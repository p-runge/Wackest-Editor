import { contextBridge, ipcRenderer, clipboard, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels } from '@shared/types/ipc'
import type {
  ProjectSaveArgs,
  ProjectLoadArgs,
  ProjectLoadResult,
  ProjectOpenRecentArgs,
  ProjectResolveInvalidArgs,
  ProjectResolveInvalidResult,
  SourceImportArgs,
  SourceImportResult,
  SourceImportProgressEvent,
  SourceImportCancelArgs,
  SourceRemoveCacheArgs,
  SourceReadWaveformResult,
  SyncRunArgs,
  SyncRunResult,
  SyncProgressEvent,
  TranscriptionRunArgs,
  TranscriptionRunResult,
  TranscriptionProgressEvent,
  HeatmapRunArgs,
  HeatmapRunResult,
  HeatmapProgressEvent,
  ExportChooseOutputArgs,
  ExportRunArgs,
  ExportProgressEvent,
  SettingsGetResult,
  SettingsSetArgs,
  SettingsPickFileArgs
} from '@shared/types/ipc'

const api = {
  project: {
    chooseDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.projectChooseDirectory),
    save: (args: ProjectSaveArgs): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.projectSave, args),
    openDialog: (): Promise<string | null> => ipcRenderer.invoke(IpcChannels.projectOpenDialog),
    load: (args: ProjectLoadArgs): Promise<ProjectLoadResult> =>
      ipcRenderer.invoke(IpcChannels.projectLoad, args),
    openRecent: (args: ProjectOpenRecentArgs): Promise<ProjectLoadResult> =>
      ipcRenderer.invoke(IpcChannels.projectOpenRecent, args),
    resolveInvalid: (args: ProjectResolveInvalidArgs): Promise<ProjectResolveInvalidResult> =>
      ipcRenderer.invoke(IpcChannels.projectResolveInvalid, args)
  },
  source: {
    pickFiles: (): Promise<string[]> => ipcRenderer.invoke(IpcChannels.sourcePickFiles),
    import: (args: SourceImportArgs): Promise<SourceImportResult> =>
      ipcRenderer.invoke(IpcChannels.sourceImport, args),
    onImportProgress: (callback: (update: SourceImportProgressEvent) => void): (() => void) => {
      const listener = (_event: unknown, update: SourceImportProgressEvent): void =>
        callback(update)
      ipcRenderer.on(IpcChannels.sourceImportProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannels.sourceImportProgress, listener)
    },
    cancelImport: (args: SourceImportCancelArgs): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.sourceImportCancel, args),
    removeCache: (args: SourceRemoveCacheArgs): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.sourceRemoveCache, args),
    readWaveform: (waveformCachePath: string): Promise<SourceReadWaveformResult> =>
      ipcRenderer.invoke(IpcChannels.sourceReadWaveform, waveformCachePath),
    getPathForFile: (file: File): string => webUtils.getPathForFile(file)
  },
  sync: {
    run: (args: SyncRunArgs): Promise<SyncRunResult> =>
      ipcRenderer.invoke(IpcChannels.syncRun, args),
    onProgress: (callback: (update: SyncProgressEvent) => void): (() => void) => {
      const listener = (_event: unknown, update: SyncProgressEvent): void => callback(update)
      ipcRenderer.on(IpcChannels.syncProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannels.syncProgress, listener)
    }
  },
  transcription: {
    run: (args: TranscriptionRunArgs): Promise<TranscriptionRunResult> =>
      ipcRenderer.invoke(IpcChannels.transcriptionRun, args),
    onProgress: (callback: (update: TranscriptionProgressEvent) => void): (() => void) => {
      const listener = (_event: unknown, update: TranscriptionProgressEvent): void =>
        callback(update)
      ipcRenderer.on(IpcChannels.transcriptionProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannels.transcriptionProgress, listener)
    }
  },
  heatmap: {
    run: (args: HeatmapRunArgs): Promise<HeatmapRunResult> =>
      ipcRenderer.invoke(IpcChannels.heatmapRun, args),
    onProgress: (callback: (update: HeatmapProgressEvent) => void): (() => void) => {
      const listener = (_event: unknown, update: HeatmapProgressEvent): void => callback(update)
      ipcRenderer.on(IpcChannels.heatmapProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannels.heatmapProgress, listener)
    }
  },
  export: {
    chooseOutput: (args: ExportChooseOutputArgs): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.exportChooseOutput, args),
    run: (args: ExportRunArgs): Promise<void> => ipcRenderer.invoke(IpcChannels.exportRun, args),
    onProgress: (callback: (update: ExportProgressEvent) => void): (() => void) => {
      const listener = (_event: unknown, update: ExportProgressEvent): void => callback(update)
      ipcRenderer.on(IpcChannels.exportProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannels.exportProgress, listener)
    },
    showInFolder: (filePath: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.exportShowInFolder, filePath)
  },
  settings: {
    get: (): Promise<SettingsGetResult> => ipcRenderer.invoke(IpcChannels.settingsGet),
    set: (args: SettingsSetArgs): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.settingsSet, args),
    pickFile: (args: SettingsPickFileArgs): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.settingsPickFile, args)
  },
  system: {
    copyToClipboard: (text: string): void => clipboard.writeText(text)
  },
  menu: {
    // On macOS, Cmd+Z/Cmd+Shift+Z/Cmd+A are intercepted at the native Cocoa level (the standard
    // undo:/redo:/selectAll: responder actions) before a keydown ever reaches the renderer's
    // DOM — so these can only be observed via an application-menu accelerator pushed over IPC,
    // not a window 'keydown' listener.
    onUndo: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on(IpcChannels.menuUndo, listener)
      return () => ipcRenderer.removeListener(IpcChannels.menuUndo, listener)
    },
    onRedo: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on(IpcChannels.menuRedo, listener)
      return () => ipcRenderer.removeListener(IpcChannels.menuRedo, listener)
    },
    onSelectAll: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on(IpcChannels.menuSelectAll, listener)
      return () => ipcRenderer.removeListener(IpcChannels.menuSelectAll, listener)
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
