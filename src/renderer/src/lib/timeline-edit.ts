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
