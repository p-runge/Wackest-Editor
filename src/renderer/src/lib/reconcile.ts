import type { Project } from '@shared/types/project'
import { initializeKeptRanges } from './timeline-edit'

// Kept ranges are placement-based (no source id), so an end past the timeline — or a fully swapped
// source set — is the objective signal that they belong to *previous* footage and can't be salvaged.
const OUT_OF_BOUNDS_EPS = 0.01

/**
 * Automated cleanup for a project whose stored state no longer matches its current sources —
 * chiefly after the footage is swapped out (remove old sources + import new ones), which leaves the
 * transcript, per-source heatmaps, active intervals, and cut ranges pinned to source ids that no
 * longer exist. Left alone, stale cut ranges render as a phantom gap at the start of the timeline
 * that no normal action clears (re-sync only re-initializes cuts when the list is empty).
 *
 * Purely additive imports (adding a camera to an ongoing edit) are untouched: the referenced
 * sources still exist and the cut ranges stay within the timeline, so nothing here triggers.
 *
 * This is intentionally conservative — it only drops references to sources that are genuinely gone
 * and only resets cut ranges when they're out of bounds or the footage was wholly swapped, so a
 * user's real cuts are never discarded on a partial change.
 */
export function reconcileProject(project: Project): Project {
  const sourceIds = new Set(project.sources.map((s) => s.id))

  const transcript = project.transcript.filter((seg) => sourceIds.has(seg.sourceClipId))
  const trackHeatmaps = project.trackHeatmaps.filter((t) => sourceIds.has(t.sourceId))
  const activeVideoIntervals = project.edit.activeVideoIntervals.filter((iv) =>
    sourceIds.has(iv.value)
  )
  const activeAudioIntervals = project.edit.activeAudioIntervals.filter((iv) =>
    sourceIds.has(iv.value)
  )

  const duration = project.timelineDurationSec
  const hasOutOfBoundsCut = project.edit.keptRanges.some(
    (r) => r.startSec < -OUT_OF_BOUNDS_EPS || r.endSec > duration + OUT_OF_BOUNDS_EPS
  )
  // "Wholly swapped" = a non-empty transcript/heatmap/active-video set that fully vanished, i.e.
  // none of it referenced a still-existing source. A partial removal keeps some of it, so it won't
  // trip this.
  const footageWhollySwapped =
    (project.transcript.length > 0 && transcript.length === 0) ||
    (project.trackHeatmaps.length > 0 && trackHeatmaps.length === 0) ||
    (project.edit.activeVideoIntervals.length > 0 && activeVideoIntervals.length === 0)

  const keptRanges =
    project.edit.keptRanges.length > 0 && (hasOutOfBoundsCut || footageWhollySwapped)
      ? initializeKeptRanges(duration)
      : project.edit.keptRanges

  const unchanged =
    transcript.length === project.transcript.length &&
    trackHeatmaps.length === project.trackHeatmaps.length &&
    activeVideoIntervals.length === project.edit.activeVideoIntervals.length &&
    activeAudioIntervals.length === project.edit.activeAudioIntervals.length &&
    keptRanges === project.edit.keptRanges
  if (unchanged) return project

  return {
    ...project,
    transcript,
    trackHeatmaps,
    edit: { ...project.edit, keptRanges, activeVideoIntervals, activeAudioIntervals }
  }
}
