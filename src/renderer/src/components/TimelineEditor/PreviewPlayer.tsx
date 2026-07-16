import { useEffect, useRef } from 'react'
import { useProjectStore } from '../../state/project-store'
import { usePlaybackStore } from '../../state/playback-store'
import {
  resolveIntervalAt,
  mapUnifiedTimeToLocal,
  mapLocalTimeToUnified
} from '../../lib/timeline-edit'
import { toMediaUrl } from '@shared/types/media-url'

// Resync threshold: below this we trust the element's own playback clock (avoids seek jitter);
// above it we treat the change as an explicit scrub and force a seek.
const RESYNC_THRESHOLD_SEC = 0.3

function PreviewPlayer(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const playheadSec = usePlaybackStore((state) => state.playheadSec)
  const isPlaying = usePlaybackStore((state) => state.isPlaying)
  const seek = usePlaybackStore((state) => state.seek)
  const pause = usePlaybackStore((state) => state.pause)

  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const activeVideoId = project
    ? (resolveIntervalAt(project.edit.activeVideoIntervals, playheadSec)?.value ??
      project.sources.find((s) => s.probed.hasVideo)?.id)
    : undefined
  const activeAudioId = project
    ? (resolveIntervalAt(project.edit.primaryAudioIntervals, playheadSec)?.value ?? activeVideoId)
    : undefined

  const videoSource = project?.sources.find((s) => s.id === activeVideoId)
  const audioSource =
    activeAudioId !== activeVideoId
      ? project?.sources.find((s) => s.id === activeAudioId)
      : undefined

  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoSource) return
    const localTime = mapUnifiedTimeToLocal(videoSource, playheadSec)
    if (localTime === null) return
    if (Math.abs(video.currentTime - localTime) > RESYNC_THRESHOLD_SEC) {
      video.currentTime = localTime
    }
  }, [playheadSec, videoSource])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioSource) return
    const localTime = mapUnifiedTimeToLocal(audioSource, playheadSec)
    if (localTime === null) return
    if (Math.abs(audio.currentTime - localTime) > RESYNC_THRESHOLD_SEC) {
      audio.currentTime = localTime
    }
  }, [playheadSec, audioSource])

  useEffect(() => {
    if (isPlaying) {
      videoRef.current?.play().catch(() => {})
      audioRef.current?.play().catch(() => {})
    } else {
      videoRef.current?.pause()
      audioRef.current?.pause()
    }
  }, [isPlaying, videoSource, audioSource])

  const handleTimeUpdate = (): void => {
    if (!isPlaying || !videoSource) return
    const video = videoRef.current
    if (!video) return
    const unified = mapLocalTimeToUnified(videoSource, video.currentTime)
    if (unified !== null) seek(unified)
  }

  if (!project) return null

  if (!videoSource) {
    return (
      <div className="preview-player preview-player--empty">
        Keine aktive Kamera für diesen Zeitpunkt.
      </div>
    )
  }

  return (
    <div className="preview-player">
      <video
        key={videoSource.id}
        ref={videoRef}
        className="preview-player__video"
        src={toMediaUrl(videoSource.originalFilePath)}
        muted={!!audioSource}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => pause()}
      />
      {audioSource && (
        <audio key={audioSource.id} ref={audioRef} src={toMediaUrl(audioSource.originalFilePath)} />
      )}
    </div>
  )
}

export default PreviewPlayer
