import { create } from 'zustand'
import { useProjectStore } from './project-store'
import { RESYNC_THRESHOLD_SEC } from '../lib/playback'

interface PlaybackState {
  playheadSec: number
  isPlaying: boolean
  pixelsPerSecond: number
  seek: (sec: number) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  setZoom: (pixelsPerSecond: number) => void
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  playheadSec: 0,
  isPlaying: false,
  pixelsPerSecond: 20,

  seek: (sec) => set({ playheadSec: Math.max(0, sec) }),
  play: () => {
    // Pressing play while sitting at (or past) the end of the last chunk starts over from the
    // first chunk, rather than resuming for a fraction of a second and immediately stopping
    // again. The program's bounds are the kept chunks' placements — with none left, the program
    // is empty (end 0) and playback pauses right away via PreviewPlayer's effects.
    const keptRanges = useProjectStore.getState().project?.edit.keptRanges ?? []
    const lastEndSec = keptRanges.reduce((max, r) => Math.max(max, r.endSec), 0)
    const firstStartSec = keptRanges.length > 0 ? Math.min(...keptRanges.map((r) => r.startSec)) : 0
    const atEnd = get().playheadSec >= lastEndSec - RESYNC_THRESHOLD_SEC
    set({ isPlaying: true, ...(atEnd ? { playheadSec: firstStartSec } : {}) })
  },
  pause: () => set({ isPlaying: false }),
  togglePlay: () => (get().isPlaying ? get().pause() : get().play()),
  setZoom: (pixelsPerSecond) =>
    set({ pixelsPerSecond: Math.max(1, Math.min(200, pixelsPerSecond)) })
}))
