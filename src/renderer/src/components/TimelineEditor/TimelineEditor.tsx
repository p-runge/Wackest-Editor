import { useState } from 'react'
import { useProjectStore } from '../../state/project-store'
import { usePlaybackStore } from '../../state/playback-store'
import TimeRuler from './TimeRuler'
import SourceLane from './SourceLane'
import IntervalLane from './IntervalLane'
import SubtitleLane from './SubtitleLane'
import HeatmapLane from './HeatmapLane'
import CutLane from './CutLane'
import PreviewPlayer from './PreviewPlayer'
import { colorForSourceId } from '../../lib/colors'
import { LANE_LABEL_WIDTH_PX } from './constants'
import './timeline-editor.css'

type ToolMode = 'video' | 'audio' | 'razor'

const TOOL_MODE_HINT: Record<ToolMode, string> = {
  video: 'Klick auf eine Quell-Spur unten: ab diesem Zeitpunkt wird sie die aktive Kamera.',
  audio: 'Klick auf eine Quell-Spur unten: ab diesem Zeitpunkt wird sie das primäre Audio.',
  razor: 'Klick in die Schnitt-Spur: teilt den Bereich dort in zwei Teile (zum Löschen mit ×).'
}

function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function TimelineEditor(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const setActiveVideoAt = useProjectStore((state) => state.setActiveVideoAt)
  const setPrimaryAudioAt = useProjectStore((state) => state.setPrimaryAudioAt)
  const splitCutAt = useProjectStore((state) => state.splitCutAt)
  const deleteKeptRange = useProjectStore((state) => state.deleteKeptRange)

  const pixelsPerSecond = usePlaybackStore((state) => state.pixelsPerSecond)
  const setZoom = usePlaybackStore((state) => state.setZoom)
  const playheadSec = usePlaybackStore((state) => state.playheadSec)
  const seek = usePlaybackStore((state) => state.seek)
  const isPlaying = usePlaybackStore((state) => state.isPlaying)
  const togglePlay = usePlaybackStore((state) => state.togglePlay)

  const [toolMode, setToolMode] = useState<ToolMode>('video')

  if (!project || project.sources.length === 0 || project.timelineDurationSec <= 0) return null

  const sourceIds = project.sources.map((s) => s.id)
  const trackWidthPx = project.timelineDurationSec * pixelsPerSecond
  const contentWidth = LANE_LABEL_WIDTH_PX + trackWidthPx

  const handleSourceLaneClick = (sourceId: string, atSec: number): void => {
    if (toolMode === 'video') void setActiveVideoAt(atSec, sourceId)
    else if (toolMode === 'audio') void setPrimaryAudioAt(atSec, sourceId)
    else seek(atSec)
  }

  const handleCutLaneClick = (atSec: number): void => {
    if (toolMode === 'razor') void splitCutAt(atSec)
    else seek(atSec)
  }

  return (
    <div className="timeline-editor">
      <PreviewPlayer />

      <div className="timeline-toolbar">
        <div className="timeline-toolbar__group">
          <button
            className={toolMode === 'video' ? 'is-active' : ''}
            onClick={() => setToolMode('video')}
            title="Klick auf eine Quelle setzt sie ab diesem Zeitpunkt als aktive Kamera"
          >
            🎥 Kamera
          </button>
          <button
            className={toolMode === 'audio' ? 'is-active' : ''}
            onClick={() => setToolMode('audio')}
            title="Klick auf eine Quelle setzt sie ab diesem Zeitpunkt als primäres Audio"
          >
            🎙️ Audio
          </button>
          <button
            className={toolMode === 'razor' ? 'is-active' : ''}
            onClick={() => setToolMode('razor')}
            title="Klick in die Schnitt-Spur teilt dort"
          >
            ✂️ Schnitt
          </button>
        </div>

        <div className="timeline-toolbar__group">
          <button onClick={() => useProjectStore.temporal.getState().undo()} title="Rückgängig">
            ↶
          </button>
          <button onClick={() => useProjectStore.temporal.getState().redo()} title="Wiederholen">
            ↷
          </button>
          <button onClick={togglePlay}>{isPlaying ? '⏸' : '▶'}</button>
          <span className="timeline-toolbar__time">{formatTime(playheadSec)}</span>
        </div>

        <div className="timeline-toolbar__group">
          <label className="timeline-toolbar__zoom">
            Zoom
            <input
              type="range"
              min={2}
              max={100}
              value={pixelsPerSecond}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
        </div>
      </div>

      <p className="timeline-toolbar__hint">{TOOL_MODE_HINT[toolMode]}</p>

      <div className="timeline-scroll">
        <div className="timeline-content" style={{ width: contentWidth }}>
          <TimeRuler
            durationSec={project.timelineDurationSec}
            pixelsPerSecond={pixelsPerSecond}
            onSeek={seek}
          />

          {project.sources.map((source) => (
            <SourceLane
              key={source.id}
              source={source}
              pixelsPerSecond={pixelsPerSecond}
              trackWidthPx={trackWidthPx}
              color={colorForSourceId(source.id, sourceIds)}
              onClick={(atSec) => handleSourceLaneClick(source.id, atSec)}
            />
          ))}

          <IntervalLane
            label="Aktive Kamera"
            intervals={project.edit.activeVideoIntervals}
            sources={project.sources}
            pixelsPerSecond={pixelsPerSecond}
            trackWidthPx={trackWidthPx}
          />
          <IntervalLane
            label="Primäres Audio"
            intervals={project.edit.primaryAudioIntervals}
            sources={project.sources}
            pixelsPerSecond={pixelsPerSecond}
            trackWidthPx={trackWidthPx}
          />

          {project.transcript.length > 0 && (
            <SubtitleLane
              transcript={project.transcript}
              pixelsPerSecond={pixelsPerSecond}
              trackWidthPx={trackWidthPx}
              onSeek={seek}
            />
          )}

          {project.heatmap.length > 0 && (
            <HeatmapLane
              heatmap={project.heatmap}
              pixelsPerSecond={pixelsPerSecond}
              trackWidthPx={trackWidthPx}
            />
          )}

          <CutLane
            keptRanges={project.edit.keptRanges}
            pixelsPerSecond={pixelsPerSecond}
            trackWidthPx={trackWidthPx}
            isRazorMode={toolMode === 'razor'}
            onClick={handleCutLaneClick}
            onDelete={(rangeId) => void deleteKeptRange(rangeId)}
          />

          <div
            className="timeline-playhead"
            style={{ left: LANE_LABEL_WIDTH_PX + playheadSec * pixelsPerSecond }}
          />
        </div>
      </div>
    </div>
  )
}

export default TimelineEditor
