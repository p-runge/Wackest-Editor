import type { HeatmapPoint } from '@shared/types/project'
import { colorForScore } from '../../lib/colors'
import { SIMPLE_LANE_HEIGHT_PX } from './constants'

interface HeatmapLaneTrackProps {
  heatmap: HeatmapPoint[]
  pixelsPerSecond: number
  trackWidthPx: number
}

function HeatmapLaneTrack({
  heatmap,
  pixelsPerSecond,
  trackWidthPx
}: HeatmapLaneTrackProps): React.JSX.Element {
  return (
    <div
      className="heatmap-lane__track"
      style={{ height: SIMPLE_LANE_HEIGHT_PX, width: trackWidthPx }}
    >
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
  )
}

export default HeatmapLaneTrack
