import { describe, expect, it } from 'vitest'
import {
  buildEdges,
  findConnectedComponents,
  resolveSyncGraph,
  nodeKey,
  type SegmentNode,
  type GraphEdge
} from './graph'
import { MIN_TRUSTED_CONFIDENCE } from './constants'
import { NO_OVERLAP_GAP_SEC } from '@shared/types/sync-constants'

function node(
  sourceId: string,
  localEndSec: number,
  estimatedStartEpochMs: number | null = null
): SegmentNode {
  return {
    sourceId,
    segmentIndex: 0,
    localStartSec: 0,
    localEndSec,
    samples: new Int16Array(0),
    estimatedStartEpochMs
  }
}

function edge(a: SegmentNode, b: SegmentNode, offsetSec: number, confidence: number): GraphEdge {
  return {
    a: nodeKey(a.sourceId, a.segmentIndex),
    b: nodeKey(b.sourceId, b.segmentIndex),
    offsetSec,
    confidence
  }
}

function key(n: SegmentNode): string {
  return nodeKey(n.sourceId, n.segmentIndex)
}

/** Deterministic pseudo-random noise (xorshift32) — reproducible across runs, unlike Math.random. */
function noise(length: number, seed: number): Int16Array {
  const arr = new Int16Array(length)
  let state = seed || 1
  for (let i = 0; i < length; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    arr[i] = state % 32768
  }
  return arr
}

describe('buildEdges', () => {
  it('keeps a genuine match (sub-clip of the reference) above the trust floor', () => {
    const reference = noise(20000, 42)
    const query = reference.subarray(3000, 9000)
    const a = node('ref', reference.length / 16000)
    const b = node('query', query.length / 16000)
    a.samples = reference
    b.samples = query

    const edges = buildEdges([a, b], 16000)
    expect(edges).toHaveLength(1)
    expect(edges[0].confidence).toBeGreaterThanOrEqual(MIN_TRUSTED_CONFIDENCE)
  })

  it('drops an edge between genuinely unrelated audio (below the trust floor)', () => {
    const a = node('a', 1.25)
    const b = node('b', 0.3125)
    a.samples = noise(20000, 42)
    b.samples = noise(5000, 999)

    const edges = buildEdges([a, b], 16000)
    expect(edges).toHaveLength(0)
  })

  it('never builds an edge between two segments of the same source', () => {
    const a = node('same', 1)
    const b = node('same', 1)
    a.samples = noise(4000, 1)
    b.samples = noise(4000, 1)
    expect(buildEdges([a, b], 16000)).toHaveLength(0)
  })
})

describe('findConnectedComponents', () => {
  it('groups nodes joined by an edge and isolates nodes with none', () => {
    const a = node('a', 1)
    const b = node('b', 1)
    const c = node('c', 1)
    const components = findConnectedComponents([a, b, c], [edge(a, b, 0, 0.5)])
    const sorted = components.map((c) => [...c].sort())
    expect(sorted).toContainEqual([key(a), key(b)].sort())
    expect(sorted).toContainEqual([key(c)])
    expect(components).toHaveLength(2)
  })
})

describe('resolveSyncGraph', () => {
  it('places a second, non-overlapping cluster after the first with a fixed gap', () => {
    const a = node('a', 10, 1000) // anchor
    const b = node('b', 8, 3000)
    const c = node('c', 6, 500)
    const d = node('d', 4, 600)

    const edges = [edge(a, b, 2, 0.5), edge(c, d, 1, 0.6)]
    const { segments, hardCutGaps } = resolveSyncGraph([a, b, c, d], edges, key(a))

    expect(segments.get(key(a))).toEqual({
      offsetSec: 0,
      confidence: 1,
      method: 'cross-correlation'
    })
    expect(segments.get(key(b))).toEqual({
      offsetSec: 2,
      confidence: 0.5,
      method: 'cross-correlation'
    })

    // cluster1 ends at max(10, 2+8) = 10; cluster2 must start at 10 + NO_OVERLAP_GAP_SEC
    expect(hardCutGaps).toEqual([{ startSec: 10, endSec: 10 + NO_OVERLAP_GAP_SEC }])
    expect(segments.get(key(c))).toEqual({
      offsetSec: 10 + NO_OVERLAP_GAP_SEC,
      confidence: 0,
      method: 'no-overlap-gap'
    })
    expect(segments.get(key(d))).toEqual({
      offsetSec: 10 + NO_OVERLAP_GAP_SEC + 1,
      confidence: 0.6,
      method: 'cross-correlation'
    })
  })

  it('places a singleton unreachable node with confidence 0 and method no-overlap-gap', () => {
    const a = node('a', 10)
    const x = node('x', 5)
    const { segments, hardCutGaps } = resolveSyncGraph([a, x], [], key(a))

    expect(segments.get(key(a))).toEqual({
      offsetSec: 0,
      confidence: 1,
      method: 'cross-correlation'
    })
    expect(segments.get(key(x))).toEqual({
      offsetSec: 10 + NO_OVERLAP_GAP_SEC,
      confidence: 0,
      method: 'no-overlap-gap'
    })
    expect(hardCutGaps).toEqual([{ startSec: 10, endSec: 10 + NO_OVERLAP_GAP_SEC }])
  })

  it('always places the anchor component first regardless of mtime, orders the rest by mtime then array index', () => {
    const a = node('a', 2, 5000) // anchor — later mtime than x, but must still go first
    const x = node('x', 3, 1000) // earliest mtime among non-anchor components
    const w = node('w', 1, null) // no mtime, appears before z in the node array
    const z = node('z', 1, null) // no mtime, appears after w — tiebreak by array order

    const { hardCutGaps } = resolveSyncGraph([a, x, w, z], [], key(a))

    // 3 non-anchor singleton components -> 3 gaps, in placement order: x, then w, then z
    expect(hardCutGaps).toHaveLength(3)
    const [gapBeforeX, gapBeforeW, gapBeforeZ] = hardCutGaps
    expect(gapBeforeX.startSec).toBe(2) // right after anchor's own end
    expect(gapBeforeW.startSec).toBeGreaterThan(gapBeforeX.startSec)
    expect(gapBeforeZ.startSec).toBeGreaterThan(gapBeforeW.startSec)
  })

  it('shifts both segment offsets and hard-cut gap markers so the earliest content sits at 0', () => {
    const a = node('a', 10) // anchor
    const b = node('b', 5)
    const c = node('c', 1) // isolated singleton -> forces a gap after cluster1

    // b is placed 3s *before* the anchor, so the whole result set must shift right by 3
    const { segments, hardCutGaps } = resolveSyncGraph([a, b, c], [edge(a, b, -3, 0.7)], key(a))

    expect(segments.get(key(b))!.offsetSec).toBe(0) // now the earliest point
    expect(segments.get(key(a))!.offsetSec).toBe(3)
    expect(hardCutGaps).toEqual([{ startSec: 13, endSec: 13 + NO_OVERLAP_GAP_SEC }])
    expect(segments.get(key(c))!.offsetSec).toBe(13 + NO_OVERLAP_GAP_SEC)
  })
})
