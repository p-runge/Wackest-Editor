import { crossCorrelate, type CrossCorrelationResult } from './cross-correlate'
import { MIN_TRUSTED_CONFIDENCE } from './constants'

const WINDOW_MARGIN_SEC = 10 * 60 // ±10 min search window around an mtime-based expectation
const CHUNK_SEC = 10 * 60 // fallback full-range scan chunk size
const CHUNK_OVERLAP_SEC = 60

export interface PairwiseSyncResult extends CrossCorrelationResult {
  offsetSec: number
}

/**
 * Correlates `querySamples` against `referenceSamples` (both full-segment mono PCM at sampleRate).
 * Uses a bounded windowed search around `expectedOffsetSec` when available (fast, avoids huge FFTs
 * on multi-hour references); falls back to a chunked full-range scan otherwise.
 */
export function pairwiseCorrelate(
  referenceSamples: Int16Array,
  querySamples: Int16Array,
  sampleRate: number,
  expectedOffsetSec: number | null
): PairwiseSyncResult {
  if (expectedOffsetSec !== null) {
    const windowed = correlateWindowed(
      referenceSamples,
      querySamples,
      sampleRate,
      expectedOffsetSec
    )
    if (windowed.confidence >= MIN_TRUSTED_CONFIDENCE) return windowed
  }
  return correlateChunked(referenceSamples, querySamples, sampleRate)
}

function correlateWindowed(
  referenceSamples: Int16Array,
  querySamples: Int16Array,
  sampleRate: number,
  expectedOffsetSec: number
): PairwiseSyncResult {
  const centerSample = Math.round(expectedOffsetSec * sampleRate)
  const marginSamples = Math.round(WINDOW_MARGIN_SEC * sampleRate)
  const windowStart = Math.max(0, centerSample - marginSamples)
  const windowEnd = Math.min(
    referenceSamples.length,
    centerSample + marginSamples + querySamples.length
  )
  if (windowEnd <= windowStart) return { lagSamples: 0, confidence: 0, offsetSec: 0 }

  const refWindow = referenceSamples.subarray(windowStart, windowEnd)
  const result = crossCorrelate(refWindow, querySamples)
  return { ...result, offsetSec: (windowStart + result.lagSamples) / sampleRate }
}

function correlateChunked(
  referenceSamples: Int16Array,
  querySamples: Int16Array,
  sampleRate: number
): PairwiseSyncResult {
  const chunkSamples = Math.round(CHUNK_SEC * sampleRate)
  const overlapSamples = Math.round(CHUNK_OVERLAP_SEC * sampleRate)
  const step = Math.max(1, chunkSamples - overlapSamples)

  let best: PairwiseSyncResult = { lagSamples: 0, confidence: 0, offsetSec: 0 }

  for (let chunkStart = 0; chunkStart < referenceSamples.length; chunkStart += step) {
    const chunkEnd = Math.min(
      referenceSamples.length,
      chunkStart + chunkSamples + querySamples.length
    )
    const chunk = referenceSamples.subarray(chunkStart, chunkEnd)
    if (chunk.length > querySamples.length) {
      const result = crossCorrelate(chunk, querySamples)
      if (result.confidence > best.confidence) {
        best = { ...result, offsetSec: (chunkStart + result.lagSamples) / sampleRate }
      }
    }
    if (chunkEnd >= referenceSamples.length) break
  }

  return best
}
