import { create } from 'zustand'
import type { AppSettings } from '@shared/types/settings'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<AppSettings>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {},
  loaded: false,

  load: async () => {
    const settings = await window.api.settings.get()
    set({ settings, loaded: true })
  },

  update: async (patch) => {
    const merged = { ...get().settings, ...patch }
    set({ settings: merged })
    await window.api.settings.set(merged)
  }
}))
