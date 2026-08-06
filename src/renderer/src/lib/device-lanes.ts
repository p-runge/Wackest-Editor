import type { DeviceGroup, Project, SourceClip } from '@shared/types/project'

/** One editor lane = one device group, plus that group's member sources relevant to the section. */
export interface DeviceLane {
  group: DeviceGroup
  members: SourceClip[]
}

/**
 * The device-group lanes to render for a timeline section, in group order. The video section shows
 * groups with at least one video source; the audio section shows groups with at least one source
 * that carries audio (a video source's own audio counts, mirroring the previous per-source rows).
 * Only groups that have a relevant member appear — an audio-only device won't show a video lane.
 */
export function deviceLanes(project: Project, section: 'video' | 'audio'): DeviceLane[] {
  const memberFilter = (s: SourceClip): boolean =>
    section === 'video'
      ? s.kind === 'video'
      : s.kind === 'audio' || (s.kind === 'video' && s.probed.hasAudio)

  return [...project.deviceGroups]
    .sort((a, b) => a.order - b.order)
    .map((group) => ({
      group,
      members: project.sources.filter((s) => s.deviceGroupId === group.id && memberFilter(s))
    }))
    .filter((lane) => lane.members.length > 0)
}

/** The device groups in render order (used for stable per-group coloring). */
export function orderedGroupIds(project: Project): string[] {
  return [...project.deviceGroups].sort((a, b) => a.order - b.order).map((g) => g.id)
}
