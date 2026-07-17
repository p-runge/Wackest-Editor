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

/** Forward mapping used to drive the playhead from a playing element's own currentTime. */
export function mapLocalTimeToUnified(source: SourceClip, localTimeSec: number): number | null {
  const containing = source.syncSegments.find(
    (seg) => localTimeSec >= seg.localStartSec && localTimeSec < seg.localEndSec
  )
  const segment = containing ?? source.syncSegments[0]
  return segment ? localTimeSec + segment.offsetSec : null
}

/**
 * Resolves which video source is active at a given unified time: an explicit interval always
 * wins; the automatic fallback (no interval set yet) must pick a source that actually has
 * footage there — "just the first video source in import order" can easily point at a source
 * whose recording hadn't started yet at that point in the unified timeline.
 */
export function resolveVideoSourceId(
  activeVideoIntervals: TrackInterval[],
  sources: SourceClip[],
  atSec: number
): string | undefined {
  const explicit = resolveIntervalAt(activeVideoIntervals, atSec)?.value
  if (explicit) return explicit
  return sources.find((s) => s.probed.hasVideo && mapUnifiedTimeToLocal(s, atSec) !== null)?.id
}

/**
 * Same idea for primary audio: an explicit interval wins; otherwise prefer the resolved video
 * source's own audio if it actually covers this time, else fall back to any audio-bearing source
 * that does.
 */
export function resolveAudioSourceId(
  primaryAudioIntervals: TrackInterval[],
  sources: SourceClip[],
  atSec: number,
  fallbackVideoSourceId: string | undefined
): string | undefined {
  const explicit = resolveIntervalAt(primaryAudioIntervals, atSec)?.value
  if (explicit) return explicit

  const videoSource = sources.find((s) => s.id === fallbackVideoSourceId)
  if (videoSource?.probed.hasAudio && mapUnifiedTimeToLocal(videoSource, atSec) !== null) {
    return fallbackVideoSourceId
  }

  return sources.find((s) => s.probed.hasAudio && mapUnifiedTimeToLocal(s, atSec) !== null)?.id
}

/**
 * Partitions the whole unified timeline into non-overlapping segments, each attributed to
 * whichever source is the resolved primary audio there (explicit `primaryAudioIntervals` win,
 * otherwise the same fallback `resolveAudioSourceId` uses for playback/export). Used to decide
 * exactly which audio to transcribe: only the portion of each source that is actually the
 * audible/primary track at that point in time, so overlapping recordings (e.g. two mics running
 * simultaneously) don't produce duplicate transcript text for the same moment.
 */
export function resolvePrimaryAudioCoverage(
  sources: SourceClip[],
  activeVideoIntervals: TrackInterval[],
  primaryAudioIntervals: TrackInterval[],
  timelineDurationSec: number
): AudioCoverageSegment[] {
  if (timelineDurationSec <= 0) return []

  const boundaries = new Set<number>([0, timelineDurationSec])
  for (const iv of [...activeVideoIntervals, ...primaryAudioIntervals]) {
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
    const sourceId = resolveAudioSourceId(primaryAudioIntervals, sources, midpoint, videoSourceId)
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
