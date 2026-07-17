import { create } from 'zustand'

interface SettingsUIState {
  isOpen: boolean
  focusFieldId: string | null
  openSettings: (focusFieldId?: string) => void
  closeSettings: () => void
}

export const useSettingsUIStore = create<SettingsUIState>((set) => ({
  isOpen: false,
  focusFieldId: null,
  openSettings: (focusFieldId) => set({ isOpen: true, focusFieldId: focusFieldId ?? null }),
  closeSettings: () => set({ isOpen: false, focusFieldId: null })
}))
