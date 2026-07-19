import type { HeatmapPoint, TrackHeatmap } from '@shared/types/project'

/**
 * Collapses the per-source track heatmaps into one global interest curve for the overview bar/lane
 * that replaced the old single `project.heatmap`: at every instant, the interest is the maximum
 * across all sources (the most interesting camera available there). Sources can have different
 * bucket boundaries — each is trimmed to its own footage — so this walks the union of all bucket
 * edges and takes, on each resulting slice, the highest score of any source covering that slice.
 * The `reason` of the winning source is carried through so peak tooltips still work.
 */
export function deriveGlobalHeatmap(trackHeatmaps: TrackHeatmap[]): HeatmapPoint[] {
  const allPoints = trackHeatmaps.flatMap((t) => t.points)
  if (allPoints.length === 0) return []

  const edges = new Set<number>()
  for (const p of allPoints) {
    edges.add(p.startSec)
    edges.add(p.endSec)
  }
  const sorted = Array.from(edges).sort((a, b) => a - b)

  const result: HeatmapPoint[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const startSec = sorted[i]
    const endSec = sorted[i + 1]
    if (endSec <= startSec) continue
    const mid = (startSec + endSec) / 2

    let best: HeatmapPoint | undefined
    for (const p of allPoints) {
      if (mid >= p.startSec && mid < p.endSec && (!best || p.score > best.score)) best = p
    }
    if (!best) continue

    const point: HeatmapPoint = { startSec, endSec, score: best.score, reason: best.reason }
    // Merge with the previous slice when it's the same score+reason to avoid a run of identical
    // slivers (adjacent sources often agree), keeping the overview bar readable.
    const prev = result[result.length - 1]
    if (
      prev &&
      prev.endSec === startSec &&
      prev.score === point.score &&
      prev.reason === point.reason
    ) {
      prev.endSec = endSec
    } else {
      result.push(point)
    }
  }
  return result
}

/**
 * A bucket counts as a "peak" when the provider gave it a reason and its score is a local
 * maximum (not lower than either neighbor) — surfaces the buckets worth explaining to the user
 * without cluttering the heatmap with a marker on every single bucket.
 */
export function findHeatmapPeakIndices(
  points: Array<{ score: number; reason?: string }>
): Set<number> {
  const peaks = new Set<number>()
  points.forEach((point, i) => {
    if (!point.reason) return
    const prevScore = points[i - 1]?.score ?? -Infinity
    const nextScore = points[i + 1]?.score ?? -Infinity
    if (point.score >= prevScore && point.score >= nextScore) {
      peaks.add(i)
    }
  })
  return peaks
}
