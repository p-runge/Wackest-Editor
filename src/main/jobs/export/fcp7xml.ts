import { pathToFileURL } from 'url'
import type { NleAsset, NleClip, NleTimeline, NleTrack } from './nle-timeline'

/**
 * Serializes an `NleTimeline` to Final Cut Pro 7 XML (xmeml v5) — the interchange format both
 * Premiere Pro and DaVinci Resolve import natively. Its explicit `<video><track>` / `<audio><track>`
 * layout maps directly onto our "separate video and audio track" goal, and clips reference the
 * original media by frame in/out so the downstream edit stays non-destructive (no re-encode).
 *
 * All times are quantized to the sequence timebase. Timeline start/end and source in/out are rounded
 * on the same frame grid, and each clip's out-in length is forced to equal its end-start length, so
 * clips stay frame-tight and gap-free after import regardless of the original float second values.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function rateBlock(timebase: number, ntsc: boolean): string {
  return `<rate><timebase>${timebase}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`
}

function fileId(sourceId: string): string {
  return `file-${sourceId}`
}

// Video/audio clip in/out and timeline positions all snap to this rate. For NTSC (29.97/23.976/…)
// the true playback rate is timebase*1000/1001, which is what maps a wall-clock second to the right
// frame index; using the plain integer here would drift on long timelines.
function effectiveFps(timeline: NleTimeline): number {
  return timeline.ntsc ? (timeline.timebase * 1000) / 1001 : timeline.timebase
}

function fileElement(asset: NleAsset, timeline: NleTimeline, alreadyEmitted: boolean): string {
  const id = fileId(asset.sourceId)
  if (alreadyEmitted) return `<file id="${id}"/>`

  const fps = effectiveFps(timeline)
  const mediaDurationFrames = Math.round(asset.durationSec * fps)
  const rate = rateBlock(timeline.timebase, timeline.ntsc)

  const mediaParts: string[] = []
  if (asset.hasVideo) {
    mediaParts.push(
      `<video><samplecharacteristics>${rate}` +
        `<width>${asset.width ?? timeline.width}</width>` +
        `<height>${asset.height ?? timeline.height}</height>` +
        `</samplecharacteristics></video>`
    )
  }
  if (asset.hasAudio) {
    mediaParts.push(
      `<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate>` +
        `</samplecharacteristics><channelcount>2</channelcount></audio>`
    )
  }

  return (
    `<file id="${id}">` +
    `<name>${escapeXml(asset.fileName)}</name>` +
    `<pathurl>${escapeXml(pathToFileURL(asset.filePath).href)}</pathurl>` +
    rate +
    `<duration>${mediaDurationFrames}</duration>` +
    `<media>${mediaParts.join('')}</media>` +
    `</file>`
  )
}

function clipItem(
  clip: NleClip,
  clipId: string,
  kind: 'video' | 'audio',
  asset: NleAsset,
  timeline: NleTimeline,
  emittedFileIds: Set<string>
): string {
  const fps = effectiveFps(timeline)
  const start = Math.round(clip.timelineStartSec * fps)
  const end = Math.round(clip.timelineEndSec * fps)
  const inFrame = Math.round(clip.sourceInSec * fps)
  // Force out-in to equal end-start: NLEs reject or misplace a clip whose source and timeline
  // lengths disagree, and independent rounding of sourceOutSec could produce a one-frame mismatch.
  const outFrame = inFrame + (end - start)
  const mediaDurationFrames = Math.round(asset.durationSec * fps)

  const id = fileId(asset.sourceId)
  const file = fileElement(asset, timeline, emittedFileIds.has(id))
  emittedFileIds.add(id)

  const sourceTrack =
    kind === 'audio'
      ? `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>`
      : ''

  return (
    `<clipitem id="${clipId}">` +
    `<name>${escapeXml(asset.label)}</name>` +
    // Per-clip enable: a disabled sub-clip stays on its track but is muted/hidden, so at any instant
    // only the active source's clip composites/plays. This is how the active selection is encoded.
    `<enabled>${clip.enabled ? 'TRUE' : 'FALSE'}</enabled>` +
    `<duration>${mediaDurationFrames}</duration>` +
    rateBlock(timeline.timebase, timeline.ntsc) +
    `<start>${start}</start>` +
    `<end>${end}</end>` +
    `<in>${inFrame}</in>` +
    `<out>${outFrame}</out>` +
    file +
    sourceTrack +
    `</clipitem>`
  )
}

function trackElement(
  track: NleTrack,
  trackIndex: number,
  kind: 'video' | 'audio',
  assetById: Map<string, NleAsset>,
  timeline: NleTimeline,
  emittedFileIds: Set<string>
): string {
  const prefix = kind === 'video' ? 'v' : 'a'
  const clipItems = track.clips
    .map((clip, clipIndex) => {
      const asset = assetById.get(clip.sourceId)
      if (!asset) return ''
      return clipItem(
        clip,
        `clipitem-${prefix}${trackIndex}-${clipIndex}`,
        kind,
        asset,
        timeline,
        emittedFileIds
      )
    })
    .join('')

  // The track itself stays enabled; muting the non-active parts happens per clip (see clipItem).
  return `<track>` + clipItems + `<enabled>TRUE</enabled>` + `<locked>FALSE</locked>` + `</track>`
}

export function serializeFcp7Xml(timeline: NleTimeline): string {
  const fps = effectiveFps(timeline)
  const totalFrames = Math.round(timeline.totalDurationSec * fps)
  const rate = rateBlock(timeline.timebase, timeline.ntsc)
  const assetById = new Map(timeline.assets.map((a) => [a.sourceId, a]))
  // Tracks the file ids whose full <file> definition has already been written, so later references
  // become lightweight `<file id="..."/>` pointers (a file used on multiple tracks is defined once).
  const emittedFileIds = new Set<string>()

  // Tracks are emitted bottom-to-top, matching how the NleTimeline orders them (last = topmost).
  const videoTracks = timeline.videoTracks
    .map((track, i) => trackElement(track, i, 'video', assetById, timeline, emittedFileIds))
    .join('')
  const audioTracks = timeline.audioTracks
    .map((track, i) => trackElement(track, i, 'audio', assetById, timeline, emittedFileIds))
    .join('')

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE xmeml>\n` +
    `<xmeml version="5">` +
    `<sequence id="sequence-1">` +
    `<name>${escapeXml(timeline.name)}</name>` +
    `<duration>${totalFrames}</duration>` +
    rate +
    `<media>` +
    `<video>` +
    `<format><samplecharacteristics>${rate}` +
    `<width>${timeline.width}</width><height>${timeline.height}</height>` +
    `</samplecharacteristics></format>` +
    videoTracks +
    `</video>` +
    `<audio>` +
    `<format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate>` +
    `</samplecharacteristics></format>` +
    audioTracks +
    `</audio>` +
    `</media>` +
    `</sequence>` +
    `</xmeml>\n`
  )
}
