import {
  resolveVideoSourceId,
  resolveAudioSourceId,
  sourceCoverageRange,
  keptRangeContentSpan
} from '@shared/types/timeline-time'
import type { KeptRange, TrackInterval, SourceClip } from '@shared/types/project'

export interface ExportSegment {
  unifiedStartSec: number
  unifiedEndSec: number
  videoSourceId: string
  audioSourceId: string
}

export interface AudioExportSpan {
  unifiedStartSec: number
  unifiedEndSec: number
  audioSourceId: string
}

/**
 * Splits each kept range at every active-video/active-audio boundary it contains — both the start
 * AND end of each interval, plus every source's own footage boundary — so every resulting
 * sub-segment has exactly one active video source and one active audio source, each with actual
 * coverage for that whole sub-segment. Without the end/footage boundaries, a segment can run past
 * the point where its resolved source's real footage ends (e.g. an explicit audio interval that
 * outlives its source's own duration): the source-resolution fallback is only evaluated once, at
 * the segment's start, so it would miss the switch and the segment would silently render short
 * (each per-segment ffmpeg trim just stops at its input's EOF) — which the final `-shortest` mux
 * then also silently truncates the whole export to match. Matches `resolveActiveAudioCoverage`'s
 * boundary set, which the transcription path already needs this same precision for.
 *
 * `keptRanges` is processed in *placement* order (sorted by startSec): where the user placed each
 * chunk on the program timeline IS the output order — dragging a chunk earlier/later in Schnitt
 * mode changes when it plays in the final cut.
 *
 * Each range's *content* span (`keptRangeContentSpan`) — not its placement span — is what actually
 * gets resolved/trimmed here: a range dragged to a new spot in Schnitt mode keeps exporting the
 * footage it was picked up from, not whatever else happens to already be at its new placement.
 * Placement determines only the ordering; trimming/resolution only ever sees content time.
 */
export function buildExportSegments(
  keptRanges: KeptRange[],
  activeVideoIntervals: TrackInterval[],
  activeAudioIntervals: TrackInterval[],
  sources: SourceClip[]
): ExportSegment[] {
  const segments: ExportSegment[] = []
  const orderedRanges = [...keptRanges].sort((a, b) => a.startSec - b.startSec)

  for (const range of orderedRanges) {
    const content = keptRangeContentSpan(range)
    const boundaries = new Set<number>()
    for (const iv of [...activeVideoIntervals, ...activeAudioIntervals]) {
      if (iv.startSec > content.startSec && iv.startSec < content.endSec) {
        boundaries.add(iv.startSec)
      }
      if (iv.endSec > content.startSec && iv.endSec < content.endSec) {
        boundaries.add(iv.endSec)
      }
    }
    for (const source of sources) {
      const coverage = sourceCoverageRange(source)
      if (!coverage) continue
      if (coverage.startSec > content.startSec && coverage.startSec < content.endSec) {
        boundaries.add(coverage.startSec)
      }
      if (coverage.endSec > content.startSec && coverage.endSec < content.endSec) {
        boundaries.add(coverage.endSec)
      }
    }
    const points = [
      content.startSec,
      ...Array.from(boundaries).sort((a, b) => a - b),
      content.endSec
    ]

    for (let i = 0; i < points.length - 1; i++) {
      const segStart = points[i]
      const segEnd = points[i + 1]
      if (segEnd <= segStart) continue

      const videoSourceId = resolveVideoSourceId(activeVideoIntervals, segStart)
      const audioSourceId = resolveAudioSourceId(activeAudioIntervals, segStart)

      if (!videoSourceId || !audioSourceId) continue // no source at all to render this range from

      segments.push({
        unifiedStartSec: segStart,
        unifiedEndSec: segEnd,
        videoSourceId,
        audioSourceId
      })
    }
  }

  return segments
}

/**
 * Collapses consecutive export segments that share the same active audio source into one span —
 * a video-only cut (camera switch with the audio source held constant) does not need a new audio
 * boundary. Segments are already contiguous within a kept range and separated by real gaps across
 * kept ranges, so a plain adjacency + same-source check is sufficient. This is what lets export
 * render each continuous audio stretch with a single ffmpeg encode instead of one per video cut —
 * re-encoding AAC separately per video segment (even from the same, temporally continuous source)
 * introduces an audible click at every join, since each independent encode adds its own encoder
 * priming samples that a later stream-copy concat can't undo.
 */
export function groupAudioSpans(segments: ExportSegment[]): AudioExportSpan[] {
  const spans: AudioExportSpan[] = []

  for (const segment of segments) {
    const previous = spans[spans.length - 1]
    if (
      previous &&
      previous.audioSourceId === segment.audioSourceId &&
      previous.unifiedEndSec === segment.unifiedStartSec
    ) {
      previous.unifiedEndSec = segment.unifiedEndSec
    } else {
      spans.push({
        unifiedStartSec: segment.unifiedStartSec,
        unifiedEndSec: segment.unifiedEndSec,
        audioSourceId: segment.audioSourceId
      })
    }
  }

  return spans
}
