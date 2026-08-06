import { describe, expect, it } from 'vitest'
import { serializeFcp7Xml } from './fcp7xml'
import type { NleTimeline } from './nle-timeline'

function baseTimeline(overrides: Partial<NleTimeline> = {}): NleTimeline {
  return {
    name: 'My Project',
    timebase: 30,
    ntsc: false,
    width: 1920,
    height: 1080,
    videoTracks: [
      {
        name: 'Roh: cam',
        clips: [
          {
            sourceId: 'cam',
            timelineStartSec: 0,
            timelineEndSec: 5,
            sourceInSec: 10,
            sourceOutSec: 15,
            enabled: true
          }
        ]
      }
    ],
    audioTracks: [
      {
        name: 'Roh: cam',
        clips: [
          {
            sourceId: 'cam',
            timelineStartSec: 0,
            timelineEndSec: 5,
            sourceInSec: 10,
            sourceOutSec: 15,
            enabled: true
          }
        ]
      }
    ],
    assets: [
      {
        sourceId: 'cam',
        filePath: '/media/cam.mp4',
        fileName: 'cam.mp4',
        label: 'cam',
        durationSec: 60,
        hasVideo: true,
        hasAudio: true,
        width: 1920,
        height: 1080,
        frameRate: 30
      }
    ],
    totalDurationSec: 5,
    ...overrides
  }
}

describe('serializeFcp7Xml', () => {
  it('emits a well-formed xmeml document with separate video and audio tracks', () => {
    const xml = serializeFcp7Xml(baseTimeline())
    expect(xml).toContain('<!DOCTYPE xmeml>')
    expect(xml).toContain('<xmeml version="5">')
    expect(xml).toContain('<video>')
    expect(xml).toContain('<audio>')
    // audio clip carries the audio sourcetrack marker; video clip does not
    expect(xml).toContain('<sourcetrack><mediatype>audio</mediatype>')
  })

  it('quantizes seconds to frames on the sequence timebase', () => {
    const xml = serializeFcp7Xml(baseTimeline())
    // 0-5s @30fps -> start 0, end 150; source in 10s -> 300, out = in + (end-start) = 450
    expect(xml).toContain('<start>0</start>')
    expect(xml).toContain('<end>150</end>')
    expect(xml).toContain('<in>300</in>')
    expect(xml).toContain('<out>450</out>')
  })

  it('defines each file once and references it by id afterward', () => {
    const xml = serializeFcp7Xml(baseTimeline())
    // full definition (with pathurl) appears once; the second use is a bare reference
    const fullDefs = xml.match(/<file id="file-cam"><name>/g) ?? []
    const refs = xml.match(/<file id="file-cam"\/>/g) ?? []
    expect(fullDefs).toHaveLength(1)
    expect(refs).toHaveLength(1)
    expect(xml).toContain('<pathurl>file:///media/cam.mp4</pathurl>')
  })

  it('emits an NTSC rate block when the timeline is NTSC', () => {
    const xml = serializeFcp7Xml(baseTimeline({ ntsc: true }))
    expect(xml).toContain('<timebase>30</timebase><ntsc>TRUE</ntsc>')
  })

  it('escapes XML-special characters in names and paths', () => {
    const xml = serializeFcp7Xml(
      baseTimeline({
        name: 'A & B <clip>',
        assets: [
          {
            sourceId: 'cam',
            filePath: '/media/a & b.mp4',
            fileName: 'a & b.mp4',
            label: 'a & b',
            durationSec: 60,
            hasVideo: true,
            hasAudio: true,
            width: 1920,
            height: 1080,
            frameRate: 30
          }
        ]
      })
    )
    expect(xml).toContain('<name>A &amp; B &lt;clip&gt;</name>')
    // pathToFileURL percent-encodes spaces/&, so the raw ampersand should not appear in the path
    expect(xml).toContain('a%20&amp;%20b.mp4')
  })

  it('marks each clip enabled/disabled per its own enabled flag', () => {
    const xml = serializeFcp7Xml(
      baseTimeline({
        videoTracks: [
          {
            name: 'Roh: cam',
            clips: [
              {
                sourceId: 'cam',
                timelineStartSec: 0,
                timelineEndSec: 5,
                sourceInSec: 0,
                sourceOutSec: 5,
                enabled: true
              },
              {
                sourceId: 'cam',
                timelineStartSec: 5,
                timelineEndSec: 10,
                sourceInSec: 5,
                sourceOutSec: 10,
                enabled: false
              }
            ]
          }
        ]
      })
    )
    // one active clip -> enabled TRUE, one non-active clip -> enabled FALSE
    expect(xml).toContain('<enabled>TRUE</enabled>')
    expect(xml).toContain('<enabled>FALSE</enabled>')
  })
})
