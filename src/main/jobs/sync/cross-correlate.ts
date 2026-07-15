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

function sumSquares(arr: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i]
  return s
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}

/**
 * Finds the lag (in samples) at which `query` best matches within `reference`,
 * restricted to non-negative lags (query's match lies inside the reference window).
 * Caller is responsible for extracting a reference window generous enough to contain it.
 */
export function crossCorrelate(
  reference: ArrayLike<number>,
  query: ArrayLike<number>
): CrossCorrelationResult {
  const na = reference.length
  const nb = query.length
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

  let bestK = 0
  let bestVal = -Infinity
  let secondBestVal = -Infinity
  const maxLag = Math.max(0, na - 1)
  for (let k = 0; k <= maxLag; k++) {
    const v = corr[k * 2]
    if (v > bestVal) {
      secondBestVal = bestVal
      bestVal = v
      bestK = k
    } else if (v > secondBestVal) {
      secondBestVal = v
    }
  }

  const refEnergy = sumSquares(reference)
  const queryEnergy = sumSquares(query)
  const norm = Math.sqrt(refEnergy * queryEnergy) || 1
  const normalizedPeak = bestVal / norm
  const peakRatio = secondBestVal > 1e-9 ? bestVal / secondBestVal : 10
  const confidence = clamp01(normalizedPeak) * clamp01(Math.log10(1 + Math.max(0, peakRatio - 1)))

  return { lagSamples: bestK, confidence }
}
