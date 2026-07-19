import FFT from 'fft.js'

export interface CrossCorrelationResult {
  /** reference[t] best matches query[t - lagSamples]; i.e. queryLocalTime + lagSamples/sr = referenceLocalTime */
  lagSamples: number
  confidence: number
}

function nextPowerOfTwo(n: number): number {
  let p = 2
  while (p < n) p *= 2
  return p
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}

// Below this fraction of the query's length actually overlapping the reference, a lag is not
// considered at all — too little shared audio to distinguish a real match from chance.
const MIN_OVERLAP_FRACTION = 0.2

/**
 * Finds the lag (in samples) at which `query` best matches within `reference`, restricted to
 * non-negative lags (the query starts at or after the reference's start). The query is allowed to
 * hang off the *end* of the reference — e.g. a clip that starts partway through the reference
 * recording but keeps rolling after the reference itself stopped — as long as at least
 * `MIN_OVERLAP_FRACTION` of the query actually overlaps.
 */
export function crossCorrelate(
  reference: ArrayLike<number>,
  query: ArrayLike<number>
): CrossCorrelationResult {
  const na = reference.length
  const nb = query.length
  if (na === 0 || nb === 0) return { lagSamples: 0, confidence: 0 }

  const n = nextPowerOfTwo(na + nb - 1)
  const fft = new FFT(n)

  const aComplex = fft.createComplexArray()
  const bComplex = fft.createComplexArray()
  for (let i = 0; i < na; i++) aComplex[i * 2] = reference[i]
  for (let i = 0; i < nb; i++) bComplex[i * 2] = query[i]

  const aFreq = fft.createComplexArray()
  const bFreq = fft.createComplexArray()
  fft.transform(aFreq, aComplex)
  fft.transform(bFreq, bComplex)

  // cross-power spectrum = A * conj(B)
  const cross = fft.createComplexArray()
  for (let i = 0; i < n; i++) {
    const reA = aFreq[i * 2]
    const imA = aFreq[i * 2 + 1]
    const reB = bFreq[i * 2]
    const imB = -bFreq[i * 2 + 1]
    cross[i * 2] = reA * reB - imA * imB
    cross[i * 2 + 1] = reA * imB + imA * reB
  }

  const corr = fft.createComplexArray()
  fft.inverseTransform(corr, cross)

  // Sliding local energy (cumulative sum of squares) on both sides, so each lag is normalized
  // against only the samples actually overlapping at that lag — not each clip's whole length.
  // Using whole-clip energy systematically deflates confidence whenever one clip is much longer
  // than the other (e.g. one long main take vs. many short phone clips), or when only part of the
  // query overlaps (e.g. a clip that outlasts the reference), to the point that genuine overlaps
  // can score below the trust threshold.
  const refCumsq = new Float64Array(na + 1)
  for (let i = 0; i < na; i++) refCumsq[i + 1] = refCumsq[i] + reference[i] * reference[i]
  const queryCumsq = new Float64Array(nb + 1)
  for (let i = 0; i < nb; i++) queryCumsq[i + 1] = queryCumsq[i] + query[i] * query[i]

  // corr[k] from the zero-padded linear FFT correlation already equals
  // sum_{i=0}^{overlapLen-1} reference[k+i] * query[i] even when overlapLen < nb (query hangs off
  // the reference's end) — the zero padding beyond each signal's real length contributes nothing.
  // So lags up to na-1 (not just na-nb) are valid; only local normalization needs the actual
  // overlap length at each lag.
  const maxLag = na - 1
  const minOverlapSamples = Math.max(1, Math.ceil(nb * MIN_OVERLAP_FRACTION))

  const normalized = new Float64Array(maxLag + 1)
  let bestK = 0
  let bestNormalized = -Infinity
  for (let k = 0; k <= maxLag; k++) {
    const overlapLen = Math.min(na - k, nb)
    if (overlapLen < minOverlapSamples) {
      normalized[k] = -Infinity
      continue
    }
    const localRefEnergy = refCumsq[k + overlapLen] - refCumsq[k]
    const localQueryEnergy = queryCumsq[overlapLen]
    const norm = Math.sqrt(localRefEnergy * localQueryEnergy) || 1
    const v = corr[k * 2] / norm
    normalized[k] = v
    if (v > bestNormalized) {
      bestNormalized = v
      bestK = k
    }
  }

  // The correlation curve is smooth, so the lags immediately next to the true peak are nearly as
  // high as the peak itself by construction — comparing against them (as a naive "second-highest
  // sample" scan would) crushes confidence for every real match regardless of quality. Excluding a
  // window around the best lag before looking for a runner-up makes peakRatio measure genuine
  // ambiguity (a comparably strong match elsewhere in time, e.g. from repetitive noise) instead.
  const exclusionRadius = Math.max(1, Math.floor(nb / 2))
  let secondBestNormalized = -Infinity
  for (let k = 0; k <= maxLag; k++) {
    if (Math.abs(k - bestK) <= exclusionRadius) continue
    if (normalized[k] > secondBestNormalized) secondBestNormalized = normalized[k]
  }
  if (!Number.isFinite(secondBestNormalized)) secondBestNormalized = 0

  const peakRatio = secondBestNormalized > 1e-9 ? bestNormalized / secondBestNormalized : 10
  const confidence = clamp01(bestNormalized) * clamp01(Math.log10(1 + Math.max(0, peakRatio - 1)))

  return { lagSamples: bestK, confidence }
}
