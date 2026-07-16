import { v4 as uuidv4 } from 'uuid'
import type { TrackInterval, KeptRange, SourceClip } from '@shared/types/project'

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

/** Finds which interval (if any) covers a given time. */
export function resolveIntervalAt(
  intervals: TrackInterval[],
  atSec: number
): TrackInterval | undefined {
  return intervals.find((iv) => atSec >= iv.startSec && atSec < iv.endSec)
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

/**
 * Inverse of the STT/sync forward mapping (`localTime + segment.offsetSec = unifiedTime`):
 * finds the source-local playback time for a given point on the unified timeline, by finding
 * whichever sync segment's local range the corresponding local time would fall into.
 */
export function mapUnifiedTimeToLocal(source: SourceClip, unifiedTimeSec: number): number | null {
  for (const segment of source.syncSegments) {
    const candidateLocal = unifiedTimeSec - segment.offsetSec
    if (candidateLocal >= segment.localStartSec && candidateLocal < segment.localEndSec) {
      return candidateLocal
    }
  }
  return null
}

/** Forward mapping used to drive the playhead from a playing element's own currentTime. */
export function mapLocalTimeToUnified(source: SourceClip, localTimeSec: number): number | null {
  const containing = source.syncSegments.find(
    (seg) => localTimeSec >= seg.localStartSec && localTimeSec < seg.localEndSec
  )
  const segment = containing ?? source.syncSegments[0]
  return segment ? localTimeSec + segment.offsetSec : null
}
