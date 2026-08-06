import { describe, expect, it } from 'vitest'
import { buildNleTimeline } from './nle-timeline'
import {
  SCHEMA_VERSION,
  type Project,
  type SourceClip,
  type TrackInterval
} from '@shared/types/project'

function source(
  id: string,
  localStartSec: number,
  localEndSec: number,
  offsetSec: number,
  overrides: Partial<SourceClip> = {}
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
      hasAudio: true,
      width: 1920,
      height: 1080,
      frameRate: 30,
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
    ],
    ...overrides
  }
}

function interval(startSec: number, endSec: number, value: string): TrackInterval {
  return { id: `${value}-${startSec}`, startSec, endSec, value }
}

function project(sources: SourceClip[], edit: Project['edit'], name = 'Test'): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'p1',
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sources,
    timelineDurationSec: 0,
    transcript: [],
    trackHeatmaps: [],
    edit,
    providerConfig: {
      transcription: { provider: 'openai-whisper-api', languageHint: 'auto' },
      heatmap: { provider: 'audio-energy-local' }
    }
  }
}

describe('buildNleTimeline', () => {
  it('lays clips end-to-end on the program timeline (concatenated), not at their unified times', () => {
    const cam = source('cam', 0, 60, 0)
    // two kept ranges with a real gap between them (30-40s cut out): the second range must sit
    // directly after the first on the program timeline, not at its unified time.
    const p = project([cam], {
      activeVideoIntervals: [interval(0, 60, 'cam')],
      activeAudioIntervals: [interval(0, 60, 'cam')],
      keptRanges: [
        { id: 'a', startSec: 0, endSec: 20 },
        { id: 'b', startSec: 40, endSec: 50 }
      ]
    })

    const timeline = buildNleTimeline(p)

    expect(timeline.videoClips).toEqual([
      {
        sourceId: 'cam',
        timelineStartSec: 0,
        timelineEndSec: 20,
        sourceInSec: 0,
        sourceOutSec: 20
      },
      {
        sourceId: 'cam',
        timelineStartSec: 20,
        timelineEndSec: 30,
        sourceInSec: 40,
        sourceOutSec: 50
      }
    ])
    expect(timeline.totalDurationSec).toBe(30)
  })

  it('merges camera-held video split only by an audio boundary into one clip', () => {
    const cam = source('cam', 0, 60, 0)
    const lav = source('lav', 0, 60, 0, { kind: 'audio' })
    // video is 'cam' throughout, but the active audio switches cam->lav at 10s. Video should stay
    // one merged clip; audio should be two clips.
    const p = project([cam, lav], {
      activeVideoIntervals: [interval(0, 30, 'cam')],
      activeAudioIntervals: [interval(0, 10, 'cam'), interval(10, 30, 'lav')],
      keptRanges: [{ id: 'a', startSec: 0, endSec: 30 }]
    })

    const timeline = buildNleTimeline(p)

    expect(timeline.videoClips).toEqual([
      { sourceId: 'cam', timelineStartSec: 0, timelineEndSec: 30, sourceInSec: 0, sourceOutSec: 30 }
    ])
    expect(timeline.audioClips).toEqual([
      {
        sourceId: 'cam',
        timelineStartSec: 0,
        timelineEndSec: 10,
        sourceInSec: 0,
        sourceOutSec: 10
      },
      {
        sourceId: 'lav',
        timelineStartSec: 10,
        timelineEndSec: 30,
        sourceInSec: 10,
        sourceOutSec: 30
      }
    ])
  })

  it('maps source in-points through the sync offset', () => {
    // camB's footage sits at unified 100-160s (offset 100), so unified 110 maps to local 10.
    const camA = source('camA', 0, 60, 0)
    const camB = source('camB', 0, 60, 100)
    const p = project([camA, camB], {
      activeVideoIntervals: [interval(0, 60, 'camA'), interval(100, 160, 'camB')],
      activeAudioIntervals: [interval(0, 60, 'camA'), interval(100, 160, 'camB')],
      keptRanges: [{ id: 'a', startSec: 110, endSec: 120 }]
    })

    const timeline = buildNleTimeline(p)

    expect(timeline.videoClips).toEqual([
      {
        sourceId: 'camB',
        timelineStartSec: 0,
        timelineEndSec: 10,
        sourceInSec: 10,
        sourceOutSec: 20
      }
    ])
  })

  it('detects an NTSC frame rate from the main source', () => {
    const cam = source('cam', 0, 60, 0, {
      probed: {
        durationSec: 60,
        hasVideo: true,
        hasAudio: true,
        width: 1920,
        height: 1080,
        frameRate: 29.97,
        container: 'mov'
      }
    })
    const p = project([cam], {
      activeVideoIntervals: [interval(0, 60, 'cam')],
      activeAudioIntervals: [interval(0, 60, 'cam')],
      keptRanges: [{ id: 'a', startSec: 0, endSec: 10 }]
    })

    const timeline = buildNleTimeline(p)
    expect(timeline.timebase).toBe(30)
    expect(timeline.ntsc).toBe(true)
  })

  it('collects only referenced sources as assets, once each', () => {
    const cam = source('cam', 0, 60, 0)
    const unused = source('unused', 0, 60, 0)
    const p = project([cam, unused], {
      activeVideoIntervals: [interval(0, 60, 'cam')],
      activeAudioIntervals: [interval(0, 60, 'cam')],
      keptRanges: [{ id: 'a', startSec: 0, endSec: 10 }]
    })

    const timeline = buildNleTimeline(p)
    expect(timeline.assets.map((a) => a.sourceId)).toEqual(['cam'])
  })
})
