import { extractMonoPcmSamples, SYNC_SAMPLE_RATE } from '../../ffmpeg'
import type { HeatmapPoint } from '@shared/types/project'
import type { HeatmapProvider, HeatmapScoreInput } from './types'

function bucketRanges(durationSec: number, bucketSec: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (let start = 0; start < durationSec; start += bucketSec) {
    ranges.push([start, Math.min(durationSec, start + bucketSec)])
  }
  return ranges
}

function computeEnergyPerBucket(
  samples: Int16Array,
  sampleRate: number,
  ranges: Array<[number, number]>
): number[] {
  return ranges.map(([start, end]) => {
    const startIdx = Math.floor(start * sampleRate)
    const endIdx = Math.min(samples.length, Math.floor(end * sampleRate))
    if (endIdx <= startIdx) return 0
    let sum = 0
    for (let i = startIdx; i < endIdx; i++) {
      const v = samples[i] / 32768
      sum += v * v
    }
    return Math.sqrt(sum / (endIdx - startIdx))
  })
}

function countWordsAndExcitementMarks(text: string): { words: number; excitementMarks: number } {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const excitementMarks = (text.match(/[!?]/g) ?? []).length
  return { words, excitementMarks }
}

/** Min-max normalizes to [0,1]; a flat/constant series maps to a neutral 0.5 everywhere. */
function normalize(values: number[]): number[] {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  if (range < 1e-9) return values.map(() => 0.5)
  return values.map((v) => (v - min) / range)
}

const ENERGY_WEIGHT = 0.4
const SPEAKING_RATE_WEIGHT = 0.3
const EXCITEMENT_WEIGHT = 0.3
const SIGNAL_HIGHLIGHT_THRESHOLD = 0.66

export function createHeuristicLocalProvider(): HeatmapProvider {
  return {
    id: 'heuristic-local',
    async score(input: HeatmapScoreInput): Promise<HeatmapPoint[]> {
      const ranges = bucketRanges(input.timelineDurationSec, input.bucketSec)
      if (ranges.length === 0) return []

      let energyPerBucket = ranges.map(() => 0)
      if (input.audioFilePath) {
        const samples = await extractMonoPcmSamples(input.audioFilePath)
        energyPerBucket = computeEnergyPerBucket(samples, SYNC_SAMPLE_RATE, ranges)
      }
      input.onProgress?.(0.5)

      const speakingRatePerBucket = ranges.map(() => 0)
      const excitementPerBucket = ranges.map(() => 0)

      for (const segment of input.transcript) {
        const { words, excitementMarks } = countWordsAndExcitementMarks(segment.text)
        const duration = Math.max(0.1, segment.endSec - segment.startSec)
        const rate = words / duration

        ranges.forEach(([start, end], i) => {
          const overlap = Math.min(segment.endSec, end) - Math.max(segment.startSec, start)
          if (overlap > 0) {
            const fraction = overlap / duration
            speakingRatePerBucket[i] += rate * fraction
            excitementPerBucket[i] += excitementMarks * fraction
          }
        })
      }

      const normEnergy = normalize(energyPerBucket)
      const normRate = normalize(speakingRatePerBucket)
      const normExcitement = normalize(excitementPerBucket)

      const points: HeatmapPoint[] = ranges.map(([start, end], i) => {
        const score =
          ENERGY_WEIGHT * normEnergy[i] +
          SPEAKING_RATE_WEIGHT * normRate[i] +
          EXCITEMENT_WEIGHT * normExcitement[i]

        const signals: string[] = []
        if (normEnergy[i] > SIGNAL_HIGHLIGHT_THRESHOLD) signals.push('hohe Lautstärke')
        if (normRate[i] > SIGNAL_HIGHLIGHT_THRESHOLD) signals.push('schnelles Sprechtempo')
        if (normExcitement[i] > SIGNAL_HIGHLIGHT_THRESHOLD) signals.push('viele Ausrufe/Fragen')

        return {
          startSec: start,
          endSec: end,
          score: Math.max(0, Math.min(1, score)),
          reason: signals.length > 0 ? signals.join(', ') : undefined,
          provider: 'heuristic-local'
        }
      })

      input.onProgress?.(1)
      return points
    }
  }
}
