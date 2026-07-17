import { create } from 'zustand'
import { temporal } from 'zundo'
import { v4 as uuidv4 } from 'uuid'
import {
  createEmptyProject,
  recomputeTimelineDuration,
  type Project,
  type SourceClip,
  type SttProviderId,
  type HeatmapProviderId
} from '@shared/types/project'
import { withRecentProject } from '@shared/types/settings'
import type { SyncProgressEvent, ExportProgressEvent } from '@shared/types/ipc'
import {
  insertActiveSwitch,
  moveIntervalBoundary,
  splitKeptRangeAt,
  removeKeptRange as removeKeptRangeFn,
  initializeKeptRanges,
  resolveVideoSourceId,
  resolveAudioSourceId
} from '../lib/timeline-edit'
import { useSettingsStore } from './settings-store'

async function recordRecentProject(projectDir: string, name: string): Promise<void> {
  const settingsState = useSettingsStore.getState()
  const current = settingsState.loaded ? settingsState.settings : await window.api.settings.get()
  const merged = {
    ...current,
    recentProjects: withRecentProject(current.recentProjects ?? [], {
      projectDir,
      name,
      lastOpenedAt: new Date().toISOString()
    })
  }
  useSettingsStore.setState({ settings: merged, loaded: true })
  await window.api.settings.set(merged)
}

interface ProjectState {
  project: Project | null
  projectDir: string | null
  isImporting: boolean
  isSyncing: boolean
  syncProgress: SyncProgressEvent | null
  isTranscribing: boolean
  sttProgress: number | null
  isScoringHeatmap: boolean
  heatmapProgress: number | null
  isExporting: boolean
  exportProgress: ExportProgressEvent | null
  lastExportPath: string | null
  projectError: string | null
  importError: string | null
  syncError: string | null
  sttError: string | null
  heatmapError: string | null
  exportError: string | null
  newProject: () => Promise<void>
  openProject: () => Promise<void>
  openRecentProject: (projectDir: string) => Promise<void>
  saveProject: () => Promise<void>
  importFiles: () => Promise<void>
  importFromDrop: (filePaths: string[]) => Promise<void>
  removeSource: (sourceId: string) => Promise<void>
  runSync: () => Promise<void>
  setManualOffset: (sourceId: string, segmentId: string, offsetSec: number) => Promise<void>
  runStt: () => Promise<void>
  setSttProvider: (provider: SttProviderId) => Promise<void>
  setSttLanguageHint: (languageHint: string) => Promise<void>
  runHeatmap: () => Promise<void>
  setHeatmapProvider: (provider: HeatmapProviderId) => Promise<void>
  setActiveVideoAt: (atSec: number, sourceId: string) => Promise<void>
  setPrimaryAudioAt: (atSec: number, sourceId: string) => Promise<void>
  moveActiveVideoBoundary: (leftIntervalId: string, atSec: number) => Promise<void>
  movePrimaryAudioBoundary: (leftIntervalId: string, atSec: number) => Promise<void>
  splitCutAt: (atSec: number) => Promise<void>
  deleteKeptRange: (rangeId: string) => Promise<void>
  runExport: () => Promise<void>
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, get) => {
      const importFromPaths = async (filePaths: string[]): Promise<void> => {
        const { project, projectDir } = get()
        if (!project || !projectDir || filePaths.length === 0) return

        set({ isImporting: true, importError: null })
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
          set({ importError: String(err) })
        } finally {
          set({ isImporting: false })
        }
      }

      return {
        project: null,
        projectDir: null,
        isImporting: false,
        isSyncing: false,
        syncProgress: null,
        isTranscribing: false,
        sttProgress: null,
        isScoringHeatmap: false,
        heatmapProgress: null,
        isExporting: false,
        exportProgress: null,
        lastExportPath: null,
        projectError: null,
        importError: null,
        syncError: null,
        sttError: null,
        heatmapError: null,
        exportError: null,

        newProject: async () => {
          const dir = await window.api.project.chooseDirectory()
          if (!dir) return
          const name = dir.split(/[/\\]/).pop() ?? 'Neues Projekt'
          const project = createEmptyProject(name, uuidv4())
          set({ project, projectDir: dir, projectError: null })
          await window.api.project.save({ projectDir: dir, project })
          await recordRecentProject(dir, name)
        },

        openProject: async () => {
          const filePath = await window.api.project.openDialog()
          if (!filePath) return
          try {
            const { project, projectDir } = await window.api.project.load({
              projectFilePath: filePath
            })
            set({ project, projectDir, projectError: null })
            await recordRecentProject(projectDir, project.name)
          } catch (err) {
            set({ projectError: String(err) })
          }
        },

        openRecentProject: async (projectDir) => {
          try {
            const { project, projectDir: resolvedDir } = await window.api.project.openRecent({
              projectDir
            })
            set({ project, projectDir: resolvedDir, projectError: null })
            await recordRecentProject(resolvedDir, project.name)
          } catch (err) {
            set({ projectError: String(err) })
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
          await importFromPaths(filePaths)
        },

        importFromDrop: async (filePaths) => {
          await importFromPaths(filePaths)
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
            set({ importError: String(err) })
          }
        },

        runSync: async () => {
          const { project } = get()
          if (!project || project.sources.length === 0) return

          set({ isSyncing: true, syncError: null, syncProgress: null })
          const unsubscribe = window.api.sync.onProgress((update) => set({ syncProgress: update }))
          try {
            const updatedSources = await window.api.sync.run({ sources: project.sources })
            set((state) => {
              if (!state.project) return state
              const updated: Project = { ...state.project, sources: updatedSources }
              updated.timelineDurationSec = recomputeTimelineDuration(updated)
              if (updated.edit.keptRanges.length === 0 && updated.timelineDurationSec > 0) {
                updated.edit = {
                  ...updated.edit,
                  keptRanges: initializeKeptRanges(updated.timelineDurationSec)
                }
              }
              return { project: updated }
            })
            await get().saveProject()
          } catch (err) {
            set({ syncError: String(err) })
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

          set({ isTranscribing: true, sttError: null, sttProgress: null })
          const unsubscribe = window.api.stt.onProgress((update) =>
            set({ sttProgress: update.progress })
          )
          try {
            const transcript = await window.api.stt.run({ project })
            set((state) => {
              if (!state.project) return state
              return { project: { ...state.project, transcript } }
            })
            await get().saveProject()
          } catch (err) {
            set({ sttError: String(err) })
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

        runHeatmap: async () => {
          const { project, projectDir } = get()
          if (!project || !projectDir) return

          set({ isScoringHeatmap: true, heatmapError: null, heatmapProgress: null })
          const unsubscribe = window.api.heatmap.onProgress((update) =>
            set({ heatmapProgress: update.progress })
          )
          try {
            const heatmap = await window.api.heatmap.run({ project, projectDir })
            set((state) => {
              if (!state.project) return state
              return { project: { ...state.project, heatmap } }
            })
            await get().saveProject()
          } catch (err) {
            set({ heatmapError: String(err) })
          } finally {
            unsubscribe()
            set({ isScoringHeatmap: false, heatmapProgress: null })
          }
        },

        setHeatmapProvider: async (provider) => {
          set((state) => {
            if (!state.project) return state
            return {
              project: {
                ...state.project,
                providerConfig: {
                  ...state.project.providerConfig,
                  heatmap: { ...state.project.providerConfig.heatmap, provider }
                }
              }
            }
          })
          await get().saveProject()
        },

        setActiveVideoAt: async (atSec, sourceId) => {
          let changed = false
          set((state) => {
            if (!state.project) return state
            const currentActiveId = resolveVideoSourceId(
              state.project.edit.activeVideoIntervals,
              state.project.sources,
              atSec
            )
            if (currentActiveId === sourceId) return state
            changed = true
            const activeVideoIntervals = insertActiveSwitch(
              state.project.edit.activeVideoIntervals,
              atSec,
              sourceId,
              state.project.timelineDurationSec
            )
            return {
              project: { ...state.project, edit: { ...state.project.edit, activeVideoIntervals } }
            }
          })
          if (changed) await get().saveProject()
        },

        setPrimaryAudioAt: async (atSec, sourceId) => {
          let changed = false
          set((state) => {
            if (!state.project) return state
            const activeVideoId = resolveVideoSourceId(
              state.project.edit.activeVideoIntervals,
              state.project.sources,
              atSec
            )
            const currentActiveAudioId = resolveAudioSourceId(
              state.project.edit.primaryAudioIntervals,
              state.project.sources,
              atSec,
              activeVideoId
            )
            if (currentActiveAudioId === sourceId) return state
            changed = true
            const primaryAudioIntervals = insertActiveSwitch(
              state.project.edit.primaryAudioIntervals,
              atSec,
              sourceId,
              state.project.timelineDurationSec
            )
            return {
              project: { ...state.project, edit: { ...state.project.edit, primaryAudioIntervals } }
            }
          })
          if (changed) await get().saveProject()
        },

        moveActiveVideoBoundary: async (leftIntervalId, atSec) => {
          set((state) => {
            if (!state.project) return state
            const activeVideoIntervals = moveIntervalBoundary(
              state.project.edit.activeVideoIntervals,
              leftIntervalId,
              atSec
            )
            return {
              project: { ...state.project, edit: { ...state.project.edit, activeVideoIntervals } }
            }
          })
          await get().saveProject()
        },

        movePrimaryAudioBoundary: async (leftIntervalId, atSec) => {
          set((state) => {
            if (!state.project) return state
            const primaryAudioIntervals = moveIntervalBoundary(
              state.project.edit.primaryAudioIntervals,
              leftIntervalId,
              atSec
            )
            return {
              project: { ...state.project, edit: { ...state.project.edit, primaryAudioIntervals } }
            }
          })
          await get().saveProject()
        },

        splitCutAt: async (atSec) => {
          set((state) => {
            if (!state.project) return state
            const existing =
              state.project.edit.keptRanges.length > 0
                ? state.project.edit.keptRanges
                : initializeKeptRanges(state.project.timelineDurationSec)
            const keptRanges = splitKeptRangeAt(existing, atSec)
            return { project: { ...state.project, edit: { ...state.project.edit, keptRanges } } }
          })
          await get().saveProject()
        },

        deleteKeptRange: async (rangeId) => {
          set((state) => {
            if (!state.project) return state
            const keptRanges = removeKeptRangeFn(state.project.edit.keptRanges, rangeId)
            return { project: { ...state.project, edit: { ...state.project.edit, keptRanges } } }
          })
          await get().saveProject()
        },

        runExport: async () => {
          const { project } = get()
          if (!project) return

          const outputPath = await window.api.export.chooseOutput()
          if (!outputPath) return

          set({ isExporting: true, exportError: null, exportProgress: null, lastExportPath: null })
          const unsubscribe = window.api.export.onProgress((update) =>
            set({ exportProgress: update })
          )
          try {
            await window.api.export.run({ project, outputPath })
            set({ lastExportPath: outputPath })
          } catch (err) {
            set({ exportError: String(err) })
          } finally {
            unsubscribe()
            set({ isExporting: false, exportProgress: null })
          }
        }
      }
    },
    { partialize: (state) => ({ project: state.project }), limit: 50 }
  )
)
