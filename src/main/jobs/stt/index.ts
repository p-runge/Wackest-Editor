import { v4 as uuidv4 } from 'uuid'
import type { Project, SourceClip, TranscriptSegment } from '@shared/types/project'
import type { AppSettings } from '@shared/types/settings'
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
 * Explicit `transcriptionSourceClipId` wins; otherwise prefer the user-flagged "main" source;
 * otherwise fall back to whichever audio-bearing source has the highest average sync confidence.
 */
export function pickTranscriptionSource(project: Project): SourceClip | undefined {
  if (project.providerConfig.transcriptionSourceClipId) {
    const explicit = project.sources.find(
      (s) => s.id === project.providerConfig.transcriptionSourceClipId
    )
    if (explicit) return explicit
  }

  const mainSource = project.sources.find((s) => s.role === 'main' && s.probed.hasAudio)
  if (mainSource) return mainSource

  const audioSources = project.sources.filter((s) => s.probed.hasAudio)
  if (audioSources.length === 0) return undefined
  return audioSources.reduce((best, current) =>
    averageConfidence(current) > averageConfidence(best) ? current : best
  )
}

/** Maps a source-local timestamp onto the unified project timeline via its resolved sync segments. */
function mapLocalTimeToUnified(source: SourceClip, localTimeSec: number): number {
  const containing = source.syncSegments.find(
    (seg) => localTimeSec >= seg.localStartSec && localTimeSec < seg.localEndSec
  )
  const segment = containing ?? source.syncSegments[0]
  return segment ? localTimeSec + segment.offsetSec : localTimeSec
}

export async function runSttForProject(
  project: Project,
  settings: AppSettings,
  onProgress?: (update: SttProgressUpdate) => void
): Promise<TranscriptSegment[]> {
  const source = pickTranscriptionSource(project)
  if (!source) {
    throw new Error('Keine Quelle mit Audiospur zum Transkribieren gefunden.')
  }

  const provider = createSttProvider(project.providerConfig.stt.provider, settings)
  const { segments } = await provider.transcribe({
    audioFilePath: source.originalFilePath,
    languageHint: project.providerConfig.stt.languageHint,
    onProgress: (progress) => onProgress?.({ progress })
  })

  return segments.map((segment) => ({
    id: uuidv4(),
    startSec: mapLocalTimeToUnified(source, segment.startSec),
    endSec: mapLocalTimeToUnified(source, segment.endSec),
    text: segment.text,
    sourceClipId: source.id,
    provider: provider.id
  }))
}
