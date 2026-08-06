import { buildExportSegments, type ExportSegment } from './edl'
import { mapUnifiedTimeToLocal, sourceCoverageRange } from '@shared/types/timeline-time'
import type { Project, SourceClip, TrackInterval } from '@shared/types/project'

/**
 * NLE-neutral intermediate representation of the edit, decoupled from any interchange format:
 * a timeline of parallel video/audio tracks whose clips reference the ORIGINAL source media by
 * local media time — no re-encode, non-destructive, editable downstream. Each concrete serializer
 * (FCP7 XML, FCPXML, …) only has to translate this structure into its own time model and track
 * layout; all the edit resolution lives here and is shared.
 *
 * Two layouts are built from the same primitives:
 *  - `buildCutTimeline` — the finished cut: kept ranges concatenated in placement order onto a
 *    single video + single audio track. Mirrors the MP4 export, just non-destructive.
 *  - `buildMulticamTimeline` — every raw source laid in parallel on the sync (unified) timeline,
 *    plus the tool's active selection on a top track, for re-picking camera/audio downstream.
 */

/** One clip placed on the timeline, referencing a stretch of a source's own media (all in seconds). */
export interface NleClip {
  sourceId: string
  timelineStartSec: number
  timelineEndSec: number
  /** In/out point within the source media's OWN local time. */
  sourceInSec: number
  sourceOutSec: number
}

/** One track (video or audio) holding clips in timeline order. Ordered bottom-to-top in the parent
 *  timeline arrays — the last track is the topmost (visually on top / last in the FCP7 `<video>`). */
export interface NleTrack {
  name: string
  /** A disabled track is present but muted/hidden on import — used to keep raw audio sources from
   *  all summing at once, so only the active-selection audio track plays out of the box. */
  enabled: boolean
  clips: NleClip[]
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
  videoTracks: NleTrack[]
  audioTracks: NleTrack[]
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

function clipFromUnifiedSpan(
  source: SourceClip,
  unifiedStartSec: number,
  unifiedEndSec: number
): NleClip {
  const sourceInSec = mapUnifiedTimeToLocal(source, unifiedStartSec)
  if (sourceInSec === null) {
    throw new Error(
      `Zeitpunkt ${unifiedStartSec.toFixed(1)}s liegt außerhalb der Sync-Segmente einer Quelle — bitte Sync prüfen.`
    )
  }
  return {
    sourceId: source.id,
    timelineStartSec: unifiedStartSec,
    timelineEndSec: unifiedEndSec,
    sourceInSec,
    sourceOutSec: sourceInSec + (unifiedEndSec - unifiedStartSec)
  }
}

/**
 * Folds consecutive placed segments that share the same source AND are continuous in the source's
 * own media (segment[i].unifiedEnd === segment[i+1].unifiedStart) into one clip — collapsing a
 * camera-held stretch that was only split by an audio boundary (for video), or a run of camera cuts
 * over one continuous mic (for audio), into a single editable clip. A gap across kept ranges breaks
 * the unified-time adjacency, so those never merge. Mirrors `groupAudioSpans`, but keeps the program
 * placement so the result can be laid on the output timeline directly.
 */
function foldCutClips(
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
    if (!source) throw new Error(`Quelle ${g.sourceId} für den Export nicht gefunden.`)
    const sourceInSec = mapUnifiedTimeToLocal(source, g.unifiedStartSec)
    if (sourceInSec === null) {
      throw new Error(
        `Zeitpunkt ${g.unifiedStartSec.toFixed(1)}s liegt außerhalb der Sync-Segmente einer Quelle — bitte Sync prüfen.`
      )
    }
    // Cut layout: clips are laid end-to-end on the program timeline (concatenation), NOT at their
    // unified times — so a program gap between kept ranges is removed, exactly like the MP4 concat.
    return {
      sourceId: g.sourceId,
      timelineStartSec: g.programStartSec,
      timelineEndSec: g.programEndSec,
      sourceInSec,
      sourceOutSec: sourceInSec + (g.unifiedEndSec - g.unifiedStartSec)
    }
  })
}

/** Merges adjacent same-source intervals, then maps each to a clip at its UNIFIED position — used for
 *  the multicam layout's active-selection tracks (the tool's current camera/audio choice over time). */
function intervalsToClips(intervals: TrackInterval[], sources: SourceClip[]): NleClip[] {
  const sorted = [...intervals].sort((a, b) => a.startSec - b.startSec)
  const merged: Array<{ value: string; startSec: number; endSec: number }> = []
  for (const iv of sorted) {
    const previous = merged[merged.length - 1]
    if (previous && previous.value === iv.value && previous.endSec === iv.startSec) {
      previous.endSec = iv.endSec
    } else {
      merged.push({ value: iv.value, startSec: iv.startSec, endSec: iv.endSec })
    }
  }
  const clips: NleClip[] = []
  for (const m of merged) {
    const source = sources.find((s) => s.id === m.value)
    if (!source) continue
    clips.push(clipFromUnifiedSpan(source, m.startSec, m.endSec))
  }
  return clips
}

/** A raw source laid on the unified timeline: one clip per sync segment, spanning its full footage
 *  at its synced offset (the classic parallel-multicam layout, before any cut/selection). */
function rawSourceClips(source: SourceClip): NleClip[] {
  return source.syncSegments.map((seg) => ({
    sourceId: source.id,
    timelineStartSec: seg.localStartSec + seg.offsetSec,
    timelineEndSec: seg.localEndSec + seg.offsetSec,
    sourceInSec: seg.localStartSec,
    sourceOutSec: seg.localEndSec
  }))
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

function allClips(tracks: NleTrack[]): NleClip[] {
  return tracks.flatMap((t) => t.clips)
}

/**
 * Builds the finished-cut timeline (single video + single audio track). Reuses `buildExportSegments`
 * (the same resolution the MP4 export relies on), lays each segment end-to-end on the program
 * timeline — the concatenation of kept ranges in placement order IS the output order, exactly like
 * the MP4 concat — and folds contiguous same-source runs into editable clips.
 */
export function buildCutTimeline(project: Project): NleTimeline {
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

  const videoTracks: NleTrack[] = [
    {
      name: 'Video',
      enabled: true,
      clips: foldCutClips(placed, (s) => s.videoSourceId, project.sources)
    }
  ]
  const audioTracks: NleTrack[] = [
    {
      name: 'Audio',
      enabled: true,
      clips: foldCutClips(placed, (s) => s.audioSourceId, project.sources)
    }
  ]
  const { width, height, timebase, ntsc } = resolveSequenceFormat(project.sources)

  return {
    name: project.name,
    timebase,
    ntsc,
    width,
    height,
    videoTracks,
    audioTracks,
    assets: collectAssets([...allClips(videoTracks), ...allClips(audioTracks)], project.sources),
    totalDurationSec: cursor
  }
}

/**
 * Builds the raw multicam timeline on the SYNC (unified) timeline: every raw source laid in parallel
 * at its synced offset (full footage, no cut applied), with the tool's current active selection on a
 * top track for reference and quick override downstream. Raw audio tracks are muted so only the
 * active-audio track plays out of the box; re-picking is just re-enabling a track in the NLE.
 */
export function buildMulticamTimeline(project: Project): NleTimeline {
  const { sources } = project

  // Bottom-to-top: raw source tracks first, active-selection track last (= topmost).
  const videoTracks: NleTrack[] = sources
    .filter((s) => s.probed.hasVideo && sourceCoverageRange(s))
    .map((s) => ({ name: `Roh: ${s.label}`, enabled: true, clips: rawSourceClips(s) }))
  const activeVideoClips = intervalsToClips(project.edit.activeVideoIntervals, sources)
  if (activeVideoClips.length > 0) {
    videoTracks.push({ name: 'Aktive Wahl (Video)', enabled: true, clips: activeVideoClips })
  }

  const audioTracks: NleTrack[] = sources
    .filter((s) => s.probed.hasAudio && sourceCoverageRange(s))
    .map((s) => ({ name: `Roh: ${s.label}`, enabled: false, clips: rawSourceClips(s) }))
  const activeAudioClips = intervalsToClips(project.edit.activeAudioIntervals, sources)
  if (activeAudioClips.length > 0) {
    audioTracks.push({ name: 'Aktive Wahl (Audio)', enabled: true, clips: activeAudioClips })
  }

  let totalDurationSec = 0
  for (const source of sources) {
    const coverage = sourceCoverageRange(source)
    if (coverage && coverage.endSec > totalDurationSec) totalDurationSec = coverage.endSec
  }

  if (totalDurationSec <= 0 || (videoTracks.length === 0 && audioTracks.length === 0)) {
    throw new Error('Keine synchronisierten Quellen zum Exportieren. Bitte zuerst synchronisieren.')
  }

  const { width, height, timebase, ntsc } = resolveSequenceFormat(sources)

  return {
    name: project.name,
    timebase,
    ntsc,
    width,
    height,
    videoTracks,
    audioTracks,
    assets: collectAssets([...allClips(videoTracks), ...allClips(audioTracks)], sources),
    totalDurationSec
  }
}
