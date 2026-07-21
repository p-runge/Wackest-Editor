import { ipcMain, BrowserWindow } from 'electron'
import {
  listAvailableModels,
  isModelDownloaded,
  downloadModel,
  deleteDownloadedModel
} from '../services/model-catalog'
import { getBundledWhisperModelFilename } from '../services/providers/transcription/bundled-resources'
import {
  IpcChannels,
  type ModelsListResult,
  type ModelDownloadArgs,
  type ModelDownloadProgressEvent,
  type ModelDownloadCancelArgs,
  type ModelDeleteArgs
} from '@shared/types/ipc'

// Keyed by filename so a cancel request from the renderer can find the in-flight download —
// mirrors `activeImports` in ipc/source.ts. Only one download per filename is expected at a time.
const activeDownloads = new Map<string, AbortController>()

export function registerModelsIpc(): void {
  ipcMain.handle(IpcChannels.modelsList, async (): Promise<ModelsListResult> => {
    const bundledFilename = getBundledWhisperModelFilename()
    const models = await listAvailableModels()
    return {
      bundledFilename,
      models: models.map((model) => ({
        ...model,
        bundled: model.filename === bundledFilename,
        downloaded: model.filename === bundledFilename || isModelDownloaded(model.filename)
      }))
    }
  })

  ipcMain.handle(
    IpcChannels.modelsDownload,
    async (event, args: ModelDownloadArgs): Promise<void> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const controller = new AbortController()
      activeDownloads.set(args.filename, controller)
      try {
        await downloadModel(args.filename, {
          signal: controller.signal,
          onProgress: (progress) => {
            win?.webContents.send(IpcChannels.modelsDownloadProgress, {
              filename: args.filename,
              progress
            } satisfies ModelDownloadProgressEvent)
          }
        })
      } finally {
        activeDownloads.delete(args.filename)
      }
    }
  )

  ipcMain.handle(
    IpcChannels.modelsDownloadCancel,
    async (_event, args: ModelDownloadCancelArgs): Promise<void> => {
      activeDownloads.get(args.filename)?.abort()
    }
  )

  ipcMain.handle(IpcChannels.modelsDelete, async (_event, args: ModelDeleteArgs): Promise<void> => {
    await deleteDownloadedModel(args.filename)
  })
}
