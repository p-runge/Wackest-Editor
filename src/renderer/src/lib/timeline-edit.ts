import { v4 as uuidv4 } from 'uuid'
import type { TrackInterval, KeptRange, SourceClip } from '@shared/types/project'
import { sourceCoverageRange, keptRangeContentSpan } from '@shared/types/timeline-time'

export {
  resolveIntervalAt,
  mapUnifiedTimeToLocal,
  mapLocalTimeToUnified,
  resolveVideoSourceId,
  resolveAudioSourceId,
  defaultVideoSourceAt,
  defaultAudioSourceAt,
  fillActiveIntervalGaps,
  sourceCoverageRange,
  keptRangeContentSpan
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

/**
 * Keeps kept-range coverage in step with a timeline that a (re-)sync just extended. When a newly
 * added, non-overlapping source is appended after a hard-cut gap the timeline grows, but existing
 * cut ranges stop at the old end — leaving that tail (and the whole appended track) rendered as
 * fully cut/invisible. This appends one tail range up to the new end, keeping the new footage by
 * default (like the initial full range) without disturbing the user's real cuts. Empty input just
 * initializes a full range; a timeline that didn't grow is returned unchanged.
 */
export function extendKeptRangesToDuration(
  keptRanges: KeptRange[],
  timelineDurationSec: number
): KeptRange[] {
  if (timelineDurationSec <= 0) return keptRanges
  if (keptRanges.length === 0) return initializeKeptRanges(timelineDurationSec)

  const lastEnd = Math.max(...keptRanges.map((r) => r.endSec))
  if (lastEnd >= timelineDurationSec - 0.01) return keptRanges
  return [...keptRanges, { id: uuidv4(), startSec: lastEnd, endSec: timelineDurationSec }]
}

/** Finds whichever kept range covers `atSec`, if any. */
export function findKeptRangeAt(keptRanges: KeptRange[], atSec: number): KeptRange | undefined {
  return keptRanges.find((r) => atSec >= r.startSec && atSec < r.endSec)
}

/** Splits whichever kept range contains `atSec` into two, so a later cut/delete/reorder can act on
 *  just one side of it. No-op if `atSec` isn't strictly inside a kept range (already a boundary,
 *  or inside a cut-out stretch — nothing there to split). Preserves each half's own content origin
 *  (see `keptRangeContentSpan`) — the right half's content start shifts forward by the same amount
 *  its placement start did, so a later move of just one half still points at the right footage. */
export function splitKeptRangeAt(keptRanges: KeptRange[], atSec: number): KeptRange[] {
  const index = keptRanges.findIndex((r) => atSec > r.startSec && atSec < r.endSec)
  if (index === -1) return keptRanges
  const range = keptRanges[index]
  const contentStart = range.contentStartSec ?? range.startSec
  const splitOffset = atSec - range.startSec
  const left: KeptRange = { ...range, endSec: atSec }
  const right: KeptRange = {
    ...range,
    id: uuidv4(),
    startSec: atSec,
    contentStartSec: contentStart + splitOffset
  }
  return [...keptRanges.slice(0, index), left, right, ...keptRanges.slice(index + 1)]
}

/** Removes [startSec, endSec) from the kept ranges — i.e. "cut". A range fully inside the removed
 *  span disappears; one that straddles either edge is truncated, or split in two if it straddles
 *  both — same content-origin bookkeeping as `splitKeptRangeAt` for whichever remainder starts at
 *  a new placement position. */
export function removeKeptRange(
  keptRanges: KeptRange[],
  startSec: number,
  endSec: number
): KeptRange[] {
  const result: KeptRange[] = []
  for (const range of keptRanges) {
    if (range.endSec <= startSec || range.startSec >= endSec) {
      result.push(range)
      continue
    }
    const contentStart = range.contentStartSec ?? range.startSec
    if (range.startSec < startSec) result.push({ ...range, endSec: startSec })
    if (range.endSec > endSec) {
      result.push({
        ...range,
        id: uuidv4(),
        startSec: endSec,
        contentStartSec: contentStart + (endSec - range.startSec)
      })
    }
  }
  return result.filter((r) => r.endSec > r.startSec)
}

/** Removes a single kept range outright by id — Schnitt mode's per-clip delete action. */
export function deleteKeptRangeById(keptRanges: KeptRange[], id: string): KeptRange[] {
  return keptRanges.filter((r) => r.id !== id)
}

/** Same as `deleteKeptRangeById`, for a whole selection at once — one array transform, so
 *  callers can commit it as a single store update (one undo step) instead of one per id. */
export function deleteKeptRangesByIds(keptRanges: KeptRange[], ids: Set<string>): KeptRange[] {
  return keptRanges.filter((r) => !ids.has(r.id))
}

/** Where the program actually ends: the furthest placement end of any kept chunk, 0 when the
 *  timeline is empty. This — not `timelineDurationSec` (a content-axis quantity: how much raw
 *  synced footage exists) — is what the duration display, playback end, and End-key target use;
 *  chunks can be placed past the content duration, so the two routinely diverge. */
export function computeProgramEndSec(keptRanges: KeptRange[]): number {
  return keptRanges.reduce((max, r) => Math.max(max, r.endSec), 0)
}

/** Re-places a range at `startSec`, freezing its content origin (see `keptRangeContentSpan`) so
 *  the footage comes along with the new placement. Identity-preserving no-op when unmoved. */
function withPlacement(range: KeptRange, startSec: number): KeptRange {
  if (startSec === range.startSec) return range
  const contentStartSec = range.contentStartSec ?? range.startSec
  return { ...range, startSec, endSec: startSec + (range.endSec - range.startSec), contentStartSec }
}

/**
 * Resolves where dragging chunk `id` to `proposedStartSec` actually lands — chunks never
 * overwrite each other. Returns the whole updated array, since neighbors can shift too:
 *
 * - The chunk targets whichever gap its *center* falls into, so dragging past a neighbor's
 *   midpoint hops it over to the other side (place before/after) instead of overwriting.
 * - Within a gap big enough to hold it, it moves freely but stops at the neighbors' edges
 *   (a partial overlap snaps flush against the blocking chunk).
 * - In a gap too small to hold it, the neighbors get pushed apart just enough to make room,
 *   rightward, cascading. The program axis has no right bound — chunks can be placed arbitrarily
 *   far out and the timeline simply grows — so only the left edge (0) ever constrains anything.
 *
 * Every shifted chunk — dragged or pushed — keeps its content frozen via `withPlacement`, so all
 * of them keep playing the footage they had, just at new program positions. Callers use this both
 * for the live drag preview and for the final commit, so what the preview shows is exactly what
 * dropping does.
 */
export function resolveMovePlacement(
  keptRanges: KeptRange[],
  id: string,
  proposedStartSec: number
): KeptRange[] {
  const target = keptRanges.find((r) => r.id === id)
  if (!target) return keptRanges
  const duration = target.endSec - target.startSec
  const others = keptRanges.filter((r) => r.id !== id).sort((a, b) => a.startSec - b.startSec)
  const proposed = Math.max(proposedStartSec, 0)
  const center = proposed + duration / 2

  let insertIndex = others.length
  for (let i = 0; i < others.length; i++) {
    if (center < (others[i].startSec + others[i].endSec) / 2) {
      insertIndex = i
      break
    }
  }
  const gapStart = insertIndex > 0 ? others[insertIndex - 1].endSec : 0
  const gapEnd = insertIndex < others.length ? others[insertIndex].startSec : Infinity

  const finish = (result: KeptRange[]): KeptRange[] => {
    const unchanged = result.every((r) => {
      const before = keptRanges.find((k) => k.id === r.id)
      return before !== undefined && before.startSec === r.startSec
    })
    return unchanged ? keptRanges : result
  }

  if (gapEnd - gapStart >= duration) {
    // The gap can hold the chunk: free movement inside it, stopping at the neighbors' edges.
    const placed = Math.min(Math.max(proposed, gapStart), gapEnd - duration)
    return finish([
      ...others.slice(0, insertIndex),
      withPlacement(target, placed),
      ...others.slice(insertIndex)
    ])
  }

  // Gap too small: insert anyway and push the following neighbors rightward just enough to make
  // room, cascading — always possible, since the axis is unbounded on the right.
  const sequence = [...others.slice(0, insertIndex), target, ...others.slice(insertIndex)]
  const starts: number[] = []
  let cursor = 0
  for (const rangeInSequence of sequence) {
    const desired = rangeInSequence.id === id ? proposed : rangeInSequence.startSec
    const startSec = Math.max(desired, cursor)
    starts.push(startSec)
    cursor = startSec + (rangeInSequence.endSec - rangeInSequence.startSec)
  }
  return finish(sequence.map((r, i) => withPlacement(r, starts[i])))
}

/**
 * Group version of `resolveMovePlacement`: drags every chunk in `selectedIds` together as a
 * rigid block (same delta applied to each, so their relative offsets — and any gaps between
 * them — are preserved exactly), based on where the dragged `leaderId` chunk is proposed to
 * land. Non-selected chunks are cascaded rightward out of the way exactly like a single-chunk
 * move, never overwritten.
 *
 * Unlike `resolveMovePlacement`, there's only one code path here (no separate "free movement"
 * branch): a plain cursor-cascade over every chunk's *desired* start, sorted, already reproduces
 * the free-movement result whenever there's room — pushing only ever clamps a desired start
 * upward to the cursor, which is a no-op when the gap already fits. That equivalence is what
 * lets a single pass cover both the "moves freely" and "pushes neighbors aside" cases for an
 * arbitrarily-sized group, where tracking one gap per selected chunk would otherwise be needed.
 */
export function resolveGroupMovePlacement(
  keptRanges: KeptRange[],
  selectedIds: Set<string>,
  leaderId: string,
  proposedLeaderStartSec: number
): KeptRange[] {
  const leader = keptRanges.find((r) => r.id === leaderId)
  if (!leader || !selectedIds.has(leaderId)) return keptRanges

  const selected = keptRanges.filter((r) => selectedIds.has(r.id))
  const others = keptRanges.filter((r) => !selectedIds.has(r.id))

  let delta = proposedLeaderStartSec - leader.startSec
  const minOriginalStart = Math.min(...selected.map((r) => r.startSec))
  delta = Math.max(delta, -minOriginalStart)

  const desiredStartById = new Map<string, number>()
  for (const r of selected) desiredStartById.set(r.id, r.startSec + delta)
  for (const r of others) desiredStartById.set(r.id, r.startSec)

  const sequence = [...keptRanges].sort(
    (a, b) =>
      (desiredStartById.get(a.id) ?? a.startSec) - (desiredStartById.get(b.id) ?? b.startSec)
  )

  let cursor = 0
  const starts: number[] = []
  for (const range of sequence) {
    const desired = desiredStartById.get(range.id) ?? range.startSec
    const startSec = Math.max(desired, cursor)
    starts.push(startSec)
    cursor = startSec + (range.endSec - range.startSec)
  }
  const result = sequence.map((r, i) => withPlacement(r, starts[i]))

  const unchanged = result.every((r) => {
    const before = keptRanges.find((k) => k.id === r.id)
    return before !== undefined && before.startSec === r.startSec
  })
  return unchanged ? keptRanges : result
}

/**
 * One kept range with both of its coordinate systems made explicit: where it sits on the program
 * timeline (placement) and which stretch of raw/synced footage it plays (content). Every lane
 * renders its content through these chunks — a chunk is a *vertical slice through all tracks at
 * once* (video, audio, transcript, heatmap), so moving it moves everything in that slice together.
 * Content in no chunk (cut out) is simply not rendered anywhere.
 */
export interface LaneChunk {
  id: string
  placementStartSec: number
  placementEndSec: number
  contentStartSec: number
  contentEndSec: number
}

export function computeLaneChunks(keptRanges: KeptRange[]): LaneChunk[] {
  return keptRanges.map((range) => {
    const content = keptRangeContentSpan(range)
    return {
      id: range.id,
      placementStartSec: range.startSec,
      placementEndSec: range.endSec,
      contentStartSec: content.startSec,
      contentEndSec: content.endSec
    }
  })
}

/** Program-timeline position -> the raw/synced content time playing there, or null in a cut gap
 *  (nothing plays there). This is THE bridge between the visible axis and the underlying media:
 *  playback, source resolution, and every "what's at the playhead" question go through it. */
export function mapPlacementTimeToContentTime(
  keptRanges: KeptRange[],
  atSec: number
): number | null {
  const range = findKeptRangeAt(keptRanges, atSec)
  if (!range) return null
  return (range.contentStartSec ?? range.startSec) + (atSec - range.startSec)
}

/** Inverse of `mapPlacementTimeToContentTime`: where on the program timeline a given raw/synced
 *  content instant currently appears, or null if that content is cut out. Well-defined because
 *  content spans never overlap — cut/move only ever trim or carry them, never duplicate. */
export function mapContentTimeToPlacementTime(
  keptRanges: KeptRange[],
  atSec: number
): number | null {
  for (const range of keptRanges) {
    const content = keptRangeContentSpan(range)
    if (atSec >= content.startSec && atSec < content.endSec) {
      return range.startSec + (atSec - content.startSec)
    }
  }
  return null
}

/**
 * Projects a raw/synced-content [startSec, endSec) span onto the program timeline: one piece per
 * chunk whose content overlaps it, each carrying both coordinate systems. A span straddling a cut
 * or split across moved chunks comes back as several pieces (or none, if fully cut out). Used to
 * place transcript segments, heatmap buckets, and hard-cut markers — so they travel along with
 * the chunk their content belongs to. Pieces are sorted by placement for stable rendering.
 */
export function mapContentRangeToPlacementRanges(
  keptRanges: KeptRange[],
  startSec: number,
  endSec: number
): Array<{
  placementStartSec: number
  placementEndSec: number
  contentStartSec: number
  contentEndSec: number
}> {
  const result: Array<{
    placementStartSec: number
    placementEndSec: number
    contentStartSec: number
    contentEndSec: number
  }> = []
  for (const chunk of computeLaneChunks(keptRanges)) {
    const overlapStart = Math.max(chunk.contentStartSec, startSec)
    const overlapEnd = Math.min(chunk.contentEndSec, endSec)
    if (overlapEnd <= overlapStart) continue
    const offset = chunk.placementStartSec - chunk.contentStartSec
    result.push({
      placementStartSec: overlapStart + offset,
      placementEndSec: overlapEnd + offset,
      contentStartSec: overlapStart,
      contentEndSec: overlapEnd
    })
  }
  return result.sort((a, b) => a.placementStartSec - b.placementStartSec)
}

export interface CutLaneSegment {
  id: string
  startSec: number
  endSec: number
  /** true = a real KeptRange (included in export); false = a gap between/around them, synthesized
   *  here purely for display/interaction so the Schnitt lane has something to render and click at
   *  every point of the timeline, not just where a KeptRange happens to exist. */
  kept: boolean
}

/**
 * Sorts and walks `keptRanges` (placement positions), synthesizing a `kept: false` segment for
 * every stretch of [0, axisEndSec) they don't cover — so a single pass renders the whole Schnitt
 * lane on the same program axis every other lane uses, with no undrawn stretch. Mirrors
 * `fillActiveIntervalGaps`'s gap-filling idea (shared/types/timeline-time.ts), but simpler since
 * there's no per-source default to resolve here: an uncovered stretch is unconditionally "cut".
 * `axisEndSec` only bounds the trailing gap; kept chunks themselves are never truncated to it —
 * the program axis is unbounded on the right, so a chunk placed (or push-previewed) past the
 * current axis end renders in full.
 */
export function computeCutLaneSegments(
  keptRanges: KeptRange[],
  axisEndSec: number
): CutLaneSegment[] {
  if (axisEndSec <= 0 && keptRanges.length === 0) return []

  const sorted = [...keptRanges].sort((a, b) => a.startSec - b.startSec)
  const result: CutLaneSegment[] = []
  let cursor = 0

  for (const range of sorted) {
    const startSec = Math.max(0, range.startSec)
    if (range.endSec <= cursor) continue
    if (startSec > cursor) {
      result.push({ id: `cut-${cursor}`, startSec: cursor, endSec: startSec, kept: false })
    }
    result.push({
      id: range.id,
      startSec: Math.max(cursor, startSec),
      endSec: range.endSec,
      kept: true
    })
    cursor = range.endSec
  }
  if (cursor < axisEndSec) {
    result.push({ id: `cut-${cursor}`, startSec: cursor, endSec: axisEndSec, kept: false })
  }

  return result
}
