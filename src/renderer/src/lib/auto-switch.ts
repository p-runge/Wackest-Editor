import type { TrackHeatmap } from '@shared/types/project'

/** A chosen-camera span before it becomes a TrackInterval (no id yet). */
export interface RawAutoInterval {
  startSec: number
  endSec: number
  value: string // sourceId
}

export interface AutoSwitchOptions {
  /** Shortest allowed shot; shorter argmax runs are absorbed into a neighbor to stop flicker. */
  minShotSec: number
}

/** Merges adjacent, contiguous intervals that name the same source. */
function mergeContiguous(intervals: RawAutoInterval[]): RawAutoInterval[] {
  const result: RawAutoInterval[] = []
  for (const iv of intervals) {
    const prev = result[result.length - 1]
    if (prev && prev.value === iv.value && prev.endSec === iv.startSec) {
      prev.endSec = iv.endSec
    } else {
      result.push({ ...iv })
    }
  }
  return result
}

/**
 * Absorbs any interval shorter than `minShotSec` into a *contiguous* neighbor (the longer of the
 * two, to stabilize), repeatedly, until every remaining run meets the minimum or can't be merged
 * (isolated by a genuine coverage gap — e.g. across a hard cut). Never merges across a gap.
 */
function enforceMinShot(intervals: RawAutoInterval[], minShotSec: number): RawAutoInterval[] {
  let arr = mergeContiguous(intervals)

  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < arr.length; i++) {
      if (arr.length <= 1) break
      const dur = arr[i].endSec - arr[i].startSec
      if (dur >= minShotSec) continue

      const leftContig = i > 0 && arr[i - 1].endSec === arr[i].startSec
      const rightContig = i < arr.length - 1 && arr[i].endSec === arr[i + 1].startSec
      if (!leftContig && !rightContig) continue // isolated by a gap — leave it

      let takeLeft: boolean
      if (leftContig && rightContig) {
        const leftDur = arr[i - 1].endSec - arr[i - 1].startSec
        const rightDur = arr[i + 1].endSec - arr[i + 1].startSec
        takeLeft = leftDur >= rightDur
      } else {
        takeLeft = leftContig
      }
      arr[i] = { ...arr[i], value: takeLeft ? arr[i - 1].value : arr[i + 1].value }
      arr = mergeContiguous(arr)
      changed = true
      break
    }
  }
  return arr
}

/**
 * Turns per-source interest heatmaps into an automatic camera cut: on every time slice, the source
 * with the highest interest score wins (argmax across parallel cameras). Slices where no source has
 * a score are true coverage gaps and simply produce no interval there (a later
 * `fillActiveIntervalGaps` pass fills them with the default). A minimum shot length is enforced so
 * near-tied buckets don't produce a rapid back-and-forth flicker.
 *
 * Returns raw {startSec, endSec, value} spans on the unified timeline — the caller assigns ids and
 * runs them through the full-coverage invariant before writing to activeVideoIntervals.
 */
export function computeAutoVideoIntervals(
  trackHeatmaps: TrackHeatmap[],
  { minShotSec }: AutoSwitchOptions
): RawAutoInterval[] {
  const points = trackHeatmaps.flatMap((t) => t.points.map((p) => ({ ...p, sourceId: t.sourceId })))
  if (points.length === 0) return []

  const edges = new Set<number>()
  for (const p of points) {
    edges.add(p.startSec)
    edges.add(p.endSec)
  }
  const sorted = Array.from(edges).sort((a, b) => a - b)

  const slices: RawAutoInterval[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const startSec = sorted[i]
    const endSec = sorted[i + 1]
    if (endSec <= startSec) continue
    const mid = (startSec + endSec) / 2

    let bestSource: string | undefined
    let bestScore = -Infinity
    for (const p of points) {
      if (mid >= p.startSec && mid < p.endSec && p.score > bestScore) {
        bestScore = p.score
        bestSource = p.sourceId
      }
    }
    if (bestSource === undefined) continue // no source covers this slice — genuine gap
    slices.push({ startSec, endSec, value: bestSource })
  }

  return enforceMinShot(slices, minShotSec)
}
