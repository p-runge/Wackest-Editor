import { ipcMain, BrowserWindow } from 'electron'
import { runTranscriptionForProject } from '../jobs/transcription'
import { loadSettings } from '../services/settings-store'
import {
  IpcChannels,
  type TranscriptionRunArgs,
  type TranscriptionRunResult
} from '@shared/types/ipc'

export function registerTranscriptionIpc(): void {
  ipcMain.handle(
    IpcChannels.transcriptionRun,
    async (event, args: TranscriptionRunArgs): Promise<TranscriptionRunResult> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const settings = await loadSettings()
      return runTranscriptionForProject(args.project, settings, (update) => {
        win?.webContents.send(IpcChannels.transcriptionProgress, update)
      })
    }
  )
}
