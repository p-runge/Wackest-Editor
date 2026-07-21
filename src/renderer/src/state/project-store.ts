import { create } from 'zustand'
import { temporal } from 'zundo'
import { v4 as uuidv4 } from 'uuid'
import {
  createEmptyProject,
  recomputeTimelineDuration,
  type Project,
  type SourceClip,
  type TranscriptionProviderId,
  type HeatmapProviderId
} from '@shared/types/project'
import { withRecentProject } from '@shared/types/settings'
import type { SamplingDensity } from '@shared/types/sampling'
import type {
  SyncProgressEvent,
  ExportProgressEvent,
  SourceImportProgressEvent
} from '@shared/types/ipc'
import {
  insertActiveSwitch,
  moveIntervalBoundary,
  extendKeptRangesToDuration,
  resolveIntervalAt,
  resolveVideoSourceId,
  defaultVideoSourceAt,
  defaultAudioSourceAt,
  fillActiveIntervalGaps,
  splitKeptRangeAt,
  removeKeptRange,
  deleteKeptRangeById,
  deleteKeptRangesByIds,
  resolveMovePlacement,
  resolveGroupMovePlacement
} from '../lib/timeline-edit'
import { computeAutoVideoIntervals } from '../lib/auto-switch'
import { reconcileProject } from '../lib/reconcile'
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
  importingFiles: SourceImportProgressEvent[]
  isSyncing: boolean
  syncProgress: SyncProgressEvent | null
  isTranscribing: boolean
  transcriptionProgress: number | null
  isScoringHeatmap: boolean
  heatmapProgress: number | null
  autoSwitchSummary: { switches: number; changed: boolean } | null
  isExporting: boolean
  exportProgress: ExportProgressEvent | null
  lastExportPath: string | null
  projectError: string | null
  importError: string | null
  syncError: string | null
  transcriptionError: string | null
  heatmapError: string | null
  exportError: string | null
  newProject: () => Promise<void>
  openProject: () => Promise<void>
  openRecentProject: (projectDir: string) => Promise<void>
  resolveInvalidProject: (action: 'discard' | 'cancel') => Promise<void>
  saveProject: () => Promise<void>
  importSources: () => Promise<void>
  importSourcesFromDrop: (filePaths: string[]) => Promise<void>
  cancelImportFile: (filePath: string) => void
  removeSource: (sourceId: string) => Promise<void>
  runSync: () => Promise<void>
  setManualOffset: (sourceId: string, segmentId: string, offsetSec: number) => Promise<void>
  runTranscription: () => Promise<void>
  setTranscriptionProvider: (provider: TranscriptionProviderId) => Promise<void>
  setTranscriptionLanguageHint: (languageHint: string) => Promise<void>
  runHeatmap: (density: SamplingDensity) => Promise<void>
  setHeatmapProvider: (provider: HeatmapProviderId) => Promise<void>
  generateAutoSwitch: (options: { minShotSec: number; audioFollowsVideo: boolean }) => Promise<void>
  setActiveVideoAt: (atSec: number, sourceId: string) => Promise<void>
  setActiveAudioAt: (atSec: number, sourceId: string) => Promise<void>
  moveActiveVideoBoundary: (leftIntervalId: string, atSec: number) => Promise<void>
  moveActiveAudioBoundary: (leftIntervalId: string, atSec: number) => Promise<void>
  splitKeptRangeAtPlayhead: (atSec: number) => Promise<void>
  cutRange: (startSec: number, endSec: number) => Promise<void>
  moveKeptRange: (id: string, newStartSec: number) => Promise<void>
  deleteKeptRange: (id: string) => Promise<void>
  moveKeptRanges: (
    selectedIds: Set<string>,
    leaderId: string,
    newLeaderStartSec: number
  ) => Promise<void>
  deleteKeptRanges: (ids: Set<string>) => Promise<void>
  runExport: () => Promise<void>
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, get) => {
      const importFromPaths = async (filePaths: string[]): Promise<void> => {
        const { project, projectDir } = get()
        if (!project || !projectDir || filePaths.length === 0) return

        const initialFiles: SourceImportProgressEvent[] = filePaths.map((filePath, fileIndex) => ({
          filePath,
          fileName: filePath.split(/[/\\]/).pop() ?? filePath,
          fileIndex,
          fileCount: filePaths.length,
          stage: 'probing',
          progress: 0
        }))
        set({ isImporting: true, importError: null, importingFiles: initialFiles })

        const unsubscribe = window.api.source.onImportProgress((update) => {
          set((state) => ({
            importingFiles: state.importingFiles.map((f) =>
              f.fileIndex === update.fileIndex ? update : f
            )
          }))
        })

        try {
          const newClips: SourceClip[] = await window.api.source.import({ filePaths, projectDir })
          set((state) => {
            if (!state.project) return state
            const updated: Project = {
              ...state.project,
              sources: [...state.project.sources, ...newClips]
            }
            updated.timelineDurationSec = recomputeTimelineDuration(updated)
            // Adding footage can grow the timeline past stale out-of-bounds cut ranges; reconcile
            // drops those (and any dead references) so a re-import can't leave a phantom gap.
            return { project: reconcileProject(updated) }
          })
          await get().saveProject()
        } catch (err) {
          set({ importError: String(err) })
        } finally {
          unsubscribe()
          set({ isImporting: false, importingFiles: [] })
        }
      }

      return {
        project: null,
        projectDir: null,
        invalidProject: null,
        isImporting: false,
        importingFiles: [],
        isSyncing: false,
        syncProgress: null,
        isTranscribing: false,
        transcriptionProgress: null,
        isScoringHeatmap: false,
        heatmapProgress: null,
        autoSwitchSummary: null,
        isExporting: false,
        exportProgress: null,
        lastExportPath: null,
        projectError: null,
        importError: null,
        syncError: null,
        transcriptionError: null,
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
            const project = withFullActiveCoverage(reconcileProject(result.project))
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
            const project = withFullActiveCoverage(reconcileProject(result.project))
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
            const project = withFullActiveCoverage(reconcileProject(result.project))
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

        importSources: async () => {
          const { project, projectDir } = get()
          if (!project || !projectDir) return

          const filePaths = await window.api.source.pickFiles()
          await importFromPaths(filePaths)
        },

        importSourcesFromDrop: async (filePaths) => {
          await importFromPaths(filePaths)
        },

        cancelImportFile: (filePath) => {
          void window.api.source.cancelImport({ filePath })
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
            // Drop transcript/heatmap/cut state that referenced the removed source (and reset cuts
            // if the whole footage set was swapped), then re-fill active coverage so the timeline
            // never has a gap where footage still exists but nothing is active.
            return { project: withFullActiveCoverage(reconcileProject(updated)) }
          })
          await get().saveProject()
          try {
            await window.api.source.removeCache({ projectDir, sourceId })
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
                sources: result.sources
              }
              updated.timelineDurationSec = recomputeTimelineDuration(updated)
              // Initialize cuts on first sync, and — crucially for a later sync that appended a
              // non-overlapping source — extend coverage so the new tail/track isn't left invisible.
              updated.edit = {
                ...updated.edit,
                keptRanges: extendKeptRangesToDuration(
                  updated.edit.keptRanges,
                  updated.timelineDurationSec
                )
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

        runTranscription: async () => {
          const { project } = get()
          if (!project) return

          set({ isTranscribing: true, transcriptionError: null, transcriptionProgress: null })
          const unsubscribe = window.api.transcription.onProgress((update) =>
            set({ transcriptionProgress: update.progress })
          )
          try {
            const transcript = await window.api.transcription.run({ project })
            set((state) => {
              if (!state.project) return state
              return { project: { ...state.project, transcript } }
            })
            await get().saveProject()
          } catch (err) {
            set({ transcriptionError: String(err) })
          } finally {
            unsubscribe()
            set({ isTranscribing: false, transcriptionProgress: null })
          }
        },

        setTranscriptionProvider: async (provider) => {
          set((state) => {
            if (!state.project) return state
            return {
              project: {
                ...state.project,
                providerConfig: {
                  ...state.project.providerConfig,
                  transcription: { ...state.project.providerConfig.transcription, provider }
                }
              }
            }
          })
          await get().saveProject()
        },

        setTranscriptionLanguageHint: async (languageHint) => {
          set((state) => {
            if (!state.project) return state
            return {
              project: {
                ...state.project,
                providerConfig: {
                  ...state.project.providerConfig,
                  transcription: { ...state.project.providerConfig.transcription, languageHint }
                }
              }
            }
          })
          await get().saveProject()
        },

        runHeatmap: async (density) => {
          const { project, projectDir } = get()
          if (!project || !projectDir) return

          set({
            isScoringHeatmap: true,
            heatmapError: null,
            heatmapProgress: null,
            autoSwitchSummary: null
          })
          const unsubscribe = window.api.heatmap.onProgress((update) =>
            set({ heatmapProgress: update.progress })
          )
          try {
            const trackHeatmaps = await window.api.heatmap.run({ project, projectDir, density })
            set((state) => {
              if (!state.project) return state
              return { project: { ...state.project, trackHeatmaps } }
            })
            await get().saveProject()
          } catch (err) {
            set({ heatmapError: String(err) })
          } finally {
            unsubscribe()
            set({ isScoringHeatmap: false, heatmapProgress: null })
          }
        },

        generateAutoSwitch: async ({ minShotSec, audioFollowsVideo }) => {
          const { project } = get()
          if (!project || project.trackHeatmaps.length === 0) return

          const rawIntervals = computeAutoVideoIntervals(project.trackHeatmaps, { minShotSec })
          const activeVideoIntervals = rawIntervals.map((iv) => ({ id: uuidv4(), ...iv }))
          // Optionally point the audio at the same source as each new video shot, then let
          // withFullActiveCoverage materialize/trim both tracks to the full-coverage invariant.
          const activeAudioIntervals = audioFollowsVideo
            ? activeVideoIntervals
                .filter((iv) => project.sources.find((s) => s.id === iv.value)?.probed.hasAudio)
                .map((iv) => ({ ...iv, id: uuidv4() }))
            : project.edit.activeAudioIntervals

          const nextProject = withFullActiveCoverage({
            ...project,
            edit: { ...project.edit, activeVideoIntervals, activeAudioIntervals }
          })

          // Summary for the panel: switches = camera boundaries; `changed` compares the resolved
          // camera sequence to what was active before, so a no-op click isn't silent.
          const before = project.edit.activeVideoIntervals.map((iv) => iv.value)
          const after = nextProject.edit.activeVideoIntervals.map((iv) => iv.value)
          const changed = before.length !== after.length || before.some((v, i) => v !== after[i])

          set({
            project: nextProject,
            autoSwitchSummary: { switches: Math.max(0, after.length - 1), changed }
          })
          await get().saveProject()
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

        moveKeptRanges: async (selectedIds, leaderId, newLeaderStartSec) => {
          let changed = false
          set((state) => {
            if (!state.project) return state
            const keptRanges = resolveGroupMovePlacement(
              state.project.edit.keptRanges,
              selectedIds,
              leaderId,
              newLeaderStartSec
            )
            if (keptRanges === state.project.edit.keptRanges) return state
            changed = true
            return { project: { ...state.project, edit: { ...state.project.edit, keptRanges } } }
          })
          if (changed) await get().saveProject()
        },

        deleteKeptRanges: async (ids) => {
          let changed = false
          set((state) => {
            if (!state.project) return state
            const keptRanges = deleteKeptRangesByIds(state.project.edit.keptRanges, ids)
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
