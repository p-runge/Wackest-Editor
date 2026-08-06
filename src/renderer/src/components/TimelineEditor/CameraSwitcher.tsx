import { useCallback, useEffect, useState } from 'react'
import { Film, Mic } from 'lucide-react'
import type { Project, SourceClip } from '@shared/types/project'
import { colorForGroupId } from '../../lib/colors'
import { orderedGroupIds, type DeviceLane } from '../../lib/device-lanes'
import { useResolvedSources } from '../../hooks/useResolvedSources'
import { mapUnifiedTimeToLocal } from '../../lib/timeline-edit'
import { isTypingTarget } from '../../lib/dom'

interface CameraSwitcherProps {
  project: Project
  playheadSec: number
  videoLanes: DeviceLane[]
  audioLanes: DeviceLane[]
  setActiveVideoAt: (atSec: number, sourceId: string) => Promise<void>
  setActiveAudioAt: (atSec: number, sourceId: string) => Promise<void>
}

/** The member of a group whose footage covers `atSec` (a group's clips never overlap). */
function memberCovering(members: SourceClip[], atSec: number): SourceClip | undefined {
  return members.find((m) => mapUnifiedTimeToLocal(m, atSec) !== null)
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
  groupIds,
  keyHint,
  onSelect
}: {
  icon: React.ReactNode
  items: Array<{ id: string; label: string; hasCoverage: boolean }>
  activeId: string | undefined
  groupIds: string[]
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
            color={colorForGroupId(item.id, groupIds)}
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
  videoLanes,
  audioLanes,
  setActiveVideoAt,
  setActiveAudioAt
}: CameraSwitcherProps): React.JSX.Element | null {
  const { activeVideoId, activeAudioId } = useResolvedSources(project, playheadSec)
  const [audioFollowsVideo, setAudioFollowsVideo] = useState(false)
  const groupIds = orderedGroupIds(project)

  // The group id that currently owns the active video / audio source.
  const activeVideoGroupId = videoLanes.find((l) => l.members.some((m) => m.id === activeVideoId))
    ?.group.id
  const activeAudioGroupId = audioLanes.find((l) => l.members.some((m) => m.id === activeAudioId))
    ?.group.id

  const handleCameraSelect = useCallback(
    (groupId: string): void => {
      const lane = videoLanes.find((l) => l.group.id === groupId)
      const member = lane && memberCovering(lane.members, playheadSec)
      if (!member) return
      void setActiveVideoAt(playheadSec, member.id)
      if (audioFollowsVideo && member.probed.hasAudio) {
        void setActiveAudioAt(playheadSec, member.id)
      }
    },
    [playheadSec, audioFollowsVideo, videoLanes, setActiveVideoAt, setActiveAudioAt]
  )

  const handleAudioSelect = useCallback(
    (groupId: string): void => {
      const lane = audioLanes.find((l) => l.group.id === groupId)
      const member = lane && memberCovering(lane.members, playheadSec)
      if (!member) return
      void setActiveAudioAt(playheadSec, member.id)
    },
    [playheadSec, audioLanes, setActiveAudioAt]
  )

  // Flipping the toggle only changes what *future* camera switches do, which gives no feedback that
  // anything happened. Also sync audio to whichever camera group is active right now, so turning it
  // on has an immediate, visible effect on the "Aktives Audio" track.
  const handleToggleAudioFollowsVideo = (): void => {
    setAudioFollowsVideo((current) => {
      const next = !current
      if (next && activeVideoGroupId && activeVideoGroupId !== activeAudioGroupId) {
        const lane = videoLanes.find((l) => l.group.id === activeVideoGroupId)
        const member = lane && memberCovering(lane.members, playheadSec)
        if (member?.probed.hasAudio) void setActiveAudioAt(playheadSec, member.id)
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
        const lane = audioLanes[index]
        if (!lane) return
        e.preventDefault()
        handleAudioSelect(lane.group.id)
      } else {
        const lane = videoLanes[index]
        if (!lane) return
        e.preventDefault()
        handleCameraSelect(lane.group.id)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [videoLanes, audioLanes, handleCameraSelect, handleAudioSelect])

  return (
    <div className="flex flex-col gap-2 p-2.5">
      <SwitcherRow
        icon={<Film className="size-3.5" />}
        items={videoLanes.map((l) => ({
          id: l.group.id,
          label: l.group.name,
          hasCoverage: memberCovering(l.members, playheadSec) !== undefined
        }))}
        activeId={activeVideoGroupId}
        groupIds={groupIds}
        keyHint={(i) => `Taste ${i + 1}`}
        onSelect={handleCameraSelect}
      />
      <SwitcherRow
        icon={<Mic className="size-3.5" />}
        items={audioLanes.map((l) => ({
          id: l.group.id,
          label: l.group.name,
          hasCoverage: memberCovering(l.members, playheadSec) !== undefined
        }))}
        activeId={activeAudioGroupId}
        groupIds={groupIds}
        keyHint={(i) => `Umschalt+${i + 1}`}
        onSelect={handleAudioSelect}
      />

      <label className="flex cursor-pointer items-center justify-between gap-2 border-t border-border/40 pt-2 text-xs text-muted-foreground">
        <span title="Wenn an: ein Kamera-Wechsel schaltet auch das aktive Audio auf dieses Gerät um (wirkt sofort auch auf die gerade aktive Kamera).">
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
