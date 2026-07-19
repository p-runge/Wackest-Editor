import { describe, expect, it } from 'vitest'
import { groupAudioSpans, type ExportSegment } from './edl'

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
