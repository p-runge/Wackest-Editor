import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildExportSegments, groupAudioSpans } from './edl'
import {
  renderExportVideoSegment,
  renderExportAudioSegment,
  muxVideoAudio,
  concatSegments,
  probeFile
} from '../../services/ffmpeg'
import { mapUnifiedTimeToLocal } from '@shared/types/timeline-time'
import type { Project, SourceClip } from '@shared/types/project'

export interface ExportProgressUpdate {
  stage: 'rendering-video' | 'rendering-audio' | 'concatenating' | 'muxing' | 'done'
  segmentIndex?: number
  segmentCount?: number
  progress: number
}

function resolveTargetOutput(sources: SourceClip[]): {
  width: number
  height: number
  fps: number
} {
  const mainSource = sources.find((s) => s.role === 'main' && s.probed.hasVideo)
  const source = mainSource ?? sources.find((s) => s.probed.hasVideo)
  const width = source?.probed.width ?? 1920
  const height = source?.probed.height ?? 1080
  // A single uniform output fps for every segment so stream-copy concat stays exact (mixed frame
  // rates otherwise truncate the concat — see renderExportVideoSegment). Rounded, sane fallback.
  const rawFps = source?.probed.frameRate
  const fps = rawFps && rawFps > 0 ? Math.min(60, Math.max(24, Math.round(rawFps))) : 30
  // libx264 (yuv420p) requires even dimensions
  return {
    width: width % 2 === 0 ? width : width + 1,
    height: height % 2 === 0 ? height : height + 1,
    fps
  }
}

export async function runExportForProject(
  project: Project,
  outputPath: string,
  onProgress?: (update: ExportProgressUpdate) => void
): Promise<void> {
  const segments = buildExportSegments(
    project.edit.keptRanges,
    project.edit.activeVideoIntervals,
    project.edit.activeAudioIntervals,
    project.sources
  )

  if (segments.length === 0) {
    throw new Error(
      'Keine exportierbaren Abschnitte gefunden. Bitte zuerst Kamera/Audio/Schnitt festlegen.'
    )
  }

  const audioSpans = groupAudioSpans(segments)
  const { width, height, fps } = resolveTargetOutput(project.sources)
  const workDir = await mkdtemp(join(tmpdir(), 'wackest-export-'))

  // Video is re-encoded per camera cut; audio is re-encoded only per continuous active-audio span
  // (see `groupAudioSpans`) and muxed back in at the end — re-encoding audio per video cut instead
  // would reintroduce an audible click at every cut, even when the audio source didn't change.
  const VIDEO_PHASE_END = 0.55
  const AUDIO_PHASE_END = 0.8
  const CONCAT_PHASE_END = 0.9

  try {
    const videoSegmentPaths: string[] = []
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const videoSource = project.sources.find((s) => s.id === segment.videoSourceId)
      if (!videoSource) continue

      const videoInSec = mapUnifiedTimeToLocal(videoSource, segment.unifiedStartSec)
      if (videoInSec === null) {
        throw new Error(
          `Zeitpunkt ${segment.unifiedStartSec.toFixed(1)}s liegt außerhalb der Sync-Segmente einer Quelle — bitte Sync prüfen.`
        )
      }

      const segmentPath = join(workDir, `video-${String(i).padStart(4, '0')}.mp4`)
      await renderExportVideoSegment({
        videoFilePath: videoSource.originalFilePath,
        videoInSec,
        durationSec: segment.unifiedEndSec - segment.unifiedStartSec,
        targetWidth: width,
        targetHeight: height,
        targetFps: fps,
        outputPath: segmentPath,
        onProgress: (fraction) =>
          onProgress?.({
            stage: 'rendering-video',
            segmentIndex: i,
            segmentCount: segments.length,
            progress: ((i + fraction) / segments.length) * VIDEO_PHASE_END
          })
      })
      videoSegmentPaths.push(segmentPath)
    }

    const audioSpanPaths: string[] = []
    for (let i = 0; i < audioSpans.length; i++) {
      const span = audioSpans[i]
      const audioSource = project.sources.find((s) => s.id === span.audioSourceId)
      if (!audioSource) continue

      const audioInSec = mapUnifiedTimeToLocal(audioSource, span.unifiedStartSec)
      if (audioInSec === null) {
        throw new Error(
          `Zeitpunkt ${span.unifiedStartSec.toFixed(1)}s liegt außerhalb der Sync-Segmente einer Quelle — bitte Sync prüfen.`
        )
      }

      const spanPath = join(workDir, `audio-${String(i).padStart(4, '0')}.m4a`)
      await renderExportAudioSegment({
        audioFilePath: audioSource.originalFilePath,
        audioInSec,
        durationSec: span.unifiedEndSec - span.unifiedStartSec,
        outputPath: spanPath,
        onProgress: (fraction) =>
          onProgress?.({
            stage: 'rendering-audio',
            segmentIndex: i,
            segmentCount: audioSpans.length,
            progress:
              VIDEO_PHASE_END +
              ((i + fraction) / audioSpans.length) * (AUDIO_PHASE_END - VIDEO_PHASE_END)
          })
      })
      audioSpanPaths.push(spanPath)
    }

    onProgress?.({ stage: 'concatenating', progress: AUDIO_PHASE_END })
    const concatVideoPath = join(workDir, 'video-concat.mp4')
    const concatAudioPath = join(workDir, 'audio-concat.m4a')
    await concatSegments(videoSegmentPaths, concatVideoPath, workDir)
    await concatSegments(audioSpanPaths, concatAudioPath, workDir)
    onProgress?.({ stage: 'concatenating', progress: CONCAT_PHASE_END })

    onProgress?.({ stage: 'muxing', progress: CONCAT_PHASE_END })
    await muxVideoAudio(concatVideoPath, concatAudioPath, outputPath)

    // Safety net against silent truncation (a mismatched-codec concat, or the muxer's `-shortest`
    // clipping to a too-short stream): the output must be ~as long as the sum of the exported
    // segments. Fail loudly instead of leaving the user with a quietly-shortened file.
    const expectedSec = segments.reduce(
      (s, seg) => s + (seg.unifiedEndSec - seg.unifiedStartSec),
      0
    )
    const probed = await probeFile(outputPath)
    if (probed.durationSec < expectedSec - 1.0) {
      throw new Error(
        `Export unvollständig: ${probed.durationSec.toFixed(1)}s statt erwarteter ` +
          `${expectedSec.toFixed(1)}s. Ein Clip wurde nicht vollständig exportiert — bitte Sync ` +
          `prüfen und erneut exportieren.`
      )
    }

    onProgress?.({ stage: 'done', progress: 1 })
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
