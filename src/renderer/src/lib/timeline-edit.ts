import { v4 as uuidv4 } from 'uuid'
import type { TrackInterval, KeptRange, SourceClip } from '@shared/types/project'
import { sourceCoverageRange } from '@shared/types/timeline-time'

export {
  resolveIntervalAt,
  mapUnifiedTimeToLocal,
  mapLocalTimeToUnified,
  resolveVideoSourceId,
  resolveAudioSourceId,
  sourceCoverageRange,
  fillIntervalGaps
} from '@shared/types/timeline-time'
export type { EffectiveTrackInterval } from '@shared/types/timeline-time'

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

/**
 * Drags the shared boundary between `leftIntervalId` and its right neighbor to `atSec`. The drag
 * is bounded by the track's own extent ([0, timelineDurationSec]) — not by the two intervals' own
 * start/end — but never past the point where the *growing* side's own source actually has
 * footage: dragging right can't extend the left interval's source beyond that source's own
 * coverage end, dragging left can't extend the right interval's source before its own coverage
 * start. A source with no sync segments yet (not synced) has no such bound.
 * Dragging past a neighbor's far edge sweeps over however many further intervals lie between the
 * old and new boundary: fully swallowed ones are removed, and whichever interval straddles the
 * new boundary is truncated to meet it. Either side of the dragged boundary disappears entirely
 * if the drag collapses it to zero length (rather than being clamped to a minimum), same as
 * `insertActiveSwitch`. No-op if the interval has no right neighbor (i.e. it's the last one,
 * whose end is pinned to the timeline) or if `atSec` doesn't actually move it.
 */
export function moveIntervalBoundary(
  intervals: TrackInterval[],
  leftIntervalId: string,
  atSec: number,
  timelineDurationSec: number,
  sources: SourceClip[]
): TrackInterval[] {
  const sorted = [...intervals].sort((a, b) => a.startSec - b.startSec)
  const index = sorted.findIndex((iv) => iv.id === leftIntervalId)
  if (index === -1 || index === sorted.length - 1) return intervals

  const left = sorted[index]
  const right = sorted[index + 1]
  const oldBoundary = left.endSec

  const leftSource = sources.find((s) => s.id === left.value)
  const rightSource = sources.find((s) => s.id === right.value)
  const leftCoverage = leftSource && sourceCoverageRange(leftSource)
  const rightCoverage = rightSource && sourceCoverageRange(rightSource)
  const minSec = Math.max(0, rightCoverage?.startSec ?? 0)
  const maxSec = Math.min(timelineDurationSec, leftCoverage?.endSec ?? timelineDurationSec)

  const clamped = Math.min(Math.max(atSec, minSec), maxSec)
  if (clamped === oldBoundary) return intervals

  const result: TrackInterval[] = []
  if (clamped > oldBoundary) {
    // dragging right: the left interval grows forward, swallowing/truncating whatever follows
    for (let i = 0; i < sorted.length; i++) {
      const iv = sorted[i]
      if (i === index) {
        result.push({ ...iv, endSec: clamped })
      } else if (i < index) {
        result.push(iv)
      } else if (iv.endSec <= clamped) {
        continue // fully swallowed
      } else if (iv.startSec < clamped) {
        result.push({ ...iv, startSec: clamped }) // straddles the new boundary
      } else {
        result.push(iv)
      }
    }
  } else {
    // dragging left: the right interval grows backward, swallowing/truncating whatever precedes
    for (let i = 0; i < sorted.length; i++) {
      const iv = sorted[i]
      if (i === index + 1) {
        result.push({ ...iv, startSec: clamped })
      } else if (i > index + 1) {
        result.push(iv)
      } else if (iv.startSec >= clamped) {
        continue // fully swallowed
      } else if (iv.endSec > clamped) {
        result.push({ ...iv, endSec: clamped }) // straddles the new boundary
      } else {
        result.push(iv)
      }
    }
  }
  return result
}

/** Fresh project (or one where sync just changed the duration): one kept range spanning everything. */
export function initializeKeptRanges(timelineDurationSec: number): KeptRange[] {
  if (timelineDurationSec <= 0) return []
  return [{ id: uuidv4(), startSec: 0, endSec: timelineDurationSec }]
}
