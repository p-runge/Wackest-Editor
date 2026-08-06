import { v4 as uuidv4 } from 'uuid'
import { sourceCoverageRange } from './timeline-time'
import type { DeviceGroup, Project, SourceClip } from './project'

/**
 * Auto-grouping of source clips by the device they came from, so all clips of one device share a
 * single editor lane / export track. Grouping is purely organizational: it never touches sync,
 * transcription, heatmap, or the active selection (which all keep referencing individual sourceIds).
 *
 * Membership is only ever *suggested* here — the user can override any assignment in the UI, and
 * those overrides are sticky (see `ensureDeviceGroups`, which only fills in ungrouped sources).
 */

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Leading non-digit part of the filename (device naming convention): GX010123 -> "gx",
 *  IMG_1234 -> "img_", C0001 -> "c", DJI_0001 -> "dji_". A weak, secondary signal. */
function filenamePrefix(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath
  const noExt = base.replace(/\.[^.]+$/, '')
  return normalize(noExt.match(/^([^\d]*)/)?.[1] ?? '')
}

/**
 * A stable string identifying the likely source device. Recording-device metadata (make/model) is
 * authoritative when present; otherwise falls back to a technical fingerprint (resolution + rounded
 * fps + codecs) plus the filename prefix to help separate otherwise-identical spec'd devices.
 */
export function deviceFingerprint(source: SourceClip): string {
  const p = source.probed
  const make = p.make ? normalize(p.make) : ''
  const model = p.model ? normalize(p.model) : ''
  if (make || model) return `meta:${make}|${model}`

  const dims = p.width && p.height ? `${p.width}x${p.height}` : ''
  const fps = p.frameRate ? String(Math.round(p.frameRate)) : ''
  const codecs = `${p.videoCodec ?? ''}/${p.audioCodec ?? ''}`
  return `tech:${dims}|${fps}|${codecs}|${filenamePrefix(source.originalFilePath)}`
}

function suggestGroupName(source: SourceClip, existingGroups: DeviceGroup[]): string {
  const p = source.probed
  if (p.model) return p.model
  if (p.make) return p.make
  const prefix = filenamePrefix(source.originalFilePath)
  if (prefix.length >= 2) return prefix.toUpperCase()
  return `Gerät ${existingGroups.length + 1}`
}

export type GroupSuggestion = { groupId: string } | { newGroup: DeviceGroup }

/**
 * Picks the device group for a not-yet-grouped source: an existing group that already contains a
 * same-fingerprint source, or otherwise a brand-new group appended after the current highest order.
 */
export function suggestGroupForSource(
  source: SourceClip,
  existingSources: SourceClip[],
  existingGroups: DeviceGroup[]
): GroupSuggestion {
  const fingerprint = deviceFingerprint(source)
  for (const other of existingSources) {
    if (other.deviceGroupId && deviceFingerprint(other) === fingerprint) {
      return { groupId: other.deviceGroupId }
    }
  }
  const order = existingGroups.reduce((max, g) => Math.max(max, g.order), -1) + 1
  return { newGroup: { id: uuidv4(), name: suggestGroupName(source, existingGroups), order } }
}

/**
 * Fills in device groups for any ungrouped sources (new imports, or pre-v5 projects being opened),
 * repairs dangling group references, prunes empty groups, and re-densifies `order` to 0..n-1.
 * Already-assigned sources are left untouched, so manual overrides survive. Idempotent — safe to run
 * on every import and project open.
 */
export function ensureDeviceGroups(project: Project): Project {
  let groups = [...project.deviceGroups]
  const sources = project.sources.map((s) => ({ ...s }))

  for (let i = 0; i < sources.length; i++) {
    if (sources[i].deviceGroupId) continue
    const alreadyGrouped = sources.filter((s) => s.deviceGroupId)
    const suggestion = suggestGroupForSource(sources[i], alreadyGrouped, groups)
    if ('groupId' in suggestion) {
      sources[i] = { ...sources[i], deviceGroupId: suggestion.groupId }
    } else {
      groups.push(suggestion.newGroup)
      sources[i] = { ...sources[i], deviceGroupId: suggestion.newGroup.id }
    }
  }

  // Repair: a source pointing at a group that no longer exists (e.g. hand-edited project.json) gets
  // a placeholder group so it stays renderable instead of vanishing.
  const groupIds = new Set(groups.map((g) => g.id))
  for (const source of sources) {
    const groupId = source.deviceGroupId
    if (groupId && !groupIds.has(groupId)) {
      const order = groups.reduce((max, g) => Math.max(max, g.order), -1) + 1
      groups.push({ id: groupId, name: suggestGroupName(source, groups), order })
      groupIds.add(groupId)
    }
  }

  const usedGroupIds = new Set(sources.map((s) => s.deviceGroupId))
  groups = groups
    .filter((g) => usedGroupIds.has(g.id))
    .sort((a, b) => a.order - b.order)
    .map((g, i) => ({ ...g, order: i }))

  // Return the original project reference when nothing actually changed, so callers that rely on
  // referential equality (and the "unchanged" fast paths upstream) aren't defeated on every load.
  const sourcesChanged = sources.some(
    (s, i) => s.deviceGroupId !== project.sources[i].deviceGroupId
  )
  const groupsChanged =
    groups.length !== project.deviceGroups.length ||
    groups.some((g, i) => {
      const prev = project.deviceGroups[i]
      return !prev || prev.id !== g.id || prev.name !== g.name || prev.order !== g.order
    })
  if (!sourcesChanged && !groupsChanged) return project

  return { ...project, sources, deviceGroups: groups }
}

/**
 * Post-sync guard: returns the ids of groups whose members overlap in time on the unified timeline —
 * an impossible grouping, since one device can't record two overlapping clips. Used only to warn.
 */
export function findOverlappingWithinGroups(sources: SourceClip[]): string[] {
  const byGroup = new Map<string, SourceClip[]>()
  for (const source of sources) {
    if (!source.deviceGroupId) continue
    const list = byGroup.get(source.deviceGroupId)
    if (list) list.push(source)
    else byGroup.set(source.deviceGroupId, [source])
  }

  const overlapping: string[] = []
  for (const [groupId, members] of byGroup) {
    const ranges = members
      .map(sourceCoverageRange)
      .filter((r): r is { startSec: number; endSec: number } => r !== null)
      .sort((a, b) => a.startSec - b.startSec)
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].startSec < ranges[i - 1].endSec - 1e-6) {
        overlapping.push(groupId)
        break
      }
    }
  }
  return overlapping
}
