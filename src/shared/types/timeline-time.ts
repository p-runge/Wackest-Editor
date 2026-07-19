import type { TrackInterval, SourceClip } from './project'

export interface AudioCoverageSegment {
  sourceId: string
  unifiedStartSec: number
  unifiedEndSec: number
}

/** Finds which interval (if any) covers a given time. */
export function resolveIntervalAt(
  intervals: TrackInterval[],
  atSec: number
): TrackInterval | undefined {
  return intervals.find((iv) => atSec >= iv.startSec && atSec < iv.endSec)
}

/**
 * The unified-timeline span a source actually has footage for — from the earliest to the latest
 * of its sync segments. `null` for a source that hasn't been synced yet (no segments), which
 * callers should treat as "no bound" rather than "zero-length".
 */
export function sourceCoverageRange(
  source: SourceClip
): { startSec: number; endSec: number } | null {
  if (source.syncSegments.length === 0) return null
  let startSec = Infinity
  let endSec = -Infinity
  for (const seg of source.syncSegments) {
    const segStart = seg.localStartSec + seg.offsetSec
    const segEnd = seg.localEndSec + seg.offsetSec
    if (segStart < startSec) startSec = segStart
    if (segEnd > endSec) endSec = segEnd
  }
  return { startSec, endSec }
}

/**
 * Inverse of the STT/sync forward mapping (`localTime + segment.offsetSec = unifiedTime`):
 * finds the source-local playback time for a given point on the unified timeline, by finding
 * whichever sync segment's local range the corresponding local time would fall into.
 */
export function mapUnifiedTimeToLocal(source: SourceClip, unifiedTimeSec: number): number | null {
  for (const segment of source.syncSegments) {
    const candidateLocal = unifiedTimeSec - segment.offsetSec
    if (candidateLocal >= segment.localStartSec && candidateLocal < segment.localEndSec) {
      return candidateLocal
    }
  }
  return null
}

/**
 * Forward mapping used to drive the playhead from a playing element's own currentTime. Each
 * source has exactly one sync segment, so this only returns null once playback has run past that
 * segment's end (e.g. native "ended", or a raw file continuing past its usable footage).
 */
export function mapLocalTimeToUnified(source: SourceClip, localTimeSec: number): number | null {
  const segment = source.syncSegments.find(
    (seg) => localTimeSec >= seg.localStartSec && localTimeSec < seg.localEndSec
  )
  return segment ? localTimeSec + segment.offsetSec : null
}

/**
 * Resolves which video source is active at a given unified time: an explicit interval wins as
 * long as the source it names actually has footage there; an explicit switch can outlive the
 * footage it was set against (e.g. the assigned camera's recording ends before the next switch or
 * the timeline end), in which case falling through to the automatic fallback — which must pick a
 * source that actually has footage there — beats freezing on a source with nothing to show.
 * "Just the first video source in import order" can easily point at a source whose recording
 * hadn't started yet at that point in the unified timeline, hence the coverage check there too.
 */
export function resolveVideoSourceId(
  activeVideoIntervals: TrackInterval[],
  sources: SourceClip[],
  atSec: number
): string | undefined {
  const explicit = resolveIntervalAt(activeVideoIntervals, atSec)?.value
  if (explicit) {
    const explicitSource = sources.find((s) => s.id === explicit)
    if (explicitSource && mapUnifiedTimeToLocal(explicitSource, atSec) !== null) return explicit
  }
  return sources.find((s) => s.probed.hasVideo && mapUnifiedTimeToLocal(s, atSec) !== null)?.id
}

/**
 * Same idea for active audio: an explicit interval wins while its source actually covers this
 * time; otherwise prefer the resolved video source's own audio if it actually covers this time,
 * else fall back to any audio-bearing source that does.
 */
export function resolveAudioSourceId(
  activeAudioIntervals: TrackInterval[],
  sources: SourceClip[],
  atSec: number,
  fallbackVideoSourceId: string | undefined
): string | undefined {
  const explicit = resolveIntervalAt(activeAudioIntervals, atSec)?.value
  if (explicit) {
    const explicitSource = sources.find((s) => s.id === explicit)
    if (explicitSource && mapUnifiedTimeToLocal(explicitSource, atSec) !== null) return explicit
  }

  const videoSource = sources.find((s) => s.id === fallbackVideoSourceId)
  if (videoSource?.probed.hasAudio && mapUnifiedTimeToLocal(videoSource, atSec) !== null) {
    return fallbackVideoSourceId
  }

  return sources.find((s) => s.probed.hasAudio && mapUnifiedTimeToLocal(s, atSec) !== null)?.id
}

export interface EffectiveTrackInterval extends TrackInterval {
  /** True for an interval synthesized to fill a stretch left uncovered by any explicit interval
   *  (e.g. before the first-ever camera switch, or after the timeline grew past the last one via a
   *  later re-sync) — not a real, draggable/editable interval, just what fallback resolution would
   *  pick there anyway. */
  synthetic?: boolean
}

/**
 * Fills every stretch of [0, timelineDurationSec) left uncovered by an explicit interval with a
 * synthetic one for whichever source `resolveAt` actually resolves there — so a track-lane display
 * built from `intervals` alone doesn't miss the leading/trailing regions that are only active via
 * fallback (see resolveVideoSourceId/resolveAudioSourceId), which would otherwise silently disagree
 * with the preview/export (both of which already apply that same fallback). Each gap is further
 * split at every source's own footage boundary within it, since the fallback-resolved source can
 * itself change partway through a gap — same reasoning as `resolveActiveAudioCoverage` below.
 */
export function fillIntervalGaps(
  intervals: TrackInterval[],
  sources: SourceClip[],
  timelineDurationSec: number,
  resolveAt: (atSec: number) => string | undefined
): EffectiveTrackInterval[] {
  if (timelineDurationSec <= 0) return intervals

  const sorted = [...intervals].sort((a, b) => a.startSec - b.startSec)
  const result: EffectiveTrackInterval[] = []
  let cursor = 0

  const fillGap = (gapEnd: number): void => {
    if (gapEnd <= cursor) return
    const boundaries = new Set<number>()
    for (const source of sources) {
      const coverage = sourceCoverageRange(source)
      if (!coverage) continue
      if (coverage.startSec > cursor && coverage.startSec < gapEnd)
        boundaries.add(coverage.startSec)
      if (coverage.endSec > cursor && coverage.endSec < gapEnd) boundaries.add(coverage.endSec)
    }
    const points = [cursor, ...Array.from(boundaries).sort((a, b) => a - b), gapEnd]
    for (let i = 0; i < points.length - 1; i++) {
      const segStart = points[i]
      const segEnd = points[i + 1]
      if (segEnd <= segStart) continue
      const value = resolveAt(segStart)
      if (!value) continue

      // Merge with the previous synthetic segment if it resolved to the same source — boundary
      // points can land a hair apart from floating-point sums (e.g. offsetSec + localEndSec) that
      // don't exactly match `gapEnd`/`timelineDurationSec`, which would otherwise leave a sliver
      // duplicate of the same source instead of one continuous block.
      const previous = result[result.length - 1]
      if (previous?.synthetic && previous.value === value && previous.endSec === segStart) {
        previous.endSec = segEnd
      } else {
        result.push({
          id: `gap-${segStart}`,
          startSec: segStart,
          endSec: segEnd,
          value,
          synthetic: true
        })
      }
    }
  }

  for (const iv of sorted) {
    fillGap(iv.startSec)
    result.push(iv)
    cursor = Math.max(cursor, iv.endSec)
  }
  fillGap(timelineDurationSec)

  return result
}

/**
 * Partitions the whole unified timeline into non-overlapping segments, each attributed to
 * whichever source is the resolved active audio there (explicit `activeAudioIntervals` win,
 * otherwise the same fallback `resolveAudioSourceId` uses for playback/export). Used to decide
 * exactly which audio to transcribe: only the portion of each source that is actually the
 * audible/active track at that point in time, so overlapping recordings (e.g. two mics running
 * simultaneously) don't produce duplicate transcript text for the same moment.
 */
export function resolveActiveAudioCoverage(
  sources: SourceClip[],
  activeVideoIntervals: TrackInterval[],
  activeAudioIntervals: TrackInterval[],
  timelineDurationSec: number
): AudioCoverageSegment[] {
  if (timelineDurationSec <= 0) return []

  const boundaries = new Set<number>([0, timelineDurationSec])
  for (const iv of [...activeVideoIntervals, ...activeAudioIntervals]) {
    if (iv.startSec > 0 && iv.startSec < timelineDurationSec) boundaries.add(iv.startSec)
    if (iv.endSec > 0 && iv.endSec < timelineDurationSec) boundaries.add(iv.endSec)
  }
  for (const source of sources) {
    for (const seg of source.syncSegments) {
      const start = seg.localStartSec + seg.offsetSec
      const end = seg.localEndSec + seg.offsetSec
      if (start > 0 && start < timelineDurationSec) boundaries.add(start)
      if (end > 0 && end < timelineDurationSec) boundaries.add(end)
    }
  }

  const points = Array.from(boundaries).sort((a, b) => a - b)
  const segments: AudioCoverageSegment[] = []

  for (let i = 0; i < points.length - 1; i++) {
    const unifiedStartSec = points[i]
    const unifiedEndSec = points[i + 1]
    if (unifiedEndSec <= unifiedStartSec) continue

    const midpoint = (unifiedStartSec + unifiedEndSec) / 2
    const videoSourceId = resolveVideoSourceId(activeVideoIntervals, sources, midpoint)
    const sourceId = resolveAudioSourceId(activeAudioIntervals, sources, midpoint, videoSourceId)
    if (!sourceId) continue

    const previous = segments[segments.length - 1]
    if (previous && previous.sourceId === sourceId && previous.unifiedEndSec === unifiedStartSec) {
      previous.unifiedEndSec = unifiedEndSec
    } else {
      segments.push({ sourceId, unifiedStartSec, unifiedEndSec })
    }
  }

  return segments
}
