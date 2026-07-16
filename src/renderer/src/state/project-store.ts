import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import {
  createEmptyProject,
  recomputeTimelineDuration,
  type Project,
  type SourceClip,
  type SttProviderId
} from '@shared/types/project'
import type { SyncProgressEvent } from '@shared/types/ipc'

interface ProjectState {
  project: Project | null
  projectDir: string | null
  isImporting: boolean
  isSyncing: boolean
  syncProgress: SyncProgressEvent | null
  isTranscribing: boolean
  sttProgress: number | null
  error: string | null
  newProject: () => Promise<void>
  openProject: () => Promise<void>
  saveProject: () => Promise<void>
  importFiles: () => Promise<void>
  removeSource: (sourceId: string) => Promise<void>
  runSync: () => Promise<void>
  setManualOffset: (sourceId: string, segmentId: string, offsetSec: number) => Promise<void>
  runStt: () => Promise<void>
  setSttProvider: (provider: SttProviderId) => Promise<void>
  setSttLanguageHint: (languageHint: string) => Promise<void>
  setTranscriptionSource: (sourceId: string | undefined) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  projectDir: null,
  isImporting: false,
  isSyncing: false,
  syncProgress: null,
  isTranscribing: false,
  sttProgress: null,
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
  },

  removeSource: async (sourceId) => {
    const { project, projectDir } = get()
    if (!project || !projectDir) return

    set((state) => {
      if (!state.project) return state
      const updated: Project = {
        ...state.project,
        sources: state.project.sources.filter((source) => source.id !== sourceId)
      }
      updated.timelineDurationSec = recomputeTimelineDuration(updated)
      return { project: updated }
    })
    await get().saveProject()
    try {
      await window.api.ingest.removeCache({ projectDir, sourceId })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  runSync: async () => {
    const { project } = get()
    if (!project || project.sources.length === 0) return

    set({ isSyncing: true, error: null, syncProgress: null })
    const unsubscribe = window.api.sync.onProgress((update) => set({ syncProgress: update }))
    try {
      const updatedSources = await window.api.sync.run({ sources: project.sources })
      set((state) => {
        if (!state.project) return state
        const updated: Project = { ...state.project, sources: updatedSources }
        updated.timelineDurationSec = recomputeTimelineDuration(updated)
        return { project: updated }
      })
      await get().saveProject()
    } catch (err) {
      set({ error: String(err) })
    } finally {
      unsubscribe()
      set({ isSyncing: false, syncProgress: null })
    }
  },

  setManualOffset: async (sourceId, segmentId, offsetSec) => {
    set((state) => {
      if (!state.project) return state
      const sources = state.project.sources.map((source) => {
        if (source.id !== sourceId) return source
        return {
          ...source,
          syncSegments: source.syncSegments.map((segment) =>
            segment.id === segmentId
              ? { ...segment, offsetSec, confidence: 1, method: 'manual' as const }
              : segment
          )
        }
      })
      const updated: Project = { ...state.project, sources }
      updated.timelineDurationSec = recomputeTimelineDuration(updated)
      return { project: updated }
    })
    await get().saveProject()
  },

  runStt: async () => {
    const { project } = get()
    if (!project) return

    set({ isTranscribing: true, error: null, sttProgress: null })
    const unsubscribe = window.api.stt.onProgress((update) => set({ sttProgress: update.progress }))
    try {
      const transcript = await window.api.stt.run({ project })
      set((state) => {
        if (!state.project) return state
        return { project: { ...state.project, transcript } }
      })
      await get().saveProject()
    } catch (err) {
      set({ error: String(err) })
    } finally {
      unsubscribe()
      set({ isTranscribing: false, sttProgress: null })
    }
  },

  setSttProvider: async (provider) => {
    set((state) => {
      if (!state.project) return state
      return {
        project: {
          ...state.project,
          providerConfig: {
            ...state.project.providerConfig,
            stt: { ...state.project.providerConfig.stt, provider }
          }
        }
      }
    })
    await get().saveProject()
  },

  setSttLanguageHint: async (languageHint) => {
    set((state) => {
      if (!state.project) return state
      return {
        project: {
          ...state.project,
          providerConfig: {
            ...state.project.providerConfig,
            stt: { ...state.project.providerConfig.stt, languageHint }
          }
        }
      }
    })
    await get().saveProject()
  },

  setTranscriptionSource: async (sourceId) => {
    set((state) => {
      if (!state.project) return state
      return {
        project: {
          ...state.project,
          providerConfig: { ...state.project.providerConfig, transcriptionSourceClipId: sourceId }
        }
      }
    })
    await get().saveProject()
  }
}))
