import { create } from 'zustand'

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
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set({ isPlaying: !get().isPlaying }),
  setZoom: (pixelsPerSecond) =>
    set({ pixelsPerSecond: Math.max(1, Math.min(200, pixelsPerSecond)) })
}))
