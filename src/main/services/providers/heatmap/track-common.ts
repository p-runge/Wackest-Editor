import type { HeatmapPoint, SourceClip } from '@shared/types/project'
import { sourceCoverageRange } from '@shared/types/timeline-time'

/** A per-source bucket, given both on the unified timeline and in source-local playback time. */
export interface SourceBucket {
  unifiedStartSec: number
  unifiedEndSec: number
  localStartSec: number
  localEndSec: number
}

// Each source has exactly one sync segment (see Project invariant), so unified = local + offset is
// a single constant shift; null before sync.
function sourceOffsetSec(source: SourceClip): number | null {
  return source.syncSegments[0]?.offsetSec ?? null
}

/**
 * Contiguous gapless buckets covering only where the source actually has footage, on the unified
 * timeline, plus the matching source-local ranges (for pulling audio/frames out of the file).
 */
export function bucketsForSource(source: SourceClip, bucketSec: number): SourceBucket[] {
  const coverage = sourceCoverageRange(source)
  const offset = sourceOffsetSec(source)
  if (!coverage || offset === null) return []

  const buckets: SourceBucket[] = []
  for (let start = coverage.startSec; start < coverage.endSec; start += bucketSec) {
    const unifiedEndSec = Math.min(coverage.endSec, start + bucketSec)
    buckets.push({
      unifiedStartSec: start,
      unifiedEndSec,
      localStartSec: start - offset,
      localEndSec: unifiedEndSec - offset
    })
  }
  return buckets
}

/**
 * Min-max normalizes raw signal values to [0,1] on a SHARED scale across every source and bucket —
 * not per-source — so scores stay comparable between parallel cameras at the same instant (the
 * whole point of the per-source heatmap). A flat/constant signal maps to a neutral 0.5.
 */
export function normalizeAcrossSources(rawPerSource: number[][]): number[][] {
  let min = Infinity
  let max = -Infinity
  for (const row of rawPerSource) {
    for (const v of row) {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  const range = max - min
  if (!isFinite(range) || range < 1e-9) {
    return rawPerSource.map((row) => row.map(() => 0.5))
  }
  return rawPerSource.map((row) => row.map((v) => (v - min) / range))
}

/** Builds a source's HeatmapPoint[] from its unified buckets and matching normalized scores. */
export function pointsFromBuckets(
  buckets: SourceBucket[],
  scores: number[],
  reasonFor?: (index: number) => string | undefined
): HeatmapPoint[] {
  return buckets.map((bucket, i) => ({
    startSec: bucket.unifiedStartSec,
    endSec: bucket.unifiedEndSec,
    score: Math.max(0, Math.min(1, scores[i] ?? 0)),
    reason: reasonFor?.(i)
  }))
}
