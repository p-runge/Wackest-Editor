import { ChevronsLeft, ChevronsRight, Pause, Play, Rewind, FastForward } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { usePlaybackStore } from '../../state/playback-store'
import { SKIP_STEP_SEC } from '../../hooks/useGlobalShortcuts'
import { RESYNC_THRESHOLD_SEC } from '../../lib/playback'
import { Button } from '../ui/button'

function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function PreviewTransportControls(): React.JSX.Element {
  const timelineDurationSec = useProjectStore((state) => state.project?.timelineDurationSec ?? 0)
  const playheadSec = usePlaybackStore((state) => state.playheadSec)
  const isPlaying = usePlaybackStore((state) => state.isPlaying)
  const togglePlay = usePlaybackStore((state) => state.togglePlay)
  const seek = usePlaybackStore((state) => state.seek)

  // Same spot natural playback-to-the-end already stops at (see PreviewPlayer's advancePastGap) —
  // landing exactly on timelineDurationSec resolves no active source at all (blank preview).
  const endSec = Math.max(0, timelineDurationSec - RESYNC_THRESHOLD_SEC)
  const atStart = playheadSec <= 0
  const atEnd = playheadSec >= endSec

  return (
    <div className="flex items-center gap-1 border-t border-border/60 bg-background/40 px-2 py-1.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={atStart}
        onClick={() => seek(0)}
        title="Zum Anfang (Pos1)"
      >
        <ChevronsLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={atStart}
        onClick={() => seek(playheadSec - SKIP_STEP_SEC)}
        title={`${SKIP_STEP_SEC} Sek. zurück (←)`}
      >
        <Rewind />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={togglePlay}
        title="Play/Pause (Leertaste)"
      >
        {isPlaying ? <Pause /> : <Play />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={atEnd}
        onClick={() => seek(Math.min(playheadSec + SKIP_STEP_SEC, endSec))}
        title={`${SKIP_STEP_SEC} Sek. vor (→)`}
      >
        <FastForward />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={atEnd}
        onClick={() => seek(endSec)}
        title="Zum Ende (Ende)"
      >
        <ChevronsRight />
      </Button>
      <span className="ml-1 font-mono text-xs tabular-nums text-muted-foreground">
        {formatTime(playheadSec)} / {formatTime(timelineDurationSec)}
      </span>
    </div>
  )
}

export default PreviewTransportControls
