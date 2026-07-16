import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { AppSettingsSchema, createDefaultSettings, type AppSettings } from '@shared/types/settings'

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsFilePath(), 'utf-8')
    return AppSettingsSchema.parse(JSON.parse(raw))
  } catch {
    return createDefaultSettings()
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const validated = AppSettingsSchema.parse(settings)
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(settingsFilePath(), JSON.stringify(validated, null, 2), 'utf-8')
}
