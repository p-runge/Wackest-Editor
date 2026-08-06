import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { runExportForProject } from '../jobs/export'
import { runNleExportForProject } from '../jobs/export/nle'
import {
  IpcChannels,
  type ExportChooseOutputArgs,
  type ExportFormat,
  type ExportRunArgs
} from '@shared/types/ipc'

// Per-format save-dialog extension and file-type filter.
const FORMAT_OUTPUT: Record<ExportFormat, { extension: string; filter: { name: string } }> = {
  mp4: { extension: 'mp4', filter: { name: 'MP4 Video' } },
  fcp7xml: { extension: 'xml', filter: { name: 'Final Cut Pro 7 XML (Premiere / Resolve)' } }
}

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
      const { extension, filter } = FORMAT_OUTPUT[args.format]
      const result = await dialog.showSaveDialog({
        title: 'Export speichern unter',
        defaultPath: `${sanitizeFilename(args.defaultName)}.${extension}`,
        filters: [{ name: filter.name, extensions: [extension] }]
      })
      if (result.canceled || !result.filePath) return null
      return result.filePath
    }
  )

  ipcMain.handle(IpcChannels.exportRun, async (event, args: ExportRunArgs): Promise<void> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (args.format === 'mp4') {
      await runExportForProject(args.project, args.outputPath, (update) => {
        win?.webContents.send(IpcChannels.exportProgress, update)
      })
      return
    }
    // NLE interchange export: no encoding, so it completes near-instantly — emit a single done
    // event to close out the renderer's progress UI consistently with the MP4 path.
    await runNleExportForProject(args.project, args.outputPath, args.format)
    win?.webContents.send(IpcChannels.exportProgress, { stage: 'done', progress: 1 })
  })

  ipcMain.handle(IpcChannels.exportShowInFolder, (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}
