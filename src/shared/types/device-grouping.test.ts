import { describe, expect, it } from 'vitest'
import {
  deviceFingerprint,
  ensureDeviceGroups,
  findOverlappingWithinGroups,
  suggestGroupForSource
} from './device-grouping'
import { SCHEMA_VERSION, type Project, type ProbedMediaInfo, type SourceClip } from './project'

function src(
  id: string,
  probed: Partial<ProbedMediaInfo>,
  overrides: Partial<SourceClip> = {},
  filePath = `/media/${id}.mp4`
): SourceClip {
  return {
    id,
    kind: 'video',
    originalFilePath: filePath,
    relativeFilePath: `../${id}.mp4`,
    importedAt: new Date().toISOString(),
    label: id,
    probed: {
      durationSec: 60,
      hasVideo: true,
      hasAudio: true,
      container: 'mov',
      ...probed
    },
    syncSegments: [
      {
        id: `${id}-s`,
        localStartSec: 0,
        localEndSec: 60,
        offsetSec: 0,
        confidence: 1,
        method: 'cross-correlation'
      }
    ],
    ...overrides
  }
}

function project(sources: SourceClip[], deviceGroups: Project['deviceGroups'] = []): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'p',
    name: 'P',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sources,
    deviceGroups,
    timelineDurationSec: 0,
    transcript: [],
    trackHeatmaps: [],
    edit: { activeVideoIntervals: [], activeAudioIntervals: [], keptRanges: [] },
    providerConfig: {
      transcription: { provider: 'openai-whisper-api', languageHint: 'auto' },
      heatmap: { provider: 'audio-energy-local' }
    }
  }
}

describe('deviceFingerprint', () => {
  it('uses make/model when present and ignores the filename', () => {
    const a = src('a', { make: 'Apple', model: 'iPhone 15 Pro' }, {}, '/x/IMG_1.mov')
    const b = src('b', { make: 'Apple', model: 'iPhone 15 Pro' }, {}, '/x/IMG_2.mov')
    expect(deviceFingerprint(a)).toBe(deviceFingerprint(b))
    expect(deviceFingerprint(a).startsWith('meta:')).toBe(true)
  })

  it('falls back to specs + filename prefix without metadata', () => {
    const specs = {
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoCodec: 'h264',
      audioCodec: 'aac'
    }
    const gopro1 = src('g1', specs, {}, '/x/GX010001.MP4')
    const gopro2 = src('g2', specs, {}, '/x/GX010002.MP4')
    const sony = src('s1', specs, {}, '/x/C0001.MP4')
    expect(deviceFingerprint(gopro1)).toBe(deviceFingerprint(gopro2)) // same prefix "gx"
    expect(deviceFingerprint(gopro1)).not.toBe(deviceFingerprint(sony)) // "gx" vs "c"
  })

  it('separates different resolutions', () => {
    const hd = src('a', { width: 1920, height: 1080, frameRate: 30 }, {}, '/x/A.mp4')
    const uhd = src('b', { width: 3840, height: 2160, frameRate: 30 }, {}, '/x/A.mp4')
    expect(deviceFingerprint(hd)).not.toBe(deviceFingerprint(uhd))
  })
})

describe('suggestGroupForSource', () => {
  it('reuses an existing group of the same device', () => {
    const existing = src('a', { make: 'GoPro', model: 'HERO12' }, { deviceGroupId: 'g1' })
    const groups = [{ id: 'g1', name: 'HERO12', order: 0 }]
    const next = src('b', { make: 'GoPro', model: 'HERO12' })
    expect(suggestGroupForSource(next, [existing], groups)).toEqual({ groupId: 'g1' })
  })

  it('creates a new group at the next order for a new device', () => {
    const existing = src('a', { make: 'GoPro', model: 'HERO12' }, { deviceGroupId: 'g1' })
    const groups = [{ id: 'g1', name: 'HERO12', order: 0 }]
    const phone = src('b', { make: 'Apple', model: 'iPhone' })
    const result = suggestGroupForSource(phone, [existing], groups)
    expect('newGroup' in result && result.newGroup.order).toBe(1)
    expect('newGroup' in result && result.newGroup.name).toBe('iPhone')
  })
})

describe('ensureDeviceGroups', () => {
  it('groups same-device clips together and separates other devices', () => {
    const p = project([
      src('cam1', { make: 'Sony', model: 'FX3' }),
      src('cam2', { make: 'Sony', model: 'FX3' }),
      src('phone', { make: 'Apple', model: 'iPhone' })
    ])
    const result = ensureDeviceGroups(p)

    expect(result.deviceGroups).toHaveLength(2)
    const [cam1, cam2, phone] = result.sources
    expect(cam1.deviceGroupId).toBe(cam2.deviceGroupId)
    expect(phone.deviceGroupId).not.toBe(cam1.deviceGroupId)
    expect(result.deviceGroups.map((g) => g.order)).toEqual([0, 1])
  })

  it('keeps manual assignments sticky', () => {
    const p = project(
      [
        src('a', { make: 'Sony', model: 'FX3' }, { deviceGroupId: 'manual' }),
        src('b', { make: 'Sony', model: 'FX3' }) // same device, but a is manually pinned
      ],
      [{ id: 'manual', name: 'My Cam', order: 0 }]
    )
    const result = ensureDeviceGroups(p)
    expect(result.sources[0].deviceGroupId).toBe('manual')
    // b auto-joins a's group by fingerprint
    expect(result.sources[1].deviceGroupId).toBe('manual')
  })

  it('prunes empty groups and re-densifies order', () => {
    const p = project(
      [src('a', { make: 'Sony', model: 'FX3' }, { deviceGroupId: 'g2' })],
      [
        { id: 'g1', name: 'Empty', order: 0 },
        { id: 'g2', name: 'Used', order: 5 }
      ]
    )
    const result = ensureDeviceGroups(p)
    expect(result.deviceGroups).toEqual([{ id: 'g2', name: 'Used', order: 0 }])
  })

  it('is idempotent (returns same reference on the second run)', () => {
    const once = ensureDeviceGroups(
      project([
        src('a', { make: 'Sony', model: 'FX3' }),
        src('b', { make: 'Apple', model: 'iPhone' })
      ])
    )
    const twice = ensureDeviceGroups(once)
    expect(twice).toBe(once)
  })
})

describe('findOverlappingWithinGroups', () => {
  it('flags a group whose members overlap in time', () => {
    const a = src('a', {}, { deviceGroupId: 'g' }) // unified 0-60
    const b = src(
      'b',
      {},
      {
        deviceGroupId: 'g',
        syncSegments: [
          {
            id: 'b-s',
            localStartSec: 0,
            localEndSec: 60,
            offsetSec: 30,
            confidence: 1,
            method: 'cross-correlation'
          }
        ]
      }
    ) // unified 30-90 -> overlaps a
    expect(findOverlappingWithinGroups([a, b])).toEqual(['g'])
  })

  it('does not flag non-overlapping members of the same group', () => {
    const a = src('a', {}, { deviceGroupId: 'g' }) // 0-60
    const b = src(
      'b',
      {},
      {
        deviceGroupId: 'g',
        syncSegments: [
          {
            id: 'b-s',
            localStartSec: 0,
            localEndSec: 60,
            offsetSec: 60,
            confidence: 1,
            method: 'cross-correlation'
          }
        ]
      }
    ) // 60-120, abuts but no overlap
    expect(findOverlappingWithinGroups([a, b])).toEqual([])
  })
})
