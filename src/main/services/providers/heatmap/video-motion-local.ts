import { extractPerBucketMotion } from '../../ffmpeg'
import type { TrackHeatmap } from '@shared/types/project'
import type { HeatmapProvider, HeatmapScoreInput } from './types'
import { bucketsForSource, normalizeAcrossSources, pointsFromBuckets } from './track-common'

const HIGH = 0.66

/**
 * Pure visual-dynamism heatmap: how much each camera's picture moves over time (per-source frame
 * differencing via ffmpeg). Ignores audio and transcript entirely — useful when the most
 * interesting shot is the one where something is visibly happening. Fully local/offline.
 */
export function createVideoMotionLocalProvider(): HeatmapProvider {
  return {
    id: 'video-motion-local',
    async score(input: HeatmapScoreInput): Promise<TrackHeatmap[]> {
      const perSource = input.videoSources.map((source) => ({
        source,
        buckets: bucketsForSource(source, input.bucketSec)
      }))

      const motionRaw: number[][] = []
      for (let s = 0; s < perSource.length; s++) {
        const { source, buckets } = perSource[s]
        const path = input.sourceMediaPaths[source.id]
        let motion = buckets.map(() => 0)
        if (path && buckets.length > 0) {
          const localRanges = buckets.map(
            (b) => [b.localStartSec, b.localEndSec] as [number, number]
          )
          motion = await extractPerBucketMotion(path, localRanges)
        }
        motionRaw.push(motion)
        input.onProgress?.((s + 1) / perSource.length)
      }

      const motionNorm = normalizeAcrossSources(motionRaw)

      return perSource.map(({ source, buckets }, s) => {
        const points = pointsFromBuckets(buckets, motionNorm[s], (i) =>
          motionNorm[s][i] > HIGH ? 'viel Bewegung im Bild' : undefined
        )
        return { sourceId: source.id, provider: 'video-motion-local', points }
      })
    }
  }
}
