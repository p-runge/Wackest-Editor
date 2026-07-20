import { useEffect, useRef } from 'react'
import { useProjectStore } from '../../state/project-store'
import { usePlaybackStore } from '../../state/playback-store'
import {
  mapUnifiedTimeToLocal,
  mapLocalTimeToUnified,
  mapPlacementTimeToContentTime,
  mapContentTimeToPlacementTime,
  computeProgramEndSec
} from '../../lib/timeline-edit'
import { sourceCoverageRange } from '@shared/types/timeline-time'
import { useResolvedSources } from '../../hooks/useResolvedSources'
import { RESYNC_THRESHOLD_SEC } from '../../lib/playback'
import { toMediaUrl } from '@shared/types/media-url'

function PreviewPlayer(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const playheadSec = usePlaybackStore((state) => state.playheadSec)
  const isPlaying = usePlaybackStore((state) => state.isPlaying)
  const seek = usePlaybackStore((state) => state.seek)
  const pause = usePlaybackStore((state) => state.pause)

  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  // The playhead lives on the program timeline (chunk placement); the media elements live in
  // content time. All source resolution and local-time seeking goes through this mapping, so a
  // moved chunk actually PLAYS its moved content at its new position. Null in a cut gap.
  const keptRanges = project?.edit.keptRanges ?? []
  const contentSec = project ? mapPlacementTimeToContentTime(keptRanges, playheadSec) : null

  const { activeVideoId, activeAudioId } = useResolvedSources(project, contentSec ?? -1)

  const videoSource = project?.sources.find((s) => s.id === activeVideoId)
  const audioSource =
    activeAudioId !== activeVideoId
      ? project?.sources.find((s) => s.id === activeAudioId)
      : undefined

  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoSource || contentSec === null) return
    const localTime = mapUnifiedTimeToLocal(videoSource, contentSec)
    if (localTime === null) return
    if (Math.abs(video.currentTime - localTime) > RESYNC_THRESHOLD_SEC) {
      video.currentTime = localTime
    }
  }, [contentSec, videoSource])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioSource || contentSec === null) return
    const localTime = mapUnifiedTimeToLocal(audioSource, contentSec)
    if (localTime === null) return
    if (Math.abs(audio.currentTime - localTime) > RESYNC_THRESHOLD_SEC) {
      audio.currentTime = localTime
    }
  }, [contentSec, audioSource])

  useEffect(() => {
    if (isPlaying) {
      videoRef.current?.play().catch(() => {})
      audioRef.current?.play().catch(() => {})
    } else {
      videoRef.current?.pause()
      audioRef.current?.pause()
    }
  }, [isPlaying, videoSource, audioSource])

  // Interval bounds are exclusive at their end, so the exact last instant of the program (the
  // last chunk's placement end — 0 when the timeline is empty) resolves no active source at all:
  // the <video>/<audio> elements unmount right before their native "ended" event would fire,
  // which would otherwise leave isPlaying stuck true with nothing left to drive it forward.
  // Force a clean stop once the playhead truly reaches the program end.
  useEffect(() => {
    if (isPlaying && project && playheadSec >= computeProgramEndSec(project.edit.keptRanges)) {
      pause()
    }
  }, [isPlaying, playheadSec, project, pause])

  // Playback runs strictly linearly along the whole program timeline — no skipping. When a stretch
  // has no active source (a cut/empty region, or a moment between two sources), nothing left to
  // drive the playhead forward, so advance it at real time via rAF until a source picks up again or
  // the program ends. The media elements drive whenever a source IS active (see handleTimeUpdate).
  useEffect(() => {
    if (!isPlaying || !project || videoSource || audioSource) return
    const end = computeProgramEndSec(project.edit.keptRanges)
    let raf = 0
    let last = performance.now()
    const step = (now: number): void => {
      const dt = (now - last) / 1000
      last = now
      const current = usePlaybackStore.getState().playheadSec
      const next = current + dt
      if (next >= end) {
        seek(end)
        pause()
        return
      }
      seek(next)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, videoSource, audioSource, project, seek, pause])

  // The active source's footage is exhausted (its file ended, or its content is cut out here).
  // Hand off to whatever source comes next by moving the playhead just past this source's own
  // coverage end — staying linear on the program timeline, never jumping ahead to another chunk.
  const continueAfterSource = (): void => {
    if (!videoSource || !project) return
    const end = computeProgramEndSec(project.edit.keptRanges)
    const coverage = sourceCoverageRange(videoSource)
    const placement = coverage
      ? mapContentTimeToPlacementTime(project.edit.keptRanges, coverage.endSec)
      : null
    if (placement !== null && placement > playheadSec) {
      seek(Math.min(placement, end))
    } else {
      // Nothing kept maps just past this source — nudge on so the gap loop / end-stop take over.
      seek(Math.min(playheadSec + 0.05, end))
    }
  }

  const handleTimeUpdate = (): void => {
    if (!isPlaying || !videoSource || !project) return
    const video = videoRef.current
    if (!video) return
    const contentUnified = mapLocalTimeToUnified(videoSource, video.currentTime)
    if (contentUnified !== null) {
      const placement = mapContentTimeToPlacementTime(project.edit.keptRanges, contentUnified)
      if (placement !== null) {
        seek(placement)
        return
      }
    }
    continueAfterSource()
  }

  const handleEnded = (): void => {
    continueAfterSource()
  }

  if (!project) return null

  if (contentSec === null) {
    return (
      <div className="preview-player preview-player--empty">
        Herausgeschnittener Bereich — hier wird nichts abgespielt.
      </div>
    )
  }

  if (!videoSource) {
    return (
      <div className="preview-player preview-player--empty">
        Keine aktive Kamera für diesen Zeitpunkt.
      </div>
    )
  }

  // Fixed 16:9 frame (see .preview-player in timeline-editor.css), regardless of the active
  // source's native shape. Portrait/non-16:9 footage letterboxes/pillarboxes via object-fit:
  // contain on .preview-player__video instead of the box resizing to match each source.
  return (
    <div className="preview-player">
      <video
        key={videoSource.id}
        ref={videoRef}
        className="preview-player__video"
        src={toMediaUrl(videoSource.originalFilePath)}
        muted={!!audioSource}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
      />
      {audioSource && (
        <audio key={audioSource.id} ref={audioRef} src={toMediaUrl(audioSource.originalFilePath)} />
      )}
    </div>
  )
}

export default PreviewPlayer
