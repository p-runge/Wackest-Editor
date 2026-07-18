import { Link2 } from 'lucide-react'
import type { SourceClip } from '@shared/types/project'
import { toMediaUrl } from '@shared/types/media-url'
import { SOURCE_LANE_HEIGHT_PX } from './constants'

interface SourceLaneLabelProps {
  source: SourceClip
  color: string
  /** Whether this source is the currently-resolved active video / active audio at the playhead. */
  isActive: boolean
  /** Whether this source has footage at the current playhead — disables the active-toggle if not. */
  hasCoverage: boolean
  /** Sets this source active starting at the current playhead. */
  onSetActiveHere: () => void
  /** Set when this row duplicates a video source's own audio into the audio section. */
  linkedVideoLabel?: string
}

function SourceLaneLabel({
  source,
  color,
  isActive,
  hasCoverage,
  onSetActiveHere,
  linkedVideoLabel
}: SourceLaneLabelProps): React.JSX.Element {
  return (
    <div
      className={`source-lane__label${isActive ? ' source-lane__label--active' : ''}`}
      style={
        {
          height: SOURCE_LANE_HEIGHT_PX,
          borderLeftColor: color,
          '--tile-color': color
        } as React.CSSProperties
      }
    >
      {source.thumbnailCachePath && (
        <img className="source-lane__thumb" src={toMediaUrl(source.thumbnailCachePath)} alt="" />
      )}
      <span className="truncate">{source.label}</span>
      {linkedVideoLabel && (
        <span
          className="ml-auto shrink-0 text-muted-foreground"
          title={`Ton von Video-Quelle „${linkedVideoLabel}“`}
        >
          <Link2 className="size-3" />
        </span>
      )}
      <button
        type="button"
        className={`source-lane__active-toggle${linkedVideoLabel ? '' : ' ml-auto'}${!hasCoverage ? ' source-lane__active-toggle--disabled' : ''}`}
        style={{ '--tile-color': color } as React.CSSProperties}
        disabled={!hasCoverage}
        onClick={onSetActiveHere}
        title={
          hasCoverage
            ? 'Als aktiv setzen (ab aktueller Position)'
            : 'Keine Aufnahme zu diesem Zeitpunkt'
        }
      />
    </div>
  )
}

export default SourceLaneLabel
