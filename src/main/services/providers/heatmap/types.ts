import type { HeatmapPoint, HeatmapProviderId, TranscriptSegment } from '@shared/types/project'

export interface HeatmapScoreInput {
  transcript: TranscriptSegment[]
  timelineDurationSec: number
  bucketSec: number
  /** Audio-bearing source to analyze for the local heuristic provider (unused by LLM providers). */
  audioFilePath?: string
  onProgress?: (progress: number) => void
}

export interface HeatmapProvider {
  id: HeatmapProviderId
  score(input: HeatmapScoreInput): Promise<HeatmapPoint[]>
}
