import { useState } from 'react'
import type { SourceClip, TrackInterval } from '@shared/types/project'
import { colorForSourceId } from '../../lib/colors'

interface IntervalLaneProps {
  label: string
  intervals: TrackInterval[]
  sources: SourceClip[]
  pixelsPerSecond: number
  trackWidthPx: number
  onMoveBoundary?: (leftIntervalId: string, atSec: number) => void
}

interface DragState {
  leftIntervalId: string
  rightIntervalId: string
  minSec: number
  maxSec: number
  atSec: number
}

const MIN_GAP_SEC = 0.05

function IntervalLane({
  label,
  intervals,
  sources,
  pixelsPerSecond,
  trackWidthPx,
  onMoveBoundary
}: IntervalLaneProps): React.JSX.Element {
  const [drag, setDrag] = useState<DragState | null>(null)
  const sourceIds = sources.map((s) => s.id)
  const sourceLabel = (id: string): string => sources.find((s) => s.id === id)?.label ?? id

  const sorted = [...intervals].sort((a, b) => a.startSec - b.startSec)

  const displayIntervals = sorted.map((iv) => {
    if (!drag) return iv
    if (iv.id === drag.leftIntervalId) return { ...iv, endSec: drag.atSec }
    if (iv.id === drag.rightIntervalId) return { ...iv, startSec: drag.atSec }
    return iv
  })

  const startDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    left: TrackInterval,
    right: TrackInterval
  ): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({
      leftIntervalId: left.id,
      rightIntervalId: right.id,
      minSec: left.startSec + MIN_GAP_SEC,
      maxSec: right.endSec - MIN_GAP_SEC,
      atSec: left.endSec
    })
  }

  const updateDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag) return
    const track = e.currentTarget.closest('.interval-lane__track')
    if (!track) return
    const rect = track.getBoundingClientRect()
    const atSec = (e.clientX - rect.left) / pixelsPerSecond
    setDrag({ ...drag, atSec: Math.min(Math.max(atSec, drag.minSec), drag.maxSec) })
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    onMoveBoundary?.(drag.leftIntervalId, drag.atSec)
    setDrag(null)
  }

  return (
    <div className="interval-lane">
      <div className="interval-lane__label">{label}</div>
      <div className="interval-lane__track" style={{ width: trackWidthPx }}>
        {displayIntervals.map((interval) => (
          <div
            key={interval.id}
            className="interval-lane__block"
            style={{
              left: interval.startSec * pixelsPerSecond,
              width: Math.max(1, (interval.endSec - interval.startSec) * pixelsPerSecond),
              backgroundColor: colorForSourceId(interval.value, sourceIds)
            }}
            title={`${sourceLabel(interval.value)} (${interval.startSec.toFixed(1)}s–${interval.endSec.toFixed(1)}s)`}
          >
            <span>{sourceLabel(interval.value)}</span>
          </div>
        ))}

        {onMoveBoundary &&
          sorted.slice(0, -1).map((left, i) => {
            const right = sorted[i + 1]
            const boundarySec = drag && drag.leftIntervalId === left.id ? drag.atSec : left.endSec
            return (
              <div
                key={`boundary-${left.id}`}
                className="group absolute top-0 z-10 -ml-1.5 h-full w-3 cursor-col-resize"
                style={{ left: boundarySec * pixelsPerSecond }}
                onPointerDown={(e) => startDrag(e, left, right)}
                onPointerMove={updateDrag}
                onPointerUp={endDrag}
              >
                <div className="mx-auto h-full w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-foreground/70" />
              </div>
            )
          })}
      </div>
    </div>
  )
}

export default IntervalLane
