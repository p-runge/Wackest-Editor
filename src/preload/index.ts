import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels } from '@shared/types/ipc'
import type {
  ProjectSaveArgs,
  ProjectLoadArgs,
  ProjectLoadResult,
  IngestImportArgs,
  IngestImportResult,
  SyncRunArgs,
  SyncRunResult,
  SyncProgressEvent
} from '@shared/types/ipc'

const api = {
  project: {
    chooseDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.projectChooseDirectory),
    save: (args: ProjectSaveArgs): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.projectSave, args),
    openDialog: (): Promise<string | null> => ipcRenderer.invoke(IpcChannels.projectOpenDialog),
    load: (args: ProjectLoadArgs): Promise<ProjectLoadResult> =>
      ipcRenderer.invoke(IpcChannels.projectLoad, args)
  },
  ingest: {
    pickFiles: (): Promise<string[]> => ipcRenderer.invoke(IpcChannels.ingestPickFiles),
    import: (args: IngestImportArgs): Promise<IngestImportResult> =>
      ipcRenderer.invoke(IpcChannels.ingestImport, args)
  },
  sync: {
    run: (args: SyncRunArgs): Promise<SyncRunResult> =>
      ipcRenderer.invoke(IpcChannels.syncRun, args),
    onProgress: (callback: (update: SyncProgressEvent) => void): (() => void) => {
      const listener = (_event: unknown, update: SyncProgressEvent): void => callback(update)
      ipcRenderer.on(IpcChannels.syncProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannels.syncProgress, listener)
    }
  }
}

export type WackestApi = typeof api

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
