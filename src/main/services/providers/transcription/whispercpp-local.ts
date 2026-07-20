import { spawn } from 'child_process'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { extractWav16kMono } from '../../ffmpeg'
import type { TranscriptionProvider, TranscriptionInput, TranscriptionOutput } from './types'

interface WhisperCppJsonOutput {
  transcription: Array<{
    offsets: { from: number; to: number }
    text: string
  }>
}

function runWhisperCli(
  binaryPath: string,
  modelPath: string,
  wavPath: string,
  outputBase: string,
  languageHint: string | undefined
): Promise<void> {
  return new Promise((resolve, reject) => {
    // whisper.cpp defaults to '-l en' if omitted, so always pass it explicitly ('auto' is a real value it understands)
    const language = languageHint || 'auto'
    const proc = spawn(binaryPath, [
      '-m',
      modelPath,
      '-f',
      wavPath,
      '-l',
      language,
      '-oj',
      '-of',
      outputBase,
      '-np'
    ])
    let stderr = ''
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    proc.on('error', (err) => {
      reject(
        new Error(
          `whisper.cpp-Binary konnte nicht gestartet werden ("${binaryPath}"): ${err.message}. ` +
            `Bitte in den Einstellungen den Pfad prüfen (z.B. via "brew install whisper-cpp" installieren).`
        )
      )
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else
        reject(new Error(`whisper.cpp beendete sich mit Fehlercode ${code}: ${stderr.slice(-500)}`))
    })
  })
}

export function createWhisperCppProvider(
  binaryPath: string,
  modelPath: string
): TranscriptionProvider {
  return {
    id: 'whispercpp-local',
    async transcribe(input: TranscriptionInput): Promise<TranscriptionOutput> {
      const tmpDir = await mkdtemp(join(tmpdir(), 'wackest-transcription-'))
      try {
        const wavPath = join(tmpDir, 'audio.wav')
        await extractWav16kMono(input.audioFilePath, wavPath)
        input.onProgress?.(0.3)

        const outputBase = join(tmpDir, 'output')
        await runWhisperCli(binaryPath, modelPath, wavPath, outputBase, input.languageHint)
        input.onProgress?.(0.9)

        const json: WhisperCppJsonOutput = JSON.parse(await readFile(`${outputBase}.json`, 'utf-8'))
        const segments = json.transcription.map((entry) => ({
          startSec: entry.offsets.from / 1000,
          endSec: entry.offsets.to / 1000,
          text: entry.text.trim()
        }))

        input.onProgress?.(1)
        return { segments }
      } finally {
        await rm(tmpDir, { recursive: true, force: true })
      }
    }
  }
}
