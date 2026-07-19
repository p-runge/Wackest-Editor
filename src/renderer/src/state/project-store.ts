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
  initializeKeptRanges,
  resolveIntervalAt,
  resolveVideoSourceId,
  defaultVideoSourceAt,
  defaultAudioSourceAt,
  fillActiveIntervalGaps,
  splitKeptRangeAt,
  removeKeptRange,
  deleteKeptRangeById,
  resolveMovePlacement
} from '../lib/timeline-edit'
import { useSettingsStore } from './settings-store'

/**
 * Materializes full coverage for both active tracks after anything that can change source
 * alignment or the source list itself (sync, re-sync, a manual offset edit, removing a source) —
 * see `fillActiveIntervalGaps`. Video is filled first since the audio default depends on it
 * (prefers the resolved video source's own audio).
 */
function withFullActiveCoverage(project: Project): Project {
  const activeVideoIntervals = fillActiveIntervalGaps(
    project.edit.activeVideoIntervals,
    project.sources,
    project.timelineDurationSec,
    (atSec) => defaultVideoSourceAt(project.sources, atSec)
  )
  const activeAudioIntervals = fillActiveIntervalGaps(
    project.edit.activeAudioIntervals,
    project.sources,
    project.timelineDurationSec,
    (atSec) =>
      defaultAudioSourceAt(
        project.sources,
        atSec,
        resolveVideoSourceId(activeVideoIntervals, atSec)
      ),
    // The audio default flips at every video switch (it prefers that video's own audio), so gap
    // fills must split there too — same reasoning fillActiveIntervalGaps documents.
    activeVideoIntervals.flatMap((iv) => [iv.startSec, iv.endSec])
  )
  return {
    ...project,
    edit: { ...project.edit, activeVideoIntervals, activeAudioIntervals }
  }
}

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
}

export interface InvalidProjectInfo {
  projectFilePath: string
  projectDir: string
  issues: string[]
}

interface ProjectState {
  project: Project | null
  projectDir: string | null
  invalidProject: InvalidProjectInfo | null
  isImporting: boolean
  importingCount: number
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
  resolveInvalidProject: (action: 'discard' | 'cancel') => Promise<void>
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
  setActiveAudioAt: (atSec: number, sourceId: string) => Promise<void>
  moveActiveVideoBoundary: (leftIntervalId: string, atSec: number) => Promise<void>
  moveActiveAudioBoundary: (leftIntervalId: string, atSec: number) => Promise<void>
  splitKeptRangeAtPlayhead: (atSec: number) => Promise<void>
  cutRange: (startSec: number, endSec: number) => Promise<void>
  moveKeptRange: (id: string, newStartSec: number) => Promise<void>
  deleteKeptRange: (id: string) => Promise<void>
  runExport: () => Promise<void>
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, get) => {
      const importFromPaths = async (filePaths: string[]): Promise<void> => {
        const { project, projectDir } = get()
        if (!project || !projectDir || filePaths.length === 0) return

        set({ isImporting: true, importError: null, importingCount: filePaths.length })
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
          set({ isImporting: false, importingCount: 0 })
        }
      }

      return {
        project: null,
        projectDir: null,
        invalidProject: null,
        isImporting: false,
        importingCount: 0,
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
          useProjectStore.temporal.getState().clear()
          await window.api.project.save({ projectDir: dir, project })
          await recordRecentProject(dir, name)
        },

        openProject: async () => {
          const filePath = await window.api.project.openDialog()
          if (!filePath) return
          try {
            const result = await window.api.project.load({ projectFilePath: filePath })
            if (result.status === 'invalid') {
              set({
                invalidProject: {
                  projectFilePath: result.projectFilePath,
                  projectDir: result.projectDir,
                  issues: result.issues
                },
                projectError: null
              })
              return
            }
            // Heals any project saved before full active-interval coverage was guaranteed (or
            // hand-edited into an incomplete state) — loading is the one place every project,
            // however old, passes through before anything else can read it.
            const project = withFullActiveCoverage(result.project)
            set({ project, projectDir: result.projectDir, projectError: null })
            useProjectStore.temporal.getState().clear()
            await recordRecentProject(result.projectDir, project.name)
            await get().saveProject()
          } catch (err) {
            set({ projectError: String(err) })
          }
        },

        openRecentProject: async (projectDir) => {
          try {
            const result = await window.api.project.openRecent({ projectDir })
            if (result.status === 'invalid') {
              set({
                invalidProject: {
                  projectFilePath: result.projectFilePath,
                  projectDir: result.projectDir,
                  issues: result.issues
                },
                projectError: null
              })
              return
            }
            // See openProject's comment on withFullActiveCoverage.
            const project = withFullActiveCoverage(result.project)
            set({ project, projectDir: result.projectDir, projectError: null })
            useProjectStore.temporal.getState().clear()
            await recordRecentProject(result.projectDir, project.name)
            await get().saveProject()
          } catch (err) {
            set({ projectError: String(err) })
          }
        },

        resolveInvalidProject: async (action) => {
          const { invalidProject } = get()
          if (!invalidProject) return

          if (action === 'cancel') {
            set({ invalidProject: null })
            return
          }

          try {
            const result = await window.api.project.resolveInvalid({
              projectFilePath: invalidProject.projectFilePath,
              projectDir: invalidProject.projectDir,
              action: 'discard'
            })
            if (!result.project) {
              set({ invalidProject: null })
              return
            }
            // See openProject's comment on withFullActiveCoverage.
            const project = withFullActiveCoverage(result.project)
            set({
              project,
              projectDir: result.projectDir,
              invalidProject: null,
              projectError: null
            })
            useProjectStore.temporal.getState().clear()
            await recordRecentProject(result.projectDir, project.name)
            await get().saveProject()
          } catch (err) {
            set({ invalidProject: null, projectError: String(err) })
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
            // The removed source may have owned active-video/audio intervals — re-fill so the
            // timeline never has a gap where footage still exists but nothing is active.
            return { project: withFullActiveCoverage(updated) }
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
            const result = await window.api.sync.run({ sources: project.sources })
            set((state) => {
              if (!state.project) return state
              const updated: Project = {
                ...state.project,
                sources: result.sources,
                hardCutMarkers: result.hardCutMarkers
              }
              updated.timelineDurationSec = recomputeTimelineDuration(updated)
              if (updated.edit.keptRanges.length === 0 && updated.timelineDurationSec > 0) {
                updated.edit = {
                  ...updated.edit,
                  keptRanges: initializeKeptRanges(updated.timelineDurationSec)
                }
              }
              // Every instant with any footage gets a real active-video/audio interval — a
              // (re-)sync is exactly when the source list or their alignment can have changed,
              // e.g. a new import filling a stretch that used to be a hard-cut gap.
              return { project: withFullActiveCoverage(updated) }
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
            // A manual offset shifts where this source's footage sits in unified time, which can
            // open or close active-interval gaps — re-fill so coverage stays complete.
            return { project: withFullActiveCoverage(updated) }
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
            // Skip only when an EXPLICIT interval already names this source here. Comparing the
            // fallback-resolved id instead would wrongly no-op the case where the clicked source
            // is only active via fallback (e.g. the explicit interval's own source ran out of
            // footage) — pinning it explicitly is a real change: it fixes the lane highlight and
            // survives later edits that would shift the fallback.
            const explicit = resolveIntervalAt(state.project.edit.activeVideoIntervals, atSec)
            if (explicit?.value === sourceId) return state
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

        setActiveAudioAt: async (atSec, sourceId) => {
          let changed = false
          set((state) => {
            if (!state.project) return state
            // Same explicit-only check as setActiveVideoAt — see the comment there.
            const explicit = resolveIntervalAt(state.project.edit.activeAudioIntervals, atSec)
            if (explicit?.value === sourceId) return state
            changed = true
            const activeAudioIntervals = insertActiveSwitch(
              state.project.edit.activeAudioIntervals,
              atSec,
              sourceId,
              state.project.timelineDurationSec
            )
            return {
              project: { ...state.project, edit: { ...state.project.edit, activeAudioIntervals } }
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
              atSec,
              state.project.timelineDurationSec,
              state.project.sources
            )
            return {
              project: { ...state.project, edit: { ...state.project.edit, activeVideoIntervals } }
            }
          })
          await get().saveProject()
        },

        moveActiveAudioBoundary: async (leftIntervalId, atSec) => {
          set((state) => {
            if (!state.project) return state
            const activeAudioIntervals = moveIntervalBoundary(
              state.project.edit.activeAudioIntervals,
              leftIntervalId,
              atSec,
              state.project.timelineDurationSec,
              state.project.sources
            )
            return {
              project: { ...state.project, edit: { ...state.project.edit, activeAudioIntervals } }
            }
          })
          await get().saveProject()
        },

        splitKeptRangeAtPlayhead: async (atSec) => {
          let changed = false
          set((state) => {
            if (!state.project) return state
            const keptRanges = splitKeptRangeAt(state.project.edit.keptRanges, atSec)
            if (keptRanges === state.project.edit.keptRanges) return state
            changed = true
            return { project: { ...state.project, edit: { ...state.project.edit, keptRanges } } }
          })
          if (changed) await get().saveProject()
        },

        cutRange: async (startSec, endSec) => {
          if (endSec <= startSec) return
          let changed = false
          set((state) => {
            if (!state.project) return state
            const keptRanges = removeKeptRange(state.project.edit.keptRanges, startSec, endSec)
            if (keptRanges === state.project.edit.keptRanges) return state
            changed = true
            return { project: { ...state.project, edit: { ...state.project.edit, keptRanges } } }
          })
          if (changed) await get().saveProject()
        },

        moveKeptRange: async (id, newStartSec) => {
          let changed = false
          set((state) => {
            if (!state.project) return state
            const keptRanges = resolveMovePlacement(state.project.edit.keptRanges, id, newStartSec)
            if (keptRanges === state.project.edit.keptRanges) return state
            changed = true
            return { project: { ...state.project, edit: { ...state.project.edit, keptRanges } } }
          })
          if (changed) await get().saveProject()
        },

        deleteKeptRange: async (id) => {
          let changed = false
          set((state) => {
            if (!state.project) return state
            const keptRanges = deleteKeptRangeById(state.project.edit.keptRanges, id)
            if (keptRanges === state.project.edit.keptRanges) return state
            changed = true
            return { project: { ...state.project, edit: { ...state.project.edit, keptRanges } } }
          })
          if (changed) await get().saveProject()
        },

        runExport: async () => {
          const { project } = get()
          if (!project) return

          const outputPath = await window.api.export.chooseOutput({ defaultName: project.name })
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
    {
      partialize: (state) => ({ project: state.project }),
      equality: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      limit: 50
    }
  )
)
