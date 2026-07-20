import { extractFramesAt, type ExtractedFrame } from '../../ffmpeg'
import type { HeatmapPoint, SourceClip } from '@shared/types/project'
import { planSampling, VISION_BATCH_SIZE, type SamplingDensity } from '@shared/types/sampling'

export { VISION_BATCH_SIZE }

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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Shared assembly for the vision providers: plans adaptive, density-based multi-frame sampling per
 * source (bounded by a global frame cap), extracts the frames, scores them via the provider's
 * model call (batched), then aggregates each bucket's frames to a single score (the max, so a bucket
 * counts as interesting if any sampled frame is) with the reason of its best frame.
 */
export async function scoreSourcesWithVision(
  videoSources: SourceClip[],
  density: SamplingDensity,
  sourceMediaPaths: Record<string, string>,
  scoreFrames: (frames: ExtractedFrame[]) => Promise<RawVisionScore[]>,
  onProgress?: (progress: number) => void
): Promise<Array<{ sourceId: string; points: HeatmapPoint[] }>> {
  const plan = planSampling(videoSources, density)
  const results: Array<{ sourceId: string; points: HeatmapPoint[] }> = []

  for (let s = 0; s < plan.perSource.length; s++) {
    const sourcePlan = plan.perSource[s]
    const path = sourceMediaPaths[sourcePlan.sourceId]
    if (!path) {
      results.push({ sourceId: sourcePlan.sourceId, points: [] })
      continue
    }

    const flatTimestamps = sourcePlan.bucketLocalTimestamps.flat()
    const frames = await extractFramesAt(path, flatTimestamps)

    const scores = frames.map(() => 0)
    const reasons: Array<string | undefined> = frames.map(() => undefined)
    for (let start = 0; start < frames.length; start += VISION_BATCH_SIZE) {
      const batch = frames.slice(start, start + VISION_BATCH_SIZE)
      const scored = await scoreFrames(batch)
      for (const { index, score, reason } of scored) {
        const globalIndex = start + index
        if (globalIndex >= 0 && globalIndex < scores.length) {
          scores[globalIndex] = clamp01(score)
          reasons[globalIndex] = reason
        }
      }
    }

    // Aggregate each bucket's frames (max score, reason of the best frame) into one point.
    const points: HeatmapPoint[] = []
    let cursor = 0
    sourcePlan.bucketLocalTimestamps.forEach((timestamps, bucketIndex) => {
      let bestScore = 0
      let bestReason: string | undefined
      for (let k = 0; k < timestamps.length; k++) {
        if (scores[cursor + k] >= bestScore) {
          bestScore = scores[cursor + k]
          bestReason = reasons[cursor + k]
        }
      }
      cursor += timestamps.length
      const [startSec, endSec] = sourcePlan.bucketUnifiedRanges[bucketIndex]
      points.push({ startSec, endSec, score: bestScore, reason: bestReason })
    })

    results.push({ sourceId: sourcePlan.sourceId, points })
    onProgress?.((s + 1) / plan.perSource.length)
  }

  return results
}
