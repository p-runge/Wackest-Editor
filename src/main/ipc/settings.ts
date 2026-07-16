import { ipcMain, dialog } from 'electron'
import { loadSettings, saveSettings } from '../services/settings-store'
import {
  IpcChannels,
  type SettingsGetResult,
  type SettingsSetArgs,
  type SettingsPickFileArgs
} from '@shared/types/ipc'

export function registerSettingsIpc(): void {
  ipcMain.handle(IpcChannels.settingsGet, async (): Promise<SettingsGetResult> => loadSettings())

  ipcMain.handle(
    IpcChannels.settingsSet,
    async (_event, settings: SettingsSetArgs): Promise<void> => {
      await saveSettings(settings)
    }
  )

  ipcMain.handle(
    IpcChannels.settingsPickFile,
    async (_event, args: SettingsPickFileArgs): Promise<string | null> => {
      const result = await dialog.showOpenDialog({
        title: args.title,
        properties: ['openFile'],
        filters: [{ name: 'Datei', extensions: args.extensions }]
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    }
  )
}
