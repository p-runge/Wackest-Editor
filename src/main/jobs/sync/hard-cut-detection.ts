const WINDOW_SEC = 0.5
const ENERGY_JUMP_DB_THRESHOLD = 15
const SUSTAIN_WINDOWS = 4 // require the level shift to persist, to avoid flagging brief transients (claps, impacts)
const MIN_LEVEL_DB = -60 // floor to avoid log(0) and to avoid over-sensitivity in near-silent recordings

function windowRmsDb(samples: Int16Array, start: number, end: number): number {
  let sum = 0
  for (let i = start; i < end; i++) {
    const v = samples[i] / 32768
    sum += v * v
  }
  const rms = Math.sqrt(sum / Math.max(1, end - start))
  return Math.max(MIN_LEVEL_DB, 20 * Math.log10(Math.max(rms, 1e-6)))
}

function average(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length
}

/**
 * Best-effort detection of internal discontinuities (pause/resume, hard cuts) within a single
 * recording, based on abrupt & sustained shifts in background noise level. Not a guarantee —
 * the UI must always allow manual add/remove/move of these markers.
 */
export function detectHardCuts(samples: Int16Array, sampleRate: number): number[] {
  const windowSize = Math.round(WINDOW_SEC * sampleRate)
  const windowCount = Math.floor(samples.length / windowSize)
  if (windowCount < SUSTAIN_WINDOWS * 2) return []

  const levels: number[] = []
  for (let i = 0; i < windowCount; i++) {
    levels.push(windowRmsDb(samples, i * windowSize, (i + 1) * windowSize))
  }

  const candidates: number[] = []
  for (let i = SUSTAIN_WINDOWS; i < windowCount - SUSTAIN_WINDOWS; i++) {
    const before = average(levels.slice(i - SUSTAIN_WINDOWS, i))
    const after = average(levels.slice(i, i + SUSTAIN_WINDOWS))
    if (Math.abs(after - before) >= ENERGY_JUMP_DB_THRESHOLD) {
      candidates.push((i * windowSize) / sampleRate)
    }
  }

  // collapse consecutive candidate windows (the sliding comparison flags a short run, not just one point)
  const merged: number[] = []
  for (const cut of candidates) {
    if (merged.length === 0 || cut - merged[merged.length - 1] > SUSTAIN_WINDOWS * WINDOW_SEC) {
      merged.push(cut)
    }
  }
  return merged
}

/** Splits [0, durationSec) into segments at the given hard-cut points. */
export function buildSegmentRanges(
  durationSec: number,
  hardCutMarkers: number[]
): Array<{ localStartSec: number; localEndSec: number }> {
  const sorted = [...hardCutMarkers].sort((a, b) => a - b)
  const bounds = [0, ...sorted, durationSec]
  const ranges: Array<{ localStartSec: number; localEndSec: number }> = []
  for (let i = 0; i < bounds.length - 1; i++) {
    if (bounds[i + 1] - bounds[i] > 0) {
      ranges.push({ localStartSec: bounds[i], localEndSec: bounds[i + 1] })
    }
  }
  return ranges
}
