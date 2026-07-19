import type { TrackHeatmap } from '@shared/types/project'
import type { HeatmapProvider, HeatmapScoreInput } from './types'
import { scoreSourcesWithVision, type RawVisionScore } from './vision-common'

// Local Ollama vision model. moondream is tiny and fast; swap for llava/qwen2-vl for more accuracy.
const OLLAMA_URL = 'http://localhost:11434/api/chat'
const MODEL = 'moondream'

const SINGLE_FRAME_PROMPT =
  'Bewerte dieses Standbild aus einem Video für einen automatischen Kameraschnitt: Wie interessant ist die Einstellung? 0 = leer/statisch/unscharf, niemand im Fokus. 1 = die aktive/sprechende Person gut sichtbar, ausdrucksstark, klare Handlung. Antworte NUR als JSON: {"score": <0..1>, "reason": "<kurzer Grund, max 8 Wörter>"}.'

async function scoreSingleFrame(base64: string): Promise<{ score: number; reason: string }> {
  let response: Response
  try {
    response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        format: 'json',
        messages: [{ role: 'user', content: SINGLE_FRAME_PROMPT, images: [base64] }]
      })
    })
  } catch {
    throw new Error(
      `Konnte lokales Vision-Modell nicht erreichen (Ollama unter ${OLLAMA_URL}). Läuft Ollama und ist das Modell "${MODEL}" installiert?`
    )
  }
  if (!response.ok) {
    throw new Error(`Ollama-Fehler ${response.status}. Ist das Modell "${MODEL}" installiert?`)
  }

  const data = (await response.json()) as { message?: { content?: string } }
  const raw = data.message?.content
  if (!raw) return { score: 0, reason: '' }
  try {
    const parsed = JSON.parse(raw) as { score?: number; reason?: string }
    return { score: Number(parsed.score) || 0, reason: parsed.reason ?? '' }
  } catch {
    return { score: 0, reason: '' }
  }
}

/**
 * Vision judgement via a fully local Ollama model — $0/offline, but the user must have Ollama
 * running with the model pulled. moondream handles one image per call, so frames are scored
 * individually (the batch from scoreSourcesWithVision is looped through).
 */
export function createVisionLocalProvider(): HeatmapProvider {
  return {
    id: 'vision-llm-local',
    async score(input: HeatmapScoreInput): Promise<TrackHeatmap[]> {
      const results = await scoreSourcesWithVision(
        input.videoSources,
        input.bucketSec,
        input.sourceMediaPaths,
        async (frames): Promise<RawVisionScore[]> => {
          const scores: RawVisionScore[] = []
          for (let i = 0; i < frames.length; i++) {
            const { score, reason } = await scoreSingleFrame(frames[i].base64)
            scores.push({ index: i, score, reason })
          }
          return scores
        },
        (progress) => input.onProgress?.(progress)
      )

      return results.map((r) => ({
        sourceId: r.sourceId,
        provider: 'vision-llm-local' as const,
        points: r.points
      }))
    }
  }
}
