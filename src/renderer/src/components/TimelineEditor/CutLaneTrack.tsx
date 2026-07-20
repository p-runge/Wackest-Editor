import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { KeptRange } from '@shared/types/project'
import {
  computeCutLaneSegments,
  resolveMovePlacement,
  resolveGroupMovePlacement
} from '../../lib/timeline-edit'
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
  /** Currently selected chunk ids — drives the `--selected` highlight and which chunks a group
   *  drag/delete acts on. */
  selectedIds: Set<string>
  /** A chunk was clicked with a given modifier combo; the caller owns the actual set bookkeeping
   *  (toggle/range/replace), this component only decides which mode a click means. */
  onSelectChunk: (id: string, mode: 'replace' | 'toggle' | 'range') => void
  /** Shift-drag over empty/cut background finished: replace the selection with every chunk the
   *  marquee box overlapped. */
  onMarqueeSelect: (ids: string[]) => void
  /** Drop a whole selected group at the leader's proposed position, same resolver as the live
   *  preview (`resolveGroupMovePlacement`). */
  onMoveRanges: (selectedIds: Set<string>, leaderId: string, newLeaderStartSec: number) => void
  onDeleteRanges: (ids: Set<string>) => void
}

// Below this many pixels of pointer travel, a pointer-down/up is treated as a plain click (seek)
// rather than a drag.
const DRAG_THRESHOLD_PX = 4

interface CutDragState {
  startAtSec: number
  startClientX: number
  currentAtSec: number
}

interface MarqueeDragState {
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
  onDelete,
  selectedIds,
  onSelectChunk,
  onMarqueeSelect,
  onMoveRanges,
  onDeleteRanges
}: CutLaneTrackProps): React.JSX.Element {
  const [cutDrag, setCutDrag] = useState<CutDragState | null>(null)
  const [marqueeDrag, setMarqueeDrag] = useState<MarqueeDragState | null>(null)
  const [moveDrag, setMoveDrag] = useState<MoveDragState | null>(null)

  // Dragging any chunk that's already part of a multi-selection moves the whole group together;
  // dragging a chunk outside the current selection is always a single-chunk move (its pointerdown
  // handler collapses the selection to just that chunk first, so this stays in sync with it).
  const isGroupDrag = moveDrag !== null && selectedIds.size > 1 && selectedIds.has(moveDrag.id)

  // While a chunk is being dragged, render the RESOLVED layout live — the dragged chunk visibly
  // snaps against neighbors / hops over them, and any chunk that would get pushed aside is shown
  // at its would-be position. Dropping commits exactly this layout (same resolver in the store).
  const previewRanges = moveDrag
    ? isGroupDrag
      ? resolveGroupMovePlacement(keptRanges, selectedIds, moveDrag.id, moveDrag.proposedStartSec)
      : resolveMovePlacement(keptRanges, moveDrag.id, moveDrag.proposedStartSec)
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
    if (e.shiftKey && interactive) {
      setMarqueeDrag({ startAtSec, startClientX: e.clientX, currentAtSec: startAtSec })
      return
    }
    setCutDrag({ startAtSec, startClientX: e.clientX, currentAtSec: startAtSec })
  }

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (marqueeDrag) {
      setMarqueeDrag({ ...marqueeDrag, currentAtSec: atSecFromClientX(e) })
      return
    }
    if (!cutDrag) return
    setCutDrag({ ...cutDrag, currentAtSec: atSecFromClientX(e) })
  }

  const handleTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (marqueeDrag) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      const moved = Math.abs(e.clientX - marqueeDrag.startClientX) >= DRAG_THRESHOLD_PX
      if (moved) {
        const from = Math.min(marqueeDrag.startAtSec, marqueeDrag.currentAtSec)
        const to = Math.max(marqueeDrag.startAtSec, marqueeDrag.currentAtSec)
        const ids = keptRanges.filter((r) => r.startSec < to && r.endSec > from).map((r) => r.id)
        onMarqueeSelect(ids)
      }
      setMarqueeDrag(null)
      return
    }
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
    // Cmd/Ctrl-click and Shift-click are discrete selection toggles, not drag gestures — they
    // never start a move, matching Finder/Premiere convention.
    if (e.metaKey || e.ctrlKey) {
      onSelectChunk(segmentId, 'toggle')
      return
    }
    if (e.shiftKey) {
      onSelectChunk(segmentId, 'range')
      return
    }
    // Grabbing a chunk that isn't part of the current selection collapses the selection down to
    // just that chunk first, so a plain drag on an unselected chunk is always a single-chunk
    // move — only dragging a chunk that's already selected moves the whole group.
    if (!selectedIds.has(segmentId)) {
      onSelectChunk(segmentId, 'replace')
    }
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
      if (isGroupDrag) {
        onMoveRanges(selectedIds, moveDrag.id, moveDrag.proposedStartSec)
      } else {
        onMoveRange(moveDrag.id, moveDrag.proposedStartSec)
      }
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
        const isSelected = segment.kept && selectedIds.has(segment.id)
        return (
          <div
            key={segment.id}
            className={`cut-lane__segment${segment.kept ? '' : ' cut-lane__segment--cut'}${interactive && segment.kept ? ' cut-lane__segment--interactive' : ''}${isDraggedChunk ? ' cut-lane__segment--drag-preview' : ''}${isPushedAside ? ' cut-lane__segment--pushed' : ''}${isSelected ? ' cut-lane__segment--selected' : ''}`}
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
                onClick={() => {
                  if (isSelected && selectedIds.size > 1) {
                    onDeleteRanges(selectedIds)
                  } else {
                    onDelete(segment.id)
                  }
                }}
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

      {marqueeDrag && interactive && (
        <div
          className="cut-lane__marquee-selection"
          style={{
            left: Math.min(marqueeDrag.startAtSec, marqueeDrag.currentAtSec) * pixelsPerSecond,
            width: Math.max(
              1,
              Math.abs(marqueeDrag.currentAtSec - marqueeDrag.startAtSec) * pixelsPerSecond
            )
          }}
        />
      )}
    </div>
  )
}

export default CutLaneTrack
