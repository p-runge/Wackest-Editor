import { useCallback, useEffect } from 'react'
import { Scissors, SplitSquareHorizontal } from 'lucide-react'
import type { Project } from '@shared/types/project'
import { findKeptRangeAt } from '../../lib/timeline-edit'
import { isTypingTarget } from '../../lib/dom'

interface CutToolProps {
  project: Project
  playheadSec: number
  splitKeptRangeAtPlayhead: (atSec: number) => Promise<void>
  deleteKeptRange: (id: string) => Promise<void>
  selectedRangeIds: Set<string>
  deleteKeptRanges: (ids: Set<string>) => Promise<void>
  onSelectAllRanges: () => void
}

function CutTool({
  project,
  playheadSec,
  splitKeptRangeAtPlayhead,
  deleteKeptRange,
  selectedRangeIds,
  deleteKeptRanges,
  onSelectAllRanges
}: CutToolProps): React.JSX.Element {
  const rangeAtPlayhead = findKeptRangeAt(project.edit.keptRanges, playheadSec)

  const handleSplit = useCallback((): void => {
    void splitKeptRangeAtPlayhead(playheadSec)
  }, [playheadSec, splitKeptRangeAtPlayhead])

  // A non-empty selection takes priority over the playhead-based single delete — once you've
  // selected several chunks, Backspace/Entf and the trash icon should act on all of them.
  const handleDelete = useCallback((): void => {
    if (selectedRangeIds.size > 0) void deleteKeptRanges(selectedRangeIds)
    else if (rangeAtPlayhead) void deleteKeptRange(rangeAtPlayhead.id)
  }, [selectedRangeIds, deleteKeptRanges, rangeAtPlayhead, deleteKeptRange])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
      if (isTypingTarget(document.activeElement)) return
      if (e.code === 'KeyS') {
        e.preventDefault()
        handleSplit()
      } else if (e.code === 'Backspace' || e.code === 'Delete') {
        e.preventDefault()
        handleDelete()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSplit, handleDelete])

  // Cmd/Ctrl+A is a standard Cocoa/Chromium responder action intercepted before any keydown DOM
  // event reaches the renderer, so it can only be observed via the application-menu accelerator
  // forwarded over IPC (see main/index.ts and preload's `menu.onSelectAll`) — same reasoning as
  // undo/redo. Only mounted while the Cut tool is active, so Cmd/Ctrl+A elsewhere is a no-op here
  // (the text-field select-all fallback lives in useGlobalShortcuts instead, always mounted).
  useEffect(() => {
    return window.api.menu.onSelectAll(() => {
      if (isTypingTarget(document.activeElement)) return
      onSelectAllRanges()
    })
  }, [onSelectAllRanges])

  return (
    <div className="flex flex-col gap-2 p-2.5">
      <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
        <span className="text-xs text-muted-foreground">
          Abspielkopf:{' '}
          <span
            className={
              rangeAtPlayhead ? 'font-medium text-foreground' : 'font-medium text-destructive'
            }
          >
            {rangeAtPlayhead ? 'in einem Highlight' : 'außerhalb (bereits herausgeschnitten)'}
          </span>
        </span>
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={handleSplit}
          title="Am Abspielkopf teilen (S)"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border/80 bg-background/60 px-2 py-1.5 text-xs text-foreground/90 transition-colors hover:border-border hover:bg-accent"
        >
          <SplitSquareHorizontal className="size-3.5" />
          Teilen
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={selectedRangeIds.size === 0 && !rangeAtPlayhead}
          title={
            selectedRangeIds.size > 1
              ? `${selectedRangeIds.size} ausgewählte Abschnitte löschen (Entf)`
              : selectedRangeIds.size === 1
                ? 'Ausgewählten Abschnitt löschen (Entf)'
                : 'Segment am Abspielkopf löschen (Entf)'
          }
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border/80 bg-background/60 px-2 py-1.5 text-xs text-foreground/90 transition-colors hover:border-border hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
        >
          <Scissors className="size-3.5" />
          Löschen
        </button>
      </div>

      <p className="border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
        Teilen (S) schneidet alle Spuren gemeinsam. Ziehe einen Abschnitt auf der Schnitt-Spur, um
        ihn mitsamt Video, Audio, Untertiteln und Heatmap an eine andere Stelle zu verschieben —
        seine Position auf der Zeitleiste bestimmt, wann er abgespielt/exportiert wird. Ziehen auf
        leerem Bereich schneidet den markierten Bereich heraus; Papierkorb oder Entf löscht einen
        Abschnitt ganz (leerer Bereich bleibt). Rückgängig mit Cmd/Strg+Z.
        <br />
        Mehrfachauswahl: Cmd/Strg-Klick togglet einen Abschnitt, Shift-Klick wählt einen Bereich,
        Shift-Ziehen auf leerem Bereich zieht einen Auswahlrahmen, Cmd/Strg+A wählt alle.
        Ausgewählte Abschnitte werden gemeinsam verschoben oder gelöscht.
      </p>
    </div>
  )
}

export default CutTool
