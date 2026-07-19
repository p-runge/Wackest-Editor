import { describe, expect, it } from 'vitest'
import { fillIntervalGaps, resolveVideoSourceId, resolveAudioSourceId } from './timeline-time'
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

describe('fillIntervalGaps', () => {
  // Regression test for the bottom camera-switcher lanes disagreeing with the preview/top
  // switcher: the lanes only rendered explicit TrackInterval entries, missing the leading region
  // before the first-ever switch and the trailing region after a re-sync grew the timeline past
  // the last explicit interval — both of which are only "active" via fallback resolution.
  it('fills the leading gap before the first explicit interval with the fallback source', () => {
    const mainMic = source('main-mic', 0, 100, 0)
    const activeVideoIntervals: TrackInterval[] = [interval(20, 100, 'main-mic')]

    const result = fillIntervalGaps(activeVideoIntervals, [mainMic], 100, (atSec) =>
      resolveVideoSourceId(activeVideoIntervals, [mainMic], atSec)
    )

    expect(result[0]).toMatchObject({ startSec: 0, endSec: 20, value: 'main-mic', synthetic: true })
    expect(result[1]).toMatchObject({ startSec: 20, endSec: 100, value: 'main-mic' })
    expect(result[1].synthetic).toBeUndefined()
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

    const result = fillIntervalGaps(activeVideoIntervals, sources, timelineDurationSec, (atSec) =>
      resolveVideoSourceId(activeVideoIntervals, sources, atSec)
    )

    const last = result[result.length - 1]
    expect(last).toMatchObject({
      startSec: 111.5,
      endSec: timelineDurationSec,
      value: 'phone-clip',
      synthetic: true
    })
  })

  it('does not synthesize a gap where no source has any footage', () => {
    const mainMic = source('main-mic', 0, 50, 0)
    const activeVideoIntervals: TrackInterval[] = [interval(0, 50, 'main-mic')]

    const result = fillIntervalGaps(activeVideoIntervals, [mainMic], 80, (atSec) =>
      resolveVideoSourceId(activeVideoIntervals, [mainMic], atSec)
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ startSec: 0, endSec: 50, value: 'main-mic' })
  })

  it('splits a gap at a source boundary if the fallback-resolved source changes partway through', () => {
    const mainMic = source('main-mic', 0, 10, 0)
    const secondCam = source('second-cam', 0, 40, 10) // covers 10-50, after main-mic runs out
    const activeVideoIntervals: TrackInterval[] = [] // nothing explicit anywhere yet

    const result = fillIntervalGaps(activeVideoIntervals, [mainMic, secondCam], 50, (atSec) =>
      resolveVideoSourceId(activeVideoIntervals, [mainMic, secondCam], atSec)
    )

    expect(result).toEqual([
      expect.objectContaining({ startSec: 0, endSec: 10, value: 'main-mic' }),
      expect.objectContaining({ startSec: 10, endSec: 50, value: 'second-cam' })
    ])
  })
})

describe('resolveAudioSourceId fallback via fillIntervalGaps', () => {
  it('falls back to the video source’s own audio once the explicit audio source runs out', () => {
    const mainMic = source('main-mic', 0, 111.5, 0)
    const phoneClip = source('phone-clip', 0, 16.3474, 105.434125)
    const sources = [mainMic, phoneClip]
    const activeVideoIntervals: TrackInterval[] = [
      interval(0, 107.091399, 'main-mic'),
      interval(107.091399, 121.781525, 'phone-clip')
    ]
    const activeAudioIntervals: TrackInterval[] = [interval(0, 111.5, 'main-mic')]

    const result = fillIntervalGaps(activeAudioIntervals, sources, 121.781525, (atSec) =>
      resolveAudioSourceId(
        activeAudioIntervals,
        sources,
        atSec,
        resolveVideoSourceId(activeVideoIntervals, sources, atSec)
      )
    )

    const last = result[result.length - 1]
    expect(last).toMatchObject({ startSec: 111.5, endSec: 121.781525, value: 'phone-clip' })
  })
})
