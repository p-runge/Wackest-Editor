import { useEffect, useRef } from 'react'
import { useProjectStore } from '../../state/project-store'
import { usePlaybackStore } from '../../state/playback-store'
import {
  mapUnifiedTimeToLocal,
  mapLocalTimeToUnified,
  mapPlacementTimeToContentTime,
  findKeptRangeAt,
  keptRangeContentSpan,
  computeProgramEndSec
} from '../../lib/timeline-edit'
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

  // Entering a stretch with nothing to play unmounts the <video>/<audio> elements, so nothing is
  // left to drive `playheadSec` forward via "timeupdate". In a cut gap, playback skips straight
  // to the next chunk and keeps going — the program only truly ends after the last chunk. Only a
  // stretch whose *content* has no source at all (hard-cut gap) still stops playback.
  useEffect(() => {
    if (!isPlaying || !project || videoSource || audioSource) return
    if (contentSec === null) {
      const next = project.edit.keptRanges
        .filter((r) => r.startSec > playheadSec)
        .sort((a, b) => a.startSec - b.startSec)[0]
      if (next) seek(next.startSec)
      else pause()
      return
    }
    pause()
  }, [isPlaying, videoSource, audioSource, contentSec, playheadSec, project, seek, pause])

  // Called when playback runs past the end of the current chunk's content (or the playing file's
  // own footage). Program playback advances in PLACEMENT order, skipping cut gaps: jump straight
  // to the next chunk's start, and only pause once no chunk follows (end of the program).
  const advancePastChunk = (): void => {
    if (!project) return
    const chunk = findKeptRangeAt(project.edit.keptRanges, playheadSec)
    if (!chunk) {
      pause()
      return
    }
    const next = project.edit.keptRanges
      .filter((r) => r.startSec >= chunk.endSec)
      .sort((a, b) => a.startSec - b.startSec)[0]
    if (next) seek(next.startSec)
    else pause()
  }

  const handleTimeUpdate = (): void => {
    if (!isPlaying || !videoSource || !project) return
    const video = videoRef.current
    if (!video) return
    const chunk = findKeptRangeAt(project.edit.keptRanges, playheadSec)
    if (!chunk) return
    const contentUnified = mapLocalTimeToUnified(videoSource, video.currentTime)
    const span = keptRangeContentSpan(chunk)
    if (contentUnified !== null && contentUnified < span.endSec) {
      seek(chunk.startSec + (contentUnified - span.startSec))
    } else {
      advancePastChunk()
    }
  }

  const handleEnded = (): void => {
    if (videoRef.current) advancePastChunk()
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
    const inHardCutGap = project.hardCutMarkers.some(
      (gapStartSec) => contentSec >= gapStartSec && contentSec < gapStartSec + NO_OVERLAP_GAP_SEC
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
