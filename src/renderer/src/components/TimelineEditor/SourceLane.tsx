import { useEffect, useState } from 'react'
import type { SourceClip } from '@shared/types/project'
import { toMediaUrl } from '@shared/types/media-url'
import WaveformCanvas from './WaveformCanvas'

interface SourceLaneProps {
  source: SourceClip
  pixelsPerSecond: number
  trackWidthPx: number
  color: string
  onClick: (atSec: number) => void
}

const LANE_HEIGHT = 44
const WAVEFORM_BUCKETS_PER_SEC = 10 // must match main/services/ffmpeg.ts

function SourceLane({
  source,
  pixelsPerSecond,
  trackWidthPx,
  color,
  onClick
}: SourceLaneProps): React.JSX.Element {
  const [peaks, setPeaks] = useState<Array<[number, number]> | null>(null)

  useEffect(() => {
    if (!source.waveformCachePath) return undefined
    let cancelled = false
    window.api.ingest
      .readWaveform(source.waveformCachePath)
      .then((data) => {
        if (!cancelled) setPeaks(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [source.waveformCachePath])

  return (
    <div className="source-lane">
      <div className="source-lane__label" style={{ borderLeftColor: color }}>
        {source.thumbnailCachePath && (
          <img className="source-lane__thumb" src={toMediaUrl(source.thumbnailCachePath)} alt="" />
        )}
        <span>{source.label}</span>
      </div>
      <div className="source-lane__track" style={{ height: LANE_HEIGHT, width: trackWidthPx }}>
        {source.syncSegments.map((segment) => {
          const left = (segment.localStartSec + segment.offsetSec) * pixelsPerSecond
          const width = Math.max(1, (segment.localEndSec - segment.localStartSec) * pixelsPerSecond)
          const segmentPeaks = peaks
            ? peaks.slice(
                Math.floor(segment.localStartSec * WAVEFORM_BUCKETS_PER_SEC),
                Math.ceil(segment.localEndSec * WAVEFORM_BUCKETS_PER_SEC)
              )
            : []

          return (
            <div
              key={segment.id}
              className="source-lane__segment"
              style={{ left, width, borderColor: color }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const localOffsetSec = (e.clientX - rect.left) / pixelsPerSecond
                onClick(segment.localStartSec + segment.offsetSec + localOffsetSec)
              }}
            >
              {segmentPeaks.length > 0 && (
                <WaveformCanvas
                  peaks={segmentPeaks}
                  width={width}
                  height={LANE_HEIGHT}
                  color={color}
                />
              )}
            </div>
          )
        })}

        {source.hardCutMarkers.map((markerLocalSec) => {
          const containing = source.syncSegments.find(
            (s) => markerLocalSec >= s.localStartSec && markerLocalSec <= s.localEndSec
          )
          if (!containing) return null
          const left = (markerLocalSec + containing.offsetSec) * pixelsPerSecond
          return (
            <div
              key={markerLocalSec}
              className="source-lane__hardcut"
              style={{ left }}
              title="Hard-Cut erkannt"
            />
          )
        })}
      </div>
    </div>
  )
}

export default SourceLane
