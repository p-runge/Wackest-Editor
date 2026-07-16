// Fixed categorical order — never cycle/reassign based on filtering; index by stable source order.
const SOURCE_PALETTE = ['#7fd1ff', '#78dc8c', '#b4b4ff', '#ff9ecf', '#ffb37f', '#7fffd4']

export function colorForSourceId(sourceId: string, allSourceIdsInOrder: string[]): string {
  const index = allSourceIdsInOrder.indexOf(sourceId)
  if (index === -1) return '#888888'
  return SOURCE_PALETTE[index % SOURCE_PALETTE.length]
}

// Sequential single-hue ramp (dark->light amber) for magnitude (heatmap score 0..1).
const SCORE_RAMP: Array<[number, number, number]> = [
  [0x33, 0x2a, 0x22],
  [0x8a, 0x5a, 0x2e],
  [0xc9, 0x7a, 0x2e],
  [0xff, 0x9d, 0x3d],
  [0xff, 0xc7, 0x73]
]

export function colorForScore(score: number): string {
  const clamped = Math.max(0, Math.min(1, score))
  const scaled = clamped * (SCORE_RAMP.length - 1)
  const lowerIndex = Math.floor(scaled)
  const upperIndex = Math.min(SCORE_RAMP.length - 1, lowerIndex + 1)
  const t = scaled - lowerIndex
  const [r1, g1, b1] = SCORE_RAMP[lowerIndex]
  const [r2, g2, b2] = SCORE_RAMP[upperIndex]
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return `rgb(${r}, ${g}, ${b})`
}
