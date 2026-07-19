import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { runExportForProject } from '../jobs/export'
import { IpcChannels, type ExportChooseOutputArgs, type ExportRunArgs } from '@shared/types/ipc'

// Strips characters that are illegal (or awkward, e.g. leading/trailing dots/spaces) in a
// filename on Windows/macOS/Linux, so the project name can be used as-is as the default export
// filename regardless of what the user named the project.
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : 'export'
}

export function registerExportIpc(): void {
  ipcMain.handle(
    IpcChannels.exportChooseOutput,
    async (_event, args: ExportChooseOutputArgs): Promise<string | null> => {
      const result = await dialog.showSaveDialog({
        title: 'Export speichern unter',
        defaultPath: `${sanitizeFilename(args.defaultName)}.mp4`,
        filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
      })
      if (result.canceled || !result.filePath) return null
      return result.filePath
    }
  )

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
