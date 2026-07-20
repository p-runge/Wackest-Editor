import type { HeatmapProviderId, SourceClip } from './project'
import { sourceCoverageRange } from './timeline-time'

/** Frames sent per model request by the vision providers (batched to cut round-trips). */
export const VISION_BATCH_SIZE = 6

/**
 * How densely the vision providers sample frames. Density maps directly to the sampling interval
 * (one frame per bucket): higher density = finer buckets = more frames = finer heatmap and more
 * responsive camera switching, but more API image tokens (cost) and requests (time). A hard global
 * frame cap (MAX_TOTAL_FRAMES) bounds cost regardless of density, by coarsening the interval.
 */
export type SamplingDensity = 'low' | 'medium' | 'high'

// Vision sampling interval per density = the bucket size, one frame each. Chosen so all three
// steps are clearly distinct (unlike a frames-per-bucket scheme, which floors to 1 on short clips).
const VISION_SEC_PER_FRAME: Record<SamplingDensity, number> = { low: 6, medium: 3, high: 1.5 }
// The coarsening ceiling when honoring the frame cap — beyond this we accept going over.
const MAX_BUCKET_SEC_HARD = 120

// Global per-run cap on sampled frames — the "don't get expensive" guarantee for API providers.
export const MAX_TOTAL_FRAMES = 150

// Bucket sizing for the audio/motion providers (not vision): finer for short timelines, capped for
// long ones. Independent of density (those providers are free, density is a vision/cost concept).
const TARGET_BUCKETS = 40
const MOTION_MIN_BUCKET_SEC = 3
const MOTION_MAX_BUCKET_SEC = 20

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Adaptive bucket size for the audio/motion providers: finer for short timelines, capped for long. */
export function computeAdaptiveBucketSec(timelineDurationSec: number): number {
  if (timelineDurationSec <= 0) return MOTION_MAX_BUCKET_SEC
  return clamp(timelineDurationSec / TARGET_BUCKETS, MOTION_MIN_BUCKET_SEC, MOTION_MAX_BUCKET_SEC)
}

/** Vision sampling interval (= bucket size, one frame each) for a density. */
export function visionBucketSec(density: SamplingDensity): number {
  return VISION_SEC_PER_FRAME[density]
}

export interface SourceFramePlan {
  sourceId: string
  /** Unified-timeline [start, end) bucket ranges (for building heatmap points). */
  bucketUnifiedRanges: Array<[number, number]>
  /** Per-bucket frame timestamps in SOURCE-LOCAL seconds (for ffmpeg frame extraction). */
  bucketLocalTimestamps: number[][]
}

export interface SamplingPlan {
  /** Bucket size actually used (possibly coarsened above the adaptive value to respect the cap). */
  bucketSec: number
  totalFrames: number
  perSource: SourceFramePlan[]
}

function planForSource(source: SourceClip, bucketSec: number): SourceFramePlan | null {
  const coverage = sourceCoverageRange(source)
  const offsetSec = source.syncSegments[0]?.offsetSec
  if (!coverage || offsetSec === undefined) return null

  const bucketUnifiedRanges: Array<[number, number]> = []
  const bucketLocalTimestamps: number[][] = []
  for (let start = coverage.startSec; start < coverage.endSec; start += bucketSec) {
    const end = Math.min(coverage.endSec, start + bucketSec)
    // One frame per bucket, at its midpoint, mapped to source-local time.
    const midpointUnified = (start + end) / 2
    bucketUnifiedRanges.push([start, end])
    bucketLocalTimestamps.push([midpointUnified - offsetSec])
  }
  return { sourceId: source.id, bucketUnifiedRanges, bucketLocalTimestamps }
}

/**
 * Plans per-source frame sampling for a run: the bucket size (= sampling interval, one frame each)
 * comes straight from the density, and a global frame cap is enforced by coarsening the interval
 * until the total fits (or the coarsening ceiling is hit). Pure — used both by the vision providers
 * (main) and by the UI cost/duration estimate (renderer), so both agree on the frame count.
 */
export function planSampling(videoSources: SourceClip[], density: SamplingDensity): SamplingPlan {
  const sources = videoSources.filter((s) => s.probed.hasVideo)

  let bucketSec = visionBucketSec(density)
  let plan: SamplingPlan = buildPlan(sources, bucketSec)
  while (plan.totalFrames > MAX_TOTAL_FRAMES && bucketSec < MAX_BUCKET_SEC_HARD) {
    bucketSec = Math.min(bucketSec * 1.25, MAX_BUCKET_SEC_HARD)
    plan = buildPlan(sources, bucketSec)
  }
  return plan
}

function buildPlan(sources: SourceClip[], bucketSec: number): SamplingPlan {
  const perSource = sources
    .map((s) => planForSource(s, bucketSec))
    .filter((p): p is SourceFramePlan => p !== null)
  const totalFrames = perSource.reduce(
    (sum, p) => sum + p.bucketLocalTimestamps.reduce((s, ts) => s + ts.length, 0),
    0
  )
  return { bucketSec, totalFrames, perSource }
}

// Rough per-frame API cost (USD) — order-of-magnitude only, for the UI estimate. Claude tokenizes
// the small (~512px) frame at ~200 image tokens; OpenAI is sent at detail:'low' (fixed ~85 tokens);
// local models are free.
const COST_PER_FRAME_USD: Partial<Record<HeatmapProviderId, number>> = {
  'vision-llm-claude': 0.0004,
  'vision-llm-openai': 0.00002,
  'vision-llm-local': 0
}
// Rough per-request latency for cloud vision; local models score one frame at a time.
const SEC_PER_REQUEST = 3
const LOCAL_SEC_PER_FRAME = 1.5

export interface RunEstimate {
  totalFrames: number
  costUsd: number
  durationSec: number
}

/** Rough cost/time estimate for a vision run, for display before the user commits. Not exact. */
export function estimateVisionRun(totalFrames: number, provider: HeatmapProviderId): RunEstimate {
  const costUsd = totalFrames * (COST_PER_FRAME_USD[provider] ?? 0)
  const durationSec =
    provider === 'vision-llm-local'
      ? totalFrames * LOCAL_SEC_PER_FRAME
      : Math.ceil(totalFrames / VISION_BATCH_SIZE) * SEC_PER_REQUEST
  return { totalFrames, costUsd, durationSec }
}
