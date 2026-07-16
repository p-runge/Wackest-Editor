import type { KeptRange } from '@shared/types/project'

interface CutLaneProps {
  keptRanges: KeptRange[]
  pixelsPerSecond: number
  trackWidthPx: number
  isRazorMode: boolean
  onClick: (atSec: number) => void
  onDelete: (rangeId: string) => void
}

function CutLane({
  keptRanges,
  pixelsPerSecond,
  trackWidthPx,
  isRazorMode,
  onClick,
  onDelete
}: CutLaneProps): React.JSX.Element {
  return (
    <div className="cut-lane">
      <div className="cut-lane__label">Schnitt</div>
      <div
        className={`cut-lane__track ${isRazorMode ? 'cut-lane__track--razor' : ''}`}
        style={{ width: trackWidthPx }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          onClick((e.clientX - rect.left) / pixelsPerSecond)
        }}
      >
        {keptRanges.map((range) => (
          <div
            key={range.id}
            className="cut-lane__block"
            style={{
              left: range.startSec * pixelsPerSecond,
              width: Math.max(1, (range.endSec - range.startSec) * pixelsPerSecond)
            }}
          >
            <button
              className="cut-lane__delete"
              title="Bereich aus Export entfernen"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(range.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default CutLane
