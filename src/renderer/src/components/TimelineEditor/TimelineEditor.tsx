import { useState } from 'react'
import { Film, Mic, Pause, Play, Redo2, Scissors, Undo2, ZoomIn } from 'lucide-react'
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
import { Button } from '../ui/button'
import type { SourceClip } from '@shared/types/project'
import './timeline-editor.css'

function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function SectionHeader({
  icon,
  title,
  hint
}: {
  icon: React.ReactNode
  title: string
  hint: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 border-b border-border/60 bg-background/60 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {icon}
      {title}
      <span className="ml-auto truncate text-right normal-case font-normal text-muted-foreground/70">
        {hint}
      </span>
    </div>
  )
}

function TimelineEditor(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const setActiveVideoAt = useProjectStore((state) => state.setActiveVideoAt)
  const setPrimaryAudioAt = useProjectStore((state) => state.setPrimaryAudioAt)
  const moveActiveVideoBoundary = useProjectStore((state) => state.moveActiveVideoBoundary)
  const movePrimaryAudioBoundary = useProjectStore((state) => state.movePrimaryAudioBoundary)
  const splitCutAt = useProjectStore((state) => state.splitCutAt)
  const deleteKeptRange = useProjectStore((state) => state.deleteKeptRange)

  const pixelsPerSecond = usePlaybackStore((state) => state.pixelsPerSecond)
  const setZoom = usePlaybackStore((state) => state.setZoom)
  const playheadSec = usePlaybackStore((state) => state.playheadSec)
  const seek = usePlaybackStore((state) => state.seek)
  const isPlaying = usePlaybackStore((state) => state.isPlaying)
  const togglePlay = usePlaybackStore((state) => state.togglePlay)

  const [isRazorMode, setIsRazorMode] = useState(false)

  if (!project) return null

  if (project.sources.length === 0 || project.timelineDurationSec <= 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Importiere Quellen und starte die Synchronisation, um mit dem Schnitt zu beginnen.
      </div>
    )
  }

  const sourceIds = project.sources.map((s) => s.id)
  const trackWidthPx = project.timelineDurationSec * pixelsPerSecond
  const contentWidth = LANE_LABEL_WIDTH_PX + trackWidthPx

  const videoSources = project.sources.filter((s) => s.kind === 'video')
  const audioRows: Array<{ source: SourceClip; linkedVideoLabel?: string }> = project.sources
    .filter((s) => s.kind === 'audio' || (s.kind === 'video' && s.probed.hasAudio))
    .map((source) => ({
      source,
      linkedVideoLabel: source.kind === 'video' ? source.label : undefined
    }))

  const handleCutLaneClick = (atSec: number): void => {
    if (isRazorMode) void splitCutAt(atSec)
    else seek(atSec)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-start gap-4 px-4 pt-3">
        <div className="w-72 shrink-0">
          <PreviewPlayer />
        </div>

        <div className="flex min-w-56 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={isRazorMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsRazorMode((v) => !v)}
              title="Klick in die Schnitt-Spur teilt dort"
            >
              <Scissors /> Schnitt
            </Button>

            <div className="mx-1 h-5 w-px bg-border" />

            <Button
              variant="ghost"
              size="icon"
              onClick={() => useProjectStore.temporal.getState().undo()}
              title="Rückgängig"
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => useProjectStore.temporal.getState().redo()}
              title="Wiederholen"
            >
              <Redo2 />
            </Button>
            <Button variant="ghost" size="icon" onClick={togglePlay}>
              {isPlaying ? <Pause /> : <Play />}
            </Button>
            <span className="font-mono text-sm tabular-nums text-muted-foreground">
              {formatTime(playheadSec)}
            </span>

            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <ZoomIn className="size-3.5" />
              <input
                type="range"
                min={2}
                max={100}
                value={pixelsPerSecond}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="accent-primary"
              />
            </label>
          </div>

          <p className="text-xs text-muted-foreground">
            {isRazorMode
              ? 'Klick in die Schnitt-Spur unten: teilt den Bereich dort (zum Löschen mit ×).'
              : 'Klick auf eine Video-Spur legt die aktive Kamera fest, Klick auf eine Audio-Spur das primäre Audio. Ziehe die Grenzen in den Übersichts-Spuren, um Schnittpunkte zu verschieben.'}
          </p>
        </div>
      </div>

      <div className="mx-4 mb-4 mt-2 min-h-0 flex-1 overflow-auto rounded-md border border-border/60 bg-white/[0.02]">
        <div className="relative py-1" style={{ width: contentWidth }}>
          <TimeRuler
            durationSec={project.timelineDurationSec}
            pixelsPerSecond={pixelsPerSecond}
            onSeek={seek}
          />

          <SectionHeader
            icon={<Film className="size-3" />}
            title="Video-Quellen"
            hint="Klick setzt die aktive Kamera"
          />
          {videoSources.map((source) => (
            <SourceLane
              key={source.id}
              source={source}
              pixelsPerSecond={pixelsPerSecond}
              trackWidthPx={trackWidthPx}
              color={colorForSourceId(source.id, sourceIds)}
              onClick={(atSec) => void setActiveVideoAt(atSec, source.id)}
            />
          ))}
          <IntervalLane
            label="Aktive Kamera"
            intervals={project.edit.activeVideoIntervals}
            sources={project.sources}
            pixelsPerSecond={pixelsPerSecond}
            trackWidthPx={trackWidthPx}
            onMoveBoundary={(leftId, atSec) => void moveActiveVideoBoundary(leftId, atSec)}
          />

          <SectionHeader
            icon={<Mic className="size-3" />}
            title="Audio-Quellen"
            hint="Klick setzt das primäre Audio"
          />
          {audioRows.map(({ source, linkedVideoLabel }) => (
            <SourceLane
              key={source.id}
              source={source}
              pixelsPerSecond={pixelsPerSecond}
              trackWidthPx={trackWidthPx}
              color={colorForSourceId(source.id, sourceIds)}
              linkedVideoLabel={linkedVideoLabel}
              onClick={(atSec) => void setPrimaryAudioAt(atSec, source.id)}
            />
          ))}
          <IntervalLane
            label="Primäres Audio"
            intervals={project.edit.primaryAudioIntervals}
            sources={project.sources}
            pixelsPerSecond={pixelsPerSecond}
            trackWidthPx={trackWidthPx}
            onMoveBoundary={(leftId, atSec) => void movePrimaryAudioBoundary(leftId, atSec)}
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
            isRazorMode={isRazorMode}
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
