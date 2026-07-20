import { v4 as uuidv4 } from 'uuid'
import type { TrackInterval, SourceClip, KeptRange } from './project'

export interface AudioCoverageSegment {
  sourceId: string
  unifiedStartSec: number
  unifiedEndSec: number
}

/** The [start, end) of raw/synced footage a kept range's content actually comes from — equal to
 *  its own placement span unless it's been moved (Schnitt mode's free drag-to-reposition), in
 *  which case the content stays anchored to wherever it was originally picked up from. Shared
 *  between the renderer (drawing the relocated clip's own waveform at its new placement) and the
 *  main-process exporter (which must trim/resolve sources from the content span, not placement). */
export function keptRangeContentSpan(range: KeptRange): { startSec: number; endSec: number } {
  const startSec = range.contentStartSec ?? range.startSec
  return { startSec, endSec: startSec + (range.endSec - range.startSec) }
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
 * Inverse of the transcription/sync forward mapping (`localTime + segment.offsetSec = unifiedTime`):
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
 * What's active RIGHT NOW at a given time — a plain interval lookup, nothing more. This is the
 * single source of truth every consumer (preview, camera switcher, lane display, export) shares:
 * as long as `fillActiveIntervalGaps` has done its job at sync time, every instant with any
 * footage has a real interval here, so there is no separate "fallback" case to get out of sync.
 */
export function resolveVideoSourceId(
  activeVideoIntervals: TrackInterval[],
  atSec: number
): string | undefined {
  return resolveIntervalAt(activeVideoIntervals, atSec)?.value
}

/** Same idea for active audio — see `resolveVideoSourceId`. */
export function resolveAudioSourceId(
  activeAudioIntervals: TrackInterval[],
  atSec: number
): string | undefined {
  return resolveIntervalAt(activeAudioIntervals, atSec)?.value
}

/** The *default* video source for a not-yet-explicitly-set instant — used only by
 *  `fillActiveIntervalGaps` at sync time, never as a runtime fallback. Picks the first source (in
 *  array/import order) whose footage actually covers `atSec`. */
export function defaultVideoSourceAt(sources: SourceClip[], atSec: number): string | undefined {
  return sources.find((s) => s.probed.hasVideo && mapUnifiedTimeToLocal(s, atSec) !== null)?.id
}

/** The *default* audio source for a not-yet-explicitly-set instant: prefers `defaultVideoSourceId`
 *  's own audio if it covers `atSec`, else the first audio-bearing source that does. Also used
 *  only by `fillActiveIntervalGaps`. */
export function defaultAudioSourceAt(
  sources: SourceClip[],
  atSec: number,
  defaultVideoSourceId: string | undefined
): string | undefined {
  const videoSource = sources.find((s) => s.id === defaultVideoSourceId)
  if (videoSource?.probed.hasAudio && mapUnifiedTimeToLocal(videoSource, atSec) !== null) {
    return defaultVideoSourceId
  }
  return sources.find((s) => s.probed.hasAudio && mapUnifiedTimeToLocal(s, atSec) !== null)?.id
}

/**
 * Materializes full coverage for an active-track (video or audio) interval list: every existing
 * interval is trimmed to where its named source actually has footage — dropped entirely if that
 * source no longer exists at all (e.g. was just removed) — then every remaining gap, wherever ANY
 * source has footage, is filled with a real interval for whichever source `resolveDefault` picks
 * there. The result always fully covers every instant that has footage, so `resolveVideoSourceId`/
 * `resolveAudioSourceId` never need a runtime fallback: what's "set" and what's "shown" are always
 * the same interval list — the class of bug where the lane, the preview, and the export silently
 * disagreed about what's active can't recur.
 *
 * Called once whenever the source list or their sync alignment changes — sync, re-sync, a manual
 * offset edit, or removing a source — not on every render/lookup, so the default choice is decided
 * once and written into real state instead of being independently re-derived by each consumer.
 *
 * `extraBoundarySecs` splits gap-fills at additional points beyond source footage boundaries —
 * the audio track passes the (already-filled) video intervals' edges here, since the audio default
 * ("prefer the active video source's own audio") flips exactly at video switches. Same reasoning
 * as `resolveActiveAudioCoverage` below.
 */
export function fillActiveIntervalGaps(
  intervals: TrackInterval[],
  sources: SourceClip[],
  timelineDurationSec: number,
  resolveDefault: (atSec: number) => string | undefined,
  extraBoundarySecs: number[] = []
): TrackInterval[] {
  if (timelineDurationSec <= 0) return []

  const sorted = [...intervals].sort((a, b) => a.startSec - b.startSec)
  const trimmed: TrackInterval[] = []
  for (const iv of sorted) {
    const source = sources.find((s) => s.id === iv.value)
    const coverage = source ? sourceCoverageRange(source) : null
    if (!coverage) continue // source gone (or never synced) — nothing real to keep here
    const startSec = Math.max(iv.startSec, coverage.startSec)
    const endSec = Math.min(iv.endSec, coverage.endSec)
    if (endSec <= startSec) continue // entirely outside its source's footage
    trimmed.push(
      startSec === iv.startSec && endSec === iv.endSec ? iv : { ...iv, startSec, endSec }
    )
  }

  const result: TrackInterval[] = []
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
    for (const boundarySec of extraBoundarySecs) {
      if (boundarySec > cursor && boundarySec < gapEnd) boundaries.add(boundarySec)
    }
    const points = [cursor, ...Array.from(boundaries).sort((a, b) => a - b), gapEnd]
    for (let i = 0; i < points.length - 1; i++) {
      const segStart = points[i]
      const segEnd = points[i + 1]
      if (segEnd <= segStart) continue
      const value = resolveDefault(segStart)
      if (!value) continue // genuinely nothing covers this instant (e.g. a hard-cut gap)

      // Merge with the previous filled-in segment if it resolved to the same source — boundary
      // points can land a hair apart from floating-point sums (e.g. offsetSec + localEndSec) that
      // don't exactly match `gapEnd`/`timelineDurationSec`, which would otherwise leave a sliver
      // duplicate of the same source instead of one continuous block.
      const previous = result[result.length - 1]
      if (previous && previous.value === value && previous.endSec === segStart) {
        previous.endSec = segEnd
      } else {
        result.push({ id: uuidv4(), startSec: segStart, endSec: segEnd, value })
      }
    }
  }

  for (const iv of trimmed) {
    fillGap(iv.startSec)
    // Same adjacent-merge as inside fillGap, but against whatever's already last in `result` —
    // a filled-in gap ending exactly where this real interval starts, same source, shouldn't stay
    // two separate objects. Always builds a fresh object rather than mutating `iv` or `previous`,
    // since either could be a reference the caller (or an earlier trim) still holds onto.
    const previous = result[result.length - 1]
    if (previous && previous.value === iv.value && previous.endSec === iv.startSec) {
      result[result.length - 1] = { ...previous, endSec: iv.endSec }
    } else {
      result.push(iv)
    }
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
    const sourceId = resolveAudioSourceId(activeAudioIntervals, midpoint)
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
