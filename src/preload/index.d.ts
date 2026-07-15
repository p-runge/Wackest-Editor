import { ElectronAPI } from '@electron-toolkit/preload'
import type { WackestApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: WackestApi
  }
}
