import { useEffect, useState } from 'react'
import type { SourceClip, TrackInterval } from '@shared/types/project'
import { sourceCoverageRange } from '../../lib/timeline-edit'
import WaveformCanvas from './WaveformCanvas'
import { SOURCE_LANE_HEIGHT_PX } from './constants'

interface SourceLaneTrackProps {
  source: SourceClip
  pixelsPerSecond: number
  trackWidthPx: number
  color: string
  /** Full activeVideoIntervals / activeAudioIntervals array, so this lane can show exactly the
   *  sub-ranges where it is the active source, and find its shared boundaries with neighbors. */
  activeIntervals: TrackInterval[]
  /** All sources in this section (video or audio), so a dragged boundary's bounds can be looked
   *  up for whichever neighbor source actually owns each side of it. */
  sources: SourceClip[]
  /** Overall length of the active-video / active-audio track — the outer bound a dragged
   *  boundary can be pushed to, past however many neighboring segments it crosses. */
  timelineDurationSec: number
  /** Sets this source active starting at the clicked timestamp within the waveform. */
  onWaveformClick: (atSec: number) => void
  /** Drags the shared boundary starting at `leftIntervalId`'s interval to `atSec`. */
  onMoveBoundary: (leftIntervalId: string, atSec: number) => void
}

interface BoundaryDragState {
  leftIntervalId: string
  minSec: number
  maxSec: number
  atSec: number
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
  source,
  pixelsPerSecond,
  trackWidthPx,
  color,
  activeIntervals,
  sources,
  timelineDurationSec,
  onWaveformClick,
  onMoveBoundary
}: SourceLaneTrackProps): React.JSX.Element {
  const [peaks, setPeaks] = useState<Array<[number, number]> | null>(null)
  const [drag, setDrag] = useState<BoundaryDragState | null>(null)

  useEffect(() => {
    if (!source.waveformCachePath) return undefined
    let cancelled = false
    window.api.ingest
      .readWaveform(source.waveformCachePath)
      .then((data) => {
        if (!cancelled) setPeaks(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [source.waveformCachePath])

  const sorted = [...activeIntervals].sort((a, b) => a.startSec - b.startSec)
  const ownBlocks = sorted
    .map((iv, index) => ({ iv, index }))
    .filter(({ iv }) => iv.value === source.id)

  const startDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    left: TrackInterval,
    right: TrackInterval
  ): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const leftSource = sources.find((s) => s.id === left.value)
    const rightSource = sources.find((s) => s.id === right.value)
    const leftCoverage = leftSource && sourceCoverageRange(leftSource)
    const rightCoverage = rightSource && sourceCoverageRange(rightSource)
    setDrag({
      leftIntervalId: left.id,
      minSec: Math.max(0, rightCoverage?.startSec ?? 0),
      maxSec: Math.min(timelineDurationSec, leftCoverage?.endSec ?? timelineDurationSec),
      atSec: left.endSec
    })
  }

  const updateDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag) return
    const track = e.currentTarget.closest('.source-lane__track')
    if (!track) return
    const rect = track.getBoundingClientRect()
    const atSec = (e.clientX - rect.left) / pixelsPerSecond
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
      {ownBlocks.map(({ iv, index }) => {
        const leftNeighbor = sorted[index - 1]
        const displayStart =
          drag && leftNeighbor && drag.leftIntervalId === leftNeighbor.id ? drag.atSec : iv.startSec
        const displayEnd = drag && drag.leftIntervalId === iv.id ? drag.atSec : iv.endSec
        return (
          <div
            key={iv.id}
            className="source-lane__active-range"
            style={{
              left: displayStart * pixelsPerSecond,
              width: Math.max(1, (displayEnd - displayStart) * pixelsPerSecond),
              backgroundColor: color
            }}
            title={`Aktiv (${iv.startSec.toFixed(1)}s–${iv.endSec.toFixed(1)}s)`}
          />
        )
      })}

      {ownBlocks.flatMap(({ iv, index }) => {
        const handles: React.JSX.Element[] = []
        const leftNeighbor = sorted[index - 1]
        if (leftNeighbor && leftNeighbor.endSec === iv.startSec) {
          const boundarySec =
            drag && drag.leftIntervalId === leftNeighbor.id ? drag.atSec : iv.startSec
          handles.push(
            <div
              key={`boundary-left-${iv.id}`}
              className="group absolute top-0 z-10 -ml-1.5 h-full w-3 cursor-col-resize"
              style={{ left: boundarySec * pixelsPerSecond }}
              onPointerDown={(e) => startDrag(e, leftNeighbor, iv)}
              onPointerMove={updateDrag}
              onPointerUp={endDrag}
            >
              <div className="mx-auto h-full w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-foreground/70" />
            </div>
          )
        }
        const rightNeighbor = sorted[index + 1]
        if (rightNeighbor && rightNeighbor.startSec === iv.endSec) {
          const boundarySec = drag && drag.leftIntervalId === iv.id ? drag.atSec : iv.endSec
          handles.push(
            <div
              key={`boundary-right-${iv.id}`}
              className="group absolute top-0 z-10 -ml-1.5 h-full w-3 cursor-col-resize"
              style={{ left: boundarySec * pixelsPerSecond }}
              onPointerDown={(e) => startDrag(e, iv, rightNeighbor)}
              onPointerMove={updateDrag}
              onPointerUp={endDrag}
            >
              <div className="mx-auto h-full w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-foreground/70" />
            </div>
          )
        }
        return handles
      })}

      {source.syncSegments.map((segment) => {
        const left = (segment.localStartSec + segment.offsetSec) * pixelsPerSecond
        const width = Math.max(1, (segment.localEndSec - segment.localStartSec) * pixelsPerSecond)
        const segmentPeaks = peaks
          ? peaks.slice(
              Math.floor(segment.localStartSec * WAVEFORM_BUCKETS_PER_SEC),
              Math.ceil(segment.localEndSec * WAVEFORM_BUCKETS_PER_SEC)
            )
          : []

        return (
          <div
            key={segment.id}
            className="source-lane__segment"
            style={{ left, width, borderColor: color }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const localOffsetSec = (e.clientX - rect.left) / pixelsPerSecond
              onWaveformClick(segment.localStartSec + segment.offsetSec + localOffsetSec)
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
      })}

      {source.syncSegments.flatMap((segment) => {
        const segStart = segment.localStartSec + segment.offsetSec
        const segEnd = segment.localEndSec + segment.offsetSec
        const activeRanges: Array<[number, number]> = ownBlocks.map(({ iv }) => [
          iv.startSec,
          iv.endSec
        ])
        const inactiveRanges = subtractRanges([segStart, segEnd], activeRanges)
        return inactiveRanges.map(([rangeStart, rangeEnd]) => (
          <div
            key={`${segment.id}-inactive-${rangeStart}`}
            className="source-lane__inactive-range"
            style={{
              left: rangeStart * pixelsPerSecond,
              width: Math.max(1, (rangeEnd - rangeStart) * pixelsPerSecond)
            }}
          />
        ))
      })}

      {source.hardCutMarkers.map((markerLocalSec) => {
        const containing = source.syncSegments.find(
          (s) => markerLocalSec >= s.localStartSec && markerLocalSec <= s.localEndSec
        )
        if (!containing) return null
        const left = (markerLocalSec + containing.offsetSec) * pixelsPerSecond
        return (
          <div
            key={markerLocalSec}
            className="source-lane__hardcut"
            style={{ left }}
            title="Hard-Cut erkannt"
          />
        )
      })}
    </div>
  )
}

export default SourceLaneTrack
