import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { AppSettings } from '@shared/types/settings'
import { withoutRecentProject } from '@shared/types/settings'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<AppSettings>) => Promise<void>
  removeRecentProject: (projectDir: string) => Promise<void>
}

interface PersistedSettings {
  settings: AppSettings
}

// Bridges zustand's persist middleware to the existing IPC-backed settings.json
// on disk (window.api.settings.get/set), so the file format is unchanged.
const electronSettingsStorage: StateStorage = {
  getItem: async (): Promise<string> => {
    const settings = await window.api.settings.get()
    return JSON.stringify({ state: { settings } })
  },
  setItem: async (_name, value): Promise<void> => {
    const envelope = JSON.parse(value) as { state: PersistedSettings }
    await window.api.settings.set(envelope.state.settings)
  },
  removeItem: (): void => {}
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: { recentProjects: [] },
      loaded: false,

      load: async () => {
        if (!useSettingsStore.persist.hasHydrated()) {
          await useSettingsStore.persist.rehydrate()
        }
      },

      update: async (patch) => {
        set({ settings: { ...get().settings, ...patch } })
      },

      removeRecentProject: async (projectDir) => {
        set({
          settings: {
            ...get().settings,
            recentProjects: withoutRecentProject(get().settings.recentProjects ?? [], projectDir)
          }
        })
      }
    }),
    {
      name: 'app-settings',
      storage: createJSONStorage<PersistedSettings>(() => electronSettingsStorage),
      partialize: (state) => ({ settings: state.settings }),
      onRehydrateStorage: () => () => {
        useSettingsStore.setState({ loaded: true })
      }
    }
  )
)
