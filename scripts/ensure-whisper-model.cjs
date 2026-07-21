// Downloads the default ggml model bundled for local whisper.cpp transcription, so a fresh
// install/packaged release works out of the box without requiring the user to fetch a model
// themselves. Same file for every platform, so this only ever needs to run once.
'use strict'

const { existsSync, mkdirSync, createWriteStream, unlinkSync } = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const MODEL_NAME = 'ggml-tiny-q5_1.bin'
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`
const REPO_ROOT = path.join(__dirname, '..')

function destinationPath() {
  return path.join(REPO_ROOT, 'resources', 'models', MODEL_NAME)
}

async function ensureWhisperModel() {
  const modelPath = destinationPath()
  if (existsSync(modelPath)) return

  console.log(`[ensure-whisper-model] Downloading ${MODEL_NAME} from ${MODEL_URL}...`)
  mkdirSync(path.dirname(modelPath), { recursive: true })

  const response = await fetch(MODEL_URL)
  if (!response.ok || !response.body) {
    throw new Error(`[ensure-whisper-model] Download failed: HTTP ${response.status}`)
  }

  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(modelPath))
  } catch (err) {
    unlinkSync(modelPath)
    throw err
  }

  console.log(`[ensure-whisper-model] Saved ${modelPath}`)
}

module.exports = { ensureWhisperModel, destinationPath, MODEL_NAME }

if (require.main === module) {
  ensureWhisperModel().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
