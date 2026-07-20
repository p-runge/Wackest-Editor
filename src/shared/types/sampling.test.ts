import { describe, expect, it } from 'vitest'
import type { SourceClip } from './project'
import {
  computeAdaptiveBucketSec,
  visionBucketSec,
  planSampling,
  estimateVisionRun,
  MAX_TOTAL_FRAMES
} from './sampling'

function videoSource(id: string, durationSec: number, offsetSec = 0): SourceClip {
  return {
    id,
    kind: 'video',
    originalFilePath: `/tmp/${id}.mp4`,
    relativeFilePath: `${id}.mp4`,
    importedAt: '2026-07-20T00:00:00.000Z',
    label: id,
    probed: { durationSec, hasVideo: true, hasAudio: true, container: 'mp4' },
    syncSegments: [
      {
        id: `${id}-seg`,
        localStartSec: 0,
        localEndSec: durationSec,
        offsetSec,
        confidence: 1,
        method: 'cross-correlation'
      }
    ]
  }
}

describe('computeAdaptiveBucketSec', () => {
  it('is finer for short timelines and capped for long ones', () => {
    expect(computeAdaptiveBucketSec(145)).toBeCloseTo(3.625, 3) // 145/40
    expect(computeAdaptiveBucketSec(30)).toBe(3) // clamped to MIN
    expect(computeAdaptiveBucketSec(4000)).toBe(20) // clamped to MAX
    expect(computeAdaptiveBucketSec(0)).toBe(20)
  })
})

describe('visionBucketSec', () => {
  it('maps each density to a distinct sampling interval', () => {
    expect(visionBucketSec('low')).toBe(6)
    expect(visionBucketSec('medium')).toBe(3)
    expect(visionBucketSec('high')).toBe(1.5)
  })
})

describe('planSampling', () => {
  it('samples one frame per bucket at its midpoint, in source-local time', () => {
    const plan = planSampling([videoSource('a', 40, 100)], 'medium')
    const src = plan.perSource[0]
    expect(src.bucketUnifiedRanges.length).toBeGreaterThan(1)
    const [uStart, uEnd] = src.bucketUnifiedRanges[0]
    const first = src.bucketLocalTimestamps[0]
    expect(first).toHaveLength(1)
    // midpoint of [uStart,uEnd] mapped to local (unified - offset 100)
    expect(first[0]).toBeCloseTo((uStart + uEnd) / 2 - 100, 5)
  })

  it('makes low/medium/high produce clearly different frame counts', () => {
    const sources = [videoSource('a', 111, 0), videoSource('b', 24, 120)]
    const low = planSampling(sources, 'low').totalFrames
    const medium = planSampling(sources, 'medium').totalFrames
    const high = planSampling(sources, 'high').totalFrames
    expect(low).toBeLessThan(medium)
    expect(medium).toBeLessThan(high)
  })

  it('honors the global frame cap by coarsening the interval', () => {
    // Many long sources at high density would blow past the cap without coarsening.
    const sources = Array.from({ length: 6 }, (_, i) => videoSource(`s${i}`, 600, i * 600))
    const plan = planSampling(sources, 'high')
    expect(plan.totalFrames).toBeLessThanOrEqual(MAX_TOTAL_FRAMES)
  })

  it('skips sources without sync coverage', () => {
    const noSync = videoSource('x', 30)
    noSync.syncSegments = []
    expect(planSampling([noSync], 'medium').perSource).toEqual([])
  })
})

describe('estimateVisionRun', () => {
  it('is free and per-frame timed for the local provider', () => {
    const est = estimateVisionRun(10, 'vision-llm-local')
    expect(est.costUsd).toBe(0)
    expect(est.durationSec).toBeGreaterThan(0)
  })

  it('charges per frame and batches requests for cloud providers', () => {
    const est = estimateVisionRun(12, 'vision-llm-openai')
    expect(est.costUsd).toBeGreaterThan(0)
    expect(est.durationSec).toBe(Math.ceil(12 / 6) * 3)
  })
})
