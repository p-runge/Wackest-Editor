import { describe, expect, it } from 'vitest'
import type { TrackHeatmap } from '@shared/types/project'
import { computeAutoVideoIntervals } from './auto-switch'

function track(sourceId: string, scores: Array<[number, number, number]>): TrackHeatmap {
  return {
    sourceId,
    provider: 'audio-energy-local',
    points: scores.map(([startSec, endSec, score]) => ({ startSec, endSec, score }))
  }
}

describe('computeAutoVideoIntervals', () => {
  it('picks the highest-scoring source per bucket (argmax)', () => {
    const a = track('a', [
      [0, 10, 0.9],
      [10, 20, 0.1]
    ])
    const b = track('b', [
      [0, 10, 0.2],
      [10, 20, 0.8]
    ])
    const result = computeAutoVideoIntervals([a, b], { minShotSec: 0 })
    expect(result).toEqual([
      { startSec: 0, endSec: 10, value: 'a' },
      { startSec: 10, endSec: 20, value: 'b' }
    ])
  })

  it('merges contiguous buckets won by the same source', () => {
    const a = track('a', [
      [0, 10, 0.9],
      [10, 20, 0.9]
    ])
    const b = track('b', [
      [0, 10, 0.2],
      [10, 20, 0.2]
    ])
    const result = computeAutoVideoIntervals([a, b], { minShotSec: 0 })
    expect(result).toEqual([{ startSec: 0, endSec: 20, value: 'a' }])
  })

  it('absorbs a shot shorter than the minimum into a neighbor to stop flicker', () => {
    // b wins only the tiny middle bucket; with a 5s minimum it should be swallowed by a.
    const a = track('a', [
      [0, 10, 0.9],
      [10, 12, 0.1],
      [12, 22, 0.9]
    ])
    const b = track('b', [
      [0, 10, 0.1],
      [10, 12, 0.9],
      [12, 22, 0.1]
    ])
    const result = computeAutoVideoIntervals([a, b], { minShotSec: 5 })
    expect(result).toEqual([{ startSec: 0, endSec: 22, value: 'a' }])
  })

  it('does not merge across a genuine coverage gap', () => {
    // a covers 0-10, b covers 20-30; nothing covers 10-20 (e.g. a hard-cut gap).
    const a = track('a', [[0, 10, 0.9]])
    const b = track('b', [[20, 30, 0.9]])
    const result = computeAutoVideoIntervals([a, b], { minShotSec: 15 })
    // Both shots are shorter than minShot but isolated by the gap, so they stay as-is.
    expect(result).toEqual([
      { startSec: 0, endSec: 10, value: 'a' },
      { startSec: 20, endSec: 30, value: 'b' }
    ])
  })

  it('returns nothing when there are no heatmaps', () => {
    expect(computeAutoVideoIntervals([], { minShotSec: 2 })).toEqual([])
  })
})
