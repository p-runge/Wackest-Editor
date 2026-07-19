import { extractMonoPcmSamples, SYNC_SAMPLE_RATE } from '../../ffmpeg'
import type { HeatmapPoint, TranscriptSegment, TrackHeatmap } from '@shared/types/project'
import type { HeatmapProvider, HeatmapScoreInput } from './types'
import {
  bucketsForSource,
  normalizeAcrossSources,
  pointsFromBuckets,
  type SourceBucket
} from './track-common'

const RMS_WEIGHT = 0.7 // the per-source mic — this is what differs between parallel cameras
const RATE_WEIGHT = 0.3 // global speaking density from the transcript
const HIGH = 0.66

function rmsPerBucket(samples: Int16Array, buckets: SourceBucket[]): number[] {
  return buckets.map((bucket) => {
    const startIdx = Math.max(0, Math.floor(bucket.localStartSec * SYNC_SAMPLE_RATE))
    const endIdx = Math.min(samples.length, Math.floor(bucket.localEndSec * SYNC_SAMPLE_RATE))
    if (endIdx <= startIdx) return 0
    let sum = 0
    for (let i = startIdx; i < endIdx; i++) {
      const v = samples[i] / 32768
      sum += v * v
    }
    return Math.sqrt(sum / (endIdx - startIdx))
  })
}

/** Words/second landing in each bucket's UNIFIED range (transcript times are unified-timeline). */
function speakingRatePerBucket(transcript: TranscriptSegment[], buckets: SourceBucket[]): number[] {
  const rate = buckets.map(() => 0)
  for (const segment of transcript) {
    const words = segment.text.trim().split(/\s+/).filter(Boolean).length
    const duration = Math.max(0.1, segment.endSec - segment.startSec)
    const wps = words / duration
    buckets.forEach((bucket, i) => {
      const overlap =
        Math.min(segment.endSec, bucket.unifiedEndSec) -
        Math.max(segment.startSec, bucket.unifiedStartSec)
      if (overlap > 0) rate[i] += wps * (overlap / duration)
    })
  }
  return rate
}

/**
 * "Who is speaking" heatmap. Each source's own microphone (RMS energy) is the discriminating
 * signal between parallel cameras; the transcript's speaking rate adds a shared "how much is being
 * said" weight. Runs fully local (ffmpeg only), no API and no video decoding.
 */
export function createAudioEnergyLocalProvider(): HeatmapProvider {
  return {
    id: 'audio-energy-local',
    async score(input: HeatmapScoreInput): Promise<TrackHeatmap[]> {
      const perSource = input.videoSources.map((source) => ({
        source,
        buckets: bucketsForSource(source, input.bucketSec)
      }))

      const rmsRaw: number[][] = []
      const rateRaw: number[][] = []
      for (let s = 0; s < perSource.length; s++) {
        const { source, buckets } = perSource[s]
        const path = input.sourceMediaPaths[source.id]
        let rms = buckets.map(() => 0)
        if (path && source.probed.hasAudio) {
          const samples = await extractMonoPcmSamples(path)
          rms = rmsPerBucket(samples, buckets)
        }
        rmsRaw.push(rms)
        rateRaw.push(speakingRatePerBucket(input.transcript, buckets))
        input.onProgress?.((s + 1) / perSource.length)
      }

      const rmsNorm = normalizeAcrossSources(rmsRaw)
      const rateNorm = normalizeAcrossSources(rateRaw)

      return perSource.map(({ source, buckets }, s) => {
        const scores = buckets.map(
          (_, i) => RMS_WEIGHT * rmsNorm[s][i] + RATE_WEIGHT * rateNorm[s][i]
        )
        const points: HeatmapPoint[] = pointsFromBuckets(buckets, scores, (i) => {
          const signals: string[] = []
          if (rmsNorm[s][i] > HIGH) signals.push('spricht (lautes Mikro)')
          if (rateNorm[s][i] > HIGH) signals.push('viel gesprochen')
          return signals.length > 0 ? signals.join(', ') : undefined
        })
        return { sourceId: source.id, provider: 'audio-energy-local', points }
      })
    }
  }
}
