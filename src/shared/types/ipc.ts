import type { Project, SourceClip } from './project'

export const IpcChannels = {
  projectChooseDirectory: 'project:choose-directory',
  projectSave: 'project:save',
  projectOpenDialog: 'project:open-dialog',
  projectLoad: 'project:load',
  ingestPickFiles: 'ingest:pick-files',
  ingestImport: 'ingest:import',
  syncRun: 'sync:run',
  syncProgress: 'sync:progress'
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

export interface SyncRunArgs {
  sources: SourceClip[]
}

export type SyncRunResult = SourceClip[]

export interface SyncProgressEvent {
  stage: 'extracting' | 'correlating' | 'done'
  sourceLabel?: string
  progress: number
}
