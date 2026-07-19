import type { HeatmapPoint } from '@shared/types/project'

/**
 * A bucket counts as a "peak" when the provider gave it a reason and its score is a local
 * maximum (not lower than either neighbor) — surfaces the buckets worth explaining to the user
 * without cluttering the heatmap with a marker on every single bucket.
 */
export function findHeatmapPeakIndices(points: HeatmapPoint[]): Set<number> {
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
