import { useEffect } from 'react'
import { useProjectStore } from '../state/project-store'
import { usePlaybackStore } from '../state/playback-store'
import { isTypingTarget } from '../lib/dom'
import { RESYNC_THRESHOLD_SEC } from '../lib/playback'

export const SKIP_STEP_SEC = 5

/** App-wide shortcuts (undo/redo, playback) — active regardless of which panel has focus, as
 *  opposed to panel-local shortcuts like CameraSwitcher's digit keys. */
export function useGlobalShortcuts(): void {
  // Undo/redo ride the application-menu accelerator + IPC push (see main/index.ts) rather than
  // a keydown listener — on macOS, Cmd+Z/Cmd+Shift+Z never reach the renderer's DOM at all.
  useEffect(() => {
    const unsubUndo = window.api.menu.onUndo(() => useProjectStore.temporal.getState().undo())
    const unsubRedo = window.api.menu.onRedo(() => useProjectStore.temporal.getState().redo())
    return () => {
      unsubUndo()
      unsubRedo()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat || isTypingTarget(document.activeElement)) return

      if (e.metaKey || e.ctrlKey || e.altKey) return

      const project = useProjectStore.getState().project
      if (!project) return
      const playback = usePlaybackStore.getState()
      const endSec = Math.max(0, project.timelineDurationSec - RESYNC_THRESHOLD_SEC)

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          playback.togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          playback.seek(playback.playheadSec - SKIP_STEP_SEC)
          break
        case 'ArrowRight':
          e.preventDefault()
          playback.seek(Math.min(playback.playheadSec + SKIP_STEP_SEC, endSec))
          break
        case 'Home':
          e.preventDefault()
          playback.seek(0)
          break
        case 'End':
          e.preventDefault()
          playback.seek(endSec)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
