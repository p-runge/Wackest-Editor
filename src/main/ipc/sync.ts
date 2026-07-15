import { ipcMain, BrowserWindow } from 'electron'
import { runSyncForProject } from '../jobs/sync'
import { IpcChannels, type SyncRunArgs, type SyncRunResult } from '@shared/types/ipc'

export function registerSyncIpc(): void {
  ipcMain.handle(IpcChannels.syncRun, async (event, args: SyncRunArgs): Promise<SyncRunResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return runSyncForProject(args.sources, (update) => {
      win?.webContents.send(IpcChannels.syncProgress, update)
    })
  })
}
