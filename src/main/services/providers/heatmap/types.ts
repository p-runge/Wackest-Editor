import type { SourceClip, TranscriptSegment, TrackHeatmap } from '@shared/types/project'
import type { HeatmapProviderId } from '@shared/types/project'
import type { AppSettings } from '@shared/types/settings'
import type { SamplingDensity } from '@shared/types/sampling'

export interface HeatmapScoreInput {
  /** The video-bearing sources to score and compare (already filtered to hasVideo). */
  videoSources: SourceClip[]
  transcript: TranscriptSegment[]
  timelineDurationSec: number
  /** Bucket size for the audio/motion providers (already adaptive). Vision plans its own buckets. */
  bucketSec: number
  /** Frame-sampling density for the vision providers. */
  density: SamplingDensity
  /** sourceId -> original media file path, for audio energy / motion / frame extraction. */
  sourceMediaPaths: Record<string, string>
  /** App settings (API keys) for the vision-LLM providers. */
  settings: AppSettings
  onProgress?: (progress: number) => void
}

export interface HeatmapProvider {
  id: HeatmapProviderId
  /** One interest curve per source, gapless within each source's footage, on a shared score scale. */
  score(input: HeatmapScoreInput): Promise<TrackHeatmap[]>
}
