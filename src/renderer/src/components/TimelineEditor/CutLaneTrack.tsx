import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  DndContext,
  useDraggable,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import type { KeptRange } from '@shared/types/project'
import {
  computeCutLaneSegments,
  resolveMovePlacement,
  resolveGroupMovePlacement,
  type CutLaneSegment
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
  /** A plain click landed on empty/cut background (not on a chunk, not a drag) — clears the
   *  selection, same as clicking empty canvas in most selection UIs. */
  onClearSelection: () => void
  /** Drop a whole selected group at the leader's proposed position, same resolver as the live
   *  preview (`resolveGroupMovePlacement`). */
  onMoveRanges: (selectedIds: Set<string>, leaderId: string, newLeaderStartSec: number) => void
  onDeleteRanges: (ids: Set<string>) => void
}

// Below this many pixels of pointer travel, a pointer-down/up is treated as a plain click (seek)
// rather than a drag — mirrored into dnd-kit's PointerSensor activation constraint below, so
// chunk-dragging and the background cut/marquee gestures agree on what counts as "a drag".
const DRAG_ACTIVATION_DISTANCE_PX = 4

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
  /** Raw desired position from the pointer — the resolver turns this into the actual layout. */
  proposedStartSec: number
}

interface CutLaneChunkProps {
  segment: CutLaneSegment
  /** Where to actually draw this chunk. Equal to `segment.startSec` for every chunk except the
   *  one currently being dragged — that one stays anchored at its pre-drag position here and
   *  moves purely via dnd-kit's own `transform` instead (see the comment on `transform` below for
   *  why mixing the two approaches on the same node doesn't work). */
  renderStartSec: number
  pixelsPerSecond: number
  interactive: boolean
  isSelected: boolean
  isDraggedChunk: boolean
  isPushedAside: boolean
  selectedIds: Set<string>
  onSelectChunk: (id: string, mode: 'replace' | 'toggle' | 'range') => void
  onSeek: (atSec: number) => void
  onDelete: (id: string) => void
  onDeleteRanges: (ids: Set<string>) => void
}

/**
 * One kept chunk's own body — a dnd-kit draggable. dnd-kit owns the actual drag mechanics (pointer
 * activation distance, keyboard pick-up/move/drop, Escape-to-cancel, and suppressing the ghost
 * click a browser fires after a real drag) instead of a hand-rolled pointer-event state machine;
 * this component only decides *which* gesture a pointer-down means. Non-dragged chunks (pushed
 * neighbors, other members of a group move) render at the live resolved preview position
 * `CutLaneTrack` computed for them (see `previewRanges` there) same as before.
 */
function CutLaneChunk({
  segment,
  renderStartSec,
  pixelsPerSecond,
  interactive,
  isSelected,
  isDraggedChunk,
  isPushedAside,
  selectedIds,
  onSelectChunk,
  onSeek,
  onDelete,
  onDeleteRanges
}: CutLaneChunkProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: segment.id,
    disabled: !interactive
  })

  // Cmd/Ctrl-click and Shift-click are discrete selection toggles, not drag gestures — intercept
  // them (and stop propagation to the track background below) before dnd-kit's own pointerdown
  // listener ever sees the event, so they can never turn into a drag. A plain pointerdown is
  // handed off to dnd-kit, which decides for itself (via the activation distance) whether it
  // becomes a drag or falls through to the click handler below.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.metaKey || e.ctrlKey) {
      e.stopPropagation()
      onSelectChunk(segment.id, 'toggle')
      return
    }
    if (e.shiftKey) {
      e.stopPropagation()
      onSelectChunk(segment.id, 'range')
      return
    }
    e.stopPropagation()
    listeners?.onPointerDown?.(e)
  }

  // Only fires for a genuine click — dnd-kit swallows the trailing click event once a pointer
  // gesture actually crossed the drag activation distance, so this never double-fires with a drop.
  const handleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    // Cmd/Ctrl/Shift clicks already applied their selection effect in pointerdown above (toggle/
    // range) — the browser still fires a plain 'click' afterward regardless, which must only seek
    // here, not also collapse what pointerdown just built.
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      onSeek(segment.startSec)
      return
    }
    // A plain click always collapses the selection down to just this chunk, even if it was
    // already part of a multi-selection — only *dragging* an already-selected chunk keeps the
    // whole group together; a click that never turned into a drag always means "select just this".
    onSelectChunk(segment.id, 'replace')
    onSeek(segment.startSec)
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      className={`cut-lane__segment${interactive ? ' cut-lane__segment--interactive' : ''}${isDraggedChunk ? ' cut-lane__segment--drag-preview' : ''}${isPushedAside ? ' cut-lane__segment--pushed' : ''}${isSelected ? ' cut-lane__segment--selected' : ''}`}
      style={{
        left: renderStartSec * pixelsPerSecond,
        width: Math.max(1, (segment.endSec - segment.startSec) * pixelsPerSecond),
        // Only ever non-null for the actively-dragged chunk. dnd-kit expects this node's *layout*
        // position (left, above) to stay put during the drag and conveys pointer movement purely
        // through this transform — internally it re-measures the node's rect to account for
        // legitimate external shifts (e.g. a sortable list reordering around it) and folds any
        // change back into the pointer delta it reports next; if we *also* move the node via
        // `left` every tick (to show the live snap/cascade preview on the dragged node itself,
        // like the old hand-rolled implementation did), that measurement mechanism reads our own
        // update as such a shift and fights it, and the drag never gets anywhere. Only the dragged
        // node needs this — every other chunk (pushed neighbors, other members of a group move)
        // isn't being tracked by dnd-kit this drag, so repositioning them via `left` is safe.
        transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined
      }}
      title={`Behaltener Abschnitt (${segment.startSec.toFixed(1)}s–${segment.endSec.toFixed(1)}s) — ziehen (Maus oder Pfeiltasten), um alle Spuren gemeinsam zu verschieben`}
      onPointerDown={interactive ? handlePointerDown : undefined}
      onClick={interactive ? handleClick : undefined}
    >
      {interactive && (
        <button
          type="button"
          className="cut-lane__delete"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
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
  onClearSelection,
  onMoveRanges,
  onDeleteRanges
}: CutLaneTrackProps): React.JSX.Element {
  const [cutDrag, setCutDrag] = useState<CutDragState | null>(null)
  const [marqueeDrag, setMarqueeDrag] = useState<MarqueeDragState | null>(null)
  const [moveDrag, setMoveDrag] = useState<MoveDragState | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX }
    }),
    useSensor(KeyboardSensor)
  )

  // Dragging any chunk that's already part of a multi-selection moves the whole group together;
  // dragging a chunk outside the current selection is always a single-chunk move (dragStart below
  // collapses the selection to just that chunk first, so this stays in sync with it).
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
  // a gesture that started on a kept chunk's own body — that stops propagation, so the two can't
  // be triggered by the same pointer-down.
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
      const moved = Math.abs(e.clientX - marqueeDrag.startClientX) >= DRAG_ACTIVATION_DISTANCE_PX
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
    const moved = Math.abs(e.clientX - cutDrag.startClientX) >= DRAG_ACTIVATION_DISTANCE_PX
    if (moved && interactive) {
      onCutRange(
        Math.min(cutDrag.startAtSec, cutDrag.currentAtSec),
        Math.max(cutDrag.startAtSec, cutDrag.currentAtSec)
      )
    } else if (!moved) {
      onSeek(cutDrag.startAtSec)
      // Clicked empty/cut background rather than a chunk — clear any selection, same as
      // clicking outside a selection in most other selection UIs.
      if (selectedIds.size > 0) onClearSelection()
    }
    setCutDrag(null)
  }

  // Chunk drag lifecycle — dnd-kit calls these for both pointer- and keyboard-initiated drags.
  const handleDragStart = (event: DragStartEvent): void => {
    const id = String(event.active.id)
    const range = keptRanges.find((r) => r.id === id)
    if (!range) return
    // Grabbing a chunk that isn't part of the current selection collapses the selection down to
    // just that chunk first, so a plain drag on an unselected chunk is always a single-chunk
    // move — only dragging a chunk that's already selected moves the whole group.
    if (!selectedIds.has(id)) onSelectChunk(id, 'replace')
    setMoveDrag({ id, originalStartSec: range.startSec, proposedStartSec: range.startSec })
  }

  const handleDragMove = (event: DragMoveEvent): void => {
    if (!moveDrag) return
    const deltaSec = event.delta.x / pixelsPerSecond
    setMoveDrag({ ...moveDrag, proposedStartSec: moveDrag.originalStartSec + deltaSec })
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    if (!moveDrag) return
    const deltaSec = event.delta.x / pixelsPerSecond
    const proposedStartSec = moveDrag.originalStartSec + deltaSec
    if (isGroupDrag) {
      onMoveRanges(selectedIds, moveDrag.id, proposedStartSec)
    } else {
      onMoveRange(moveDrag.id, proposedStartSec)
    }
    setMoveDrag(null)
  }

  const handleDragCancel = (): void => {
    setMoveDrag(null)
  }

  return (
    <DndContext
      sensors={sensors}
      modifiers={[restrictToHorizontalAxis]}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        className="cut-lane__track"
        style={{ height: CUT_LANE_HEIGHT_PX, width: trackWidthPx }}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleTrackPointerMove}
        onPointerUp={handleTrackPointerUp}
      >
        {segments.map((segment) => {
          if (!segment.kept) {
            return (
              <div
                key={segment.id}
                className="cut-lane__segment cut-lane__segment--cut"
                style={{
                  left: segment.startSec * pixelsPerSecond,
                  width: Math.max(1, (segment.endSec - segment.startSec) * pixelsPerSecond)
                }}
                title={`Herausgeschnitten (${segment.startSec.toFixed(1)}s–${segment.endSec.toFixed(1)}s)`}
              />
            )
          }
          const isDraggedChunk = moveDrag?.id === segment.id
          const isPushedAside =
            moveDrag !== null &&
            !isDraggedChunk &&
            committedStartById.get(segment.id) !== segment.startSec
          const renderStartSec = isDraggedChunk
            ? (committedStartById.get(segment.id) ?? segment.startSec)
            : segment.startSec
          return (
            <CutLaneChunk
              key={segment.id}
              segment={segment}
              renderStartSec={renderStartSec}
              pixelsPerSecond={pixelsPerSecond}
              interactive={interactive}
              isSelected={selectedIds.has(segment.id)}
              isDraggedChunk={isDraggedChunk}
              isPushedAside={isPushedAside}
              selectedIds={selectedIds}
              onSelectChunk={onSelectChunk}
              onSeek={onSeek}
              onDelete={onDelete}
              onDeleteRanges={onDeleteRanges}
            />
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
    </DndContext>
  )
}

export default CutLaneTrack
