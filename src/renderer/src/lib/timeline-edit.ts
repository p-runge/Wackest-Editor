import { v4 as uuidv4 } from 'uuid'
import type { TrackInterval, KeptRange } from '@shared/types/project'

export {
  resolveIntervalAt,
  mapUnifiedTimeToLocal,
  mapLocalTimeToUnified,
  resolveVideoSourceId,
  resolveAudioSourceId
} from '@shared/types/timeline-time'

/**
 * Inserts a "switch to this source from here" point, but only as far as the next already-
 * existing switch — not destructively to the timeline end. This is a local split: the interval
 * covering `atSec` (if any) is truncated to end at `atSec`, a new interval [atSec, nextStart)
 * is inserted, and everything from `nextStart` onward (the next pre-existing switch) is left
 * untouched. `nextStart` falls back to `timelineEnd` when there is no later switch yet, so the
 * common forward-editing workflow (switching sequentially while scrubbing ahead) behaves exactly
 * as before; only retroactively editing an earlier point stops wiping out later decisions.
 * Adjacent same-value intervals are merged afterward to avoid fragmenting into needless slivers.
 */
export function insertActiveSwitch(
  intervals: TrackInterval[],
  atSec: number,
  value: string,
  timelineEnd: number
): TrackInterval[] {
  if (atSec >= timelineEnd) {
    return intervals
      .filter((iv) => iv.startSec < atSec)
      .map((iv) => (iv.endSec > atSec ? { ...iv, endSec: atSec } : iv))
      .filter((iv) => iv.endSec > iv.startSec)
  }

  const nextStart = intervals
    .map((iv) => iv.startSec)
    .filter((startSec) => startSec > atSec)
    .reduce((min, startSec) => Math.min(min, startSec), timelineEnd)

  const kept = intervals
    .map((iv) => (iv.startSec < atSec && iv.endSec > atSec ? { ...iv, endSec: atSec } : iv))
    .filter((iv) => iv.endSec > iv.startSec && (iv.endSec <= atSec || iv.startSec >= nextStart))

  const merged = [...kept, { id: uuidv4(), startSec: atSec, endSec: nextStart, value }].sort(
    (a, b) => a.startSec - b.startSec
  )

  const result: TrackInterval[] = []
  for (const iv of merged) {
    const last = result[result.length - 1]
    if (last && last.value === iv.value && last.endSec === iv.startSec) {
      last.endSec = iv.endSec
    } else {
      result.push({ ...iv })
    }
  }
  return result
}

const MIN_INTERVAL_DURATION_SEC = 0.05

/**
 * Drags the shared boundary between `leftIntervalId` and its right neighbor to `atSec`,
 * clamped so neither interval collapses below MIN_INTERVAL_DURATION_SEC. No-op if the
 * interval has no right neighbor (i.e. it's the last one, whose end is pinned to the timeline).
 */
export function moveIntervalBoundary(
  intervals: TrackInterval[],
  leftIntervalId: string,
  atSec: number
): TrackInterval[] {
  const sorted = [...intervals].sort((a, b) => a.startSec - b.startSec)
  const index = sorted.findIndex((iv) => iv.id === leftIntervalId)
  if (index === -1 || index === sorted.length - 1) return intervals

  const left = sorted[index]
  const right = sorted[index + 1]
  const clamped = Math.min(
    Math.max(atSec, left.startSec + MIN_INTERVAL_DURATION_SEC),
    right.endSec - MIN_INTERVAL_DURATION_SEC
  )

  return intervals.map((iv) => {
    if (iv.id === left.id) return { ...iv, endSec: clamped }
    if (iv.id === right.id) return { ...iv, startSec: clamped }
    return iv
  })
}

/** Splits whichever kept range contains `atSec` into two adjacent kept ranges at that point. */
export function splitKeptRangeAt(ranges: KeptRange[], atSec: number): KeptRange[] {
  const result: KeptRange[] = []
  for (const range of ranges) {
    if (atSec > range.startSec && atSec < range.endSec) {
      result.push({ ...range, id: uuidv4(), endSec: atSec })
      result.push({ ...range, id: uuidv4(), startSec: atSec })
    } else {
      result.push(range)
    }
  }
  return result
}

export function removeKeptRange(ranges: KeptRange[], rangeId: string): KeptRange[] {
  return ranges.filter((r) => r.id !== rangeId)
}

/** Fresh project (or one where sync just changed the duration): one kept range spanning everything. */
export function initializeKeptRanges(timelineDurationSec: number): KeptRange[] {
  if (timelineDurationSec <= 0) return []
  return [{ id: uuidv4(), startSec: 0, endSec: timelineDurationSec }]
}
