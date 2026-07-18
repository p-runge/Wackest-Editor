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
 * Forward mapping used to drive the playhead from a playing element's own currentTime.
 * Returns null when `localTimeSec` falls outside every sync segment — e.g. footage between two
 * segments of the same file after a hard cut — rather than guessing via an arbitrary segment,
 * since that footage isn't actually part of the edited timeline.
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
