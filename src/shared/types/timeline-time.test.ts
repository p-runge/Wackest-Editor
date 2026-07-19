import { describe, expect, it } from 'vitest'
import {
  fillActiveIntervalGaps,
  defaultVideoSourceAt,
  defaultAudioSourceAt,
  resolveVideoSourceId,
  resolveAudioSourceId
} from './timeline-time'
import type { SourceClip, TrackInterval } from './project'

function source(
  id: string,
  localStartSec: number,
  localEndSec: number,
  offsetSec: number,
  hasAudio = true
): SourceClip {
  return {
    id,
    kind: 'video',
    originalFilePath: `/fake/${id}.mp4`,
    relativeFilePath: `../${id}.mp4`,
    importedAt: new Date().toISOString(),
    label: id,
    probed: {
      durationSec: localEndSec - localStartSec,
      hasVideo: true,
      hasAudio,
      container: 'mov,mp4,m4a,3gp,3g2,mj2'
    },
    syncSegments: [
      {
        id: `${id}-sync`,
        localStartSec,
        localEndSec,
        offsetSec,
        confidence: 1,
        method: 'cross-correlation'
      }
    ]
  }
}

function interval(startSec: number, endSec: number, value: string): TrackInterval {
  return { id: `${value}-${startSec}`, startSec, endSec, value }
}

describe('resolveVideoSourceId / resolveAudioSourceId', () => {
  it('are plain interval lookups — no fallback', () => {
    const intervals: TrackInterval[] = [interval(10, 20, 'cam1')]
    expect(resolveVideoSourceId(intervals, 15)).toBe('cam1')
    expect(resolveVideoSourceId(intervals, 25)).toBeUndefined()
    expect(resolveAudioSourceId(intervals, 15)).toBe('cam1')
  })
})

describe('fillActiveIntervalGaps', () => {
  // Regression test for the bottom camera-switcher lanes disagreeing with the preview/top
  // switcher: the lanes only rendered explicit TrackInterval entries, missing the leading region
  // before the first-ever switch and the trailing region after a re-sync grew the timeline past
  // the last explicit interval — both only "active" via the (now-removed) runtime fallback. Full
  // coverage is now materialized once at sync time instead.
  it('fills the leading gap before the first explicit interval with the default source', () => {
    const mainMic = source('main-mic', 0, 100, 0)
    const activeVideoIntervals: TrackInterval[] = [interval(20, 100, 'main-mic')]

    const result = fillActiveIntervalGaps(activeVideoIntervals, [mainMic], 100, (atSec) =>
      defaultVideoSourceAt([mainMic], atSec)
    )

    // the filled leading gap and the original explicit interval are the same source and touch,
    // so they merge into one continuous block rather than staying two adjacent slivers.
    expect(result).toEqual([
      expect.objectContaining({ startSec: 0, endSec: 100, value: 'main-mic' })
    ])
  })

  it('fills the trailing gap after the timeline grows past the last explicit interval', () => {
    const mainMic = source('main-mic', 0, 111.5, 0)
    const phoneClip = source('phone-clip', 0, 16.3474, 105.434125)
    const activeVideoIntervals: TrackInterval[] = [
      interval(0, 107.091399, 'main-mic'),
      interval(107.091399, 111.5, 'phone-clip')
    ]
    const sources = [mainMic, phoneClip]
    // Grew past the last interval's end (111.5) via re-sync; computed the same way `sourceCoverageRange`
    // derives phoneClip's own coverage end, so this matches the real app's floating-point arithmetic.
    const timelineDurationSec = 16.3474 + 105.434125

    const result = fillActiveIntervalGaps(
      activeVideoIntervals,
      sources,
      timelineDurationSec,
      (atSec) => defaultVideoSourceAt(sources, atSec)
    )

    // merges with the preceding explicit phone-clip interval it directly extends.
    const last = result[result.length - 1]
    expect(last).toMatchObject({
      startSec: 107.091399,
      endSec: timelineDurationSec,
      value: 'phone-clip'
    })
  })

  it('does not fill a gap where no source has any footage', () => {
    const mainMic = source('main-mic', 0, 50, 0)
    const activeVideoIntervals: TrackInterval[] = [interval(0, 50, 'main-mic')]

    const result = fillActiveIntervalGaps(activeVideoIntervals, [mainMic], 80, (atSec) =>
      defaultVideoSourceAt([mainMic], atSec)
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ startSec: 0, endSec: 50, value: 'main-mic' })
  })

  it('splits a gap at a source boundary if the default source changes partway through', () => {
    const mainMic = source('main-mic', 0, 10, 0)
    const secondCam = source('second-cam', 0, 40, 10) // covers 10-50, after main-mic runs out
    const activeVideoIntervals: TrackInterval[] = [] // nothing explicit anywhere yet
    const sources = [mainMic, secondCam]

    const result = fillActiveIntervalGaps(activeVideoIntervals, sources, 50, (atSec) =>
      defaultVideoSourceAt(sources, atSec)
    )

    expect(result).toEqual([
      expect.objectContaining({ startSec: 0, endSec: 10, value: 'main-mic' }),
      expect.objectContaining({ startSec: 10, endSec: 50, value: 'second-cam' })
    ])
  })

  // Regression test for the lane highlighting a source with no footage: an explicit interval that
  // outlives its own source's coverage was rendered verbatim, while preview/export resolved a
  // different source there — the two must never diverge again, so trimming now happens once, here,
  // permanently, rather than being separately re-derived by the display.
  it('trims an explicit interval to its source’s footage and fills the rest with the default', () => {
    const mainCam = source('main-cam', 0, 111.5, 0) // footage ends at 111.5
    const phoneClip = source('phone-clip', 0, 16.3474, 105.434125) // covers 105.43-121.78
    const sources = [mainCam, phoneClip]
    // explicit interval claims main-cam all the way to 121.78 — past its own footage.
    const activeVideoIntervals: TrackInterval[] = [interval(80, 121.781525, 'main-cam')]

    const result = fillActiveIntervalGaps(activeVideoIntervals, sources, 121.781525, (atSec) =>
      defaultVideoSourceAt(sources, atSec)
    )

    // the filled leading gap (0-80, default main-cam) and the trimmed explicit interval (80-111.5)
    // are the same source and touch, so they merge into one continuous block.
    const trimmedExplicit = result.find((iv) => iv.value === 'main-cam')
    expect(trimmedExplicit).toMatchObject({ startSec: 0, endSec: 111.5 })
    const last = result[result.length - 1]
    expect(last).toMatchObject({ startSec: 111.5, endSec: 121.781525, value: 'phone-clip' })
  })

  // Regression test for removing a source: an interval that names a source no longer in `sources`
  // must be dropped entirely (not kept as-is, which would point playback/export at nothing) and
  // the stretch it covered re-filled with whichever source is now the default there.
  it('drops an interval whose source no longer exists and fills the gap it leaves', () => {
    const mainCam = source('main-cam', 0, 50, 0)
    // 'deleted-cam' is referenced by the interval but not in `sources` — simulates removeSource.
    const activeVideoIntervals: TrackInterval[] = [interval(10, 30, 'deleted-cam')]

    const result = fillActiveIntervalGaps(activeVideoIntervals, [mainCam], 50, (atSec) =>
      defaultVideoSourceAt([mainCam], atSec)
    )

    expect(result).toEqual([
      expect.objectContaining({ startSec: 0, endSec: 50, value: 'main-cam' })
    ])
  })

  it('is empty when the timeline has no duration', () => {
    expect(fillActiveIntervalGaps([], [], 0, () => undefined)).toEqual([])
  })

  // Regression test for an audible-but-invisible audio flip: with no explicit audio yet, the
  // audio default follows the active VIDEO source's own audio, so it flips at video switches —
  // boundaries the gap fill must split at (not just footage edges), or the materialized interval
  // would show one continuous source while playback/export audibly switch away and back.
  it('splits an audio gap at video-interval boundaries via extraBoundarySecs', () => {
    const mainCam = source('main-cam', 0, 100, 0)
    const insertCam = source('insert-cam', 0, 30, 20) // covers 20-50
    const sources = [mainCam, insertCam]
    // video: explicit switch to insert-cam for 30-40, main-cam around it (via default fill).
    const activeVideoIntervals = fillActiveIntervalGaps(
      [interval(30, 40, 'insert-cam')],
      sources,
      100,
      (atSec) => defaultVideoSourceAt(sources, atSec)
    )
    const activeAudioIntervals: TrackInterval[] = [] // nothing explicit — default everywhere

    const result = fillActiveIntervalGaps(
      activeAudioIntervals,
      sources,
      100,
      (atSec) =>
        defaultAudioSourceAt(sources, atSec, resolveVideoSourceId(activeVideoIntervals, atSec)),
      activeVideoIntervals.flatMap((iv) => [iv.startSec, iv.endSec])
    )

    expect(result).toEqual([
      expect.objectContaining({ startSec: 0, endSec: 30, value: 'main-cam' }),
      expect.objectContaining({ startSec: 30, endSec: 40, value: 'insert-cam' }),
      expect.objectContaining({ startSec: 40, endSec: 100, value: 'main-cam' })
    ])
  })
})

describe('defaultAudioSourceAt', () => {
  it('falls back to any audio-bearing source once the given video source’s own audio runs out', () => {
    const mainMic = source('main-mic', 0, 111.5, 0)
    const phoneClip = source('phone-clip', 0, 16.3474, 105.434125)
    const sources = [mainMic, phoneClip]
    const activeVideoIntervals = fillActiveIntervalGaps(
      [interval(0, 107.091399, 'main-mic'), interval(107.091399, 111.5, 'phone-clip')],
      sources,
      121.781525,
      (atSec) => defaultVideoSourceAt(sources, atSec)
    )
    const activeAudioIntervals: TrackInterval[] = [interval(0, 111.5, 'main-mic')]

    const result = fillActiveIntervalGaps(
      activeAudioIntervals,
      sources,
      121.781525,
      (atSec) =>
        defaultAudioSourceAt(sources, atSec, resolveVideoSourceId(activeVideoIntervals, atSec)),
      activeVideoIntervals.flatMap((iv) => [iv.startSec, iv.endSec])
    )

    const last = result[result.length - 1]
    expect(last).toMatchObject({ startSec: 111.5, endSec: 121.781525, value: 'phone-clip' })
  })
})
