import { app, BrowserWindow, Notification, shell } from 'electron'
import { autoUpdater, NsisUpdater } from 'electron-updater'
import { IpcChannels, type UpdateStatus } from '@shared/types/ipc'

const RELEASES_URL = 'https://github.com/p-runge/Wackest-Editor/releases/latest'

let getMainWindow: (() => BrowserWindow | null) | null = null

function setStatus(status: UpdateStatus): void {
  getMainWindow?.()?.webContents.send(IpcChannels.updateStateChanged, status)
}

export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  getMainWindow = getWindow

  // Only Windows/Linux builds can be installed silently (see UpdateStatus doc comment) —
  // macOS is check-only and always routes through openDownloadPage() instead.
  autoUpdater.autoDownload = process.platform !== 'darwin'
  autoUpdater.autoInstallOnAppQuit = true

  if (process.platform === 'win32') {
    // The app isn't code-signed yet, so the default verifier (which compares the downloaded
    // installer's publisher certificate to the running app's) would reject every update. Skip
    // verification rather than have auto-update silently fail for every Windows user.
    ;(autoUpdater as NsisUpdater).verifyUpdateCodeSignature = () => Promise.resolve(null)
  }

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }))

  autoUpdater.on('update-available', (info) => {
    setStatus({
      state: 'available',
      version: info.version,
      canAutoInstall: process.platform !== 'darwin'
    })
    if (process.platform === 'darwin') {
      new Notification({
        title: 'Wackest Editor',
        body: `Version ${info.version} ist verfügbar.`
      }).show()
    }
  })

  autoUpdater.on('update-not-available', () => setStatus({ state: 'not-available' }))

  autoUpdater.on('download-progress', (progress) => {
    setStatus({ state: 'downloading', progress: progress.percent / 100 })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ state: 'downloaded', version: info.version })
    new Notification({
      title: 'Wackest Editor',
      body: `Version ${info.version} ist bereit — jetzt neu starten, um zu aktualisieren.`
    }).show()
  })

  autoUpdater.on('error', (err) => {
    setStatus({ state: 'error', message: err.message })
  })
}

export async function checkForUpdates(): Promise<void> {
  // electron-updater silently no-ops checkForUpdates() (resolves without emitting a single event)
  // whenever the app isn't packaged — otherwise a dev build's "Nach Updates suchen" button would
  // appear to do nothing at all.
  if (!app.isPackaged) {
    setStatus({
      state: 'error',
      message: 'Auto-Update ist nur in gepackten Builds verfügbar, nicht im Dev-Modus.'
    })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}

export async function openDownloadPage(): Promise<void> {
  await shell.openExternal(RELEASES_URL)
}
