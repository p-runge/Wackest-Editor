import type { SourceClip, TrackInterval } from '@shared/types/project'
import { colorForSourceId } from '../../lib/colors'

interface IntervalLaneProps {
  label: string
  intervals: TrackInterval[]
  sources: SourceClip[]
  pixelsPerSecond: number
  trackWidthPx: number
}

function IntervalLane({
  label,
  intervals,
  sources,
  pixelsPerSecond,
  trackWidthPx
}: IntervalLaneProps): React.JSX.Element {
  const sourceIds = sources.map((s) => s.id)
  const sourceLabel = (id: string): string => sources.find((s) => s.id === id)?.label ?? id

  return (
    <div className="interval-lane">
      <div className="interval-lane__label">{label}</div>
      <div className="interval-lane__track" style={{ width: trackWidthPx }}>
        {intervals.map((interval) => (
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
      </div>
    </div>
  )
}

export default IntervalLane
