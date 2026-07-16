import { resolveVideoSourceId, resolveAudioSourceId } from '@shared/types/timeline-time'
import type { KeptRange, TrackInterval, SourceClip } from '@shared/types/project'

export interface ExportSegment {
  unifiedStartSec: number
  unifiedEndSec: number
  videoSourceId: string
  audioSourceId: string
}

/**
 * Splits each kept range at every active-video/primary-audio boundary it contains, so every
 * resulting sub-segment has exactly one active video source and one active audio source —
 * matching what the preview player would show, including its same fallback source choice
 * (which always picks a source that actually has footage at that point in time).
 */
export function buildExportSegments(
  keptRanges: KeptRange[],
  activeVideoIntervals: TrackInterval[],
  primaryAudioIntervals: TrackInterval[],
  sources: SourceClip[]
): ExportSegment[] {
  const segments: ExportSegment[] = []
  const sortedRanges = [...keptRanges].sort((a, b) => a.startSec - b.startSec)

  for (const range of sortedRanges) {
    const boundaries = new Set<number>()
    for (const iv of [...activeVideoIntervals, ...primaryAudioIntervals]) {
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
        primaryAudioIntervals,
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
