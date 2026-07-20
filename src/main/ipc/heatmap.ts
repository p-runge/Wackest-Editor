import { ipcMain, BrowserWindow } from 'electron'
import { runHeatmapForProject } from '../jobs/heatmap'
import { loadSettings } from '../services/settings-store'
import { IpcChannels, type HeatmapRunArgs, type HeatmapRunResult } from '@shared/types/ipc'

export function registerHeatmapIpc(): void {
  ipcMain.handle(
    IpcChannels.heatmapRun,
    async (event, args: HeatmapRunArgs): Promise<HeatmapRunResult> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const settings = await loadSettings()
      return runHeatmapForProject(
        args.project,
        args.projectDir,
        settings,
        args.density,
        (update) => {
          win?.webContents.send(IpcChannels.heatmapProgress, update)
        }
      )
    }
  )
}
