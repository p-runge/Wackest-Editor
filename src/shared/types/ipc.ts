import type { Project, SourceClip, TranscriptSegment } from './project'
import type { AppSettings } from './settings'

export const IpcChannels = {
  projectChooseDirectory: 'project:choose-directory',
  projectSave: 'project:save',
  projectOpenDialog: 'project:open-dialog',
  projectLoad: 'project:load',
  ingestPickFiles: 'ingest:pick-files',
  ingestImport: 'ingest:import',
  ingestRemoveCache: 'ingest:remove-cache',
  syncRun: 'sync:run',
  syncProgress: 'sync:progress',
  sttRun: 'stt:run',
  sttProgress: 'stt:progress',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsPickFile: 'settings:pick-file'
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

export interface IngestImportArgs {
  filePaths: string[]
  projectDir: string
}

export type IngestImportResult = SourceClip[]

export interface IngestRemoveCacheArgs {
  projectDir: string
  sourceId: string
}

export interface SyncRunArgs {
  sources: SourceClip[]
}

export type SyncRunResult = SourceClip[]

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

export type SettingsGetResult = AppSettings
export type SettingsSetArgs = AppSettings

export interface SettingsPickFileArgs {
  title: string
  extensions: string[]
}
