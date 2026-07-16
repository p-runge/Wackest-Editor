import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { runExportForProject } from '../jobs/export'
import { IpcChannels, type ExportRunArgs } from '@shared/types/ipc'

export function registerExportIpc(): void {
  ipcMain.handle(IpcChannels.exportChooseOutput, async (): Promise<string | null> => {
    const result = await dialog.showSaveDialog({
      title: 'Export speichern unter',
      defaultPath: 'export.mp4',
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle(IpcChannels.exportRun, async (event, args: ExportRunArgs): Promise<void> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    await runExportForProject(args.project, args.outputPath, (update) => {
      win?.webContents.send(IpcChannels.exportProgress, update)
    })
  })

  ipcMain.handle(IpcChannels.exportShowInFolder, (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}
