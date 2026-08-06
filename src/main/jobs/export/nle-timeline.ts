import {
  resolveVideoSourceId,
  resolveAudioSourceId,
  sourceCoverageRange
} from '@shared/types/timeline-time'
import type { Project, SourceClip, TrackInterval } from '@shared/types/project'

/**
 * NLE-neutral intermediate representation of the edit, decoupled from any interchange format:
 * every raw source laid in parallel on the sync (unified) timeline, so the whole multicam edit can
 * be re-worked downstream. Clips reference the ORIGINAL source media by local media time — no
 * re-encode, non-destructive — and each raw track is razor-cut at the camera/audio switch points,
 * with the non-active sub-clips marked disabled. At any instant exactly one clip per role is
 * enabled, so the NLE composites/plays the active source; re-picking is just toggling a clip's
 * enable state (in Premiere: the higher, disabled clip lets the enabled one "underneath" show).
 *
 * Each concrete serializer (FCP7 XML, …) only has to translate this structure into its own time and
 * track model; all the edit resolution lives here and is shared.
 */

/** One clip placed on the timeline, referencing a stretch of a source's own media (all in seconds). */
export interface NleClip {
  sourceId: string
  timelineStartSec: number
  timelineEndSec: number
  /** In/out point within the source media's OWN local time. */
  sourceInSec: number
  sourceOutSec: number
  /** Whether this sub-clip is the active source for its span — disabled clips are present but
   *  muted/hidden on import, so only the active source shows/plays out of the box. */
  enabled: boolean
}

/** One track (video or audio) holding clips in timeline order. */
export interface NleTrack {
  name: string
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
 * Builds one raw track for a source: its full footage on the sync timeline, razor-cut at every
 * active-track switch boundary that falls inside its footage, with each resulting sub-clip enabled
 * iff this source is the resolved active one for that span. Adjacent sub-clips with the same enabled
 * state are merged, so a cut only ever lands where THIS source's active status actually flips.
 */
function buildRawTrack(
  source: SourceClip,
  intervals: TrackInterval[],
  resolveActive: (atSec: number) => string | undefined
): NleTrack {
  const clips: NleClip[] = []

  for (const seg of source.syncSegments) {
    const spanStartSec = seg.localStartSec + seg.offsetSec
    const spanEndSec = seg.localEndSec + seg.offsetSec

    const boundaries = new Set<number>()
    for (const iv of intervals) {
      if (iv.startSec > spanStartSec && iv.startSec < spanEndSec) boundaries.add(iv.startSec)
      if (iv.endSec > spanStartSec && iv.endSec < spanEndSec) boundaries.add(iv.endSec)
    }
    const points = [spanStartSec, ...Array.from(boundaries).sort((a, b) => a - b), spanEndSec]

    for (let i = 0; i < points.length - 1; i++) {
      const startSec = points[i]
      const endSec = points[i + 1]
      if (endSec <= startSec) continue

      const enabled = resolveActive((startSec + endSec) / 2) === source.id

      // Merge with the previous sub-clip when it's contiguous and shares the enabled state — keeps a
      // cut only where this source's active status genuinely changes, not at every foreign switch.
      const previous = clips[clips.length - 1]
      if (previous && previous.enabled === enabled && previous.timelineEndSec === startSec) {
        previous.timelineEndSec = endSec
        previous.sourceOutSec = previous.sourceInSec + (endSec - previous.timelineStartSec)
        continue
      }

      // Source-local in-point: unified time minus this segment's offset (valid across the whole span).
      const sourceInSec = startSec - seg.offsetSec
      clips.push({
        sourceId: source.id,
        timelineStartSec: startSec,
        timelineEndSec: endSec,
        sourceInSec,
        sourceOutSec: sourceInSec + (endSec - startSec),
        enabled
      })
    }
  }

  return { name: `Roh: ${source.label}`, clips }
}

function collectAssets(tracks: NleTrack[], sources: SourceClip[]): NleAsset[] {
  const byId = new Map<string, NleAsset>()
  for (const clip of tracks.flatMap((t) => t.clips)) {
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
 * Builds the raw multicam timeline on the SYNC (unified) timeline: every raw source in parallel at
 * its synced offset (full footage), each track razor-cut at the camera/audio switch points with the
 * non-active sub-clips disabled. No separate "cut" track — the active selection is encoded purely by
 * which sub-clips are enabled, so the layout carries both the raw material and the current pick.
 */
export function buildMulticamTimeline(project: Project): NleTimeline {
  const { sources, edit } = project

  const videoTracks = sources
    .filter((s) => s.probed.hasVideo && sourceCoverageRange(s))
    .map((s) =>
      buildRawTrack(s, edit.activeVideoIntervals, (atSec) =>
        resolveVideoSourceId(edit.activeVideoIntervals, atSec)
      )
    )

  const audioTracks = sources
    .filter((s) => s.probed.hasAudio && sourceCoverageRange(s))
    .map((s) =>
      buildRawTrack(s, edit.activeAudioIntervals, (atSec) =>
        resolveAudioSourceId(edit.activeAudioIntervals, atSec)
      )
    )

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
    assets: collectAssets([...videoTracks, ...audioTracks], sources),
    totalDurationSec
  }
}
