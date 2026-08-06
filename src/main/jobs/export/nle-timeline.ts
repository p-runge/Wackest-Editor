import { buildExportSegments, type ExportSegment } from './edl'
import { mapUnifiedTimeToLocal } from '@shared/types/timeline-time'
import type { Project, SourceClip } from '@shared/types/project'

/**
 * NLE-neutral intermediate representation of the edit, decoupled from any interchange format:
 * a program timeline (video track + separate audio track) whose clips reference the ORIGINAL
 * source media by local media time — no re-encode, non-destructive, editable downstream. Each
 * concrete serializer (FCP7 XML, FCPXML, …) only has to translate this structure into its own
 * time model and track layout; all the edit resolution lives here and is shared.
 */

/** One clip placed on the program (output) timeline, referencing a stretch of a source's own media. */
export interface NleClip {
  sourceId: string
  /** Position on the program timeline (concatenated kept ranges), in seconds. */
  timelineStartSec: number
  timelineEndSec: number
  /** In/out point within the source media's OWN local time, in seconds. */
  sourceInSec: number
  sourceOutSec: number
}

/** A source file referenced by at least one clip — everything a serializer needs to declare the asset. */
export interface NleAsset {
  sourceId: string
  filePath: string
  fileName: string
  label: string
  durationSec: number
  hasVideo: boolean
  hasAudio: boolean
  width?: number
  height?: number
  frameRate?: number
}

export interface NleTimeline {
  name: string
  /** Integer sequence timebase (e.g. 30). Real playback rate is `timebase * 1000 / 1001` when `ntsc`. */
  timebase: number
  ntsc: boolean
  width: number
  height: number
  /** Camera-switch clips on a single video track, in program order. */
  videoClips: NleClip[]
  /** Continuous active-audio stretches on a single, separate audio track, in program order. */
  audioClips: NleClip[]
  /** Only the sources actually referenced by a clip, in first-use order. */
  assets: NleAsset[]
  totalDurationSec: number
}

/** A single export segment placed at its cumulative position on the concatenated program timeline. */
interface PlacedSegment {
  segment: ExportSegment
  programStartSec: number
  programEndSec: number
}

// NTSC fractional rates (23.976/29.97/59.94) read back from probe as e.g. 29.97; detect them so the
// serializers can emit the `1000/1001` timebase NLEs expect instead of snapping to a plain integer.
function deriveTimebase(rawFps: number | undefined): { timebase: number; ntsc: boolean } {
  if (!rawFps || rawFps <= 0) return { timebase: 30, ntsc: false }
  const timebase = Math.min(60, Math.max(24, Math.round(rawFps)))
  const ntscRate = (timebase * 1000) / 1001
  const ntsc = Math.abs(rawFps - ntscRate) < Math.abs(rawFps - timebase)
  return { timebase, ntsc }
}

// Same main-source-first pick as the MP4 exporter's resolveTargetOutput, but here the raw frame rate
// is preserved (not rounded away) so NTSC detection above can see the true rate.
function resolveSequenceFormat(sources: SourceClip[]): {
  width: number
  height: number
  timebase: number
  ntsc: boolean
} {
  const mainSource = sources.find((s) => s.role === 'main' && s.probed.hasVideo)
  const source = mainSource ?? sources.find((s) => s.probed.hasVideo)
  const width = source?.probed.width ?? 1920
  const height = source?.probed.height ?? 1080
  const { timebase, ntsc } = deriveTimebase(source?.probed.frameRate)
  return { width, height, timebase, ntsc }
}

/**
 * Folds consecutive placed segments that share the same source AND are continuous in the source's
 * own media (segment[i].unifiedEnd === segment[i+1].unifiedStart) into one clip — collapsing a
 * camera-held stretch that was only split by an audio boundary (for video), or a run of camera cuts
 * over one continuous mic (for audio), into a single editable clip. A gap across kept ranges breaks
 * the unified-time adjacency, so those never merge. Mirrors `groupAudioSpans`, but keeps the program
 * placement so the result can be laid on the output timeline directly.
 */
function foldClips(
  placed: PlacedSegment[],
  pickSourceId: (segment: ExportSegment) => string,
  sources: SourceClip[]
): NleClip[] {
  interface Group {
    sourceId: string
    programStartSec: number
    programEndSec: number
    unifiedStartSec: number
    unifiedEndSec: number
  }

  const groups: Group[] = []
  for (const p of placed) {
    const sourceId = pickSourceId(p.segment)
    const previous = groups[groups.length - 1]
    if (
      previous &&
      previous.sourceId === sourceId &&
      previous.unifiedEndSec === p.segment.unifiedStartSec
    ) {
      previous.programEndSec = p.programEndSec
      previous.unifiedEndSec = p.segment.unifiedEndSec
    } else {
      groups.push({
        sourceId,
        programStartSec: p.programStartSec,
        programEndSec: p.programEndSec,
        unifiedStartSec: p.segment.unifiedStartSec,
        unifiedEndSec: p.segment.unifiedEndSec
      })
    }
  }

  return groups.map((g) => {
    const source = sources.find((s) => s.id === g.sourceId)
    if (!source) {
      throw new Error(`Quelle ${g.sourceId} für den Export nicht gefunden.`)
    }
    const sourceInSec = mapUnifiedTimeToLocal(source, g.unifiedStartSec)
    if (sourceInSec === null) {
      throw new Error(
        `Zeitpunkt ${g.unifiedStartSec.toFixed(1)}s liegt außerhalb der Sync-Segmente einer Quelle — bitte Sync prüfen.`
      )
    }
    return {
      sourceId: g.sourceId,
      timelineStartSec: g.programStartSec,
      timelineEndSec: g.programEndSec,
      sourceInSec,
      sourceOutSec: sourceInSec + (g.unifiedEndSec - g.unifiedStartSec)
    }
  })
}

function collectAssets(clips: NleClip[], sources: SourceClip[]): NleAsset[] {
  const byId = new Map<string, NleAsset>()
  for (const clip of clips) {
    if (byId.has(clip.sourceId)) continue
    const source = sources.find((s) => s.id === clip.sourceId)
    if (!source) continue
    byId.set(clip.sourceId, {
      sourceId: source.id,
      filePath: source.originalFilePath,
      fileName: source.originalFilePath.split(/[/\\]/).pop() ?? source.label,
      label: source.label,
      durationSec: source.probed.durationSec,
      hasVideo: source.probed.hasVideo,
      hasAudio: source.probed.hasAudio,
      width: source.probed.width,
      height: source.probed.height,
      frameRate: source.probed.frameRate
    })
  }
  return [...byId.values()]
}

/**
 * Builds the NLE-neutral timeline from a project's edit state. Reuses `buildExportSegments` (the
 * same resolution the MP4 export relies on), then lays each segment end-to-end on the program
 * timeline — the concatenation of kept ranges in placement order IS the output order, exactly like
 * the MP4 concat — and folds contiguous same-source runs into editable clips.
 */
export function buildNleTimeline(project: Project): NleTimeline {
  const segments = buildExportSegments(
    project.edit.keptRanges,
    project.edit.activeVideoIntervals,
    project.edit.activeAudioIntervals,
    project.sources
  )

  if (segments.length === 0) {
    throw new Error(
      'Keine exportierbaren Abschnitte gefunden. Bitte zuerst Kamera/Audio/Schnitt festlegen.'
    )
  }

  let cursor = 0
  const placed: PlacedSegment[] = segments.map((segment) => {
    const programStartSec = cursor
    cursor += segment.unifiedEndSec - segment.unifiedStartSec
    return { segment, programStartSec, programEndSec: cursor }
  })

  const videoClips = foldClips(placed, (s) => s.videoSourceId, project.sources)
  const audioClips = foldClips(placed, (s) => s.audioSourceId, project.sources)
  const assets = collectAssets([...videoClips, ...audioClips], project.sources)
  const { width, height, timebase, ntsc } = resolveSequenceFormat(project.sources)

  return {
    name: project.name,
    timebase,
    ntsc,
    width,
    height,
    videoClips,
    audioClips,
    assets,
    totalDurationSec: cursor
  }
}
