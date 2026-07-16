import OpenAI from 'openai'
import { createReadStream } from 'fs'
import { mkdtemp, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { extractCompressedAudioChunks, AUDIO_CHUNK_DURATION_SEC } from '../../ffmpeg'
import type { SttProvider, SttTranscribeInput, SttTranscribeOutput } from './types'

const MAX_UPLOAD_BYTES = 24 * 1024 * 1024 // stay safely under the API's 25MB limit

export function createOpenAiWhisperProvider(apiKey: string): SttProvider {
  const client = new OpenAI({ apiKey })

  return {
    id: 'openai-whisper-api',
    async transcribe(input: SttTranscribeInput): Promise<SttTranscribeOutput> {
      const tmpDir = await mkdtemp(join(tmpdir(), 'wackest-stt-'))
      try {
        const chunkPaths = await extractCompressedAudioChunks(input.audioFilePath, tmpDir)
        const segments: SttTranscribeOutput['segments'] = []

        for (let i = 0; i < chunkPaths.length; i++) {
          const chunkPath = chunkPaths[i]
          const chunkStartSec = i * AUDIO_CHUNK_DURATION_SEC

          const size = (await stat(chunkPath)).size
          if (size > MAX_UPLOAD_BYTES) {
            throw new Error(
              `Audio-Chunk zu groß für die OpenAI API (${Math.round(size / 1024 / 1024)}MB) — bitte kürzeren Abschnitt wählen.`
            )
          }

          // omitting `language` (rather than passing the literal string "auto") makes the API auto-detect
          const language =
            input.languageHint && input.languageHint !== 'auto' ? input.languageHint : undefined

          const response = await client.audio.transcriptions.create({
            file: createReadStream(chunkPath),
            model: 'whisper-1',
            response_format: 'verbose_json',
            language
          })

          for (const seg of response.segments ?? []) {
            segments.push({
              startSec: chunkStartSec + seg.start,
              endSec: chunkStartSec + seg.end,
              text: seg.text.trim()
            })
          }

          input.onProgress?.((i + 1) / chunkPaths.length)
        }

        return { segments }
      } finally {
        await rm(tmpDir, { recursive: true, force: true })
      }
    }
  }
}
