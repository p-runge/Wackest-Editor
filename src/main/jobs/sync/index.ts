import { v4 as uuidv4 } from 'uuid'
import { extractMonoPcmSamples, SYNC_SAMPLE_RATE } from '../../services/ffmpeg'
import { detectHardCuts, buildSegmentRanges } from './hard-cut-detection'
import { estimateFileStartEpochMs } from './mtime-estimate'
import { buildAndResolveSyncGraph, type SegmentNode } from './graph'
import type { SourceClip, SyncSegment } from '@shared/types/project'

export interface SyncProgressUpdate {
  stage: 'extracting' | 'correlating' | 'done'
  sourceLabel?: string
  progress: number
}

interface PreparedSource {
  source: SourceClip
  samples: Int16Array
  hardCutMarkers: number[]
  estimatedStartEpochMs: number | null
}

function nodeKey(sourceId: string, segmentIndex: number): string {
  return `${sourceId}#${segmentIndex}`
}

/**
 * Runs hard-cut detection + the pairwise sync graph across all audio-bearing sources of a
 * project, returning updated SourceClip entries with resolved `syncSegments`. Sources without
 * an audio track are returned unchanged (they can only be placed manually).
 */
export async function runSyncForProject(
  sources: SourceClip[],
  onProgress?: (update: SyncProgressUpdate) => void
): Promise<SourceClip[]> {
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
    const hardCutMarkers = detectHardCuts(samples, SYNC_SAMPLE_RATE)
    const estimatedStartEpochMs = await estimateFileStartEpochMs(
      source.originalFilePath,
      source.probed.durationSec
    )
    prepared.push({ source, samples, hardCutMarkers, estimatedStartEpochMs })
  }

  const nodes: SegmentNode[] = []
  for (const p of prepared) {
    const ranges = buildSegmentRanges(p.source.probed.durationSec, p.hardCutMarkers)
    ranges.forEach((range, segmentIndex) => {
      const startSample = Math.round(range.localStartSec * SYNC_SAMPLE_RATE)
      const endSample = Math.round(range.localEndSec * SYNC_SAMPLE_RATE)
      nodes.push({
        sourceId: p.source.id,
        segmentIndex,
        localStartSec: range.localStartSec,
        localEndSec: range.localEndSec,
        samples: p.samples.subarray(startSample, endSample),
        estimatedStartEpochMs: p.estimatedStartEpochMs
      })
    })
  }

  onProgress?.({ stage: 'correlating', progress: 0 })
  const mainSource = sources.find((s) => s.role === 'main')
  const anchorKey = mainSource ? nodeKey(mainSource.id, 0) : null
  const resolved = buildAndResolveSyncGraph(nodes, anchorKey, SYNC_SAMPLE_RATE)
  onProgress?.({ stage: 'done', progress: 1 })

  const segmentsBySource = new Map<string, SyncSegment[]>()
  for (const node of nodes) {
    const resolvedSegment = resolved.get(nodeKey(node.sourceId, node.segmentIndex))
    const segment: SyncSegment = {
      id: uuidv4(),
      localStartSec: node.localStartSec,
      localEndSec: node.localEndSec,
      offsetSec: resolvedSegment?.offsetSec ?? 0,
      confidence: resolvedSegment?.confidence ?? 0,
      method: resolvedSegment?.method ?? 'timestamp-heuristic'
    }
    const list = segmentsBySource.get(node.sourceId) ?? []
    list.push(segment)
    segmentsBySource.set(node.sourceId, list)
  }

  return sources.map((source) => {
    const segments = segmentsBySource.get(source.id)
    if (!segments) return source
    const hardCutMarkers = prepared.find((p) => p.source.id === source.id)?.hardCutMarkers ?? []
    return { ...source, syncSegments: segments, hardCutMarkers }
  })
}
