import { ipcMain, dialog } from 'electron'
import { dirname, join } from 'path'
import {
  saveProject,
  readProjectFile,
  discardInvalidProjectFields
} from '../services/project-store'
import {
  IpcChannels,
  type ProjectSaveArgs,
  type ProjectLoadArgs,
  type ProjectLoadResult,
  type ProjectOpenRecentArgs,
  type ProjectResolveInvalidArgs,
  type ProjectResolveInvalidResult
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
      filters: [{ name: 'Wackest Editor Projekt', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    IpcChannels.projectLoad,
    async (_event, args: ProjectLoadArgs): Promise<ProjectLoadResult> => {
      const projectDir = dirname(args.projectFilePath)
      const outcome = await readProjectFile(args.projectFilePath)
      if (outcome.status === 'ok') {
        return { status: 'ok', project: outcome.project, projectDir }
      }
      return {
        status: 'invalid',
        projectDir,
        projectFilePath: args.projectFilePath,
        issues: outcome.issues
      }
    }
  )

  ipcMain.handle(
    IpcChannels.projectOpenRecent,
    async (_event, args: ProjectOpenRecentArgs): Promise<ProjectLoadResult> => {
      const projectFilePath = join(args.projectDir, 'project.json')
      const outcome = await readProjectFile(projectFilePath)
      if (outcome.status === 'ok') {
        return { status: 'ok', project: outcome.project, projectDir: args.projectDir }
      }
      return {
        status: 'invalid',
        projectDir: args.projectDir,
        projectFilePath,
        issues: outcome.issues
      }
    }
  )

  ipcMain.handle(
    IpcChannels.projectResolveInvalid,
    async (_event, args: ProjectResolveInvalidArgs): Promise<ProjectResolveInvalidResult> => {
      if (args.action === 'cancel') {
        return { project: null, projectDir: args.projectDir }
      }
      const project = await discardInvalidProjectFields(args.projectFilePath, args.projectDir)
      return { project, projectDir: args.projectDir }
    }
  )
}
