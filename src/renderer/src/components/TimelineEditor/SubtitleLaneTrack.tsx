import type { TranscriptSegment } from '@shared/types/project'
import { SIMPLE_LANE_HEIGHT_PX } from './constants'

interface SubtitleLaneTrackProps {
  transcript: TranscriptSegment[]
  pixelsPerSecond: number
  trackWidthPx: number
  onSeek: (atSec: number) => void
}

function SubtitleLaneTrack({
  transcript,
  pixelsPerSecond,
  trackWidthPx,
  onSeek
}: SubtitleLaneTrackProps): React.JSX.Element {
  return (
    <div
      className="subtitle-lane__track"
      style={{ height: SIMPLE_LANE_HEIGHT_PX, width: trackWidthPx }}
    >
      {transcript.map((segment) => (
        <div
          key={segment.id}
          className="subtitle-lane__block"
          style={{
            left: segment.startSec * pixelsPerSecond,
            width: Math.max(2, (segment.endSec - segment.startSec) * pixelsPerSecond)
          }}
          title={segment.text}
          onClick={() => onSeek(segment.startSec)}
        >
          <span>{segment.text}</span>
        </div>
      ))}
    </div>
  )
}

export default SubtitleLaneTrack
