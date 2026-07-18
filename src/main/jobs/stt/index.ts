import { v4 as uuidv4 } from 'uuid'
import type { Project, SourceClip, TranscriptSegment } from '@shared/types/project'
import type { AppSettings } from '@shared/types/settings'
import { resolveActiveAudioCoverage, mapLocalTimeToUnified } from '@shared/types/timeline-time'
import { createSttProvider } from '../../services/providers/stt'

export interface SttProgressUpdate {
  progress: number
}

function averageConfidence(source: SourceClip): number {
  if (source.syncSegments.length === 0) return 0
  return (
    source.syncSegments.reduce((sum, seg) => sum + seg.confidence, 0) / source.syncSegments.length
  )
}

/**
 * Picks one representative audio-bearing source for consumers that need a single whole file
 * (e.g. the local heuristic heatmap scorer) rather than per-time-range coverage: prefers the
 * user-flagged "main" source, else whichever audio-bearing source has the highest average sync
 * confidence.
 */
export function pickActiveAudioSource(project: Project): SourceClip | undefined {
  const mainSource = project.sources.find((s) => s.role === 'main' && s.probed.hasAudio)
  if (mainSource) return mainSource

  const audioSources = project.sources.filter((s) => s.probed.hasAudio)
  if (audioSources.length === 0) return undefined
  return audioSources.reduce((best, current) =>
    averageConfidence(current) > averageConfidence(best) ? current : best
  )
}

export async function runSttForProject(
  project: Project,
  settings: AppSettings,
  onProgress?: (update: SttProgressUpdate) => void
): Promise<TranscriptSegment[]> {
  const coverage = resolveActiveAudioCoverage(
    project.sources,
    project.edit.activeVideoIntervals,
    project.edit.activeAudioIntervals,
    project.timelineDurationSec
  )
  if (coverage.length === 0) {
    throw new Error('Keine Quelle mit Audiospur zum Transkribieren gefunden.')
  }

  const sourceIds = Array.from(new Set(coverage.map((c) => c.sourceId)))
  const provider = createSttProvider(project.providerConfig.stt.provider, settings)
  const result: TranscriptSegment[] = []

  for (let i = 0; i < sourceIds.length; i++) {
    const source = project.sources.find((s) => s.id === sourceIds[i])
    if (!source) continue

    const ownCoverage = coverage.filter((c) => c.sourceId === source.id)
    const { segments } = await provider.transcribe({
      audioFilePath: source.originalFilePath,
      languageHint: project.providerConfig.stt.languageHint,
      onProgress: (progress) => onProgress?.({ progress: (i + progress) / sourceIds.length })
    })

    for (const segment of segments) {
      const unifiedStartSec = mapLocalTimeToUnified(source, segment.startSec)
      const unifiedEndSec = mapLocalTimeToUnified(source, segment.endSec)
      if (unifiedStartSec === null || unifiedEndSec === null) continue

      // Attribute the whole segment to whichever of this source's own coverage windows it
      // overlaps most, rather than splitting it across every window it touches — segment-level
      // (not word-level) STT output can't be cut mid-sentence without duplicating the text.
      let bestCoverage: (typeof ownCoverage)[number] | undefined
      let bestOverlapSec = 0
      for (const cov of ownCoverage) {
        const overlapSec =
          Math.min(unifiedEndSec, cov.unifiedEndSec) -
          Math.max(unifiedStartSec, cov.unifiedStartSec)
        if (overlapSec > bestOverlapSec) {
          bestOverlapSec = overlapSec
          bestCoverage = cov
        }
      }
      if (!bestCoverage) continue

      result.push({
        id: uuidv4(),
        startSec: Math.max(unifiedStartSec, bestCoverage.unifiedStartSec),
        endSec: Math.min(unifiedEndSec, bestCoverage.unifiedEndSec),
        text: segment.text,
        sourceClipId: source.id,
        provider: provider.id
      })
    }
  }

  return result.sort((a, b) => a.startSec - b.startSec)
}
