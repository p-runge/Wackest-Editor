import { useMemo } from 'react'
import type { Project } from '@shared/types/project'
import { resolveVideoSourceId, resolveAudioSourceId } from '../lib/timeline-edit'

/**
 * Resolves which video/audio source is actually active at the current playhead — the single
 * source of truth PreviewPlayer and the camera/audio switcher both need, so the switcher's
 * highlighted tile always matches what the preview is actually showing.
 */
export function useResolvedSources(
  project: Project | null,
  playheadSec: number
): { activeVideoId?: string; activeAudioId?: string } {
  return useMemo(() => {
    if (!project) return {}
    const activeVideoId = resolveVideoSourceId(
      project.edit.activeVideoIntervals,
      project.sources,
      playheadSec
    )
    const activeAudioId = resolveAudioSourceId(
      project.edit.activeAudioIntervals,
      project.sources,
      playheadSec,
      activeVideoId
    )
    return { activeVideoId, activeAudioId }
  }, [project, playheadSec])
}
