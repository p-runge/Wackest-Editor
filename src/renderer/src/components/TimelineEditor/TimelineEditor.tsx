import { useEffect, useRef, useState } from 'react'
import { Film, Mic, Pause, Play, Redo2, Scissors, Undo2, Upload, ZoomIn } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { usePlaybackStore } from '../../state/playback-store'
import TimeRuler from './TimeRuler'
import SourceLaneLabel from './SourceLaneLabel'
import SourceLaneTrack from './SourceLaneTrack'
import LaneLabel from './LaneLabel'
import SubtitleLaneTrack from './SubtitleLaneTrack'
import HeatmapLaneTrack from './HeatmapLaneTrack'
import CutLaneTrack from './CutLaneTrack'
import PreviewPlayer from './PreviewPlayer'
import CameraSwitcher from './CameraSwitcher'
import { colorForSourceId } from '../../lib/colors'
import { mapUnifiedTimeToLocal } from '../../lib/timeline-edit'
import { useResolvedSources } from '../../hooks/useResolvedSources'
import {
  BOTTOM_SPACER_PX,
  RULER_HEIGHT_PX,
  SECTION_HEADER_HEIGHT_PX,
  SIMPLE_LANE_HEIGHT_PX
} from './constants'
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

/** Sticky section title in the sidebar — stays pinned below the ruler spacer for as long as its
 *  section's rows (wrapped alongside it in the same parent) are still in view. */
function SidebarSectionLabel({
  icon,
  title
}: {
  icon: React.ReactNode
  title: string
}): React.JSX.Element {
  return (
    <div
      className="timeline-sidebar__section-label flex items-center gap-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      style={{ height: SECTION_HEADER_HEIGHT_PX }}
    >
      {icon}
      {title}
    </div>
  )
}

/** Body-side counterpart of SidebarSectionLabel — same height and sticky offset, so the two stay
 *  vertically in sync, but purely a visual divider since the title itself lives in the sidebar. */
function BodySectionDivider({ trackWidthPx }: { trackWidthPx: number }): React.JSX.Element {
  return (
    <div
      className="timeline-section__divider"
      style={{ height: SECTION_HEADER_HEIGHT_PX, width: trackWidthPx }}
    />
  )
}

function TimelineEditor(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const setActiveVideoAt = useProjectStore((state) => state.setActiveVideoAt)
  const setActiveAudioAt = useProjectStore((state) => state.setActiveAudioAt)
  const moveActiveVideoBoundary = useProjectStore((state) => state.moveActiveVideoBoundary)
  const moveActiveAudioBoundary = useProjectStore((state) => state.moveActiveAudioBoundary)
  const splitCutAt = useProjectStore((state) => state.splitCutAt)
  const deleteKeptRange = useProjectStore((state) => state.deleteKeptRange)
  const importFiles = useProjectStore((state) => state.importFiles)
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
  const sidebarScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const isSyncingScrollRef = useRef(false)
  const [bodyWidth, setBodyWidth] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const hscrollDragRef = useRef<{ startClientX: number; startScrollLeft: number } | null>(null)

  useEffect(() => {
    const el = bodyScrollRef.current
    if (!el) return undefined
    const observer = new ResizeObserver((entries) => {
      setBodyWidth(entries[0].contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The sidebar and the body are separate scroll containers (so the sidebar can stay put
  // horizontally without any position: sticky tricks) — keep their vertical scroll in lockstep.
  // The guard flag stops the programmatic scrollTop set below from re-triggering its own handler.
  const handleBodyScroll = (): void => {
    const body = bodyScrollRef.current
    if (body) setScrollLeft(body.scrollLeft)

    if (isSyncingScrollRef.current) {
      isSyncingScrollRef.current = false
      return
    }
    const sidebar = sidebarScrollRef.current
    if (!sidebar || !body) return
    isSyncingScrollRef.current = true
    sidebar.scrollTop = body.scrollTop
  }

  const handleSidebarScroll = (): void => {
    if (isSyncingScrollRef.current) {
      isSyncingScrollRef.current = false
      return
    }
    const sidebar = sidebarScrollRef.current
    const body = bodyScrollRef.current
    if (!sidebar || !body) return
    isSyncingScrollRef.current = true
    body.scrollTop = sidebar.scrollTop
  }

  if (!project) return null

  if (project.sources.length === 0 || project.timelineDurationSec <= 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
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
      </div>
    )
  }

  const sourceIds = project.sources.map((s) => s.id)
  const trackWidthPx = Math.max(project.timelineDurationSec * pixelsPerSecond, bodyWidth)
  const playheadLeftPx = playheadSec * pixelsPerSecond

  // Custom horizontal scrollbar geometry — replaces the native one (hidden via CSS, see
  // .timeline-body::-webkit-scrollbar:horizontal) so it can be visible without reserving any
  // row-content height. Mirrors standard scrollbar math: thumb size proportional to the visible
  // fraction of content, with a floor so it stays grabbable even when heavily zoomed out.
  const maxScrollLeft = Math.max(0, trackWidthPx - bodyWidth)
  const showHorizontalScrollbar = maxScrollLeft > 0
  const thumbWidthPx =
    bodyWidth > 0 ? Math.min(bodyWidth, Math.max(24, (bodyWidth / trackWidthPx) * bodyWidth)) : 0
  const thumbTravelPx = Math.max(0, bodyWidth - thumbWidthPx)
  const thumbLeftPx = maxScrollLeft > 0 ? (scrollLeft / maxScrollLeft) * thumbTravelPx : 0

  const handleHscrollThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    hscrollDragRef.current = { startClientX: e.clientX, startScrollLeft: scrollLeft }
  }

  const handleHscrollThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = hscrollDragRef.current
    const body = bodyScrollRef.current
    if (!drag || !body || thumbTravelPx <= 0) return
    const deltaClientX = e.clientX - drag.startClientX
    const scale = maxScrollLeft / thumbTravelPx
    body.scrollLeft = Math.min(
      Math.max(drag.startScrollLeft + deltaClientX * scale, 0),
      maxScrollLeft
    )
  }

  const handleHscrollThumbPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (hscrollDragRef.current) e.currentTarget.releasePointerCapture(e.pointerId)
    hscrollDragRef.current = null
  }

  const handleHscrollTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return // clicks on the thumb are handled separately
    const body = bodyScrollRef.current
    if (!body || maxScrollLeft <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickFraction = (e.clientX - rect.left) / rect.width
    body.scrollLeft = Math.min(
      Math.max(clickFraction * trackWidthPx - bodyWidth / 2, 0),
      maxScrollLeft
    )
  }

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
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-start gap-4 px-4 pt-3">
        <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-white/[0.02]">
          <PreviewPlayer />
          <CameraSwitcher
            project={project}
            playheadSec={playheadSec}
            videoSources={videoSources}
            audioRows={audioRows}
            setActiveVideoAt={setActiveVideoAt}
            setActiveAudioAt={setActiveAudioAt}
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
          </div>

          <p className="text-xs text-muted-foreground">
            {isRazorMode
              ? 'Klick in die Schnitt-Spur unten: teilt den Bereich dort (zum Löschen mit ×).'
              : 'Klick auf den Punkt in einer Spur-Beschriftung setzt sie an der aktuellen Position aktiv; Klick in die Spur selbst an der geklickten Stelle. Der aktive Bereich ist direkt auf der Spur farbig markiert — Grenzen lassen sich dort per Ziehen verschieben.'}
          </p>
        </div>
      </div>

      <label className="mx-4 mt-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">
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

      <div className="mx-4 mb-4 mt-1 flex min-h-0 flex-1 overflow-hidden rounded-md border border-border/60 bg-white/[0.02]">
        <div ref={sidebarScrollRef} className="timeline-sidebar" onScroll={handleSidebarScroll}>
          <div className="timeline-sidebar__spacer" style={{ height: RULER_HEIGHT_PX }} />

          <div className="timeline-sidebar__section">
            <SidebarSectionLabel icon={<Film className="size-3" />} title="Video-Quellen" />
            {videoSources.map((source) => (
              <SourceLaneLabel
                key={source.id}
                source={source}
                color={colorForSourceId(source.id, sourceIds)}
                isActive={source.id === activeVideoId}
                hasCoverage={mapUnifiedTimeToLocal(source, playheadSec) !== null}
                onSetActiveHere={() => void setActiveVideoAt(playheadSec, source.id)}
              />
            ))}
          </div>

          <div className="timeline-sidebar__section">
            <SidebarSectionLabel icon={<Mic className="size-3" />} title="Audio-Quellen" />
            {audioRows.map(({ source, linkedVideoLabel }) => (
              <SourceLaneLabel
                key={source.id}
                source={source}
                color={colorForSourceId(source.id, sourceIds)}
                linkedVideoLabel={linkedVideoLabel}
                isActive={source.id === activeAudioId}
                hasCoverage={mapUnifiedTimeToLocal(source, playheadSec) !== null}
                onSetActiveHere={() => void setActiveAudioAt(playheadSec, source.id)}
              />
            ))}
          </div>

          {project.transcript.length > 0 && (
            <LaneLabel heightPx={SIMPLE_LANE_HEIGHT_PX}>Untertitel</LaneLabel>
          )}
          {project.heatmap.length > 0 && (
            <LaneLabel heightPx={SIMPLE_LANE_HEIGHT_PX}>Heatmap</LaneLabel>
          )}
          <LaneLabel heightPx={SIMPLE_LANE_HEIGHT_PX}>Schnitt</LaneLabel>
          <div style={{ height: BOTTOM_SPACER_PX }} />
        </div>

        <div className="timeline-body-wrapper">
          <div ref={bodyScrollRef} className="timeline-body" onScroll={handleBodyScroll}>
            <div className="relative" style={{ width: trackWidthPx }}>
              <TimeRuler
                pixelsPerSecond={pixelsPerSecond}
                trackWidthPx={trackWidthPx}
                onSeek={seek}
              />

              <div className="timeline-section">
                <BodySectionDivider trackWidthPx={trackWidthPx} />
                {videoSources.map((source) => (
                  <SourceLaneTrack
                    key={source.id}
                    source={source}
                    pixelsPerSecond={pixelsPerSecond}
                    trackWidthPx={trackWidthPx}
                    color={colorForSourceId(source.id, sourceIds)}
                    activeIntervals={project.edit.activeVideoIntervals}
                    sources={project.sources}
                    timelineDurationSec={project.timelineDurationSec}
                    onWaveformClick={(atSec) => void setActiveVideoAt(atSec, source.id)}
                    onMoveBoundary={(leftId, atSec) => void moveActiveVideoBoundary(leftId, atSec)}
                  />
                ))}
              </div>

              <div className="timeline-section">
                <BodySectionDivider trackWidthPx={trackWidthPx} />
                {audioRows.map(({ source }) => (
                  <SourceLaneTrack
                    key={source.id}
                    source={source}
                    pixelsPerSecond={pixelsPerSecond}
                    trackWidthPx={trackWidthPx}
                    color={colorForSourceId(source.id, sourceIds)}
                    activeIntervals={project.edit.activeAudioIntervals}
                    sources={project.sources}
                    timelineDurationSec={project.timelineDurationSec}
                    onWaveformClick={(atSec) => void setActiveAudioAt(atSec, source.id)}
                    onMoveBoundary={(leftId, atSec) => void moveActiveAudioBoundary(leftId, atSec)}
                  />
                ))}
              </div>

              {project.transcript.length > 0 && (
                <SubtitleLaneTrack
                  transcript={project.transcript}
                  pixelsPerSecond={pixelsPerSecond}
                  trackWidthPx={trackWidthPx}
                  onSeek={seek}
                />
              )}

              {project.heatmap.length > 0 && (
                <HeatmapLaneTrack
                  heatmap={project.heatmap}
                  pixelsPerSecond={pixelsPerSecond}
                  trackWidthPx={trackWidthPx}
                />
              )}

              <CutLaneTrack
                keptRanges={project.edit.keptRanges}
                pixelsPerSecond={pixelsPerSecond}
                trackWidthPx={trackWidthPx}
                isRazorMode={isRazorMode}
                onClick={handleCutLaneClick}
                onDelete={(rangeId) => void deleteKeptRange(rangeId)}
              />

              <div style={{ height: BOTTOM_SPACER_PX }} />
              <div className="timeline-playhead" style={{ left: playheadLeftPx }} />
            </div>
          </div>

          {showHorizontalScrollbar && (
            <div className="timeline-hscrollbar" onPointerDown={handleHscrollTrackPointerDown}>
              <div
                className="timeline-hscrollbar__thumb"
                style={{ width: thumbWidthPx, left: thumbLeftPx }}
                onPointerDown={handleHscrollThumbPointerDown}
                onPointerMove={handleHscrollThumbPointerMove}
                onPointerUp={handleHscrollThumbPointerUp}
              />
            </div>
          )}
        </div>
      </div>

      {importError && (
        <p className="mx-4 mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {importError}
        </p>
      )}
    </div>
  )
}

export default TimelineEditor
