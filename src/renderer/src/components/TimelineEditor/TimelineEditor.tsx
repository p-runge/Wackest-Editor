import { useEffect, useRef, useState } from 'react'
import { Film, Mic, Pause, Play, Redo2, Scissors, Undo2, Upload, ZoomIn } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { usePlaybackStore } from '../../state/playback-store'
import TimeRuler from './TimeRuler'
import SourceLane from './SourceLane'
import SubtitleLane from './SubtitleLane'
import HeatmapLane from './HeatmapLane'
import CutLane from './CutLane'
import PreviewPlayer from './PreviewPlayer'
import CameraSwitcher from './CameraSwitcher'
import SourceList from './SourceList'
import { colorForSourceId } from '../../lib/colors'
import { mapUnifiedTimeToLocal } from '../../lib/timeline-edit'
import { useResolvedSources } from '../../hooks/useResolvedSources'
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
  const importFiles = useProjectStore((state) => state.importFiles)
  const importFromDrop = useProjectStore((state) => state.importFromDrop)
  const isImporting = useProjectStore((state) => state.isImporting)
  const importError = useProjectStore((state) => state.importError)

  const pixelsPerSecond = usePlaybackStore((state) => state.pixelsPerSecond)
  const setZoom = usePlaybackStore((state) => state.setZoom)
  const playheadSec = usePlaybackStore((state) => state.playheadSec)
  const seek = usePlaybackStore((state) => state.seek)
  const isPlaying = usePlaybackStore((state) => state.isPlaying)
  const togglePlay = usePlaybackStore((state) => state.togglePlay)

  const { activeVideoId, activeAudioId } = useResolvedSources(project, playheadSec)

  const [isRazorMode, setIsRazorMode] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounter = useRef(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [scrollContainerWidth, setScrollContainerWidth] = useState(0)

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return undefined
    const observer = new ResizeObserver((entries) => {
      setScrollContainerWidth(entries[0].contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounter.current += 1
    setIsDraggingOver(true)
  }
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setIsDraggingOver(false)
  }
  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDraggingOver(false)
    try {
      const filePaths = Array.from(e.dataTransfer.files).map((file) =>
        window.api.ingest.getPathForFile(file)
      )
      if (filePaths.length > 0) void importFromDrop(filePaths)
    } catch (err) {
      console.error('Drag&Drop-Import fehlgeschlagen', err)
      useProjectStore.setState({ importError: String(err) })
    }
  }

  if (!project) return null

  if (project.sources.length === 0 || project.timelineDurationSec <= 0) {
    return (
      <div
        className="relative flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p className="text-sm text-muted-foreground">
          {project.sources.length === 0
            ? 'Importiere Kamera-, Mikro- und Handy-Aufnahmen, um mit dem Schnitt zu beginnen.'
            : 'Starte die Synchronisation, um mit dem Schnitt zu beginnen.'}
        </p>
        <Button disabled={isImporting} onClick={() => void importFiles()}>
          <Upload /> {isImporting ? 'Importiere…' : 'Rohspuren importieren'}
        </Button>
        <p className="text-xs text-muted-foreground">oder Dateien hierher ziehen</p>
        {importError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {importError}
          </p>
        )}
        {isDraggingOver && (
          <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/5 text-sm font-medium text-primary">
            Dateien hier ablegen
          </div>
        )}
      </div>
    )
  }

  const sourceIds = project.sources.map((s) => s.id)
  const minTrackWidthPx = Math.max(0, scrollContainerWidth - LANE_LABEL_WIDTH_PX)
  const trackWidthPx = Math.max(project.timelineDurationSec * pixelsPerSecond, minTrackWidthPx)
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
    <div
      className="relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex flex-wrap items-start gap-4 px-4 pt-3">
        <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-white/[0.02]">
          <PreviewPlayer />
          <CameraSwitcher
            project={project}
            playheadSec={playheadSec}
            videoSources={videoSources}
            audioRows={audioRows}
            setActiveVideoAt={setActiveVideoAt}
            setPrimaryAudioAt={setPrimaryAudioAt}
          />
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
              : 'Klick auf den Punkt in einer Spur-Beschriftung setzt sie an der aktuellen Position aktiv; Klick in die Spur selbst an der geklickten Stelle. Der aktive Bereich ist direkt auf der Spur farbig markiert — Grenzen lassen sich dort per Ziehen verschieben.'}
          </p>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="mx-4 mb-4 mt-2 min-h-0 flex-1 overflow-auto rounded-md border border-border/60 bg-white/[0.02]"
      >
        <div className="relative py-1" style={{ width: contentWidth }}>
          <TimeRuler pixelsPerSecond={pixelsPerSecond} trackWidthPx={trackWidthPx} onSeek={seek} />

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
              isActive={source.id === activeVideoId}
              hasCoverage={mapUnifiedTimeToLocal(source, playheadSec) !== null}
              activeIntervals={project.edit.activeVideoIntervals}
              onSetActiveHere={() => void setActiveVideoAt(playheadSec, source.id)}
              onWaveformClick={(atSec) => void setActiveVideoAt(atSec, source.id)}
              onMoveBoundary={(leftId, atSec) => void moveActiveVideoBoundary(leftId, atSec)}
            />
          ))}

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
              isActive={source.id === activeAudioId}
              hasCoverage={mapUnifiedTimeToLocal(source, playheadSec) !== null}
              activeIntervals={project.edit.primaryAudioIntervals}
              onSetActiveHere={() => void setPrimaryAudioAt(playheadSec, source.id)}
              onWaveformClick={(atSec) => void setPrimaryAudioAt(atSec, source.id)}
              onMoveBoundary={(leftId, atSec) => void movePrimaryAudioBoundary(leftId, atSec)}
            />
          ))}

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

      <div className="mx-4 mb-4 flex shrink-0 flex-col gap-2">
        <div className="flex items-center gap-3 rounded-md border border-dashed border-border px-3 py-3">
          <Upload className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Dateien hierher ziehen</span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={isImporting}
            onClick={() => void importFiles()}
          >
            <Upload className="size-3.5" /> {isImporting ? 'Importiere…' : 'Quelle hinzufügen'}
          </Button>
        </div>

        {importError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {importError}
          </p>
        )}

        <div className="max-h-32 overflow-y-auto">
          <SourceList />
        </div>
      </div>

      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/5 text-sm font-medium text-primary">
          Dateien hier ablegen
        </div>
      )}
    </div>
  )
}

export default TimelineEditor
