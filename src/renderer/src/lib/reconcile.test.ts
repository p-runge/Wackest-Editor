import { describe, expect, it } from 'vitest'
import { createEmptyProject, type Project, type SourceClip } from '@shared/types/project'
import { ensureDeviceGroups } from '@shared/types/device-grouping'
import { reconcileProject } from './reconcile'

function videoSource(id: string, durationSec: number): SourceClip {
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
        offsetSec: 0,
        confidence: 1,
        method: 'manual'
      }
    ]
  }
}

function baseProject(): Project {
  const p = createEmptyProject('test', 'proj-1')
  p.sources = [videoSource('new-a', 100)]
  p.timelineDurationSec = 100
  // reconcileProject also runs ensureDeviceGroups, so a genuinely "clean" project must already be
  // grouped for reconcile to be a no-op — mirror that here.
  return ensureDeviceGroups(p)
}

describe('reconcileProject', () => {
  it('drops transcript and heatmaps that reference removed sources', () => {
    const p = baseProject()
    p.transcript = [
      {
        id: 't1',
        startSec: 0,
        endSec: 5,
        text: 'gone',
        sourceClipId: 'old-x',
        provider: 'whispercpp-local'
      },
      {
        id: 't2',
        startSec: 5,
        endSec: 10,
        text: 'kept',
        sourceClipId: 'new-a',
        provider: 'whispercpp-local'
      }
    ]
    p.trackHeatmaps = [
      {
        sourceId: 'old-x',
        provider: 'audio-energy-local',
        points: [{ startSec: 0, endSec: 5, score: 0.5 }]
      },
      {
        sourceId: 'new-a',
        provider: 'audio-energy-local',
        points: [{ startSec: 0, endSec: 5, score: 0.7 }]
      }
    ]
    const result = reconcileProject(p)
    expect(result.transcript.map((t) => t.id)).toEqual(['t2'])
    expect(result.trackHeatmaps.map((t) => t.sourceId)).toEqual(['new-a'])
  })

  it('resets cut ranges that extend past the current timeline (out of bounds)', () => {
    const p = baseProject()
    // Leftover cut from longer, previous footage: starts at 80, ends at 130 > duration 100.
    p.edit.keptRanges = [{ id: 'k1', startSec: 80, endSec: 130 }]
    const result = reconcileProject(p)
    expect(result.edit.keptRanges).toEqual([{ id: expect.any(String), startSec: 0, endSec: 100 }])
  })

  it('resets cut ranges when the footage was wholly swapped (all transcript dead)', () => {
    const p = baseProject()
    // In-bounds but stale: a front gap 0-40 from an edit of different footage.
    p.edit.keptRanges = [{ id: 'k1', startSec: 40, endSec: 100 }]
    p.transcript = [
      {
        id: 't1',
        startSec: 0,
        endSec: 5,
        text: 'gone',
        sourceClipId: 'old-x',
        provider: 'whispercpp-local'
      }
    ]
    const result = reconcileProject(p)
    expect(result.edit.keptRanges).toEqual([{ id: expect.any(String), startSec: 0, endSec: 100 }])
    expect(result.transcript).toEqual([])
  })

  it('keeps real cuts on a partial removal (some transcript still valid)', () => {
    const p = baseProject()
    p.sources = [videoSource('new-a', 100), videoSource('new-b', 100)]
    const cuts = [
      { id: 'k1', startSec: 0, endSec: 30 },
      { id: 'k2', startSec: 60, endSec: 100 }
    ]
    p.edit.keptRanges = cuts
    p.transcript = [
      {
        id: 't1',
        startSec: 0,
        endSec: 5,
        text: 'gone',
        sourceClipId: 'removed',
        provider: 'whispercpp-local'
      },
      {
        id: 't2',
        startSec: 5,
        endSec: 10,
        text: 'kept',
        sourceClipId: 'new-a',
        provider: 'whispercpp-local'
      }
    ]
    const result = reconcileProject(p)
    // Dead transcript dropped, but the user's cuts are preserved (footage not wholly swapped).
    expect(result.transcript.map((t) => t.id)).toEqual(['t2'])
    expect(result.edit.keptRanges).toBe(cuts)
  })

  it('is a no-op for a clean additive state', () => {
    const p = baseProject()
    p.edit.keptRanges = [{ id: 'k1', startSec: 0, endSec: 100 }]
    p.transcript = [
      {
        id: 't1',
        startSec: 0,
        endSec: 5,
        text: 'ok',
        sourceClipId: 'new-a',
        provider: 'whispercpp-local'
      }
    ]
    expect(reconcileProject(p)).toBe(p)
  })
})
