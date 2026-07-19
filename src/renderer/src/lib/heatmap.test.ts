import { describe, expect, it } from 'vitest'
import type { TrackHeatmap } from '@shared/types/project'
import { deriveGlobalHeatmap } from './heatmap'

function track(sourceId: string, scores: Array<[number, number, number]>): TrackHeatmap {
  return {
    sourceId,
    provider: 'audio-energy-local',
    points: scores.map(([startSec, endSec, score]) => ({ startSec, endSec, score }))
  }
}

describe('deriveGlobalHeatmap', () => {
  it('takes the max score across sources per slice', () => {
    const a = track('a', [
      [0, 10, 0.9],
      [10, 20, 0.1]
    ])
    const b = track('b', [
      [0, 10, 0.2],
      [10, 20, 0.8]
    ])
    expect(deriveGlobalHeatmap([a, b])).toEqual([
      { startSec: 0, endSec: 10, score: 0.9, reason: undefined },
      { startSec: 10, endSec: 20, score: 0.8, reason: undefined }
    ])
  })

  it('splits at the union of bucket edges when sources are misaligned', () => {
    const a = track('a', [[0, 20, 0.5]])
    const b = track('b', [[10, 30, 0.9]])
    // Edges: 0,10,20,30 -> slices [0,10]=max(0.5)=a, [10,20]=max(0.5,0.9)=b, [20,30]=0.9=b (merged)
    expect(deriveGlobalHeatmap([a, b])).toEqual([
      { startSec: 0, endSec: 10, score: 0.5, reason: undefined },
      { startSec: 10, endSec: 30, score: 0.9, reason: undefined }
    ])
  })

  it('returns nothing for empty input', () => {
    expect(deriveGlobalHeatmap([])).toEqual([])
  })
})
