import type { TranscriptSegment } from '@shared/types/project'

interface SubtitleLaneProps {
  transcript: TranscriptSegment[]
  pixelsPerSecond: number
  trackWidthPx: number
  onSeek: (atSec: number) => void
}

function SubtitleLane({
  transcript,
  pixelsPerSecond,
  trackWidthPx,
  onSeek
}: SubtitleLaneProps): React.JSX.Element {
  return (
    <div className="subtitle-lane">
      <div className="subtitle-lane__label">Untertitel</div>
      <div className="subtitle-lane__track" style={{ width: trackWidthPx }}>
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
    </div>
  )
}

export default SubtitleLane
