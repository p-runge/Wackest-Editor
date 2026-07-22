import { app, ipcMain } from 'electron'
import { checkForUpdates, installUpdate, openDownloadPage } from '../services/updater'
import { IpcChannels } from '@shared/types/ipc'

export function registerUpdatesIpc(): void {
  ipcMain.handle(IpcChannels.updateCheck, async (): Promise<void> => {
    await checkForUpdates()
  })

  ipcMain.handle(IpcChannels.updateInstall, (): void => {
    installUpdate()
  })

  ipcMain.handle(IpcChannels.updateOpenDownloadPage, async (): Promise<void> => {
    await openDownloadPage()
  })

  ipcMain.handle(IpcChannels.updateGetVersion, (): string => {
    return app.getVersion()
  })
}
