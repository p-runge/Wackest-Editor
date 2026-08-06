import { useEffect, useState } from 'react'
import type { SourceClip, TrackInterval } from '@shared/types/project'
import { sourceCoverageRange, type LaneChunk } from '../../lib/timeline-edit'
import WaveformCanvas from './WaveformCanvas'
import { SOURCE_LANE_HEIGHT_PX } from './constants'

interface SourceLaneTrackProps {
  /** The device group's member sources shown on this lane. They never overlap in time (one device
   *  can't record two clips at once), so their pieces sit side by side in the single lane row. */
  members: SourceClip[]
  pixelsPerSecond: number
  trackWidthPx: number
  color: string
  /** Full activeVideoIntervals / activeAudioIntervals array (content time) — always fully covers
   *  every instant with any footage (see `fillActiveIntervalGaps`, run at sync time), so this lane
   *  shows exactly the sub-ranges where one of its members is the active source and can find its
   *  shared boundaries with neighbors without any separate fallback/gap-filling of its own. */
  activeIntervals: TrackInterval[]
  /** The kept-range chunks that define what this timeline currently shows: everything in this
   *  lane (waveform, active tint, dimming) is rendered per chunk, clipped to the chunk's content
   *  span and drawn at its placement position — so a moved chunk carries this lane's slice of
   *  footage along with it, and cut-out content simply isn't drawn. */
  chunks: LaneChunk[]
  /** All sources in this section (video or audio), so a dragged boundary's bounds can be looked
   *  up for whichever neighbor source actually owns each side of it. */
  sources: SourceClip[]
  /** Overall length of the active-video / active-audio track — the outer bound a dragged
   *  boundary can be pushed to, past however many neighboring segments it crosses. */
  timelineDurationSec: number
  /** Whether Kamerawechsler is the active tool — gates the boundary-drag handles between active
   *  segments; waveform clicks stay live either way (the caller decides what a click does). */
  interactive: boolean
  /** Click on a waveform piece, in *placement* (program-timeline) seconds, plus the member source
   *  that was clicked — the caller maps to content time and sets that source active there. */
  onWaveformClick: (placementSec: number, sourceId: string) => void
  /** Drags the shared boundary starting at `leftIntervalId`'s interval to `atSec` (content time —
   *  active intervals live in content time). */
  onMoveBoundary: (leftIntervalId: string, atSec: number) => void
}

interface BoundaryDragState {
  leftIntervalId: string
  minSec: number
  maxSec: number
  /** Current boundary position in content time. */
  atSec: number
  /** placementSec - contentSec for the chunk the boundary lives in, so pointer x (placement) can
   *  be translated to content and the handle drawn back at placement. */
  chunkOffset: number
}

const WAVEFORM_BUCKETS_PER_SEC = 10 // must match main/services/ffmpeg.ts

/** Subtracts a set of (sorted, non-overlapping) ranges from a single [start, end) range. */
function subtractRanges(
  [start, end]: [number, number],
  subtract: Array<[number, number]>
): Array<[number, number]> {
  const result: Array<[number, number]> = []
  let cursor = start
  for (const [s, e] of subtract) {
    if (e <= cursor || s >= end) continue
    const clippedStart = Math.max(s, cursor)
    if (clippedStart > cursor) result.push([cursor, clippedStart])
    cursor = Math.max(cursor, Math.min(e, end))
  }
  if (cursor < end) result.push([cursor, end])
  return result
}

function SourceLaneTrack({
  members,
  pixelsPerSecond,
  trackWidthPx,
  color,
  activeIntervals,
  chunks,
  sources,
  timelineDurationSec,
  interactive,
  onWaveformClick,
  onMoveBoundary
}: SourceLaneTrackProps): React.JSX.Element {
  // One waveform per member source, keyed by source id (members share the lane but each references
  // its own cached peaks).
  const [peaksBySource, setPeaksBySource] = useState<Record<string, Array<[number, number]>>>({})
  const [drag, setDrag] = useState<BoundaryDragState | null>(null)

  // Re-load whenever the member set / their cache paths change.
  const waveformKey = members.map((m) => `${m.id}:${m.waveformCachePath ?? ''}`).join('|')
  useEffect(() => {
    let cancelled = false
    const toLoad = members.filter((m) => m.waveformCachePath)
    Promise.all(
      toLoad.map(async (m) => {
        try {
          const data = await window.api.source.readWaveform(m.waveformCachePath!)
          return [m.id, data] as const
        } catch {
          return [m.id, [] as Array<[number, number]>] as const
        }
      })
    ).then((entries) => {
      if (!cancelled) setPeaksBySource(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
    // waveformKey captures the members + paths we depend on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveformKey])

  const sorted = [...activeIntervals].sort((a, b) => a.startSec - b.startSec)

  const startDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    left: TrackInterval,
    right: TrackInterval,
    chunk: LaneChunk
  ): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const leftSource = sources.find((s) => s.id === left.value)
    const rightSource = sources.find((s) => s.id === right.value)
    const leftCoverage = leftSource && sourceCoverageRange(leftSource)
    const rightCoverage = rightSource && sourceCoverageRange(rightSource)
    setDrag({
      leftIntervalId: left.id,
      // Bounded by the growing side's real footage AND the chunk the boundary lives in — dragging
      // a boundary out of its own chunk would silently jump it into differently-placed content.
      minSec: Math.max(0, rightCoverage?.startSec ?? 0, chunk.contentStartSec),
      maxSec: Math.min(
        timelineDurationSec,
        leftCoverage?.endSec ?? timelineDurationSec,
        chunk.contentEndSec
      ),
      atSec: left.endSec,
      chunkOffset: chunk.placementStartSec - chunk.contentStartSec
    })
  }

  const updateDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag) return
    const track = e.currentTarget.closest('.source-lane__track')
    if (!track) return
    const rect = track.getBoundingClientRect()
    const placementSec = (e.clientX - rect.left) / pixelsPerSecond
    const atSec = placementSec - drag.chunkOffset
    setDrag({ ...drag, atSec: Math.min(Math.max(atSec, drag.minSec), drag.maxSec) })
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    onMoveBoundary(drag.leftIntervalId, drag.atSec)
    setDrag(null)
  }

  return (
    <div
      className="source-lane__track"
      style={{ height: SOURCE_LANE_HEIGHT_PX, width: trackWidthPx }}
    >
      {chunks.flatMap((chunk) => {
        const offset = chunk.placementStartSec - chunk.contentStartSec
        const clipToChunk = (a: number, b: number): [number, number] | null => {
          const start = Math.max(a, chunk.contentStartSec)
          const end = Math.min(b, chunk.contentEndSec)
          return end > start ? [start, end] : null
        }

        const pieces: React.JSX.Element[] = []
        // Boundary handles a boundary two members share must only render once per chunk.
        const renderedBoundaryKeys = new Set<string>()

        for (const member of members) {
          const peaks = peaksBySource[member.id]
          const ownBlocks = sorted
            .map((iv, index) => ({ iv, index }))
            .filter(({ iv }) => iv.value === member.id)

          // Active-source tint — content intervals clipped to this chunk, drawn at placement.
          // While a boundary drag is live, the dragged edge follows drag.atSec (content time).
          for (const { iv, index } of ownBlocks) {
            const leftNeighbor = sorted[index - 1]
            const rawStart =
              drag && leftNeighbor && drag.leftIntervalId === leftNeighbor.id
                ? drag.atSec
                : iv.startSec
            const rawEnd = drag && drag.leftIntervalId === iv.id ? drag.atSec : iv.endSec
            const clipped = clipToChunk(rawStart, rawEnd)
            if (!clipped) continue
            pieces.push(
              <div
                key={`tint-${chunk.id}-${iv.id}`}
                className="source-lane__active-range"
                style={{
                  left: (clipped[0] + offset) * pixelsPerSecond,
                  width: Math.max(1, (clipped[1] - clipped[0]) * pixelsPerSecond),
                  backgroundColor: color
                }}
                title={`Aktiv (${(clipped[0] + offset).toFixed(1)}s–${(clipped[1] + offset).toFixed(1)}s)`}
              />
            )
          }

          // Waveform: this member's sync segments clipped to the chunk's content span, drawn at the
          // chunk's placement — the footage inside a moved chunk travels with it.
          for (const segment of member.syncSegments) {
            const clipped = clipToChunk(
              segment.localStartSec + segment.offsetSec,
              segment.localEndSec + segment.offsetSec
            )
            if (!clipped) continue
            const [c0, c1] = clipped
            const local0 = c0 - segment.offsetSec
            const local1 = c1 - segment.offsetSec
            const segmentPeaks = peaks
              ? peaks.slice(
                  Math.floor(local0 * WAVEFORM_BUCKETS_PER_SEC),
                  Math.ceil(local1 * WAVEFORM_BUCKETS_PER_SEC)
                )
              : []
            const width = Math.max(1, (c1 - c0) * pixelsPerSecond)
            pieces.push(
              <div
                key={`wave-${chunk.id}-${segment.id}`}
                className="source-lane__segment"
                style={{ left: (c0 + offset) * pixelsPerSecond, width, borderColor: color }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const withinSec = (e.clientX - rect.left) / pixelsPerSecond
                  onWaveformClick(c0 + offset + withinSec, member.id)
                }}
              >
                {segmentPeaks.length > 0 && (
                  <WaveformCanvas
                    peaks={segmentPeaks}
                    width={width}
                    height={SOURCE_LANE_HEIGHT_PX}
                    color={color}
                  />
                )}
              </div>
            )
          }

          // Dim the stretches (within this chunk) where this member is NOT the active one.
          for (const segment of member.syncSegments) {
            const clipped = clipToChunk(
              segment.localStartSec + segment.offsetSec,
              segment.localEndSec + segment.offsetSec
            )
            if (!clipped) continue
            const activeRanges: Array<[number, number]> = ownBlocks.map(({ iv }) => [
              iv.startSec,
              iv.endSec
            ])
            for (const [rangeStart, rangeEnd] of subtractRanges(clipped, activeRanges)) {
              pieces.push(
                <div
                  key={`dim-${chunk.id}-${segment.id}-${rangeStart}`}
                  className="source-lane__inactive-range"
                  style={{
                    left: (rangeStart + offset) * pixelsPerSecond,
                    width: Math.max(1, (rangeEnd - rangeStart) * pixelsPerSecond)
                  }}
                />
              )
            }
          }

          // Boundary-drag handles between two adjacent active intervals, at the boundary's current
          // placement within this chunk. Keyed by the left interval's id so a boundary two blocks
          // share (each seeing it as its neighbor's edge) is only rendered once.
          if (interactive) {
            const boundaryPairs = new Map<string, [TrackInterval, TrackInterval]>()
            for (const { iv, index } of ownBlocks) {
              const leftNeighbor = sorted[index - 1]
              if (leftNeighbor && leftNeighbor.endSec === iv.startSec) {
                boundaryPairs.set(leftNeighbor.id, [leftNeighbor, iv])
              }
              const rightNeighbor = sorted[index + 1]
              if (rightNeighbor && rightNeighbor.startSec === iv.endSec) {
                boundaryPairs.set(iv.id, [iv, rightNeighbor])
              }
            }
            for (const [left, right] of boundaryPairs.values()) {
              if (renderedBoundaryKeys.has(left.id)) continue
              const boundarySec = drag && drag.leftIntervalId === left.id ? drag.atSec : left.endSec
              if (boundarySec < chunk.contentStartSec || boundarySec >= chunk.contentEndSec) {
                continue
              }
              renderedBoundaryKeys.add(left.id)
              pieces.push(
                <div
                  key={`handle-${chunk.id}-${left.id}`}
                  className="group absolute top-0 z-10 -ml-1.5 h-full w-3 cursor-col-resize"
                  style={{ left: (boundarySec + offset) * pixelsPerSecond }}
                  onPointerDown={(e) => startDrag(e, left, right, chunk)}
                  onPointerMove={updateDrag}
                  onPointerUp={endDrag}
                >
                  <div className="mx-auto h-full w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-foreground/70" />
                </div>
              )
            }
          }
        }

        return pieces
      })}
    </div>
  )
}

export default SourceLaneTrack
