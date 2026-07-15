import { expectedOffsetSec } from './mtime-estimate'
import { pairwiseCorrelate } from './windowed-correlate'
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

interface GraphEdge {
  a: string // node key on the "reference" side of the correlation
  b: string // node key on the "query" side; b.local + offsetSec = a.local
  offsetSec: number
  confidence: number
}

function nodeKey(sourceId: string, segmentIndex: number): string {
  return `${sourceId}#${segmentIndex}`
}

function buildEdges(nodes: SegmentNode[], sampleRate: number): GraphEdge[] {
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
      if (result.confidence <= 0) continue

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
  nodes: SegmentNode[],
  edges: GraphEdge[],
  preferredAnchorKey: string | null
): string | null {
  if (
    preferredAnchorKey &&
    nodes.some((n) => nodeKey(n.sourceId, n.segmentIndex) === preferredAnchorKey)
  ) {
    return preferredAnchorKey
  }
  if (nodes.length === 0) return null

  const connectivity = new Map<string, number>()
  for (const edge of edges) {
    connectivity.set(edge.a, (connectivity.get(edge.a) ?? 0) + edge.confidence)
    connectivity.set(edge.b, (connectivity.get(edge.b) ?? 0) + edge.confidence)
  }

  let best = nodeKey(nodes[0].sourceId, nodes[0].segmentIndex)
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
 * Builds the pairwise cross-correlation graph across all segments and resolves a globally
 * consistent placement via a Prim's-style maximum-spanning-tree walk from the anchor segment.
 * Segments unreachable from the anchor fall back to an mtime-only estimate (or 0, confidence 0).
 */
export function buildAndResolveSyncGraph(
  nodes: SegmentNode[],
  preferredAnchorKey: string | null,
  sampleRate: number
): Map<string, ResolvedSegment> {
  const edges = buildEdges(nodes, sampleRate)
  const anchorKey = pickAnchor(nodes, edges, preferredAnchorKey)

  const placedOffset = new Map<string, number>()
  const placedConfidence = new Map<string, number>()
  if (anchorKey) {
    placedOffset.set(anchorKey, 0)
    placedConfidence.set(anchorKey, 1)
  }

  const adjacency = new Map<string, GraphEdge[]>()
  for (const edge of edges) {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, [])
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, [])
    adjacency.get(edge.a)!.push(edge)
    adjacency.get(edge.b)!.push(edge)
  }

  const frontier: GraphEdge[] = anchorKey ? [...(adjacency.get(anchorKey) ?? [])] : []
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

  const anchorNode = anchorKey
    ? nodes.find((n) => nodeKey(n.sourceId, n.segmentIndex) === anchorKey)
    : undefined

  const results = new Map<string, ResolvedSegment>()
  for (const node of nodes) {
    const key = nodeKey(node.sourceId, node.segmentIndex)
    if (placedOffset.has(key)) {
      results.set(key, {
        offsetSec: placedOffset.get(key)!,
        confidence: placedConfidence.get(key) ?? 0,
        method: 'cross-correlation'
      })
      continue
    }

    const fallback = anchorNode
      ? expectedOffsetSec(
          anchorNode.estimatedStartEpochMs,
          anchorNode.localStartSec,
          node.estimatedStartEpochMs,
          node.localStartSec
        )
      : null

    results.set(key, {
      offsetSec: fallback ?? 0,
      confidence: 0,
      method: 'timestamp-heuristic'
    })
  }

  return results
}
