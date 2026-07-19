import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { KeptRange } from '@shared/types/project'
import { computeCutLaneSegments, resolveMovePlacement } from '../../lib/timeline-edit'
import { CUT_LANE_HEIGHT_PX } from './constants'

interface CutLaneTrackProps {
  keptRanges: KeptRange[]
  /** End of the visible program axis (last chunk end + drag headroom) — bounds pointer-to-time
   *  conversion and the trailing cut-gap rendering; NOT a placement limit (the axis grows). */
  axisEndSec: number
  pixelsPerSecond: number
  trackWidthPx: number
  /** Whether Schnitt is the active tool — gates drag-to-cut, drag-to-move, and delete. Plain
   *  click-to-seek stays available either way, same as the other lanes. */
  interactive: boolean
  onSeek: (atSec: number) => void
  /** Click-and-drag across empty/cut background: cut exactly the dragged span in one step, across
   *  the whole timeline (all tracks at once) — only wired up while `interactive`. */
  onCutRange: (startSec: number, endSec: number) => void
  /** Drop a chunk at a proposed position; the store resolves it with the exact same
   *  `resolveMovePlacement` used for the live preview, so what was shown is what happens. */
  onMoveRange: (id: string, newStartSec: number) => void
  onDelete: (id: string) => void
}

// Below this many pixels of pointer travel, a pointer-down/up is treated as a plain click (seek)
// rather than a drag.
const DRAG_THRESHOLD_PX = 4

interface CutDragState {
  startAtSec: number
  startClientX: number
  currentAtSec: number
}

interface MoveDragState {
  id: string
  originalStartSec: number
  startClientX: number
  /** Raw desired position from the pointer — the resolver turns this into the actual layout. */
  proposedStartSec: number
}

function CutLaneTrack({
  keptRanges,
  axisEndSec,
  pixelsPerSecond,
  trackWidthPx,
  interactive,
  onSeek,
  onCutRange,
  onMoveRange,
  onDelete
}: CutLaneTrackProps): React.JSX.Element {
  const [cutDrag, setCutDrag] = useState<CutDragState | null>(null)
  const [moveDrag, setMoveDrag] = useState<MoveDragState | null>(null)

  // While a chunk is being dragged, render the RESOLVED layout live — the dragged chunk visibly
  // snaps against neighbors / hops over them, and any chunk that would get pushed aside is shown
  // at its would-be position. Dropping commits exactly this layout (same resolver in the store).
  const previewRanges = moveDrag
    ? resolveMovePlacement(keptRanges, moveDrag.id, moveDrag.proposedStartSec)
    : keptRanges
  const committedStartById = new Map(keptRanges.map((r) => [r.id, r.startSec]))
  const segments = computeCutLaneSegments(previewRanges, axisEndSec)

  // Track-level: click-to-seek / drag-to-cut on empty or already-cut background. Never fires for
  // a gesture that started on a kept chunk's own body — that stops propagation and runs the move
  // gesture below instead, so the two can't be triggered by the same pointer-down.
  const atSecFromClientX = (e: React.PointerEvent<HTMLDivElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect()
    const raw = (e.clientX - rect.left) / pixelsPerSecond
    return Math.min(Math.max(raw, 0), axisEndSec)
  }

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const startAtSec = atSecFromClientX(e)
    setCutDrag({ startAtSec, startClientX: e.clientX, currentAtSec: startAtSec })
  }

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!cutDrag) return
    setCutDrag({ ...cutDrag, currentAtSec: atSecFromClientX(e) })
  }

  const handleTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!cutDrag) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const moved = Math.abs(e.clientX - cutDrag.startClientX) >= DRAG_THRESHOLD_PX
    if (moved && interactive) {
      onCutRange(
        Math.min(cutDrag.startAtSec, cutDrag.currentAtSec),
        Math.max(cutDrag.startAtSec, cutDrag.currentAtSec)
      )
    } else if (!moved) {
      onSeek(cutDrag.startAtSec)
    }
    setCutDrag(null)
  }

  // Kept chunk body: click-to-seek / drag-to-reposition the whole cross-track chunk. Only
  // attached while interactive — when not, pointer-down simply bubbles to the track above, which
  // reduces to a plain seek there (drag-to-cut is itself gated on `interactive`).
  const handleChunkPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    segmentId: string,
    segmentStartSec: number
  ): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setMoveDrag({
      id: segmentId,
      originalStartSec: segmentStartSec,
      startClientX: e.clientX,
      proposedStartSec: segmentStartSec
    })
  }

  const handleChunkPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!moveDrag) return
    const deltaSec = (e.clientX - moveDrag.startClientX) / pixelsPerSecond
    setMoveDrag({ ...moveDrag, proposedStartSec: moveDrag.originalStartSec + deltaSec })
  }

  const handleChunkPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!moveDrag) return
    e.stopPropagation()
    e.currentTarget.releasePointerCapture(e.pointerId)
    const moved = Math.abs(e.clientX - moveDrag.startClientX) >= DRAG_THRESHOLD_PX
    if (moved) {
      onMoveRange(moveDrag.id, moveDrag.proposedStartSec)
    } else {
      onSeek(moveDrag.originalStartSec)
    }
    setMoveDrag(null)
  }

  return (
    <div
      className="cut-lane__track"
      style={{ height: CUT_LANE_HEIGHT_PX, width: trackWidthPx }}
      onPointerDown={handleTrackPointerDown}
      onPointerMove={handleTrackPointerMove}
      onPointerUp={handleTrackPointerUp}
    >
      {segments.map((segment) => {
        const isDraggedChunk = moveDrag?.id === segment.id
        const isPushedAside =
          moveDrag !== null &&
          segment.kept &&
          !isDraggedChunk &&
          committedStartById.get(segment.id) !== segment.startSec
        return (
          <div
            key={segment.id}
            className={`cut-lane__segment${segment.kept ? '' : ' cut-lane__segment--cut'}${interactive && segment.kept ? ' cut-lane__segment--interactive' : ''}${isDraggedChunk ? ' cut-lane__segment--drag-preview' : ''}${isPushedAside ? ' cut-lane__segment--pushed' : ''}`}
            style={{
              left: segment.startSec * pixelsPerSecond,
              width: Math.max(1, (segment.endSec - segment.startSec) * pixelsPerSecond)
            }}
            title={
              segment.kept
                ? `Behaltener Abschnitt (${segment.startSec.toFixed(1)}s–${segment.endSec.toFixed(1)}s) — ziehen, um alle Spuren gemeinsam zu verschieben`
                : `Herausgeschnitten (${segment.startSec.toFixed(1)}s–${segment.endSec.toFixed(1)}s)`
            }
            onPointerDown={
              interactive && segment.kept
                ? (e) => handleChunkPointerDown(e, segment.id, segment.startSec)
                : undefined
            }
            onPointerMove={interactive && segment.kept ? handleChunkPointerMove : undefined}
            onPointerUp={interactive && segment.kept ? handleChunkPointerUp : undefined}
          >
            {interactive && segment.kept && (
              <button
                type="button"
                className="cut-lane__delete"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onDelete(segment.id)}
                title="Abschnitt löschen"
              >
                <Trash2 className="size-2.5" />
              </button>
            )}
          </div>
        )
      })}

      {cutDrag && interactive && (
        <div
          className="cut-lane__drag-selection"
          style={{
            left: Math.min(cutDrag.startAtSec, cutDrag.currentAtSec) * pixelsPerSecond,
            width: Math.max(
              1,
              Math.abs(cutDrag.currentAtSec - cutDrag.startAtSec) * pixelsPerSecond
            )
          }}
        />
      )}
    </div>
  )
}

export default CutLaneTrack
