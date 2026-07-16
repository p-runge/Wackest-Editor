import Anthropic from '@anthropic-ai/sdk'
import {
  buildTranscriptChunks,
  buildHeatmapPrompt,
  HEATMAP_POINTS_JSON_SCHEMA,
  type RawHeatmapPoint
} from './llm-common'
import type { HeatmapPoint } from '@shared/types/project'
import type { HeatmapProvider, HeatmapScoreInput } from './types'

// Cheap/fast model — this is a structured classification-style task, not creative writing.
const MODEL = 'claude-haiku-4-5-20251001'
const TOOL_NAME = 'report_heatmap_scores'

export function createClaudeHeatmapProvider(apiKey: string): HeatmapProvider {
  const client = new Anthropic({ apiKey })

  return {
    id: 'llm-claude',
    async score(input: HeatmapScoreInput): Promise<HeatmapPoint[]> {
      const chunks = buildTranscriptChunks(input.transcript)
      if (chunks.length === 0) return []

      const points: HeatmapPoint[] = []
      let previousContext: string | undefined

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const prompt = buildHeatmapPrompt(chunk, input.bucketSec, previousContext)

        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
          tools: [
            {
              name: TOOL_NAME,
              description:
                'Reports an interest/highlight score (0-1) with a short reason for each time bucket in this transcript chunk.',
              input_schema: HEATMAP_POINTS_JSON_SCHEMA as Anthropic.Tool.InputSchema
            }
          ],
          tool_choice: { type: 'tool', name: TOOL_NAME }
        })

        const toolUse = response.content.find(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        )
        if (toolUse) {
          const result = toolUse.input as { points: RawHeatmapPoint[] }
          for (const point of result.points ?? []) {
            points.push({
              startSec: point.startSec,
              endSec: point.endSec,
              score: Math.max(0, Math.min(1, point.score)),
              reason: point.reason,
              provider: 'llm-claude'
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
