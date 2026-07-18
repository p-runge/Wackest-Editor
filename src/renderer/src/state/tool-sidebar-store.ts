import { create } from 'zustand'

export type ToolId = 'files' | 'sync' | 'transcript' | 'heatmap' | 'export'

interface ToolSidebarState {
  activeTool: ToolId | null
  setActiveTool: (tool: ToolId | null) => void
}

export const useToolSidebarStore = create<ToolSidebarState>((set) => ({
  activeTool: 'sync',
  setActiveTool: (tool) => set({ activeTool: tool })
}))
