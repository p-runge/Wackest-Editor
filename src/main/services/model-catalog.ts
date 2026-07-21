import { app } from 'electron'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, rename, unlink } from 'fs/promises'
import { join } from 'path'

const HF_TREE_URL = 'https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main'
const HF_RESOLVE_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
const MODEL_FILENAME_PATTERN = /^ggml-[\w.-]+\.bin$/

export interface WhisperModelInfo {
  filename: string
  sizeBytes: number
}

interface HfTreeEntry {
  path: string
  size: number
}

export async function listAvailableModels(): Promise<WhisperModelInfo[]> {
  const response = await fetch(HF_TREE_URL)
  if (!response.ok) {
    throw new Error(`[model-catalog] Failed to list models: HTTP ${response.status}`)
  }
  const entries = (await response.json()) as HfTreeEntry[]
  return entries
    .filter((entry) => MODEL_FILENAME_PATTERN.test(entry.path))
    .map((entry) => ({ filename: entry.path, sizeBytes: entry.size }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
}

export function getModelsDir(): string {
  return join(app.getPath('userData'), 'models')
}

export function getDownloadedModelPath(filename: string): string {
  return join(getModelsDir(), filename)
}

export function isModelDownloaded(filename: string): boolean {
  return existsSync(getDownloadedModelPath(filename))
}

export interface DownloadModelOptions {
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

export async function downloadModel(
  filename: string,
  options: DownloadModelOptions = {}
): Promise<void> {
  if (!MODEL_FILENAME_PATTERN.test(filename)) {
    throw new Error(`[model-catalog] Refusing to download unexpected filename: ${filename}`)
  }

  const modelsDir = getModelsDir()
  await mkdir(modelsDir, { recursive: true })
  const finalPath = getDownloadedModelPath(filename)
  // Downloaded to a .part sibling first so a crash/cancel mid-download can never leave a
  // truncated file at `finalPath` that isModelDownloaded()/the transcription provider would
  // mistake for a complete model.
  const partPath = `${finalPath}.part`

  const response = await fetch(`${HF_RESOLVE_BASE}/${filename}`, { signal: options.signal })
  if (!response.ok || !response.body) {
    throw new Error(`[model-catalog] Download failed: HTTP ${response.status}`)
  }

  const totalBytes = Number(response.headers.get('content-length')) || 0
  let receivedBytes = 0

  try {
    const out = createWriteStream(partPath)
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        receivedBytes += value.byteLength
        if (totalBytes > 0) options.onProgress?.(receivedBytes / totalBytes)
        if (!out.write(value)) {
          await new Promise<void>((resolve) => out.once('drain', () => resolve()))
        }
      }
    } finally {
      out.end()
      await new Promise<void>((resolve, reject) => {
        out.once('finish', () => resolve())
        out.once('error', reject)
      })
    }
    await rename(partPath, finalPath)
  } catch (err) {
    await unlink(partPath).catch(() => {})
    throw err
  }
}

export async function deleteDownloadedModel(filename: string): Promise<void> {
  await unlink(getDownloadedModelPath(filename)).catch(() => {})
}
