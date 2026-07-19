import { v4 as uuidv4 } from 'uuid'
import { extractMonoPcmSamples, SYNC_SAMPLE_RATE } from '../../services/ffmpeg'
import { estimateFileStartEpochMs } from './mtime-estimate'
import { buildAndResolveSyncGraph, nodeKey, type SegmentNode } from './graph'
import type { SourceClip, SyncSegment } from '@shared/types/project'

export interface SyncProgressUpdate {
  stage: 'extracting' | 'correlating' | 'done'
  sourceLabel?: string
  progress: number
}

export interface SyncResult {
  sources: SourceClip[]
}

interface PreparedSource {
  source: SourceClip
  samples: Int16Array
  estimatedStartEpochMs: number | null
}

/**
 * Runs the pairwise sync graph across all audio-bearing sources of a project, returning updated
 * SourceClip entries with a single resolved `syncSegment` each. Clusters with no trustworthy
 * temporal overlap are concatenated directly after the rest. Sources without an audio track are
 * returned unchanged (they can only be placed manually).
 */
export async function runSyncForProject(
  sources: SourceClip[],
  onProgress?: (update: SyncProgressUpdate) => void
): Promise<SyncResult> {
  const audioSources = sources.filter((s) => s.probed.hasAudio)

  const prepared: PreparedSource[] = []
  for (let i = 0; i < audioSources.length; i++) {
    const source = audioSources[i]
    onProgress?.({
      stage: 'extracting',
      sourceLabel: source.label,
      progress: audioSources.length > 0 ? i / audioSources.length : 1
    })
    const samples = await extractMonoPcmSamples(source.originalFilePath)
    const estimatedStartEpochMs = await estimateFileStartEpochMs(
      source.originalFilePath,
      source.probed.durationSec
    )
    prepared.push({ source, samples, estimatedStartEpochMs })
  }

  const nodes: SegmentNode[] = prepared.map((p) => ({
    sourceId: p.source.id,
    segmentIndex: 0,
    localStartSec: 0,
    localEndSec: p.source.probed.durationSec,
    samples: p.samples,
    estimatedStartEpochMs: p.estimatedStartEpochMs
  }))

  onProgress?.({ stage: 'correlating', progress: 0 })
  const mainSource = sources.find((s) => s.role === 'main')
  const anchorKey = mainSource ? nodeKey(mainSource.id, 0) : null
  const { segments: resolved } = buildAndResolveSyncGraph(nodes, anchorKey, SYNC_SAMPLE_RATE)
  onProgress?.({ stage: 'done', progress: 1 })

  const segmentsBySource = new Map<string, SyncSegment>()
  for (const node of nodes) {
    const resolvedSegment = resolved.get(nodeKey(node.sourceId, node.segmentIndex))
    segmentsBySource.set(node.sourceId, {
      id: uuidv4(),
      localStartSec: node.localStartSec,
      localEndSec: node.localEndSec,
      offsetSec: resolvedSegment?.offsetSec ?? 0,
      confidence: resolvedSegment?.confidence ?? 0,
      method: resolvedSegment?.method ?? 'no-overlap-gap'
    })
  }

  const updatedSources = sources.map((source) => {
    const segment = segmentsBySource.get(source.id)
    if (!segment) return source
    return { ...source, syncSegments: [segment] }
  })

  return { sources: updatedSources }
}
