import { LANE_LABEL_WIDTH_PX } from './constants'

interface TimeRulerProps {
  pixelsPerSecond: number
  trackWidthPx: number
  onSeek: (atSec: number) => void
}

function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// Pick a tick interval that keeps labels legible at the current zoom level.
function tickIntervalSec(pixelsPerSecond: number): number {
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800]
  const minPixelsBetweenTicks = 60
  return candidates.find((c) => c * pixelsPerSecond >= minPixelsBetweenTicks) ?? 3600
}

function TimeRuler({ pixelsPerSecond, trackWidthPx, onSeek }: TimeRulerProps): React.JSX.Element {
  const interval = tickIntervalSec(pixelsPerSecond)
  const trackDurationSec = trackWidthPx / pixelsPerSecond
  const ticks: number[] = []
  for (let t = 0; t <= trackDurationSec; t += interval) ticks.push(t)

  return (
    <div className="time-ruler">
      {/* empty spacer — keeps the ruler's track aligned with every other lane's track below it */}
      <div className="time-ruler__label" style={{ width: LANE_LABEL_WIDTH_PX }} />
      <div
        className="time-ruler__track"
        style={{ width: trackWidthPx }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          onSeek((e.clientX - rect.left) / pixelsPerSecond)
        }}
      >
        {ticks.map((t) => (
          <div key={t} className="time-ruler__tick" style={{ left: t * pixelsPerSecond }}>
            <span>{formatTime(t)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default TimeRuler
