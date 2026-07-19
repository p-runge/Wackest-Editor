import { useEffect, useRef, useState } from 'react'
import { Film, Mic, SwitchCamera, Upload, ZoomIn } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { usePlaybackStore } from '../../state/playback-store'
import TimeRuler from './TimeRuler'
import SourceLaneLabel from './SourceLaneLabel'
import SourceLaneTrack from './SourceLaneTrack'
import LaneLabel from './LaneLabel'
import SubtitleLaneTrack from './SubtitleLaneTrack'
import HeatmapLaneTrack from './HeatmapLaneTrack'
import PreviewPlayer from './PreviewPlayer'
import PreviewTransportControls from './PreviewTransportControls'
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
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import type { SourceClip } from '@shared/types/project'
import { NO_OVERLAP_GAP_SEC } from '@shared/types/sync-constants'
import './timeline-editor.css'

const PREVIEW_MIN_WIDTH_PX = 280
const PREVIEW_MAX_WIDTH_PX = 960
const PREVIEW_DEFAULT_WIDTH_PX = 480

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
  const importFiles = useProjectStore((state) => state.importFiles)
  const isImporting = useProjectStore((state) => state.isImporting)
  const importError = useProjectStore((state) => state.importError)

  const pixelsPerSecond = usePlaybackStore((state) => state.pixelsPerSecond)
  const setZoom = usePlaybackStore((state) => state.setZoom)
  const playheadSec = usePlaybackStore((state) => state.playheadSec)
  const seek = usePlaybackStore((state) => state.seek)

  const { activeVideoId, activeAudioId } = useResolvedSources(project, playheadSec)

  const sidebarScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const isSyncingScrollRef = useRef(false)
  const [bodyWidth, setBodyWidth] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const hscrollDragRef = useRef<{ startClientX: number; startScrollLeft: number } | null>(null)
  const [previewWidthPx, setPreviewWidthPx] = useState(PREVIEW_DEFAULT_WIDTH_PX)
  const previewResizeDragRef = useRef<{ startClientX: number; startWidthPx: number } | null>(null)

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

  const handlePreviewResizePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    previewResizeDragRef.current = { startClientX: e.clientX, startWidthPx: previewWidthPx }
  }

  const handlePreviewResizePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = previewResizeDragRef.current
    if (!drag) return
    const next = drag.startWidthPx + (e.clientX - drag.startClientX)
    setPreviewWidthPx(Math.min(PREVIEW_MAX_WIDTH_PX, Math.max(PREVIEW_MIN_WIDTH_PX, next)))
  }

  const handlePreviewResizePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (previewResizeDragRef.current) e.currentTarget.releasePointerCapture(e.pointerId)
    previewResizeDragRef.current = null
  }

  const videoSources = project.sources.filter((s) => s.kind === 'video')
  const audioRows: Array<{ source: SourceClip; linkedVideoLabel?: string }> = project.sources
    .filter((s) => s.kind === 'audio' || (s.kind === 'video' && s.probed.hasAudio))
    .map((source) => ({
      source,
      linkedVideoLabel: source.kind === 'video' ? source.label : undefined
    }))

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-start px-4 pt-3">
        <div
          className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-white/[0.02]"
          style={{ width: previewWidthPx, maxWidth: '100%' }}
        >
          <PreviewPlayer />
          <PreviewTransportControls />
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={handlePreviewResizePointerDown}
          onPointerMove={handlePreviewResizePointerMove}
          onPointerUp={handlePreviewResizePointerUp}
          title="Vorschau-Breite ziehen"
          className="mx-1.5 w-1.5 shrink-0 cursor-col-resize self-stretch rounded-full bg-border/40 transition-colors hover:bg-border active:bg-primary/50"
        />

        <div className="flex min-w-56 flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-white/[0.02]">
          <CameraSwitcher
            project={project}
            playheadSec={playheadSec}
            videoSources={videoSources}
            audioRows={audioRows}
            setActiveVideoAt={setActiveVideoAt}
            setActiveAudioAt={setActiveAudioAt}
          />
        </div>
      </div>

      <div className="mx-4 mt-2 flex items-center justify-between gap-2">
        <Tabs defaultValue="camera-switcher">
          <TabsList>
            <TabsTrigger value="camera-switcher" className="gap-1.5">
              <SwitchCamera className="size-3.5" />
              Kamerawechsler
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
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

              <div style={{ height: BOTTOM_SPACER_PX }} />
              {project.hardCutMarkers.map((gapStartSec) => (
                <div
                  key={gapStartSec}
                  className="timeline-hardcut-gap"
                  style={{
                    left: gapStartSec * pixelsPerSecond,
                    width: NO_OVERLAP_GAP_SEC * pixelsPerSecond
                  }}
                  title="Hard Cut: keine zeitliche Überschneidung"
                />
              ))}
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
