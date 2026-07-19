import { expectedOffsetSec } from './mtime-estimate'
import { pairwiseCorrelate } from './windowed-correlate'
import { MIN_TRUSTED_CONFIDENCE } from './constants'
import { NO_OVERLAP_GAP_SEC } from '@shared/types/sync-constants'
import type { SyncMethod } from '@shared/types/project'

export interface SegmentNode {
  sourceId: string
  segmentIndex: number
  localStartSec: number
  localEndSec: number
  samples: Int16Array
  estimatedStartEpochMs: number | null
}

export interface ResolvedSegment {
  offsetSec: number
  confidence: number
  method: SyncMethod
}

/** A fixed-width unified-timeline gap separating a non-overlapping source cluster from the rest. */
export interface HardCutGap {
  startSec: number
  endSec: number
}

export interface SyncGraphResult {
  segments: Map<string, ResolvedSegment>
  hardCutGaps: HardCutGap[]
}

export interface GraphEdge {
  a: string // node key on the "reference" side of the correlation
  b: string // node key on the "query" side; b.local + offsetSec = a.local
  offsetSec: number
  confidence: number
}

export function nodeKey(sourceId: string, segmentIndex: number): string {
  return `${sourceId}#${segmentIndex}`
}

/**
 * All-pairs cross-correlation across different sources (never within the same source). Only
 * edges at or above `MIN_TRUSTED_CONFIDENCE` survive — this is the real "do these two sources
 * actually overlap in time" bar; a lower bar would let near-noise correlations wrongly bridge
 * unrelated files.
 */
export function buildEdges(nodes: SegmentNode[], sampleRate: number): GraphEdge[] {
  const edges: GraphEdge[] = []

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeA = nodes[i]
      const nodeB = nodes[j]
      if (nodeA.sourceId === nodeB.sourceId) continue // never sync a source against itself

      const [ref, query] =
        nodeA.samples.length >= nodeB.samples.length ? [nodeA, nodeB] : [nodeB, nodeA]

      const expected = expectedOffsetSec(
        ref.estimatedStartEpochMs,
        ref.localStartSec,
        query.estimatedStartEpochMs,
        query.localStartSec
      )

      const result = pairwiseCorrelate(ref.samples, query.samples, sampleRate, expected)
      if (result.confidence < MIN_TRUSTED_CONFIDENCE) continue

      edges.push({
        a: nodeKey(ref.sourceId, ref.segmentIndex),
        b: nodeKey(query.sourceId, query.segmentIndex),
        offsetSec: result.offsetSec,
        confidence: result.confidence
      })
    }
  }

  return edges
}

function pickAnchor(
  nodeKeys: string[],
  edges: GraphEdge[],
  preferredAnchorKey: string | null
): string | null {
  if (preferredAnchorKey && nodeKeys.includes(preferredAnchorKey)) return preferredAnchorKey
  if (nodeKeys.length === 0) return null

  const connectivity = new Map<string, number>()
  for (const edge of edges) {
    connectivity.set(edge.a, (connectivity.get(edge.a) ?? 0) + edge.confidence)
    connectivity.set(edge.b, (connectivity.get(edge.b) ?? 0) + edge.confidence)
  }

  let best = nodeKeys[0]
  let bestScore = -1
  for (const [key, score] of connectivity) {
    if (score > bestScore) {
      bestScore = score
      best = key
    }
  }
  return best
}

/**
 * Union-find over the (already trust-floored) edges: partitions all nodes into connected
 * components. A node with no surviving edges to any other node is its own singleton component —
 * this is exactly the "no trustworthy overlap found" case that now drives hard-cut placement.
 */
export function findConnectedComponents(nodes: SegmentNode[], edges: GraphEdge[]): string[][] {
  const parent = new Map<string, string>()
  for (const node of nodes) parent.set(nodeKey(node.sourceId, node.segmentIndex), '')
  for (const key of parent.keys()) parent.set(key, key)

  function find(key: string): string {
    let root = key
    while (parent.get(root) !== root) root = parent.get(root)!
    let cur = key
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }

  function union(a: string, b: string): void {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootA, rootB)
  }

  for (const edge of edges) {
    if (parent.has(edge.a) && parent.has(edge.b)) union(edge.a, edge.b)
  }

  const groups = new Map<string, string[]>()
  for (const node of nodes) {
    const key = nodeKey(node.sourceId, node.segmentIndex)
    const root = find(key)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(key)
  }
  return Array.from(groups.values())
}

/**
 * Seeds `seedKey` at offset 0/confidence 1 and walks a Prim's-style maximum-spanning-tree over
 * `edges`, placing every node reachable from the seed via the highest-confidence available edge
 * at each step (each placed node's confidence is that connecting edge's confidence, not
 * accumulated/decayed along the path). Callers are expected to pass only the edges/nodes
 * belonging to a single connected component containing `seedKey`, so every node ends up placed.
 */
export function resolveComponent(
  edges: GraphEdge[],
  seedKey: string
): Map<string, { offsetSec: number; confidence: number }> {
  const placedOffset = new Map<string, number>([[seedKey, 0]])
  const placedConfidence = new Map<string, number>([[seedKey, 1]])

  const adjacency = new Map<string, GraphEdge[]>()
  for (const edge of edges) {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, [])
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, [])
    adjacency.get(edge.a)!.push(edge)
    adjacency.get(edge.b)!.push(edge)
  }

  const frontier: GraphEdge[] = [...(adjacency.get(seedKey) ?? [])]
  while (frontier.length > 0) {
    frontier.sort((x, y) => y.confidence - x.confidence)
    const edge = frontier.shift()!
    const aPlaced = placedOffset.has(edge.a)
    const bPlaced = placedOffset.has(edge.b)
    if (aPlaced && bPlaced) continue
    if (!aPlaced && !bPlaced) continue // not yet reachable from the placed frontier

    if (aPlaced) {
      placedOffset.set(edge.b, placedOffset.get(edge.a)! + edge.offsetSec)
      placedConfidence.set(edge.b, edge.confidence)
      frontier.push(...(adjacency.get(edge.b) ?? []))
    } else {
      placedOffset.set(edge.a, placedOffset.get(edge.b)! - edge.offsetSec)
      placedConfidence.set(edge.a, edge.confidence)
      frontier.push(...(adjacency.get(edge.a) ?? []))
    }
  }

  const result = new Map<string, { offsetSec: number; confidence: number }>()
  for (const [key, offsetSec] of placedOffset) {
    result.set(key, { offsetSec, confidence: placedConfidence.get(key) ?? 0 })
  }
  return result
}

/** Components with an mtime estimate sort first (earliest first); those without sort last, in original node order. */
function sortComponentsByEarliestStart(
  components: string[][],
  nodeByKey: Map<string, SegmentNode>,
  nodeOrder: Map<string, number>
): string[][] {
  const sortKey = (component: string[]): { mtimeMs: number; index: number } => {
    let mtimeMs = Infinity
    let index = Infinity
    for (const key of component) {
      const node = nodeByKey.get(key)!
      if (node.estimatedStartEpochMs !== null && node.estimatedStartEpochMs < mtimeMs) {
        mtimeMs = node.estimatedStartEpochMs
      }
      const idx = nodeOrder.get(key) ?? Infinity
      if (idx < index) index = idx
    }
    return { mtimeMs, index }
  }

  return [...components].sort((a, b) => {
    const keyA = sortKey(a)
    const keyB = sortKey(b)
    if (keyA.mtimeMs !== keyB.mtimeMs) return keyA.mtimeMs - keyB.mtimeMs
    return keyA.index - keyB.index
  })
}

/**
 * Core placement logic, separated from `buildEdges`'s correlation work so it can be unit tested
 * against hand-built edges. Partitions nodes into connected components (via `findConnectedComponents`),
 * resolves each component's internal relative offsets independently (via `resolveComponent`), then
 * lays the components out on the unified timeline: the anchor's component first (unshifted, its own
 * seed at offset 0), every other component placed immediately after the previously placed content,
 * separated by a fixed `NO_OVERLAP_GAP_SEC` gap — this gap is the new "hard cut": a boundary between
 * source clusters that have no trustworthy correlation with each other. Non-anchor components are
 * ordered by their earliest member's estimated mtime start when available (undated components sort
 * last); the anchor's component is always placed first regardless of its own mtime, since it's the
 * deliberately chosen reference (`role: 'main'`), not a floating estimate.
 */
export function resolveSyncGraph(
  nodes: SegmentNode[],
  edges: GraphEdge[],
  preferredAnchorKey: string | null
): SyncGraphResult {
  const allKeys = nodes.map((n) => nodeKey(n.sourceId, n.segmentIndex))
  const anchorKey = pickAnchor(allKeys, edges, preferredAnchorKey)
  const components = findConnectedComponents(nodes, edges)

  const nodeByKey = new Map(nodes.map((n) => [nodeKey(n.sourceId, n.segmentIndex), n]))
  const nodeOrder = new Map(allKeys.map((k, i) => [k, i]))

  const anchorComponentIndex = anchorKey ? components.findIndex((c) => c.includes(anchorKey)) : -1
  const anchorComponent = anchorComponentIndex >= 0 ? components[anchorComponentIndex] : null
  const otherComponents = components.filter((_, i) => i !== anchorComponentIndex)
  const orderedComponents = [
    ...(anchorComponent ? [anchorComponent] : []),
    ...sortComponentsByEarliestStart(otherComponents, nodeByKey, nodeOrder)
  ]

  const results = new Map<string, ResolvedSegment>()
  const gaps: HardCutGap[] = []
  let cursorEndSec = 0
  let isFirstComponent = true

  for (const componentKeys of orderedComponents) {
    const componentSet = new Set(componentKeys)
    const componentEdges = edges.filter((e) => componentSet.has(e.a) && componentSet.has(e.b))
    const isAnchorComponent = componentKeys === anchorComponent
    const seedKey = isAnchorComponent
      ? anchorKey!
      : pickAnchor(componentKeys, componentEdges, null)!

    const internal = resolveComponent(componentEdges, seedKey)

    let minStart = Infinity
    let maxEnd = -Infinity
    for (const key of componentKeys) {
      const node = nodeByKey.get(key)!
      const offset = internal.get(key)?.offsetSec ?? 0
      minStart = Math.min(minStart, node.localStartSec + offset)
      maxEnd = Math.max(maxEnd, node.localEndSec + offset)
    }

    let shift = 0
    if (isFirstComponent) {
      isFirstComponent = false
    } else {
      const gapStart = cursorEndSec
      shift = gapStart + NO_OVERLAP_GAP_SEC - minStart
      gaps.push({ startSec: gapStart, endSec: gapStart + NO_OVERLAP_GAP_SEC })
    }

    for (const key of componentKeys) {
      const isSeed = key === seedKey
      const placed = internal.get(key) ?? { offsetSec: 0, confidence: 0 }
      const method: SyncMethod =
        isSeed && !isAnchorComponent ? 'no-overlap-gap' : 'cross-correlation'
      const confidence = isSeed && !isAnchorComponent ? 0 : placed.confidence
      results.set(key, { offsetSec: placed.offsetSec + shift, confidence, method })
    }

    cursorEndSec = maxEnd + shift
  }

  const normalizeShift = normalizeToEarliestStart(nodes, results)
  const hardCutGaps = gaps.map((g) => ({
    startSec: g.startSec - normalizeShift,
    endSec: g.endSec - normalizeShift
  }))

  return { segments: results, hardCutGaps }
}

/**
 * Builds the pairwise cross-correlation graph across all segments and resolves a globally
 * consistent placement (see `resolveSyncGraph`). Sources/clusters with no trustworthy overlap to
 * the rest of the timeline are placed sequentially after it, separated by a fixed gap — see
 * `NO_OVERLAP_GAP_SEC` — rather than guessed at via an mtime estimate.
 */
export function buildAndResolveSyncGraph(
  nodes: SegmentNode[],
  preferredAnchorKey: string | null,
  sampleRate: number
): SyncGraphResult {
  const edges = buildEdges(nodes, sampleRate)
  return resolveSyncGraph(nodes, edges, preferredAnchorKey)
}

/**
 * The anchor picked for graph resolution is whichever segment correlates best, not necessarily
 * the one that starts first — so raw offsets can come out negative (anchor started later than
 * some other segment). Re-reference the whole result set so the earliest actual content across
 * all segments sits at unified time 0, which is what a timeline should look like either way and
 * matches user expectations. This is just a constant shift; all relative offsets are unaffected.
 * Returns the shift that was applied (0 if none), so callers can apply the same shift to any
 * other unified-timeline values computed alongside the results (e.g. hard-cut gap markers).
 */
function normalizeToEarliestStart(
  nodes: SegmentNode[],
  results: Map<string, ResolvedSegment>
): number {
  let minUnifiedStart = Infinity
  for (const node of nodes) {
    const resolved = results.get(nodeKey(node.sourceId, node.segmentIndex))
    if (!resolved) continue
    const unifiedStart = node.localStartSec + resolved.offsetSec
    if (unifiedStart < minUnifiedStart) minUnifiedStart = unifiedStart
  }
  if (!Number.isFinite(minUnifiedStart) || minUnifiedStart === 0) return 0

  for (const [key, resolved] of results) {
    results.set(key, { ...resolved, offsetSec: resolved.offsetSec - minUnifiedStart })
  }
  return minUnifiedStart
}
