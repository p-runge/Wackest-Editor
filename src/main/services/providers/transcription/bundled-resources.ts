import { app } from 'electron'
import path from 'path'

function resourcesBaseDir(): string {
  // asarUnpack (unlike extraResources) keeps the unpacked copy under app.asar.unpacked.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    : path.join(app.getAppPath(), 'resources')
}

export function getBundledWhisperCliPath(): string {
  const dir = `${process.platform}-${process.arch}`
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  return path.join(resourcesBaseDir(), 'bin', dir, exe)
}

const BUNDLED_MODEL_FILENAME = 'ggml-tiny-q5_1.bin'

export function getBundledWhisperModelPath(): string {
  return path.join(resourcesBaseDir(), 'models', BUNDLED_MODEL_FILENAME)
}

export function getBundledWhisperModelFilename(): string {
  return BUNDLED_MODEL_FILENAME
}
