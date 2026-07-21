import { ipcMain, dialog, BrowserWindow } from 'electron'
import { join, basename, relative, extname } from 'path'
import { mkdir, rm, readFile } from 'fs/promises'
import { v4 as uuidv4 } from 'uuid'
import {
  probeFile,
  extractWaveformPeaks,
  extractThumbnail,
  MediaOperationCancelledError
} from '../services/ffmpeg'
import type { SourceClip } from '@shared/types/project'
import {
  IpcChannels,
  type SourceImportArgs,
  type SourceImportResult,
  type SourceImportProgressEvent,
  type SourceImportCancelArgs,
  type SourceRemoveCacheArgs,
  type SourceReadWaveformResult
} from '@shared/types/ipc'

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'avi', 'm4v', 'webm']
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']

// Keyed by filePath so a cancel request from the renderer (which only knows the path) can find
// the in-flight ffmpeg operation for that file. Entries only exist while that file's import is
// actually running, and only one sourceImport batch is expected to run at a time in this app.
const activeImports = new Map<string, AbortController>()

export function registerSourceIpc(): void {
  ipcMain.handle(IpcChannels.sourcePickFiles, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Rohspuren importieren',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video & Audio', extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] },
        { name: 'Alle Dateien', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle(
    IpcChannels.sourceImport,
    async (event, args: SourceImportArgs): Promise<SourceImportResult> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const cacheDir = join(args.projectDir, 'cache')
      await mkdir(cacheDir, { recursive: true })

      const clips: SourceClip[] = []
      const fileCount = args.filePaths.length

      // Registered upfront (not lazily per iteration) so a cancel request for a file that's still
      // queued behind an earlier one in this batch has a controller to abort — otherwise it would
      // silently no-op and the file would import anyway once its turn comes.
      const controllers = args.filePaths.map(() => new AbortController())
      args.filePaths.forEach((filePath, i) => activeImports.set(filePath, controllers[i]))

      for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
        const filePath = args.filePaths[fileIndex]
        const fileName = basename(filePath)
        const controller = controllers[fileIndex]

        const report = (stage: SourceImportProgressEvent['stage'], progress: number): void => {
          win?.webContents.send(IpcChannels.sourceImportProgress, {
            filePath,
            fileName,
            fileIndex,
            fileCount,
            stage,
            progress
          } satisfies SourceImportProgressEvent)
        }

        let id: string | undefined
        try {
          report('probing', 0)
          if (controller.signal.aborted) throw new MediaOperationCancelledError()
          const probed = await probeFile(filePath)
          id = uuidv4()
          const ext = extname(filePath).slice(1).toLowerCase()
          const kind = probed.hasVideo || VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'audio'

          let waveformCachePath: string | undefined
          let thumbnailCachePath: string | undefined

          if (controller.signal.aborted) throw new MediaOperationCancelledError()
          if (probed.hasAudio) {
            report('waveform', 0)
            waveformCachePath = await extractWaveformPeaks(
              filePath,
              cacheDir,
              id,
              probed.durationSec || 1,
              {
                signal: controller.signal,
                onProgress: (fraction) => report('waveform', fraction)
              }
            )
          }
          if (controller.signal.aborted) throw new MediaOperationCancelledError()
          if (probed.hasVideo) {
            report('thumbnail', 0)
            thumbnailCachePath = await extractThumbnail(
              filePath,
              cacheDir,
              id,
              Math.min(1, probed.durationSec / 2),
              { signal: controller.signal }
            )
          }

          clips.push({
            id,
            kind,
            originalFilePath: filePath,
            relativeFilePath: relative(args.projectDir, filePath),
            importedAt: new Date().toISOString(),
            label: fileName,
            probed,
            // Placeholder single segment at offset 0 until Phase 2's sync graph resolves real offsets.
            syncSegments: [
              {
                id: uuidv4(),
                localStartSec: 0,
                localEndSec: probed.durationSec,
                offsetSec: 0,
                confidence: 0,
                method: 'no-overlap-gap'
              }
            ],
            waveformCachePath,
            thumbnailCachePath
          })
          report('done', 1)
        } catch (err) {
          if (err instanceof MediaOperationCancelledError) {
            report('cancelled', 1)
            // A cancelled extract can leave a partial thumbnail behind (the waveform's own PCM
            // temp file cleans itself up in extractWaveformPeaks) — this clip was never pushed,
            // so nothing else references these paths.
            if (id) await rm(join(cacheDir, `${id}.thumb.jpg`), { force: true })
          } else {
            throw err
          }
        } finally {
          activeImports.delete(filePath)
        }
      }

      return clips
    }
  )

  ipcMain.handle(IpcChannels.sourceImportCancel, async (_event, args: SourceImportCancelArgs) => {
    activeImports.get(args.filePath)?.abort()
  })

  ipcMain.handle(IpcChannels.sourceRemoveCache, async (_event, args: SourceRemoveCacheArgs) => {
    const cacheDir = join(args.projectDir, 'cache')
    await rm(join(cacheDir, `${args.sourceId}.waveform.json`), { force: true })
    await rm(join(cacheDir, `${args.sourceId}.thumb.jpg`), { force: true })
  })

  ipcMain.handle(
    IpcChannels.sourceReadWaveform,
    async (_event, waveformCachePath: string): Promise<SourceReadWaveformResult> => {
      const raw = await readFile(waveformCachePath, 'utf-8')
      return JSON.parse(raw) as Array<[number, number]>
    }
  )
}
