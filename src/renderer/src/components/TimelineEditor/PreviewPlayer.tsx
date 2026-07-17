import { useEffect, useRef } from 'react'
import { useProjectStore } from '../../state/project-store'
import { usePlaybackStore } from '../../state/playback-store'
import {
  resolveVideoSourceId,
  resolveAudioSourceId,
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
    ? resolveVideoSourceId(project.edit.activeVideoIntervals, project.sources, playheadSec)
    : undefined
  const activeAudioId = project
    ? resolveAudioSourceId(
        project.edit.primaryAudioIntervals,
        project.sources,
        playheadSec,
        activeVideoId
      )
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

  // Interval bounds are exclusive at their end, so the exact last instant of the timeline
  // resolves no active source at all — the <video>/<audio> elements unmount right before their
  // native "ended" event would fire, which would otherwise leave isPlaying stuck true with
  // nothing left to drive it forward. Force a clean stop once the playhead truly reaches the end.
  useEffect(() => {
    if (isPlaying && project && playheadSec >= project.timelineDurationSec) pause()
  }, [isPlaying, playheadSec, project, pause])

  // Called whenever the currently playing source's local time isn't covered by any of its own
  // sync segments — either a gap between two segments of the same file (a hard cut: footage that
  // was recorded but isn't part of the edit) or having played past the last segment entirely
  // (native "ended", or a raw file that runs on past its last usable segment). Jumps straight to
  // wherever this source's next usable footage is, so the active-source resolution above can pick
  // up the correct source there — only truly pausing once we've reached the actual timeline end.
  const advancePastGap = (localTimeSec: number): void => {
    if (!project || !videoSource) return
    const next = videoSource.syncSegments
      .filter((seg) => seg.localStartSec > localTimeSec)
      .sort((a, b) => a.localStartSec - b.localStartSec)[0]
    if (next) {
      seek(next.localStartSec + next.offsetSec)
      return
    }
    const sourceEndUnifiedSec = videoSource.syncSegments.reduce(
      (max, seg) => Math.max(max, seg.localEndSec + seg.offsetSec),
      0
    )
    if (sourceEndUnifiedSec >= project.timelineDurationSec - RESYNC_THRESHOLD_SEC) {
      pause()
    } else {
      seek(sourceEndUnifiedSec)
    }
  }

  const handleTimeUpdate = (): void => {
    if (!isPlaying || !videoSource) return
    const video = videoRef.current
    if (!video) return
    const unified = mapLocalTimeToUnified(videoSource, video.currentTime)
    if (unified !== null) seek(unified)
    else advancePastGap(video.currentTime)
  }

  const handleEnded = (): void => {
    if (videoRef.current) advancePastGap(videoRef.current.currentTime)
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
        onEnded={handleEnded}
      />
      {audioSource && (
        <audio key={audioSource.id} ref={audioRef} src={toMediaUrl(audioSource.originalFilePath)} />
      )}
    </div>
  )
}

export default PreviewPlayer
