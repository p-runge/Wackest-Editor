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
    // Pressing play while sitting at (or past) the natural end starts over from the beginning,
    // rather than resuming for a fraction of a second and immediately stopping again.
    const timelineDurationSec = useProjectStore.getState().project?.timelineDurationSec ?? 0
    const atEnd = get().playheadSec >= timelineDurationSec - RESYNC_THRESHOLD_SEC
    set({ isPlaying: true, ...(atEnd ? { playheadSec: 0 } : {}) })
  },
  pause: () => set({ isPlaying: false }),
  togglePlay: () => (get().isPlaying ? get().pause() : get().play()),
  setZoom: (pixelsPerSecond) =>
    set({ pixelsPerSecond: Math.max(1, Math.min(200, pixelsPerSecond)) })
}))
