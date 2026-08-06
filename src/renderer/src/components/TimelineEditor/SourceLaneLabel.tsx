import { toMediaUrl } from '@shared/types/media-url'
import { SOURCE_LANE_HEIGHT_PX } from './constants'

interface SourceLaneLabelProps {
  /** Device group name shown on the lane. */
  name: string
  /** Optional thumbnail (first member source that has one). */
  thumbnailCachePath?: string
  color: string
  /** Whether one of this group's members is the currently-resolved active video/audio at the playhead. */
  isActive: boolean
  /** Whether this group has any footage at the current playhead — disables the active-toggle if not. */
  hasCoverage: boolean
  /** Sets this group active (its member covering the playhead) starting at the current playhead. */
  onSetActiveHere: () => void
}

function SourceLaneLabel({
  name,
  thumbnailCachePath,
  color,
  isActive,
  hasCoverage,
  onSetActiveHere
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
      {thumbnailCachePath && (
        <img className="source-lane__thumb" src={toMediaUrl(thumbnailCachePath)} alt="" />
      )}
      <span className="truncate">{name}</span>
      <button
        type="button"
        className={`source-lane__active-toggle ml-auto${!hasCoverage ? ' source-lane__active-toggle--disabled' : ''}`}
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
