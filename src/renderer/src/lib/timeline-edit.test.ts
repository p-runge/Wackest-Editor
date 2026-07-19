import { describe, expect, it } from 'vitest'
import type { KeptRange } from '@shared/types/project'
import {
  computeCutLaneSegments,
  computeProgramEndSec,
  extendKeptRangesToDuration,
  keptRangeContentSpan,
  mapContentRangeToPlacementRanges,
  mapContentTimeToPlacementTime,
  mapPlacementTimeToContentTime,
  resolveMovePlacement,
  removeKeptRange,
  splitKeptRangeAt
} from './timeline-edit'

function range(id: string, startSec: number, endSec: number): KeptRange {
  return { id, startSec, endSec }
}

describe('extendKeptRangesToDuration', () => {
  it('appends a tail range when a sync grows the timeline past the last cut', () => {
    // Repro of the "appended, non-overlapping track is invisible" bug: kept ends at 111.5 but the
    // synced timeline now reaches 150.5.
    const result = extendKeptRangesToDuration([range('k1', 0, 111.5)], 150.5)
    expect(result).toEqual([
      range('k1', 0, 111.5),
      { id: expect.any(String), startSec: 111.5, endSec: 150.5 }
    ])
  })

  it('initializes a full range from empty input', () => {
    const result = extendKeptRangesToDuration([], 90)
    expect(result).toEqual([{ id: expect.any(String), startSec: 0, endSec: 90 }])
  })

  it('leaves ranges untouched when the timeline did not grow', () => {
    const kept = [range('k1', 0, 40), range('k2', 60, 100)]
    expect(extendKeptRangesToDuration(kept, 100)).toBe(kept)
  })

  it('does not disturb existing cuts when extending the tail', () => {
    const kept = [range('k1', 0, 30), range('k2', 50, 80)]
    const result = extendKeptRangesToDuration(kept, 120)
    expect(result.slice(0, 2)).toEqual(kept)
    expect(result[2]).toEqual({ id: expect.any(String), startSec: 80, endSec: 120 })
  })
})

describe('computeCutLaneSegments', () => {
  it('fills every stretch of the timeline, marking uncovered ground as cut', () => {
    const segments = computeCutLaneSegments([range('a', 5, 10)], 20)
    expect(segments).toEqual([
      { id: 'cut-0', startSec: 0, endSec: 5, kept: false },
      { id: 'a', startSec: 5, endSec: 10, kept: true },
      { id: 'cut-10', startSec: 10, endSec: 20, kept: false }
    ])
  })

  it('marks the whole timeline as cut when nothing is kept', () => {
    expect(computeCutLaneSegments([], 20)).toEqual([
      { id: 'cut-0', startSec: 0, endSec: 20, kept: false }
    ])
  })

  it('produces no gap between two touching kept ranges', () => {
    const segments = computeCutLaneSegments([range('a', 0, 10), range('b', 10, 20)], 20)
    expect(segments.filter((s) => !s.kept)).toEqual([])
  })
})

describe('resolveMovePlacement', () => {
  it('slides a range freely through open space, freezing content at the old position', () => {
    const result = resolveMovePlacement([range('a', 10, 15)], 'a', 18)
    expect(result).toEqual([{ id: 'a', startSec: 18, endSec: 23, contentStartSec: 10 }])
    // the content span still points at the footage it was picked up from, not the new placement.
    expect(keptRangeContentSpan(result[0])).toEqual({ startSec: 10, endSec: 15 })
  })

  it('a second move keeps the content anchored at the original recorded position', () => {
    const first = resolveMovePlacement([range('a', 10, 15)], 'a', 18)
    const second = resolveMovePlacement(first, 'a', 2)
    expect(second).toEqual([{ id: 'a', startSec: 2, endSec: 7, contentStartSec: 10 }])
  })

  it('clamps at the timeline start but has no right-side limit — the program just grows', () => {
    expect(resolveMovePlacement([range('a', 10, 15)], 'a', -5)).toEqual([
      { id: 'a', startSec: 0, endSec: 5, contentStartSec: 10 }
    ])
    // far past the raw content duration is a perfectly valid placement.
    expect(resolveMovePlacement([range('a', 10, 15)], 'a', 500)).toEqual([
      { id: 'a', startSec: 500, endSec: 505, contentStartSec: 10 }
    ])
  })

  it('is a no-op when the range already sits at that position', () => {
    const keptRanges = [range('a', 10, 15)]
    expect(resolveMovePlacement(keptRanges, 'a', 10)).toBe(keptRanges)
  })

  it('is a no-op for an unknown id', () => {
    const keptRanges = [range('a', 10, 15)]
    expect(resolveMovePlacement(keptRanges, 'missing', 5)).toBe(keptRanges)
  })

  it('stops flush against a neighbor instead of overwriting it on partial overlap', () => {
    // a (10s) dragged to 15 would overlap b's first half — it snaps to end exactly at b's start,
    // and b does not move.
    const result = resolveMovePlacement([range('a', 0, 10), range('b', 20, 30)], 'a', 15)
    expect(result.find((r) => r.id === 'a')).toMatchObject({ startSec: 10, endSec: 20 })
    expect(result.find((r) => r.id === 'b')).toMatchObject({ startSec: 20, endSec: 30 })
  })

  it('hops over a neighbor once dragged past its midpoint, into unbounded space beyond', () => {
    // proposed 26 puts a's center (31) past b's center (25) — a lands right after b, free to go
    // further right without any limit.
    const result = resolveMovePlacement([range('a', 0, 10), range('b', 20, 30)], 'a', 26)
    expect(result.find((r) => r.id === 'a')).toMatchObject({ startSec: 30, endSec: 40 })
    expect(result.find((r) => r.id === 'b')).toMatchObject({ startSec: 20, endSec: 30 })
  })

  it('pushes the neighbor aside when the target gap is too small', () => {
    // c (5s) dropped into the 1s gap between a and b: b gets pushed right just enough to fit,
    // and being pushed freezes b's content at its previous position too.
    const keptRanges = [range('a', 0, 10), range('b', 11, 20), range('c', 25, 30)]
    const result = resolveMovePlacement(keptRanges, 'c', 10.5)
    expect(result.find((r) => r.id === 'c')).toMatchObject({ startSec: 10.5, endSec: 15.5 })
    expect(result.find((r) => r.id === 'b')).toMatchObject({
      startSec: 15.5,
      endSec: 24.5,
      contentStartSec: 11
    })
    expect(result.find((r) => r.id === 'a')).toMatchObject({ startSec: 0, endSec: 10 })
  })

  it('pushing near the former content end grows the program instead of squeezing left', () => {
    // a (10s) dropped into the too-small 2s gap between b and c: c is pushed past the raw content
    // duration (30) — the program is allowed to outgrow it.
    const keptRanges = [range('a', 0, 10), range('b', 10, 20), range('c', 22, 30)]
    const result = resolveMovePlacement(keptRanges, 'a', 15)
    expect(result.find((r) => r.id === 'b')).toMatchObject({ startSec: 10, endSec: 20 })
    expect(result.find((r) => r.id === 'a')).toMatchObject({ startSec: 20, endSec: 30 })
    expect(result.find((r) => r.id === 'c')).toMatchObject({
      startSec: 30,
      endSec: 38,
      contentStartSec: 22
    })
  })

  it('never produces overlapping ranges, regardless of destination', () => {
    const result = resolveMovePlacement(
      [range('a', 0, 10), range('b', 10, 20), range('c', 20, 30)],
      'c',
      5
    )
    const sorted = [...result].sort((x, y) => x.startSec - y.startSec)
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i].endSec).toBeLessThanOrEqual(sorted[i + 1].startSec)
    }
  })
})

describe('computeProgramEndSec', () => {
  it('is the furthest placement end across chunks, regardless of array order', () => {
    expect(computeProgramEndSec([range('b', 40, 55), range('a', 0, 10)])).toBe(55)
  })

  it('is 0 for an empty timeline', () => {
    expect(computeProgramEndSec([])).toBe(0)
  })
})

describe('keptRangeContentSpan', () => {
  it('equals the placement span when the range has never been moved', () => {
    expect(keptRangeContentSpan(range('a', 10, 15))).toEqual({ startSec: 10, endSec: 15 })
  })

  it('reflects the frozen content origin after a move', () => {
    const [moved] = resolveMovePlacement([range('a', 10, 15)], 'a', 40)
    expect(keptRangeContentSpan(moved)).toEqual({ startSec: 10, endSec: 15 })
  })
})

describe('splitKeptRangeAt content-origin bookkeeping', () => {
  it('shifts the right half content start by the same amount its placement moved', () => {
    // move first, so the range has a non-trivial content origin to preserve across the split.
    const [moved] = resolveMovePlacement([range('a', 0, 10)], 'a', 20)
    const [left, right] = splitKeptRangeAt([moved], 25)
    expect(keptRangeContentSpan(left)).toEqual({ startSec: 0, endSec: 5 })
    expect(keptRangeContentSpan(right)).toEqual({ startSec: 5, endSec: 10 })
  })
})

describe('placement/content mapping', () => {
  it('is the identity while nothing has been moved', () => {
    const keptRanges = [range('a', 0, 10), range('b', 10, 20)]
    expect(mapPlacementTimeToContentTime(keptRanges, 5)).toBe(5)
    expect(mapContentTimeToPlacementTime(keptRanges, 15)).toBe(15)
  })

  it('returns null for placement time inside a cut gap', () => {
    expect(mapPlacementTimeToContentTime([range('a', 5, 10)], 2)).toBeNull()
  })

  it('follows a moved chunk in both directions', () => {
    // chunk with content 10-15 moved to placement 40-45
    const moved = resolveMovePlacement([range('a', 10, 15)], 'a', 40)
    expect(mapPlacementTimeToContentTime(moved, 42)).toBe(12)
    expect(mapContentTimeToPlacementTime(moved, 12)).toBe(42)
    // the vacated old placement is a gap now, and the moved content no longer appears there
    expect(mapPlacementTimeToContentTime(moved, 12)).toBeNull()
  })

  it('returns null for content that has been cut out entirely', () => {
    expect(mapContentTimeToPlacementTime([range('a', 0, 5)], 7)).toBeNull()
  })
})

describe('mapContentRangeToPlacementRanges', () => {
  it('projects a content span onto a moved chunk, clipped to what survives', () => {
    // content 10-15 moved to placement 40-45; a transcript segment covering content 8-12
    // should surface only its surviving 10-12 slice, at placement 40-42.
    const moved = resolveMovePlacement([range('a', 10, 15)], 'a', 40)
    expect(mapContentRangeToPlacementRanges(moved, 8, 12)).toEqual([
      { placementStartSec: 40, placementEndSec: 42, contentStartSec: 10, contentEndSec: 12 }
    ])
  })

  it('splits a span straddling two separately-placed chunks into pieces sorted by placement', () => {
    // content 0-10 split at 5, right half moved to placement 20-25: a span over content 3-8
    // appears as placement 3-5 (left chunk) and 20-23 (moved right chunk).
    const split = splitKeptRangeAt([range('a', 0, 10)], 5)
    const moved = resolveMovePlacement(split, split[1].id, 20)
    expect(mapContentRangeToPlacementRanges(moved, 3, 8)).toEqual([
      { placementStartSec: 3, placementEndSec: 5, contentStartSec: 3, contentEndSec: 5 },
      { placementStartSec: 20, placementEndSec: 23, contentStartSec: 5, contentEndSec: 8 }
    ])
  })

  it('returns nothing for a span whose content is fully cut out', () => {
    expect(mapContentRangeToPlacementRanges([range('a', 0, 5)], 6, 9)).toEqual([])
  })
})

describe('removeKeptRange', () => {
  it('truncates a range that straddles the cut start', () => {
    expect(removeKeptRange([range('a', 0, 10)], 5, 20)).toEqual([range('a', 0, 5)])
  })

  it('splits a range that fully contains the cut', () => {
    const result = removeKeptRange([range('a', 0, 20)], 5, 10)
    expect(result).toHaveLength(2)
    expect(result[0].endSec).toBe(5)
    expect(result[1].startSec).toBe(10)
  })

  it('removes a range fully inside the cut', () => {
    expect(removeKeptRange([range('a', 5, 10)], 0, 20)).toEqual([])
  })
})
