import { useCallback, useEffect, useState } from 'react'
import { Film, Mic } from 'lucide-react'
import type { Project, SourceClip } from '@shared/types/project'
import { colorForSourceId } from '../../lib/colors'
import { useResolvedSources } from '../../hooks/useResolvedSources'
import { mapUnifiedTimeToLocal } from '../../lib/timeline-edit'

interface CameraSwitcherProps {
  project: Project
  playheadSec: number
  videoSources: SourceClip[]
  audioRows: Array<{ source: SourceClip; linkedVideoLabel?: string }>
  setActiveVideoAt: (atSec: number, sourceId: string) => Promise<void>
  setPrimaryAudioAt: (atSec: number, sourceId: string) => Promise<void>
}

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

function Tile({
  index,
  label,
  color,
  active,
  disabled,
  shortcutHint,
  onClick
}: {
  index: number
  label: string
  color: string
  active: boolean
  disabled: boolean
  shortcutHint: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={
        disabled ? `${label} – keine Aufnahme zu diesem Zeitpunkt` : `${label} (${shortcutHint})`
      }
      className={`group relative flex w-12 shrink-0 flex-col items-center gap-0.5 rounded-md border bg-background/60 px-1 py-1 text-center transition-all ${
        disabled
          ? 'cursor-not-allowed opacity-35'
          : 'hover:bg-accent ' +
            (active
              ? 'border-transparent shadow-[0_0_0_1.5px_var(--tile-color)]'
              : 'border-border/80 hover:border-border')
      }`}
      style={{ '--tile-color': color } as React.CSSProperties}
    >
      <span
        className="absolute -left-1 -top-1 flex size-3.5 items-center justify-center rounded-full border border-border bg-card text-[9px] leading-none text-muted-foreground"
        style={active ? { borderColor: color, color } : undefined}
      >
        {index + 1}
      </span>
      <span
        className="h-1 w-4 shrink-0 rounded-full"
        style={{ backgroundColor: color, opacity: active ? 1 : 0.4 }}
      />
      <span className="w-full truncate text-[10px] leading-tight text-foreground/90">{label}</span>
    </button>
  )
}

function SwitcherRow({
  icon,
  items,
  activeId,
  sourceIds,
  keyHint,
  onSelect
}: {
  icon: React.ReactNode
  items: Array<{ id: string; label: string; hasCoverage: boolean }>
  activeId: string | undefined
  sourceIds: string[]
  keyHint: (index: number) => string
  onSelect: (id: string) => void
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <div className="flex flex-1 flex-wrap gap-1">
        {items.map((item, index) => (
          <Tile
            key={item.id}
            index={index}
            label={item.label}
            color={colorForSourceId(item.id, sourceIds)}
            active={item.id === activeId}
            disabled={!item.hasCoverage}
            shortcutHint={keyHint(index)}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </div>
    </div>
  )
}

function CameraSwitcher({
  project,
  playheadSec,
  videoSources,
  audioRows,
  setActiveVideoAt,
  setPrimaryAudioAt
}: CameraSwitcherProps): React.JSX.Element | null {
  const { activeVideoId, activeAudioId } = useResolvedSources(project, playheadSec)
  const [audioFollowsVideo, setAudioFollowsVideo] = useState(false)
  const sourceIds = project.sources.map((s) => s.id)

  // A track can only be switched to while it actually has footage at the current playhead —
  // otherwise there'd be nothing to show and the resolution logic would just fall through to
  // whatever else covers this instant anyway (see resolveVideoSourceId's graceful fallback).
  const hasCoverage = (source: SourceClip): boolean =>
    mapUnifiedTimeToLocal(source, playheadSec) !== null

  const handleCameraSelect = useCallback(
    (sourceId: string): void => {
      const source = videoSources.find((s) => s.id === sourceId)
      if (!source || mapUnifiedTimeToLocal(source, playheadSec) === null) return
      void setActiveVideoAt(playheadSec, source.id)
      if (audioFollowsVideo && source.probed.hasAudio) {
        void setPrimaryAudioAt(playheadSec, source.id)
      }
    },
    [playheadSec, audioFollowsVideo, videoSources, setActiveVideoAt, setPrimaryAudioAt]
  )

  const handleAudioSelect = useCallback(
    (sourceId: string): void => {
      const source = audioRows.find((row) => row.source.id === sourceId)?.source
      if (!source || mapUnifiedTimeToLocal(source, playheadSec) === null) return
      void setPrimaryAudioAt(playheadSec, sourceId)
    },
    [playheadSec, audioRows, setPrimaryAudioAt]
  )

  // Flipping the toggle only changes what *future* camera switches do, which gives no
  // feedback that anything happened. Also sync audio to whichever camera is active right now,
  // so turning it on has an immediate, visible effect on the "Primäres Audio" track.
  const handleToggleAudioFollowsVideo = (): void => {
    setAudioFollowsVideo((current) => {
      const next = !current
      if (next) {
        const activeVideo = videoSources.find((s) => s.id === activeVideoId)
        if (activeVideo?.probed.hasAudio && activeAudioId !== activeVideoId) {
          void setPrimaryAudioAt(playheadSec, activeVideo.id)
        }
      }
      return next
    })
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat || e.altKey || e.metaKey || e.ctrlKey) return
      if (isTypingTarget(document.activeElement)) return
      // Use the physical key (layout-independent) rather than e.key: holding Shift turns '1'
      // into '!', '"', '@' etc. depending on keyboard layout, so e.key would never match here.
      const digitMatch = /^Digit([1-9])$/.exec(e.code)
      if (!digitMatch) return

      const index = Number(digitMatch[1]) - 1
      if (e.shiftKey) {
        const row = audioRows[index]
        if (!row) return
        e.preventDefault()
        handleAudioSelect(row.source.id)
      } else {
        const source = videoSources[index]
        if (!source) return
        e.preventDefault()
        handleCameraSelect(source.id)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [videoSources, audioRows, handleCameraSelect, handleAudioSelect])

  return (
    <div className="flex flex-col gap-2 border-t border-border/60 bg-background/40 p-2.5">
      <SwitcherRow
        icon={<Film className="size-3.5" />}
        items={videoSources.map((s) => ({ id: s.id, label: s.label, hasCoverage: hasCoverage(s) }))}
        activeId={activeVideoId}
        sourceIds={sourceIds}
        keyHint={(i) => `Taste ${i + 1}`}
        onSelect={handleCameraSelect}
      />
      <SwitcherRow
        icon={<Mic className="size-3.5" />}
        items={audioRows.map(({ source }) => ({
          id: source.id,
          label: source.label,
          hasCoverage: hasCoverage(source)
        }))}
        activeId={activeAudioId}
        sourceIds={sourceIds}
        keyHint={(i) => `Umschalt+${i + 1}`}
        onSelect={handleAudioSelect}
      />

      <label className="flex cursor-pointer items-center justify-between gap-2 border-t border-border/40 pt-2 text-xs text-muted-foreground">
        <span title="Wenn an: ein Kamera-Wechsel schaltet auch das primäre Audio auf diese Quelle um (wirkt sofort auch auf die gerade aktive Kamera).">
          Ton folgt Bild
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={audioFollowsVideo}
          onClick={handleToggleAudioFollowsVideo}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            audioFollowsVideo ? 'bg-primary' : 'bg-muted-foreground/30'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform ${
              audioFollowsVideo ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </label>
    </div>
  )
}

export default CameraSwitcher
