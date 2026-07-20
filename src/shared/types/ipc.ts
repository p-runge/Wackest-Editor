import type { Project, SourceClip, TranscriptSegment, TrackHeatmap } from './project'
import type { AppSettings } from './settings'
import type { SamplingDensity } from './sampling'

export const IpcChannels = {
  projectChooseDirectory: 'project:choose-directory',
  projectSave: 'project:save',
  projectOpenDialog: 'project:open-dialog',
  projectLoad: 'project:load',
  projectOpenRecent: 'project:open-recent',
  projectResolveInvalid: 'project:resolve-invalid',
  sourcePickFiles: 'source:pick-files',
  sourceImport: 'source:import',
  sourceRemoveCache: 'source:remove-cache',
  sourceReadWaveform: 'source:read-waveform',
  syncRun: 'sync:run',
  syncProgress: 'sync:progress',
  transcriptionRun: 'transcription:run',
  transcriptionProgress: 'transcription:progress',
  heatmapRun: 'heatmap:run',
  heatmapProgress: 'heatmap:progress',
  exportChooseOutput: 'export:choose-output',
  exportRun: 'export:run',
  exportProgress: 'export:progress',
  exportShowInFolder: 'export:show-in-folder',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsPickFile: 'settings:pick-file',
  menuUndo: 'menu:undo',
  menuRedo: 'menu:redo',
  menuSelectAll: 'menu:select-all'
} as const

export interface ProjectSaveArgs {
  projectDir: string
  project: Project
}

export interface ProjectLoadArgs {
  projectFilePath: string
}

export interface ProjectLoadOkResult {
  status: 'ok'
  project: Project
  projectDir: string
}

// Returned when project.json doesn't match ProjectSchema, so the renderer can offer the user a
// choice between discarding the unmatched fields (with a timestamped backup) or cancelling.
export interface ProjectLoadInvalidResult {
  status: 'invalid'
  projectDir: string
  projectFilePath: string
  issues: string[]
}

export type ProjectLoadResult = ProjectLoadOkResult | ProjectLoadInvalidResult

export interface ProjectOpenRecentArgs {
  projectDir: string
}

export interface ProjectResolveInvalidArgs {
  projectFilePath: string
  projectDir: string
  action: 'discard' | 'cancel'
}

export interface ProjectResolveInvalidResult {
  project: Project | null
  projectDir: string
}

export interface SourceImportArgs {
  filePaths: string[]
  projectDir: string
}

export type SourceImportResult = SourceClip[]

export interface SourceRemoveCacheArgs {
  projectDir: string
  sourceId: string
}

export type SourceReadWaveformResult = Array<[number, number]>

export interface SyncRunArgs {
  sources: SourceClip[]
}

export interface SyncRunResult {
  sources: SourceClip[]
}

export interface SyncProgressEvent {
  stage: 'extracting' | 'correlating' | 'done'
  sourceLabel?: string
  progress: number
}

export interface TranscriptionRunArgs {
  project: Project
}

export type TranscriptionRunResult = TranscriptSegment[]

export interface TranscriptionProgressEvent {
  progress: number
}

export interface HeatmapRunArgs {
  project: Project
  projectDir: string
  density: SamplingDensity
}

export type HeatmapRunResult = TrackHeatmap[]

export interface HeatmapProgressEvent {
  progress: number
}

export interface ExportChooseOutputArgs {
  defaultName: string
}

export interface ExportRunArgs {
  project: Project
  outputPath: string
}

export interface ExportProgressEvent {
  stage: 'rendering-video' | 'rendering-audio' | 'concatenating' | 'muxing' | 'done'
  segmentIndex?: number
  segmentCount?: number
  progress: number
}

export type SettingsGetResult = AppSettings
export type SettingsSetArgs = AppSettings

export interface SettingsPickFileArgs {
  title: string
  extensions: string[]
}
