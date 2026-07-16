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
 * Inserts a "cut to this source from here" switch point: truncates/removes anything
 * at or after `atSec`, then appends a new interval [atSec, timelineEnd) with `value`.
 * Mirrors a live multicam switcher — later switches simply override from their point on.
 */
export function insertActiveSwitch(
  intervals: TrackInterval[],
  atSec: number,
  value: string,
  timelineEnd: number
): TrackInterval[] {
  const before = intervals
    .filter((iv) => iv.startSec < atSec)
    .map((iv) => (iv.endSec > atSec ? { ...iv, endSec: atSec } : iv))
    .filter((iv) => iv.endSec > iv.startSec)

  if (atSec >= timelineEnd) return before

  return [...before, { id: uuidv4(), startSec: atSec, endSec: timelineEnd, value }]
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
