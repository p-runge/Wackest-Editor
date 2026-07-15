import { ipcMain, dialog } from 'electron'
import { join, basename, relative, extname } from 'path'
import { mkdir, rm } from 'fs/promises'
import { v4 as uuidv4 } from 'uuid'
import { probeFile, extractWaveformPeaks, extractThumbnail } from '../services/ffmpeg'
import type { SourceClip } from '@shared/types/project'
import {
  IpcChannels,
  type IngestImportArgs,
  type IngestImportResult,
  type IngestRemoveCacheArgs
} from '@shared/types/ipc'

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'avi', 'm4v', 'webm']
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']

export function registerIngestIpc(): void {
  ipcMain.handle(IpcChannels.ingestPickFiles, async () => {
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
    IpcChannels.ingestImport,
    async (_event, args: IngestImportArgs): Promise<IngestImportResult> => {
      const cacheDir = join(args.projectDir, 'cache')
      await mkdir(cacheDir, { recursive: true })

      const clips: SourceClip[] = []

      for (const filePath of args.filePaths) {
        const probed = await probeFile(filePath)
        const id = uuidv4()
        const ext = extname(filePath).slice(1).toLowerCase()
        const kind = probed.hasVideo || VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'audio'

        let waveformCachePath: string | undefined
        let thumbnailCachePath: string | undefined

        if (probed.hasAudio) {
          waveformCachePath = await extractWaveformPeaks(
            filePath,
            cacheDir,
            id,
            probed.durationSec || 1
          )
        }
        if (probed.hasVideo) {
          thumbnailCachePath = await extractThumbnail(
            filePath,
            cacheDir,
            id,
            Math.min(1, probed.durationSec / 2)
          )
        }

        clips.push({
          id,
          kind,
          originalFilePath: filePath,
          relativeFilePath: relative(args.projectDir, filePath),
          importedAt: new Date().toISOString(),
          label: basename(filePath),
          probed,
          hardCutMarkers: [],
          // Placeholder single segment at offset 0 until Phase 2's sync graph resolves real offsets.
          syncSegments: [
            {
              id: uuidv4(),
              localStartSec: 0,
              localEndSec: probed.durationSec,
              offsetSec: 0,
              confidence: 0,
              method: 'timestamp-heuristic'
            }
          ],
          waveformCachePath,
          thumbnailCachePath
        })
      }

      return clips
    }
  )

  ipcMain.handle(IpcChannels.ingestRemoveCache, async (_event, args: IngestRemoveCacheArgs) => {
    const cacheDir = join(args.projectDir, 'cache')
    await rm(join(cacheDir, `${args.sourceId}.waveform.json`), { force: true })
    await rm(join(cacheDir, `${args.sourceId}.thumb.jpg`), { force: true })
  })
}
