import { describe, expect, it } from 'vitest'
import { buildMulticamTimeline, type NleTrack } from './nle-timeline'
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

function project(
  sources: SourceClip[],
  edit: Project['edit'],
  deviceGroups: Project['deviceGroups'] = [],
  name = 'Test'
): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'p1',
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sources,
    deviceGroups,
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

// Ungrouped test sources fall back to a singleton group named by the source label (see
// buildMulticamTimeline), so a lane's name equals the source's label unless a device group is set.
function trackFor(tracks: NleTrack[], name: string): NleTrack {
  const track = tracks.find((t) => t.name === name)
  if (!track) throw new Error(`track ${name} not found`)
  return track
}

// Two cameras filming the same 0-60s window in parallel; camA also carries the used mic.
function twoCamProject(
  activeVideoIntervals: TrackInterval[],
  activeAudioIntervals: TrackInterval[]
): Project {
  return project([source('camA', 0, 60, 0), source('camB', 0, 60, 0)], {
    activeVideoIntervals,
    activeAudioIntervals,
    keptRanges: [{ id: 'k', startSec: 0, endSec: 60 }]
  })
}

describe('buildMulticamTimeline', () => {
  it('lays one raw track per source at its synced offset, full footage', () => {
    const camA = source('camA', 0, 60, 0)
    const camB = source('camB', 0, 40, 100) // footage sits at unified 100-140s
    const p = project([camA, camB], {
      activeVideoIntervals: [interval(0, 60, 'camA'), interval(100, 140, 'camB')],
      activeAudioIntervals: [interval(0, 60, 'camA'), interval(100, 140, 'camB')],
      keptRanges: [{ id: 'k', startSec: 0, endSec: 140 }]
    })

    const timeline = buildMulticamTimeline(p)

    // camB's single clip spans its full footage at the synced offset (unified 100-140, local 0-40)
    const rawCamB = trackFor(timeline.videoTracks, 'camB')
    expect(rawCamB.clips).toEqual([
      {
        sourceId: 'camB',
        timelineStartSec: 100,
        timelineEndSec: 140,
        sourceInSec: 0,
        sourceOutSec: 40,
        enabled: true
      }
    ])
    expect(timeline.totalDurationSec).toBe(140)
  })

  it('razor-cuts a raw track at video switches, enabling only the active sub-clip', () => {
    const timeline = buildMulticamTimeline(
      twoCamProject([interval(0, 30, 'camA'), interval(30, 60, 'camB')], [interval(0, 60, 'camA')])
    )

    // camA is the active camera 0-30 (enabled), then camB takes over 30-60 (camA disabled)
    expect(trackFor(timeline.videoTracks, 'camA').clips).toEqual([
      {
        sourceId: 'camA',
        timelineStartSec: 0,
        timelineEndSec: 30,
        sourceInSec: 0,
        sourceOutSec: 30,
        enabled: true
      },
      {
        sourceId: 'camA',
        timelineStartSec: 30,
        timelineEndSec: 60,
        sourceInSec: 30,
        sourceOutSec: 60,
        enabled: false
      }
    ])
    // camB is the mirror: disabled while camA is active, enabled once it takes over
    expect(trackFor(timeline.videoTracks, 'camB').clips).toEqual([
      {
        sourceId: 'camB',
        timelineStartSec: 0,
        timelineEndSec: 30,
        sourceInSec: 0,
        sourceOutSec: 30,
        enabled: false
      },
      {
        sourceId: 'camB',
        timelineStartSec: 30,
        timelineEndSec: 60,
        sourceInSec: 30,
        sourceOutSec: 60,
        enabled: true
      }
    ])
  })

  it('disables the whole raw audio track of a source that is never the active audio', () => {
    const timeline = buildMulticamTimeline(
      twoCamProject(
        [interval(0, 30, 'camA'), interval(30, 60, 'camB')],
        [interval(0, 60, 'camA')] // camA mic used throughout
      )
    )

    // camA carries the active audio the whole time -> one enabled clip
    expect(trackFor(timeline.audioTracks, 'camA').clips).toEqual([
      {
        sourceId: 'camA',
        timelineStartSec: 0,
        timelineEndSec: 60,
        sourceInSec: 0,
        sourceOutSec: 60,
        enabled: true
      }
    ])
    // camB's mic is never active -> present but fully disabled (no summing on import)
    expect(trackFor(timeline.audioTracks, 'camB').clips).toEqual([
      {
        sourceId: 'camB',
        timelineStartSec: 0,
        timelineEndSec: 60,
        sourceInSec: 0,
        sourceOutSec: 60,
        enabled: false
      }
    ])
  })

  it('ignores the cut (kept ranges) and exports the full sync span', () => {
    const camA = source('camA', 0, 60, 0)
    const p = project([camA], {
      activeVideoIntervals: [interval(0, 60, 'camA')],
      activeAudioIntervals: [interval(0, 60, 'camA')],
      // a cut that keeps only 5s — the raw multicam export must ignore it
      keptRanges: [{ id: 'k', startSec: 0, endSec: 5 }]
    })

    const timeline = buildMulticamTimeline(p)
    expect(timeline.totalDurationSec).toBe(60)
    expect(trackFor(timeline.videoTracks, 'camA').clips).toEqual([
      {
        sourceId: 'camA',
        timelineStartSec: 0,
        timelineEndSec: 60,
        sourceInSec: 0,
        sourceOutSec: 60,
        enabled: true
      }
    ])
  })

  it('maps source in-points through the sync offset', () => {
    const camB = source('camB', 0, 60, 100) // unified 100-160 -> local 0-60
    const p = project([camB], {
      activeVideoIntervals: [interval(100, 160, 'camB')],
      activeAudioIntervals: [interval(100, 160, 'camB')],
      keptRanges: [{ id: 'k', startSec: 100, endSec: 160 }]
    })

    const timeline = buildMulticamTimeline(p)
    expect(trackFor(timeline.videoTracks, 'camB').clips[0]).toMatchObject({
      timelineStartSec: 100,
      timelineEndSec: 160,
      sourceInSec: 0,
      sourceOutSec: 60
    })
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
      keptRanges: [{ id: 'k', startSec: 0, endSec: 60 }]
    })

    const timeline = buildMulticamTimeline(p)
    expect(timeline.timebase).toBe(30)
    expect(timeline.ntsc).toBe(true)
  })

  it('puts all clips of one device group on a single track, ordered by group order', () => {
    // Handy group: two short, non-overlapping clips (0-20 and 40-60). Camera group: one long clip.
    const handyA = source('handyA', 0, 20, 0, { deviceGroupId: 'g-phone' })
    const handyB = source('handyB', 0, 20, 40, { deviceGroupId: 'g-phone' }) // unified 40-60
    const camMain = source('camMain', 0, 60, 0, { deviceGroupId: 'g-cam' })
    const p = project(
      [handyA, handyB, camMain],
      {
        activeVideoIntervals: [
          interval(0, 20, 'handyA'),
          interval(20, 40, 'camMain'),
          interval(40, 60, 'handyB')
        ],
        activeAudioIntervals: [interval(0, 60, 'camMain')], // camera mic throughout
        keptRanges: [{ id: 'k', startSec: 0, endSec: 60 }]
      },
      [
        { id: 'g-phone', name: 'Handy', order: 0 },
        { id: 'g-cam', name: 'Kamera', order: 1 }
      ]
    )

    const timeline = buildMulticamTimeline(p)

    // one track per group, in group order (Handy = V1, Kamera = V2)
    expect(timeline.videoTracks.map((t) => t.name)).toEqual(['Handy', 'Kamera'])

    // both handy clips live on the single Handy track, sorted by start, each enabled where active
    const handyVideo = trackFor(timeline.videoTracks, 'Handy')
    expect(handyVideo.clips.map((c) => c.sourceId)).toEqual(['handyA', 'handyB'])
    expect(handyVideo.clips.map((c) => [c.timelineStartSec, c.timelineEndSec, c.enabled])).toEqual([
      [0, 20, true],
      [40, 60, true]
    ])

    // camera video is razor-cut around the two handy takes: disabled, enabled (its own take), disabled
    const camVideo = trackFor(timeline.videoTracks, 'Kamera')
    expect(camVideo.clips.map((c) => c.enabled)).toEqual([false, true, false])

    // audio: camera mic is the active audio throughout -> handy audio fully disabled, camera enabled
    expect(trackFor(timeline.audioTracks, 'Handy').clips.every((c) => !c.enabled)).toBe(true)
    expect(trackFor(timeline.audioTracks, 'Kamera').clips.every((c) => c.enabled)).toBe(true)
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
