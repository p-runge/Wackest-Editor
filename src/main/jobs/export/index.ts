import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildExportSegments } from './edl'
import { renderExportSegment, concatSegments } from '../../services/ffmpeg'
import { mapUnifiedTimeToLocal } from '@shared/types/timeline-time'
import type { Project, SourceClip } from '@shared/types/project'

export interface ExportProgressUpdate {
  stage: 'rendering' | 'concatenating' | 'done'
  segmentIndex?: number
  segmentCount?: number
  progress: number
}

function resolveTargetResolution(sources: SourceClip[]): { width: number; height: number } {
  const mainSource = sources.find((s) => s.role === 'main' && s.probed.hasVideo)
  const source = mainSource ?? sources.find((s) => s.probed.hasVideo)
  const width = source?.probed.width ?? 1920
  const height = source?.probed.height ?? 1080
  // libx264 (yuv420p) requires even dimensions
  return {
    width: width % 2 === 0 ? width : width + 1,
    height: height % 2 === 0 ? height : height + 1
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
    project.edit.primaryAudioIntervals,
    project.sources
  )

  if (segments.length === 0) {
    throw new Error(
      'Keine exportierbaren Abschnitte gefunden. Bitte zuerst Kamera/Audio/Schnitt festlegen.'
    )
  }

  const { width, height } = resolveTargetResolution(project.sources)
  const workDir = await mkdtemp(join(tmpdir(), 'wackest-export-'))

  try {
    const segmentPaths: string[] = []

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const videoSource = project.sources.find((s) => s.id === segment.videoSourceId)
      const audioSource = project.sources.find((s) => s.id === segment.audioSourceId)
      if (!videoSource || !audioSource) continue

      const videoInSec = mapUnifiedTimeToLocal(videoSource, segment.unifiedStartSec)
      const audioInSec = mapUnifiedTimeToLocal(audioSource, segment.unifiedStartSec)
      if (videoInSec === null || audioInSec === null) {
        throw new Error(
          `Zeitpunkt ${segment.unifiedStartSec.toFixed(1)}s liegt außerhalb der Sync-Segmente einer Quelle — bitte Sync prüfen.`
        )
      }

      const segmentPath = join(workDir, `segment-${String(i).padStart(4, '0')}.mp4`)
      await renderExportSegment({
        videoFilePath: videoSource.originalFilePath,
        videoInSec,
        audioFilePath: audioSource.originalFilePath,
        audioInSec,
        durationSec: segment.unifiedEndSec - segment.unifiedStartSec,
        targetWidth: width,
        targetHeight: height,
        outputPath: segmentPath,
        onProgress: (fraction) =>
          onProgress?.({
            stage: 'rendering',
            segmentIndex: i,
            segmentCount: segments.length,
            progress: (i + fraction) / segments.length
          })
      })
      segmentPaths.push(segmentPath)
    }

    onProgress?.({ stage: 'concatenating', progress: 0.95 })
    await concatSegments(segmentPaths, outputPath, workDir)
    onProgress?.({ stage: 'done', progress: 1 })
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
