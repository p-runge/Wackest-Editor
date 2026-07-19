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
  // the main mic's own audio) silently disappeared from the export: the audio source changes
  // partway through the kept range, and a segment that doesn't split exactly there resolves audio
  // once at its own start and silently runs past where that source's real footage actually ends
  // (each per-segment ffmpeg trim just stops at its input's EOF) — which the final `-shortest` mux
  // then also silently truncates the whole export to match. `activeAudioIntervals` here is exactly
  // what `fillActiveIntervalGaps` (shared/types/timeline-time.ts) produces for this source pair —
  // trimmed to real coverage and filled — since staleness past a source's own footage is now
  // prevented upstream of this function, not defended against here.
  it('splits a segment at an audio-source change partway through a kept range', () => {
    // main mic: 0-111.5s of footage. phone clip: 105.4-121.8s of footage, with its own audio.
    const mainMic = source('main-mic', 0, 111.5, 0)
    const phoneClip = source('phone-clip', 0, 16.3474, 105.434125)

    const activeVideoIntervals: TrackInterval[] = [
      interval(0, 107.091399, 'main-mic'),
      interval(107.091399, 121.781525, 'phone-clip')
    ]
    const activeAudioIntervals: TrackInterval[] = [
      interval(0, 111.5, 'main-mic'),
      interval(111.5, 121.781525, 'phone-clip')
    ]
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

  // Placement position on the program timeline IS the output order: a chunk moved to an earlier
  // placement plays earlier, regardless of where its ranges sit in the array.
  it('processes kept ranges in placement order, not array order', () => {
    const cam = source('cam', 0, 60, 0)
    const activeVideoIntervals: TrackInterval[] = [interval(0, 60, 'cam')]
    const activeAudioIntervals: TrackInterval[] = [interval(0, 60, 'cam')]
    // chunk with content 30-40s was dragged to the very start of the timeline (placement 0-10),
    // pushing the never-moved content 0-10s chunk (still placed at 10-20) behind it. The array
    // deliberately lists them in the "wrong" order to prove array position doesn't matter.
    const keptRanges: KeptRange[] = [
      { id: 'kr-unmoved', startSec: 10, endSec: 20, contentStartSec: 0 },
      { id: 'kr-moved-first', startSec: 0, endSec: 10, contentStartSec: 30 }
    ]

    const segments = buildExportSegments(keptRanges, activeVideoIntervals, activeAudioIntervals, [
      cam
    ])

    expect(segments).toEqual([
      { unifiedStartSec: 30, unifiedEndSec: 40, videoSourceId: 'cam', audioSourceId: 'cam' },
      { unifiedStartSec: 0, unifiedEndSec: 10, videoSourceId: 'cam', audioSourceId: 'cam' }
    ])
  })

  // Regression test for Schnitt mode's free move: a range dragged to a new placement must still
  // export the footage it was picked up from (contentStartSec), not whatever else is sitting at
  // its new placement position.
  it('exports a moved range from its content span, not its placement span', () => {
    const camA = source('camA', 0, 60, 0)
    const camB = source('camB', 0, 60, 100) // camB's footage occupies unified 100-160s
    const activeVideoIntervals: TrackInterval[] = [
      interval(0, 60, 'camA'),
      interval(100, 160, 'camB')
    ]
    const activeAudioIntervals: TrackInterval[] = activeVideoIntervals
    // placed at 100-110s (where camB's footage naturally sits), but its content still points at
    // camA's 10-20s — as if that clip had been dragged from 10-20s over to 100-110s.
    const keptRanges: KeptRange[] = [
      { id: 'moved', startSec: 100, endSec: 110, contentStartSec: 10 }
    ]

    const segments = buildExportSegments(keptRanges, activeVideoIntervals, activeAudioIntervals, [
      camA,
      camB
    ])

    expect(segments).toEqual([
      { unifiedStartSec: 10, unifiedEndSec: 20, videoSourceId: 'camA', audioSourceId: 'camA' }
    ])
  })
})
