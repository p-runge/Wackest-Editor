import { ipcMain, dialog } from 'electron'
import { dirname, join } from 'path'
import { saveProject, loadProject } from '../services/project-store'
import {
  IpcChannels,
  type ProjectSaveArgs,
  type ProjectLoadArgs,
  type ProjectOpenRecentArgs
} from '@shared/types/ipc'

export function registerProjectIpc(): void {
  ipcMain.handle(IpcChannels.projectChooseDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Projektordner wählen',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.projectSave, async (_event, args: ProjectSaveArgs) => {
    await saveProject(args.projectDir, args.project)
  })

  ipcMain.handle(IpcChannels.projectOpenDialog, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Projekt öffnen',
      properties: ['openFile'],
      filters: [{ name: 'Wackest Tool Projekt', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.projectLoad, async (_event, args: ProjectLoadArgs) => {
    const project = await loadProject(args.projectFilePath)
    return { project, projectDir: dirname(args.projectFilePath) }
  })

  ipcMain.handle(IpcChannels.projectOpenRecent, async (_event, args: ProjectOpenRecentArgs) => {
    const projectFilePath = join(args.projectDir, 'project.json')
    const project = await loadProject(projectFilePath)
    return { project, projectDir: args.projectDir }
  })
}
