import { ipcMain, BrowserWindow } from 'electron'
import { runHeatmapForProject } from '../jobs/heatmap'
import { loadSettings } from '../services/settings-store'
import { IpcChannels, type HeatmapRunArgs, type HeatmapRunResult } from '@shared/types/ipc'

const DEFAULT_BUCKET_SEC = 20

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
        args.bucketSec ?? DEFAULT_BUCKET_SEC,
        (update) => {
          win?.webContents.send(IpcChannels.heatmapProgress, update)
        }
      )
    }
  )
}
