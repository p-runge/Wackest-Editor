import { describe, expect, it } from 'vitest'
import { buildCutTimeline, buildMulticamTimeline } from './nle-timeline'
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

describe('buildCutTimeline', () => {
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

    const timeline = buildCutTimeline(p)

    expect(timeline.videoTracks).toHaveLength(1)
    expect(timeline.videoTracks[0].clips).toEqual([
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

    const timeline = buildCutTimeline(p)

    expect(timeline.videoTracks[0].clips).toEqual([
      { sourceId: 'cam', timelineStartSec: 0, timelineEndSec: 30, sourceInSec: 0, sourceOutSec: 30 }
    ])
    expect(timeline.audioTracks[0].clips).toEqual([
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

    const timeline = buildCutTimeline(p)

    expect(timeline.videoTracks[0].clips).toEqual([
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

    const timeline = buildCutTimeline(p)
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

    const timeline = buildCutTimeline(p)
    expect(timeline.assets.map((a) => a.sourceId)).toEqual(['cam'])
  })
})

describe('buildMulticamTimeline', () => {
  it('lays each raw source in parallel at its synced offset, full footage', () => {
    const camA = source('camA', 0, 60, 0)
    const camB = source('camB', 0, 40, 100) // footage sits at unified 100-140s
    const p = project([camA, camB], {
      activeVideoIntervals: [interval(0, 60, 'camA'), interval(100, 140, 'camB')],
      activeAudioIntervals: [interval(0, 60, 'camA'), interval(100, 140, 'camB')],
      // a cut that would drop most of the timeline — multicam must IGNORE it and export raw
      keptRanges: [{ id: 'a', startSec: 0, endSec: 5 }]
    })

    const timeline = buildMulticamTimeline(p)

    // one raw track per source (bottom), plus the active-selection track (top)
    const rawCamA = timeline.videoTracks[0]
    const rawCamB = timeline.videoTracks[1]
    expect(rawCamA.clips).toEqual([
      {
        sourceId: 'camA',
        timelineStartSec: 0,
        timelineEndSec: 60,
        sourceInSec: 0,
        sourceOutSec: 60
      }
    ])
    expect(rawCamB.clips).toEqual([
      {
        sourceId: 'camB',
        timelineStartSec: 100,
        timelineEndSec: 140,
        sourceInSec: 0,
        sourceOutSec: 40
      }
    ])
    // full sync span, not the 5s cut
    expect(timeline.totalDurationSec).toBe(140)
  })

  it('puts the active selection on the topmost (last) track', () => {
    const camA = source('camA', 0, 60, 0)
    const camB = source('camB', 0, 40, 100)
    const p = project([camA, camB], {
      activeVideoIntervals: [interval(0, 60, 'camA'), interval(100, 140, 'camB')],
      activeAudioIntervals: [interval(0, 60, 'camA'), interval(100, 140, 'camB')],
      keptRanges: [{ id: 'a', startSec: 0, endSec: 140 }]
    })

    const timeline = buildMulticamTimeline(p)

    const topVideo = timeline.videoTracks[timeline.videoTracks.length - 1]
    expect(topVideo.name).toBe('Aktive Wahl (Video)')
    expect(topVideo.clips).toEqual([
      {
        sourceId: 'camA',
        timelineStartSec: 0,
        timelineEndSec: 60,
        sourceInSec: 0,
        sourceOutSec: 60
      },
      {
        sourceId: 'camB',
        timelineStartSec: 100,
        timelineEndSec: 140,
        sourceInSec: 0,
        sourceOutSec: 40
      }
    ])
  })

  it('mutes raw audio tracks but keeps the active-audio track enabled', () => {
    const cam = source('cam', 0, 60, 0)
    const lav = source('lav', 0, 60, 0, { kind: 'audio' })
    const p = project([cam, lav], {
      activeVideoIntervals: [interval(0, 60, 'cam')],
      activeAudioIntervals: [interval(0, 60, 'lav')],
      keptRanges: [{ id: 'a', startSec: 0, endSec: 60 }]
    })

    const timeline = buildMulticamTimeline(p)

    const rawAudio = timeline.audioTracks.filter((t) => t.name.startsWith('Roh:'))
    const activeAudio = timeline.audioTracks[timeline.audioTracks.length - 1]
    expect(rawAudio.every((t) => t.enabled === false)).toBe(true)
    expect(activeAudio.name).toBe('Aktive Wahl (Audio)')
    expect(activeAudio.enabled).toBe(true)
  })

  it('throws when no source has been synced', () => {
    const unsynced = source('cam', 0, 60, 0, { syncSegments: [] })
    const p = project([unsynced], {
      activeVideoIntervals: [],
      activeAudioIntervals: [],
      keptRanges: []
    })

    expect(() => buildMulticamTimeline(p)).toThrow(/synchronisieren/)
  })
})
