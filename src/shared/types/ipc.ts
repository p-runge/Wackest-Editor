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
  sourceImportProgress: 'source:import-progress',
  sourceImportCancel: 'source:import-cancel',
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
  modelsList: 'models:list',
  modelsDownload: 'models:download',
  modelsDownloadProgress: 'models:download-progress',
  modelsDownloadCancel: 'models:download-cancel',
  modelsDelete: 'models:delete',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateOpenDownloadPage: 'update:open-download-page',
  updateGetVersion: 'update:get-version',
  updateStateChanged: 'update:state-changed',
  menuUndo: 'menu:undo',
  menuRedo: 'menu:redo',
  menuSelectAll: 'menu:select-all',
  menuOpenSettings: 'menu:open-settings'
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

export interface SourceImportProgressEvent {
  filePath: string
  fileName: string
  fileIndex: number
  fileCount: number
  stage: 'probing' | 'waveform' | 'thumbnail' | 'done' | 'cancelled'
  /** 0-1, fraction of progress within the current stage/file. */
  progress: number
}

export interface SourceImportCancelArgs {
  filePath: string
}

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

// 'mp4' renders a finished, flattened video. 'fcp7xml' instead writes a non-destructive edit file
// (Final Cut Pro 7 XML, imported by both Premiere Pro and DaVinci Resolve) that references the
// original media: every raw source in parallel on the sync timeline, razor-cut at the camera/audio
// switch points with the non-active sub-clips disabled, so the active selection is preserved while
// staying fully re-editable downstream.
export type ExportFormat = 'mp4' | 'fcp7xml'

export interface ExportChooseOutputArgs {
  defaultName: string
  format: ExportFormat
}

export interface ExportRunArgs {
  project: Project
  outputPath: string
  format: ExportFormat
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

export interface ModelInfo {
  filename: string
  sizeBytes: number
  downloaded: boolean
  /** Whether this is the model shipped with the app (see getBundledWhisperModelFilename()). */
  bundled: boolean
}

export interface ModelsListResult {
  models: ModelInfo[]
  bundledFilename: string
}

export interface ModelDownloadArgs {
  filename: string
}

export interface ModelDownloadProgressEvent {
  filename: string
  /** 0-1 */
  progress: number
}

export interface ModelDownloadCancelArgs {
  filename: string
}

export interface ModelDeleteArgs {
  filename: string
}

// canAutoInstall is false on macOS: the app isn't code-signed, and Squirrel.Mac (electron-updater's
// macOS backend) refuses to silently install unsigned updates, so the renderer must fall back to
// opening the GitHub release page instead of calling updates.install().
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; canAutoInstall: boolean }
  | { state: 'downloading'; progress: number }
  | { state: 'downloaded'; version: string }
  | { state: 'not-available' }
  | { state: 'error'; message: string }
