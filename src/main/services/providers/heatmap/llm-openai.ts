import OpenAI from 'openai'
import {
  buildTranscriptChunks,
  buildHeatmapPrompt,
  HEATMAP_POINTS_JSON_SCHEMA,
  type RawHeatmapPoint
} from './llm-common'
import type { HeatmapPoint } from '@shared/types/project'
import type { HeatmapProvider, HeatmapScoreInput } from './types'

const MODEL = 'gpt-4o-mini' // cheap/fast, sufficient for this structured classification task

export function createOpenAiHeatmapProvider(apiKey: string): HeatmapProvider {
  const client = new OpenAI({ apiKey })

  return {
    id: 'llm-openai',
    async score(input: HeatmapScoreInput): Promise<HeatmapPoint[]> {
      const chunks = buildTranscriptChunks(input.transcript)
      if (chunks.length === 0) return []

      const points: HeatmapPoint[] = []
      let previousContext: string | undefined

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const prompt = buildHeatmapPrompt(chunk, input.bucketSec, previousContext)

        const response = await client.chat.completions.create({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'heatmap_scores',
              schema: HEATMAP_POINTS_JSON_SCHEMA
            }
          }
        })

        const raw = response.choices[0]?.message?.content
        if (raw) {
          const result = JSON.parse(raw) as { points: RawHeatmapPoint[] }
          for (const point of result.points ?? []) {
            points.push({
              startSec: point.startSec,
              endSec: point.endSec,
              score: Math.max(0, Math.min(1, point.score)),
              reason: point.reason,
              provider: 'llm-openai'
            })
          }
        }

        previousContext = chunk.text.slice(-200)
        input.onProgress?.((i + 1) / chunks.length)
      }

      return points
    }
  }
}
