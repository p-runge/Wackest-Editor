import { create } from 'zustand'

interface SettingsDialogState {
  isOpen: boolean
  focusFieldId: string | null
  openSettings: (focusFieldId?: string) => void
  closeSettings: () => void
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  isOpen: false,
  focusFieldId: null,
  openSettings: (focusFieldId) => set({ isOpen: true, focusFieldId: focusFieldId ?? null }),
  closeSettings: () => set({ isOpen: false, focusFieldId: null })
}))
