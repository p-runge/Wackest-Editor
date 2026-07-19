import { SIMPLE_LANE_HEIGHT_PX } from './constants'

// Structurally compatible with TranscriptSegment (which has more fields this lane doesn't use),
// but loosened so Schnitt mode can pass in synthesized blocks — a raw segment straddling a cut or
// a reorder boundary gets projected onto the packed timeline as more than one piece, each still
// carrying the original text but with its own id/time range, not a real TranscriptSegment.
interface SubtitleLaneBlock {
  id: string
  startSec: number
  endSec: number
  text: string
}

interface SubtitleLaneTrackProps {
  transcript: SubtitleLaneBlock[]
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
