import { extractFramesAt, type ExtractedFrame } from '../../ffmpeg'
import type { HeatmapPoint, SourceClip } from '@shared/types/project'
import { bucketsForSource, pointsFromBuckets, type SourceBucket } from './track-common'

// Batch several frames per model request to cut round-trips/latency.
export const VISION_BATCH_SIZE = 6

export interface RawVisionScore {
  index: number
  score: number
  reason: string
}

export const VISION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Zero-based index of the frame being scored' },
          score: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' }
        },
        required: ['index', 'score', 'reason']
      }
    }
  },
  required: ['scores']
}

export function buildVisionPrompt(frameCount: number): string {
  return `Du bewertest ${frameCount} Standbilder aus verschiedenen Kamera-Perspektiven eines Videos, um für einen automatischen Kameraschnitt die interessanteste Einstellung zu finden. Bewerte JEDES Bild einzeln mit einem Interesse-Score von 0 (uninteressant: leere/statische/unscharfe Einstellung, niemand im Fokus) bis 1 (sehr interessant: die sprechende/aktive Person gut im Bild, ausdrucksstark, klare Handlung). Gib je Bild einen kurzen Grund (max. 8 Wörter, Deutsch) an. Die Bilder folgen in Reihenfolge; nutze den 0-basierten Index. Antworte ausschließlich über das bereitgestellte Schema.`
}

/** Per-source frames sampled at each bucket's midpoint (source-local time), for the vision model. */
export async function sampleFramesForSource(
  source: SourceClip,
  bucketSec: number,
  filePath: string
): Promise<{ buckets: SourceBucket[]; frames: ExtractedFrame[] }> {
  const buckets = bucketsForSource(source, bucketSec)
  const midpoints = buckets.map((b) => (b.localStartSec + b.localEndSec) / 2)
  const frames = await extractFramesAt(filePath, midpoints)
  return { buckets, frames }
}

/**
 * Shared assembly: given a per-frame scoring function (provider-specific model call, batched),
 * runs every source's frames through it and builds one TrackHeatmap per source. Vision scores are
 * already absolute 0..1 judgements, so they're used directly (clamped) without cross-source
 * renormalization.
 */
export async function scoreSourcesWithVision(
  videoSources: SourceClip[],
  bucketSec: number,
  sourceMediaPaths: Record<string, string>,
  scoreFrames: (frames: ExtractedFrame[]) => Promise<RawVisionScore[]>,
  onProgress?: (progress: number) => void
): Promise<Array<{ sourceId: string; points: HeatmapPoint[] }>> {
  const results: Array<{ sourceId: string; points: HeatmapPoint[] }> = []
  for (let s = 0; s < videoSources.length; s++) {
    const source = videoSources[s]
    const path = sourceMediaPaths[source.id]
    if (!path) {
      results.push({ sourceId: source.id, points: [] })
      continue
    }
    const { buckets, frames } = await sampleFramesForSource(source, bucketSec, path)

    const scores = buckets.map(() => 0)
    const reasons: Array<string | undefined> = buckets.map(() => undefined)
    for (let start = 0; start < frames.length; start += VISION_BATCH_SIZE) {
      const batch = frames.slice(start, start + VISION_BATCH_SIZE)
      const scored = await scoreFrames(batch)
      for (const { index, score, reason } of scored) {
        const bucketIdx = start + index
        if (bucketIdx < scores.length) {
          scores[bucketIdx] = Math.max(0, Math.min(1, score))
          reasons[bucketIdx] = reason
        }
      }
    }

    results.push({
      sourceId: source.id,
      points: pointsFromBuckets(buckets, scores, (i) => reasons[i])
    })
    onProgress?.((s + 1) / videoSources.length)
  }
  return results
}
