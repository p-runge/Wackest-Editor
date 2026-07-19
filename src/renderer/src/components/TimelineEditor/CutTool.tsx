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
}

function CutTool({
  project,
  playheadSec,
  splitKeptRangeAtPlayhead,
  deleteKeptRange
}: CutToolProps): React.JSX.Element {
  const rangeAtPlayhead = findKeptRangeAt(project.edit.keptRanges, playheadSec)

  const handleSplit = useCallback((): void => {
    void splitKeptRangeAtPlayhead(playheadSec)
  }, [playheadSec, splitKeptRangeAtPlayhead])

  const handleDelete = useCallback((): void => {
    if (rangeAtPlayhead) void deleteKeptRange(rangeAtPlayhead.id)
  }, [rangeAtPlayhead, deleteKeptRange])

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
          disabled={!rangeAtPlayhead}
          title="Segment am Abspielkopf löschen (Entf)"
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
      </p>
    </div>
  )
}

export default CutTool
