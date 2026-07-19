import Anthropic from '@anthropic-ai/sdk'
import type { TrackHeatmap } from '@shared/types/project'
import type { HeatmapProvider, HeatmapScoreInput } from './types'
import {
  buildVisionPrompt,
  scoreSourcesWithVision,
  VISION_JSON_SCHEMA,
  type RawVisionScore
} from './vision-common'

const MODEL = 'claude-haiku-4-5-20251001'
const TOOL_NAME = 'report_frame_scores'

export function createVisionClaudeProvider(apiKey: string): HeatmapProvider {
  const client = new Anthropic({ apiKey })

  return {
    id: 'vision-llm-claude',
    async score(input: HeatmapScoreInput): Promise<TrackHeatmap[]> {
      const results = await scoreSourcesWithVision(
        input.videoSources,
        input.bucketSec,
        input.sourceMediaPaths,
        async (frames): Promise<RawVisionScore[]> => {
          const content: Anthropic.MessageParam['content'] = [
            { type: 'text', text: buildVisionPrompt(frames.length) },
            ...frames
              .map(
                (frame, i) =>
                  [
                    { type: 'text' as const, text: `Bild ${i}:` },
                    {
                      type: 'image' as const,
                      source: {
                        type: 'base64' as const,
                        media_type: 'image/jpeg' as const,
                        data: frame.base64
                      }
                    }
                  ] as const
              )
              .flat()
          ]

          const response = await client.messages.create({
            model: MODEL,
            max_tokens: 1024,
            messages: [{ role: 'user', content }],
            tools: [
              {
                name: TOOL_NAME,
                description: 'Reports an interest score (0-1) with a short reason for each frame.',
                input_schema: VISION_JSON_SCHEMA as Anthropic.Tool.InputSchema
              }
            ],
            tool_choice: { type: 'tool', name: TOOL_NAME }
          })

          const toolUse = response.content.find(
            (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
          )
          return toolUse ? ((toolUse.input as { scores: RawVisionScore[] }).scores ?? []) : []
        },
        (progress) => input.onProgress?.(progress)
      )

      return results.map((r) => ({
        sourceId: r.sourceId,
        provider: 'vision-llm-claude' as const,
        points: r.points
      }))
    }
  }
}
