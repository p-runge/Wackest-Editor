import type { HeatmapPoint } from '@shared/types/project'
import { colorForScore } from '../../lib/colors'
import { findHeatmapPeakIndices } from '../../lib/heatmap'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
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
  const peakIndices = findHeatmapPeakIndices(heatmap)

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className="heatmap-lane__track"
        style={{ height: SIMPLE_LANE_HEIGHT_PX, width: trackWidthPx }}
      >
        {heatmap.map((point, i) => {
          const left = point.startSec * pixelsPerSecond
          const width = Math.max(1, (point.endSec - point.startSec) * pixelsPerSecond)
          const isPeak = peakIndices.has(i)
          return (
            <div
              key={i}
              className="heatmap-lane__bucket"
              style={{ left, width, backgroundColor: colorForScore(point.score) }}
              title={isPeak ? undefined : `Score ${point.score.toFixed(2)}`}
            >
              {isPeak && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="heatmap-lane__peak-marker" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="font-medium">Score {point.score.toFixed(2)}</p>
                    <p className="text-muted-foreground">{point.reason}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

export default HeatmapLaneTrack
