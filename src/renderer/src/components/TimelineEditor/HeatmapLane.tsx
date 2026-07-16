import type { HeatmapPoint } from '@shared/types/project'
import { colorForScore } from '../../lib/colors'

interface HeatmapLaneProps {
  heatmap: HeatmapPoint[]
  pixelsPerSecond: number
  trackWidthPx: number
}

function HeatmapLane({
  heatmap,
  pixelsPerSecond,
  trackWidthPx
}: HeatmapLaneProps): React.JSX.Element {
  return (
    <div className="heatmap-lane">
      <div className="heatmap-lane__label">Heatmap</div>
      <div className="heatmap-lane__track" style={{ width: trackWidthPx }}>
        {heatmap.map((point, i) => (
          <div
            key={i}
            className="heatmap-lane__bucket"
            style={{
              left: point.startSec * pixelsPerSecond,
              width: Math.max(1, (point.endSec - point.startSec) * pixelsPerSecond),
              backgroundColor: colorForScore(point.score)
            }}
            title={`Score ${point.score.toFixed(2)}${point.reason ? `\n${point.reason}` : ''}`}
          />
        ))}
      </div>
    </div>
  )
}

export default HeatmapLane
