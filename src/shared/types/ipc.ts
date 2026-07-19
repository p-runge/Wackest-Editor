import type { Project, SourceClip, TranscriptSegment, HeatmapPoint } from './project'
import type { AppSettings } from './settings'

export const IpcChannels = {
  projectChooseDirectory: 'project:choose-directory',
  projectSave: 'project:save',
  projectOpenDialog: 'project:open-dialog',
  projectLoad: 'project:load',
  projectOpenRecent: 'project:open-recent',
  ingestPickFiles: 'ingest:pick-files',
  ingestImport: 'ingest:import',
  ingestRemoveCache: 'ingest:remove-cache',
  ingestReadWaveform: 'ingest:read-waveform',
  syncRun: 'sync:run',
  syncProgress: 'sync:progress',
  sttRun: 'stt:run',
  sttProgress: 'stt:progress',
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
  menuRedo: 'menu:redo'
} as const

export interface ProjectSaveArgs {
  projectDir: string
  project: Project
}

export interface ProjectLoadArgs {
  projectFilePath: string
}

export interface ProjectLoadResult {
  project: Project
  projectDir: string
}

export interface ProjectOpenRecentArgs {
  projectDir: string
}

export interface IngestImportArgs {
  filePaths: string[]
  projectDir: string
}

export type IngestImportResult = SourceClip[]

export interface IngestRemoveCacheArgs {
  projectDir: string
  sourceId: string
}

export type IngestReadWaveformResult = Array<[number, number]>

export interface SyncRunArgs {
  sources: SourceClip[]
}

export interface SyncRunResult {
  sources: SourceClip[]
  hardCutMarkers: number[]
}

export interface SyncProgressEvent {
  stage: 'extracting' | 'correlating' | 'done'
  sourceLabel?: string
  progress: number
}

export interface SttRunArgs {
  project: Project
}

export type SttRunResult = TranscriptSegment[]

export interface SttProgressEvent {
  progress: number
}

export interface HeatmapRunArgs {
  project: Project
  projectDir: string
  bucketSec?: number
}

export type HeatmapRunResult = HeatmapPoint[]

export interface HeatmapProgressEvent {
  progress: number
}

export interface ExportRunArgs {
  project: Project
  outputPath: string
}

export interface ExportProgressEvent {
  stage: 'rendering' | 'concatenating' | 'done'
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
