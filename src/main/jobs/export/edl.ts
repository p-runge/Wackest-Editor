import { resolveVideoSourceId, resolveAudioSourceId } from '@shared/types/timeline-time'
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
 * Splits each kept range at every active-video/active-audio boundary it contains, so every
 * resulting sub-segment has exactly one active video source and one active audio source —
 * matching what the preview player would show, including its same fallback source choice
 * (which always picks a source that actually has footage at that point in time).
 */
export function buildExportSegments(
  keptRanges: KeptRange[],
  activeVideoIntervals: TrackInterval[],
  activeAudioIntervals: TrackInterval[],
  sources: SourceClip[]
): ExportSegment[] {
  const segments: ExportSegment[] = []
  const sortedRanges = [...keptRanges].sort((a, b) => a.startSec - b.startSec)

  for (const range of sortedRanges) {
    const boundaries = new Set<number>()
    for (const iv of [...activeVideoIntervals, ...activeAudioIntervals]) {
      if (iv.startSec > range.startSec && iv.startSec < range.endSec) {
        boundaries.add(iv.startSec)
      }
    }
    const points = [range.startSec, ...Array.from(boundaries).sort((a, b) => a - b), range.endSec]

    for (let i = 0; i < points.length - 1; i++) {
      const segStart = points[i]
      const segEnd = points[i + 1]
      if (segEnd <= segStart) continue

      const videoSourceId = resolveVideoSourceId(activeVideoIntervals, sources, segStart)
      const audioSourceId = resolveAudioSourceId(
        activeAudioIntervals,
        sources,
        segStart,
        videoSourceId
      )

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
