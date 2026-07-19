import { describe, expect, it } from 'vitest'
import { buildExportSegments, groupAudioSpans, type ExportSegment } from './edl'
import type { KeptRange, SourceClip, TrackInterval } from '@shared/types/project'

function segment(
  unifiedStartSec: number,
  unifiedEndSec: number,
  videoSourceId: string,
  audioSourceId: string
): ExportSegment {
  return { unifiedStartSec, unifiedEndSec, videoSourceId, audioSourceId }
}

describe('groupAudioSpans', () => {
  it('merges consecutive segments that share the same audio source across camera cuts', () => {
    const segments = [
      segment(0, 10, 'cam1', 'cam1'),
      segment(10, 20, 'cam2', 'cam1'),
      segment(20, 30, 'cam3', 'cam1')
    ]

    expect(groupAudioSpans(segments)).toEqual([
      { unifiedStartSec: 0, unifiedEndSec: 30, audioSourceId: 'cam1' }
    ])
  })

  it('splits at a genuine audio source change', () => {
    const segments = [
      segment(0, 10, 'cam1', 'cam1'),
      segment(10, 20, 'cam2', 'cam1'),
      segment(20, 30, 'cam2', 'lav-mic')
    ]

    expect(groupAudioSpans(segments)).toEqual([
      { unifiedStartSec: 0, unifiedEndSec: 20, audioSourceId: 'cam1' },
      { unifiedStartSec: 20, unifiedEndSec: 30, audioSourceId: 'lav-mic' }
    ])
  })

  it('does not merge across a real timeline gap even if the audio source matches on both sides', () => {
    const segments = [
      segment(0, 10, 'cam1', 'cam1'),
      // a cut-out gap between 10 and 15 means these are not contiguous
      segment(15, 25, 'cam1', 'cam1')
    ]

    expect(groupAudioSpans(segments)).toEqual([
      { unifiedStartSec: 0, unifiedEndSec: 10, audioSourceId: 'cam1' },
      { unifiedStartSec: 15, unifiedEndSec: 25, audioSourceId: 'cam1' }
    ])
  })
})

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

describe('buildExportSegments', () => {
  // Regression test for the bug where the last, shortest video clip (which overlaps and outlives
  // the main mic's own audio) silently disappeared from the export: the explicit audio interval
  // covered the whole tail on paper, but the main mic's real footage ran out partway through it —
  // and because segments weren't split at that point, the per-segment audio render silently
  // stopped at its source's EOF, then the final `-shortest` mux truncated the video to match.
  it('splits a segment when its explicit audio source runs out of real footage partway through', () => {
    // main mic: 0-111.5s of footage. phone clip: 105.4-121.8s of footage, with its own audio.
    const mainMic = source('main-mic', 0, 111.5, 0)
    const phoneClip = source('phone-clip', 0, 16.3474, 105.434125)

    const activeVideoIntervals: TrackInterval[] = [
      interval(0, 107.091399, 'main-mic'),
      interval(107.091399, 121.781525, 'phone-clip')
    ]
    // explicit audio interval claims the main mic for the whole timeline, but the mic's real
    // footage (see `mainMic` above) actually ends at 111.5s — well before the timeline's 121.8s end.
    const activeAudioIntervals: TrackInterval[] = [interval(0, 121.781525, 'main-mic')]
    const keptRanges: KeptRange[] = [{ id: 'kr1', startSec: 0, endSec: 121.781525 }]

    const segments = buildExportSegments(keptRanges, activeVideoIntervals, activeAudioIntervals, [
      mainMic,
      phoneClip
    ])

    // the final segment must be split at 111.5s (where the main mic's real audio coverage ends),
    // falling back to the phone clip's own audio for the tail instead of silently running past it.
    const last = segments[segments.length - 1]
    expect(last.unifiedEndSec).toBe(121.781525)
    expect(last.audioSourceId).toBe('phone-clip')

    const spans = groupAudioSpans(segments)
    // the audio spans must together cover the full timeline, matching the video's true end —
    // otherwise the final mux's `-shortest` flag truncates the exported video to match short audio.
    expect(spans[spans.length - 1].unifiedEndSec).toBe(121.781525)
  })
})
