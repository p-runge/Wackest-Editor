import { useEffect, useRef } from 'react'
import { useProjectStore } from '../../state/project-store'
import { usePlaybackStore } from '../../state/playback-store'
import {
  mapUnifiedTimeToLocal,
  mapPlacementTimeToContentTime,
  computeProgramEndSec
} from '../../lib/timeline-edit'
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

  // playheadSec (program/placement axis) is always driven from here, never derived back from a
  // playing media element's own clock — that round trip (local time -> content time -> placement
  // time, searching every kept range) was ambiguous enough at chunk boundaries to make playback
  // ping-pong between two points after moving/swapping chunks. A single real-time rAF loop is the
  // one source of truth for "where we are", so playback is always strictly linear from 0s to the
  // program end, regardless of whether a source happens to be active at any given instant.
  useEffect(() => {
    if (!isPlaying || !project) return
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
  }, [isPlaying, project, seek, pause])

  // Video/audio elements are pure followers of the rAF-driven playheadSec above: nudged back in
  // line whenever they've drifted from their target local time by more than the resync threshold,
  // never treated as the driver themselves. Both derive from the same contentSec, so they can never
  // disagree about which instant they should be showing/playing — fixes stale/wrong audio that
  // used to linger when it was only corrected against a video-clock-derived time.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoSource || contentSec === null) return
    const localTime = mapUnifiedTimeToLocal(videoSource, contentSec)
    if (localTime === null) {
      video.pause()
      return
    }
    if (Math.abs(video.currentTime - localTime) > RESYNC_THRESHOLD_SEC) {
      video.currentTime = localTime
    }
    if (isPlaying && video.paused) video.play().catch(() => {})
  }, [contentSec, videoSource, isPlaying])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioSource || contentSec === null) return
    const localTime = mapUnifiedTimeToLocal(audioSource, contentSec)
    if (localTime === null) {
      audio.pause()
      return
    }
    if (Math.abs(audio.currentTime - localTime) > RESYNC_THRESHOLD_SEC) {
      audio.currentTime = localTime
    }
    if (isPlaying && audio.paused) audio.play().catch(() => {})
  }, [contentSec, audioSource, isPlaying])

  useEffect(() => {
    if (isPlaying) {
      videoRef.current?.play().catch(() => {})
      audioRef.current?.play().catch(() => {})
    } else {
      videoRef.current?.pause()
      audioRef.current?.pause()
    }
  }, [isPlaying, videoSource, audioSource])

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
      />
      {audioSource && (
        <audio key={audioSource.id} ref={audioRef} src={toMediaUrl(audioSource.originalFilePath)} />
      )}
    </div>
  )
}

export default PreviewPlayer
