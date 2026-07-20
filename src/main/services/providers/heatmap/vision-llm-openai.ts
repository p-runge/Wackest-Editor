import OpenAI from 'openai'
import type { TrackHeatmap } from '@shared/types/project'
import type { HeatmapProvider, HeatmapScoreInput } from './types'
import {
  buildVisionPrompt,
  scoreSourcesWithVision,
  VISION_JSON_SCHEMA,
  type RawVisionScore
} from './vision-common'

const MODEL = 'gpt-4o-mini' // cheap vision-capable model, sufficient for this scoring task

export function createVisionOpenAiProvider(apiKey: string): HeatmapProvider {
  // maxRetries lifts the SDK's default 429 backoff headroom for bursty multi-frame runs.
  const client = new OpenAI({ apiKey, maxRetries: 5 })

  return {
    id: 'vision-llm-openai',
    async score(input: HeatmapScoreInput): Promise<TrackHeatmap[]> {
      const results = await scoreSourcesWithVision(
        input.videoSources,
        input.density,
        input.sourceMediaPaths,
        async (frames): Promise<RawVisionScore[]> => {
          const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
            { type: 'text', text: buildVisionPrompt(frames.length) }
          ]
          frames.forEach((frame, i) => {
            content.push({ type: 'text', text: `Bild ${i}:` })
            content.push({
              type: 'image_url',
              // 'low' detail = fixed ~85 tokens/image (vs ~800 at auto/high) — enough to judge which
              // camera is interesting, ~9x cheaper, and keeps bursts under the tokens-per-minute cap.
              image_url: { url: `data:image/jpeg;base64,${frame.base64}`, detail: 'low' }
            })
          })

          const response = await client.chat.completions.create({
            model: MODEL,
            messages: [{ role: 'user', content }],
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'frame_scores', schema: VISION_JSON_SCHEMA }
            }
          })

          const raw = response.choices[0]?.message?.content
          return raw ? ((JSON.parse(raw) as { scores: RawVisionScore[] }).scores ?? []) : []
        },
        (progress) => input.onProgress?.(progress)
      )

      return results.map((r) => ({
        sourceId: r.sourceId,
        provider: 'vision-llm-openai' as const,
        points: r.points
      }))
    }
  }
}
