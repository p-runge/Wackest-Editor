import { useEffect, useMemo, useRef, useState } from 'react'
import { Film, Mic, Scissors, SwitchCamera, Upload, ZoomIn } from 'lucide-react'
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
import PreviewTransportControls from './PreviewTransportControls'
import CameraSwitcher from './CameraSwitcher'
import CutTool from './CutTool'
import { colorForSourceId } from '../../lib/colors'
import { deriveGlobalHeatmap } from '../../lib/heatmap'
import {
  mapUnifiedTimeToLocal,
  computeCutLaneSegments,
  computeLaneChunks,
  computeProgramEndSec,
  mapPlacementTimeToContentTime,
  mapContentRangeToPlacementRanges
} from '../../lib/timeline-edit'
import { useResolvedSources } from '../../hooks/useResolvedSources'
import {
  BOTTOM_SPACER_PX,
  RULER_HEIGHT_PX,
  SECTION_HEADER_HEIGHT_PX,
  SIMPLE_LANE_HEIGHT_PX,
  CUT_LANE_HEIGHT_PX
} from './constants'
import { Button } from '../ui/button'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import type { SourceClip } from '@shared/types/project'
import './timeline-editor.css'

const PREVIEW_MIN_WIDTH_PX = 280
const PREVIEW_MAX_WIDTH_PX = 960
const PREVIEW_DEFAULT_WIDTH_PX = 480

// Full-height cross-track overlays (split markers) live in the same
// `position: relative` container as the ruler and the Schnitt lane, so a plain `top: 0` would
// paint over those two rows too, not just the content lanes below them. Offsetting by their
// combined height keeps the overlays scoped to the lanes they're actually meant to mark.
const BELOW_CUT_LANE_PX = RULER_HEIGHT_PX + CUT_LANE_HEIGHT_PX

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
  const splitKeptRangeAtPlayhead = useProjectStore((state) => state.splitKeptRangeAtPlayhead)
  const cutRange = useProjectStore((state) => state.cutRange)
  const moveKeptRange = useProjectStore((state) => state.moveKeptRange)
  const deleteKeptRange = useProjectStore((state) => state.deleteKeptRange)
  const moveKeptRanges = useProjectStore((state) => state.moveKeptRanges)
  const deleteKeptRanges = useProjectStore((state) => state.deleteKeptRanges)
  const importSources = useProjectStore((state) => state.importSources)
  const isImporting = useProjectStore((state) => state.isImporting)
  const importError = useProjectStore((state) => state.importError)

  const pixelsPerSecond = usePlaybackStore((state) => state.pixelsPerSecond)
  const setZoom = usePlaybackStore((state) => state.setZoom)
  const playheadSec = usePlaybackStore((state) => state.playheadSec)
  const seek = usePlaybackStore((state) => state.seek)

  // The playhead lives on the program timeline (placement); everything media-related (which
  // camera is active, which local file second to show) needs the underlying content time. Null
  // while the playhead sits in a cut gap — nothing plays there. The `?? -1` sentinel below feeds
  // resolution helpers a time no source/interval can ever cover, so they cleanly resolve nothing.
  const playheadContentSec = project
    ? mapPlacementTimeToContentTime(project.edit.keptRanges, playheadSec)
    : null

  const { activeVideoId, activeAudioId } = useResolvedSources(project, playheadContentSec ?? -1)

  // The kept-range chunks every lane renders through: placement (program position) + content
  // (which footage). A chunk is one vertical slice through ALL tracks — moving it moves waveforms,
  // tints, transcript, and heatmap together; cut-out content isn't rendered anywhere.
  const laneChunks = useMemo(() => {
    if (!project) return []
    return computeLaneChunks(project.edit.keptRanges)
  }, [project])

  // Transcript/heatmap entries live in content time — project them onto the program timeline so
  // they travel with the chunk their content belongs to. An entry straddling a cut or a chunk
  // boundary comes back as several pieces (or none, if fully cut out).
  const placedTranscript = useMemo(() => {
    if (!project) return []
    return project.transcript.flatMap((segment) =>
      mapContentRangeToPlacementRanges(
        project.edit.keptRanges,
        segment.startSec,
        segment.endSec
      ).map((piece, i) => ({
        id: `${segment.id}-${i}`,
        startSec: piece.placementStartSec,
        endSec: piece.placementEndSec,
        text: segment.text
      }))
    )
  }, [project])

  // The single overview curve for the Heatmap lane is derived from the per-source track heatmaps
  // (max across sources at each instant) — the model no longer stores one global heatmap.
  const globalHeatmap = useMemo(
    () => (project ? deriveGlobalHeatmap(project.trackHeatmaps) : []),
    [project]
  )

  const placedHeatmap = useMemo(() => {
    if (!project) return []
    return globalHeatmap.flatMap((point) =>
      mapContentRangeToPlacementRanges(project.edit.keptRanges, point.startSec, point.endSec).map(
        (piece) => ({
          startSec: piece.placementStartSec,
          endSec: piece.placementEndSec,
          score: point.score,
          reason: point.reason
        })
      )
    )
  }, [project, globalHeatmap])

  const sidebarScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const isSyncingScrollRef = useRef(false)
  const [bodyWidth, setBodyWidth] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const hscrollDragRef = useRef<{ startClientX: number; startScrollLeft: number } | null>(null)
  const [previewWidthPx, setPreviewWidthPx] = useState(PREVIEW_DEFAULT_WIDTH_PX)
  const previewResizeDragRef = useRef<{ startClientX: number; startWidthPx: number } | null>(null)
  const [activeTool, setActiveTool] = useState<'camera-switch' | 'cut'>('camera-switch')
  // Which Schnitt-lane chunks are selected for group move/delete — ephemeral UI state, not part
  // of the document (must not be undo-tracked or persisted), so it lives here rather than in
  // project-store. Cleared whenever the Cut tool isn't active, so it never lingers stale.
  const [selectedRangeIds, setSelectedRangeIds] = useState<Set<string>>(new Set())
  const selectionAnchorIdRef = useRef<string | null>(null)

  useEffect(() => {
    const el = bodyScrollRef.current
    if (!el) return undefined
    const observer = new ResizeObserver((entries) => {
      setBodyWidth(entries[0].contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Switching away from the Cut tool clears the Schnitt-lane selection so it never lingers
  // stale — driven directly from the tab change (not an effect keyed on activeTool), since this
  // is a plain synchronous reaction to a user action, not a sync with an external system.
  const handleActiveToolChange = (tool: 'camera-switch' | 'cut'): void => {
    setActiveTool(tool)
    if (tool !== 'cut') {
      setSelectedRangeIds(new Set())
      selectionAnchorIdRef.current = null
    }
  }

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
        <Button disabled={isImporting} onClick={() => void importSources()}>
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
  const isCut = activeTool === 'cut'
  // One shared program timeline for both modes — Kamerawechsel and Schnitt render the exact
  // same chunk-mapped lanes/axis, so edits made in either are immediately visible in the other.
  // Only which interactions are live (active-source editing vs. cut/move/delete) depends on the
  // tool.
  //
  // The program axis has no fixed end: it reaches to the last chunk's placement plus one full
  // viewport of empty space, so there's always visible room to drag a chunk further right — each
  // drop grows the axis, so repeated drags reach arbitrarily far. With no chunks left it collapses
  // to just the viewport (the program is empty; its duration is 0:00).
  const programEndSec = computeProgramEndSec(project.edit.keptRanges)
  const axisEndSec = programEndSec + (pixelsPerSecond > 0 ? bodyWidth / pixelsPerSecond : 0)
  const trackWidthPx = Math.max(axisEndSec * pixelsPerSecond, bodyWidth)
  const playheadLeftPx = playheadSec * pixelsPerSecond
  const cutSegments = computeCutLaneSegments(project.edit.keptRanges, axisEndSec)
  // Two still-kept clips touching with no cut between them are otherwise invisible as separate
  // clips (they render identically and merge visually) — mark that boundary explicitly so a split
  // is actually visible on the timeline the moment it's made, before either half is moved/deleted.
  const splitBoundarySecs = cutSegments
    .filter((segment, i) => {
      const next = cutSegments[i + 1]
      return segment.kept && next?.kept && segment.endSec === next.startSec
    })
    .map((segment) => segment.endSec)

  // Schnitt-lane multi-select: a single entry point so CutLaneTrack only has to decide *which*
  // mode a click means (from its pointer-event modifiers) and hand the id off here — the actual
  // set bookkeeping (toggle/range/replace) lives in one place.
  const onSelectChunk = (id: string, mode: 'replace' | 'toggle' | 'range'): void => {
    if (mode === 'replace') {
      setSelectedRangeIds(new Set([id]))
      selectionAnchorIdRef.current = id
      return
    }
    if (mode === 'toggle') {
      setSelectedRangeIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      selectionAnchorIdRef.current = id
      return
    }
    // range: everything between the last anchor and this chunk, in timeline order.
    const orderedIds = [...project.edit.keptRanges]
      .sort((a, b) => a.startSec - b.startSec)
      .map((r) => r.id)
    const anchorId = selectionAnchorIdRef.current ?? id
    const anchorIndex = orderedIds.indexOf(anchorId)
    const targetIndex = orderedIds.indexOf(id)
    if (anchorIndex === -1 || targetIndex === -1) {
      setSelectedRangeIds(new Set([id]))
      return
    }
    const [from, to] =
      anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
    setSelectedRangeIds(new Set(orderedIds.slice(from, to + 1)))
  }

  // Marquee/rubber-band select always replaces the selection outright (no extend-via-marquee) —
  // simplest interaction that still covers the common "drag a box over several clips" case.
  const onMarqueeSelect = (ids: string[]): void => {
    setSelectedRangeIds(new Set(ids))
    selectionAnchorIdRef.current = ids[ids.length - 1] ?? null
  }

  const onSelectAllRanges = (): void => {
    setSelectedRangeIds(new Set(project.edit.keptRanges.map((r) => r.id)))
  }

  const onClearSelection = (): void => {
    setSelectedRangeIds(new Set())
    selectionAnchorIdRef.current = null
  }

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

  // Waveform clicks arrive in placement time; Kamerawechsel edits (set active source) apply to
  // content time. In a cut gap there's no content — the click just seeks instead of editing.
  const handleWaveformClick = (
    placementSec: number,
    setActiveAt: (atSec: number, sourceId: string) => Promise<void>,
    sourceId: string
  ): void => {
    if (isCut) {
      seek(placementSec)
      return
    }
    const contentSec = mapPlacementTimeToContentTime(project.edit.keptRanges, placementSec)
    if (contentSec !== null) void setActiveAt(contentSec, sourceId)
  }

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
          {activeTool === 'camera-switch' ? (
            // The switcher operates on content time (which camera is active in the underlying
            // footage). In a cut gap there is no content — the -1 sentinel resolves no coverage
            // anywhere, so every tile disables itself and switch attempts no-op.
            <CameraSwitcher
              project={project}
              playheadSec={playheadContentSec ?? -1}
              videoSources={videoSources}
              audioRows={audioRows}
              setActiveVideoAt={setActiveVideoAt}
              setActiveAudioAt={setActiveAudioAt}
            />
          ) : (
            <CutTool
              project={project}
              playheadSec={playheadSec}
              splitKeptRangeAtPlayhead={splitKeptRangeAtPlayhead}
              deleteKeptRange={deleteKeptRange}
              selectedRangeIds={selectedRangeIds}
              deleteKeptRanges={deleteKeptRanges}
              onSelectAllRanges={onSelectAllRanges}
            />
          )}
        </div>
      </div>

      <div className="mx-4 mt-2 flex items-center justify-between gap-2">
        <Tabs
          value={activeTool}
          onValueChange={(value) => handleActiveToolChange(value as typeof activeTool)}
        >
          <TabsList>
            <TabsTrigger value="camera-switch" className="gap-1.5">
              <SwitchCamera className="size-3.5" />
              Kamerawechsel
            </TabsTrigger>
            <TabsTrigger value="cut" className="gap-1.5">
              <Scissors className="size-3.5" />
              Schnitt
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

          <LaneLabel heightPx={CUT_LANE_HEIGHT_PX}>Schnitt</LaneLabel>

          <div className="timeline-sidebar__section">
            <SidebarSectionLabel icon={<Film className="size-3" />} title="Video-Quellen" />
            {videoSources.map((source) => (
              <SourceLaneLabel
                key={source.id}
                source={source}
                color={colorForSourceId(source.id, sourceIds)}
                isActive={source.id === activeVideoId}
                hasCoverage={mapUnifiedTimeToLocal(source, playheadContentSec ?? -1) !== null}
                onSetActiveHere={() => {
                  if (playheadContentSec !== null)
                    void setActiveVideoAt(playheadContentSec, source.id)
                }}
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
                hasCoverage={mapUnifiedTimeToLocal(source, playheadContentSec ?? -1) !== null}
                onSetActiveHere={() => {
                  if (playheadContentSec !== null)
                    void setActiveAudioAt(playheadContentSec, source.id)
                }}
              />
            ))}
          </div>

          {project.transcript.length > 0 && (
            <LaneLabel heightPx={SIMPLE_LANE_HEIGHT_PX}>Untertitel</LaneLabel>
          )}
          {globalHeatmap.length > 0 && (
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

              <CutLaneTrack
                keptRanges={project.edit.keptRanges}
                axisEndSec={axisEndSec}
                pixelsPerSecond={pixelsPerSecond}
                trackWidthPx={trackWidthPx}
                interactive={isCut}
                onSeek={seek}
                onCutRange={(startSec, endSec) => void cutRange(startSec, endSec)}
                onMoveRange={(id, newStartSec) => void moveKeptRange(id, newStartSec)}
                onDelete={(id) => void deleteKeptRange(id)}
                selectedIds={selectedRangeIds}
                onSelectChunk={onSelectChunk}
                onMarqueeSelect={onMarqueeSelect}
                onClearSelection={onClearSelection}
                onMoveRanges={(ids, leaderId, newLeaderStartSec) =>
                  void moveKeptRanges(ids, leaderId, newLeaderStartSec)
                }
                onDeleteRanges={(ids) => void deleteKeptRanges(ids)}
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
                    chunks={laneChunks}
                    sources={project.sources}
                    timelineDurationSec={project.timelineDurationSec}
                    interactive={!isCut}
                    onWaveformClick={(placementSec) =>
                      handleWaveformClick(placementSec, setActiveVideoAt, source.id)
                    }
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
                    chunks={laneChunks}
                    sources={project.sources}
                    timelineDurationSec={project.timelineDurationSec}
                    interactive={!isCut}
                    onWaveformClick={(placementSec) =>
                      handleWaveformClick(placementSec, setActiveAudioAt, source.id)
                    }
                    onMoveBoundary={(leftId, atSec) => void moveActiveAudioBoundary(leftId, atSec)}
                  />
                ))}
              </div>

              {project.transcript.length > 0 && (
                <SubtitleLaneTrack
                  transcript={placedTranscript}
                  pixelsPerSecond={pixelsPerSecond}
                  trackWidthPx={trackWidthPx}
                  onSeek={seek}
                />
              )}

              {globalHeatmap.length > 0 && (
                <HeatmapLaneTrack
                  heatmap={placedHeatmap}
                  pixelsPerSecond={pixelsPerSecond}
                  trackWidthPx={trackWidthPx}
                />
              )}

              <div style={{ height: BOTTOM_SPACER_PX }} />
              {splitBoundarySecs.map((atSec) => (
                <div
                  key={atSec}
                  className="timeline-split-marker"
                  style={{ top: BELOW_CUT_LANE_PX, left: atSec * pixelsPerSecond }}
                  title="Schnittpunkt"
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
