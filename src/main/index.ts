import { app, shell, BrowserWindow, ipcMain, protocol, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerProjectIpc } from './ipc/project'
import { registerIngestIpc } from './ipc/ingest'
import { registerSyncIpc } from './ipc/sync'
import { registerSttIpc } from './ipc/stt'
import { registerHeatmapIpc } from './ipc/heatmap'
import { registerExportIpc } from './ipc/export'
import { registerSettingsIpc } from './ipc/settings'
import { registerMediaProtocolHandler } from './services/media-protocol'
import { MEDIA_URL_SCHEME } from '@shared/types/media-url'
import { IpcChannels } from '@shared/types/ipc'

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_URL_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

// On macOS, ⌘Z/⌘⇧Z are intercepted at the native Cocoa level (the standard undo:/redo: responder
// actions) before a keydown DOM event ever reaches the renderer — with or without a menu role
// for them. The only way to observe these keys in the renderer is to bind them as an explicit
// application-menu accelerator and forward the action over IPC (see preload's `menu.onUndo`).
function setApplicationMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: 'Datei',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }]
    },
    {
      label: 'Bearbeiten',
      submenu: [
        {
          label: 'Rückgängig',
          accelerator: 'CmdOrCtrl+Z',
          click: (): void => {
            BrowserWindow.getFocusedWindow()?.webContents.send(IpcChannels.menuUndo)
          }
        },
        {
          label: 'Wiederholen',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: (): void => {
            BrowserWindow.getFocusedWindow()?.webContents.send(IpcChannels.menuRedo)
          }
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Fenster',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'close' }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.progani.wackest-tool')

  setApplicationMenu()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  registerMediaProtocolHandler()

  registerProjectIpc()
  registerIngestIpc()
  registerSyncIpc()
  registerSttIpc()
  registerHeatmapIpc()
  registerExportIpc()
  registerSettingsIpc()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
