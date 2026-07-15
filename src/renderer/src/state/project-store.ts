import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import {
  createEmptyProject,
  recomputeTimelineDuration,
  type Project,
  type SourceClip
} from '@shared/types/project'

interface ProjectState {
  project: Project | null
  projectDir: string | null
  isImporting: boolean
  error: string | null
  newProject: () => Promise<void>
  openProject: () => Promise<void>
  saveProject: () => Promise<void>
  importFiles: () => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  projectDir: null,
  isImporting: false,
  error: null,

  newProject: async () => {
    const dir = await window.api.project.chooseDirectory()
    if (!dir) return
    const name = dir.split('/').pop() ?? 'Neues Projekt'
    const project = createEmptyProject(name, uuidv4())
    set({ project, projectDir: dir, error: null })
    await window.api.project.save({ projectDir: dir, project })
  },

  openProject: async () => {
    const filePath = await window.api.project.openDialog()
    if (!filePath) return
    try {
      const { project, projectDir } = await window.api.project.load({ projectFilePath: filePath })
      set({ project, projectDir, error: null })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  saveProject: async () => {
    const { project, projectDir } = get()
    if (!project || !projectDir) return
    await window.api.project.save({ projectDir, project })
  },

  importFiles: async () => {
    const { project, projectDir } = get()
    if (!project || !projectDir) return

    const filePaths = await window.api.ingest.pickFiles()
    if (filePaths.length === 0) return

    set({ isImporting: true, error: null })
    try {
      const newClips: SourceClip[] = await window.api.ingest.import({ filePaths, projectDir })
      set((state) => {
        if (!state.project) return state
        const updated: Project = {
          ...state.project,
          sources: [...state.project.sources, ...newClips]
        }
        updated.timelineDurationSec = recomputeTimelineDuration(updated)
        return { project: updated }
      })
      await get().saveProject()
    } catch (err) {
      set({ error: String(err) })
    } finally {
      set({ isImporting: false })
    }
  }
}))
