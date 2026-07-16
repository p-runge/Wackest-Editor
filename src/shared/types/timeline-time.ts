import type { TrackInterval, SourceClip } from './project'

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
