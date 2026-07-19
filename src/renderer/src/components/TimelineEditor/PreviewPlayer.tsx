import { useEffect, useRef } from 'react'
import { useProjectStore } from '../../state/project-store'
import { usePlaybackStore } from '../../state/playback-store'
import { mapUnifiedTimeToLocal, mapLocalTimeToUnified } from '../../lib/timeline-edit'
import { useResolvedSources } from '../../hooks/useResolvedSources'
import { RESYNC_THRESHOLD_SEC } from '../../lib/playback'
import { toMediaUrl } from '@shared/types/media-url'
import { NO_OVERLAP_GAP_SEC } from '@shared/types/sync-constants'

function PreviewPlayer(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const playheadSec = usePlaybackStore((state) => state.playheadSec)
  const isPlaying = usePlaybackStore((state) => state.isPlaying)
  const seek = usePlaybackStore((state) => state.seek)
  const pause = usePlaybackStore((state) => state.pause)

  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const { activeVideoId, activeAudioId } = useResolvedSources(project, playheadSec)

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

  // Entering a hard-cut gap (no source has footage at this unified time) unmounts the <video>/
  // <audio> elements, so nothing is left to drive `playheadSec` forward via "timeupdate" — without
  // this, playback would silently freeze with isPlaying stuck true instead of visibly stopping.
  useEffect(() => {
    if (isPlaying && !videoSource && !audioSource) pause()
  }, [isPlaying, videoSource, audioSource, pause])

  // Called once the currently playing source has played past its own footage (native "ended", or
  // a raw file that runs on past its usable segment). Jumps to wherever this source's footage
  // ends on the unified timeline, so the active-source resolution above can pick up whatever plays
  // next there (another source, or a hard-cut gap) — only truly pausing at the actual timeline end.
  const advancePastGap = (): void => {
    if (!project || !videoSource) return
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
    else advancePastGap()
  }

  const handleEnded = (): void => {
    if (videoRef.current) advancePastGap()
  }

  if (!project) return null

  if (!videoSource) {
    const inHardCutGap = project.hardCutMarkers.some(
      (gapStartSec) => playheadSec >= gapStartSec && playheadSec < gapStartSec + NO_OVERLAP_GAP_SEC
    )
    return (
      <div className="preview-player preview-player--empty">
        {inHardCutGap
          ? 'Hard Cut: keine Aufnahme überschneidet sich an dieser Stelle.'
          : 'Keine aktive Kamera für diesen Zeitpunkt.'}
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
