import { ipcMain, BrowserWindow } from 'electron'
import { runSttForProject } from '../jobs/stt'
import { loadSettings } from '../services/settings-store'
import { IpcChannels, type SttRunArgs, type SttRunResult } from '@shared/types/ipc'

export function registerSttIpc(): void {
  ipcMain.handle(IpcChannels.sttRun, async (event, args: SttRunArgs): Promise<SttRunResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const settings = await loadSettings()
    return runSttForProject(args.project, settings, (update) => {
      win?.webContents.send(IpcChannels.sttProgress, update)
    })
  })
}
