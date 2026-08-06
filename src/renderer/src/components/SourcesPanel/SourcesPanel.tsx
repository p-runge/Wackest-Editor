import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Film, Loader2, Mic, Upload, X } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { toMediaUrl } from '@shared/types/media-url'
import { findOverlappingWithinGroups } from '@shared/types/device-grouping'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Progress } from '../ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { DeviceGroup, Project, SourceClip } from '@shared/types/project'
import type { SourceImportProgressEvent } from '@shared/types/ipc'

const NEW_GROUP_VALUE = '__new__'

function isSourceInUse(project: Project, sourceId: string): boolean {
  return (
    project.edit.activeVideoIntervals.some((iv) => iv.value === sourceId) ||
    project.edit.activeAudioIntervals.some((iv) => iv.value === sourceId)
  )
}

function formatDuration(sec: number): string {
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function importStageLabel(stage: SourceImportProgressEvent['stage']): string {
  switch (stage) {
    case 'probing':
      return 'Analysiere Datei'
    case 'waveform':
      return 'Erzeuge Wellenform'
    case 'thumbnail':
      return 'Erzeuge Vorschaubild'
    case 'done':
      return 'Fertig'
    case 'cancelled':
      return 'Abgebrochen'
    default:
      return stage
  }
}

// Stage boundaries used only to give the per-file progress bar a sensible shape — waveform
// extraction fully decodes the file and dominates; thumbnail/probing are comparatively instant.
const STAGE_BASE_FRACTION: Record<SourceImportProgressEvent['stage'], number> = {
  probing: 0,
  waveform: 0.05,
  thumbnail: 0.9,
  done: 1,
  cancelled: 1
}

function fileCompletionFraction(update: SourceImportProgressEvent): number {
  if (update.stage === 'done' || update.stage === 'cancelled') return 1
  const base = STAGE_BASE_FRACTION[update.stage]
  const nextBase =
    update.stage === 'waveform' ? STAGE_BASE_FRACTION.thumbnail : STAGE_BASE_FRACTION.done
  return base + update.progress * (nextBase - base)
}

/** Editable device-group name; commits on blur or Enter. */
function GroupNameInput({
  group,
  onRename
}: {
  group: DeviceGroup
  onRename: (name: string) => void
}): React.JSX.Element {
  // Local edit buffer; the parent remounts this via key={group.name} when the committed name changes
  // elsewhere, so no effect is needed to sync back an external rename.
  const [value, setValue] = useState(group.name)
  return (
    <input
      className="min-w-0 flex-1 truncate rounded bg-transparent text-sm font-medium outline-none focus:bg-muted/40 focus:px-1"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onRename(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setValue(group.name)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function SourceRow({
  source,
  otherGroups,
  onMoveToGroup,
  onMoveToNewGroup,
  onRemove
}: {
  source: SourceClip
  otherGroups: DeviceGroup[]
  onMoveToGroup: (groupId: string) => void
  onMoveToNewGroup: () => void
  onRemove: () => void
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
      <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
        {source.thumbnailCachePath ? (
          <img
            src={toMediaUrl(source.thumbnailCachePath)}
            alt=""
            className="size-full object-cover"
          />
        ) : source.kind === 'audio' ? (
          <Mic className="size-4 text-muted-foreground" />
        ) : (
          <Film className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{source.label}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {source.kind === 'video' ? 'Video' : 'Audio'}
          </Badge>
          <span>{formatDuration(source.probed.durationSec)}</span>
          {source.probed.width && source.probed.height && (
            <span>
              {source.probed.width}×{source.probed.height}
            </span>
          )}
        </div>
      </div>
      <Select
        value=""
        onValueChange={(v) => (v === NEW_GROUP_VALUE ? onMoveToNewGroup() : onMoveToGroup(v))}
      >
        <SelectTrigger
          className="h-7 w-28 shrink-0 text-xs"
          title="In ein anderes Gerät verschieben"
        >
          <SelectValue placeholder="Verschieben…" />
        </SelectTrigger>
        <SelectContent>
          {otherGroups.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
          <SelectItem value={NEW_GROUP_VALUE}>Neues Gerät…</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" title="Quelle entfernen" onClick={onRemove}>
        <X className="size-4" />
      </Button>
    </li>
  )
}

function SourcesPanel(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const removeSource = useProjectStore((state) => state.removeSource)
  const importSources = useProjectStore((state) => state.importSources)
  const cancelImportFile = useProjectStore((state) => state.cancelImportFile)
  const renameDeviceGroup = useProjectStore((state) => state.renameDeviceGroup)
  const reorderDeviceGroup = useProjectStore((state) => state.reorderDeviceGroup)
  const moveSourceToGroup = useProjectStore((state) => state.moveSourceToGroup)
  const moveSourceToNewGroup = useProjectStore((state) => state.moveSourceToNewGroup)
  const isImporting = useProjectStore((state) => state.isImporting)
  const importingFiles = useProjectStore((state) => state.importingFiles)
  const importError = useProjectStore((state) => state.importError)
  const loadingAnchorRef = useRef<HTMLLIElement>(null)
  const [pendingRemove, setPendingRemove] = useState<SourceClip | null>(null)

  useEffect(() => {
    if (isImporting) loadingAnchorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [isImporting])

  if (!project) return null

  const orderedGroups = [...project.deviceGroups].sort((a, b) => a.order - b.order)
  const overlappingGroupIds = new Set(findOverlappingWithinGroups(project.sources))

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Dateien hierher ziehen oder ins Projekt ablegen, um sie zu importieren. Clips desselben
        Geräts werden automatisch zu einer Spur gruppiert.
      </p>

      <Button className="w-full" disabled={isImporting} onClick={() => void importSources()}>
        {isImporting ? <Loader2 className="animate-spin" /> : <Upload />}
        {isImporting ? 'Importiere…' : 'Dateien importieren'}
      </Button>

      {importError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {importError}
        </p>
      )}

      {project.sources.length === 0 && !isImporting ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Noch keine Dateien importiert.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {orderedGroups.map((group, groupIndex) => {
            const members = project.sources.filter((s) => s.deviceGroupId === group.id)
            if (members.length === 0) return null
            const otherGroups = orderedGroups.filter((g) => g.id !== group.id)
            const hasOverlap = overlappingGroupIds.has(group.id)
            return (
              <div key={group.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-1">
                  <GroupNameInput
                    key={group.name}
                    group={group}
                    onRename={(name) => void renameDeviceGroup(group.id, name)}
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    V{groupIndex + 1}/A{groupIndex + 1}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    title="Nach oben"
                    disabled={groupIndex === 0}
                    onClick={() => void reorderDeviceGroup(group.id, 'up')}
                  >
                    <ChevronUp className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    title="Nach unten"
                    disabled={groupIndex === orderedGroups.length - 1}
                    onClick={() => void reorderDeviceGroup(group.id, 'down')}
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                </div>

                {hasOverlap && (
                  <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Clips dieses Geräts überschneiden sich zeitlich — das kann nicht dasselbe
                      Gerät sein. Bitte einen Clip in ein anderes Gerät verschieben.
                    </span>
                  </div>
                )}

                <ul className="flex flex-col gap-2">
                  {members.map((source) => (
                    <SourceRow
                      key={source.id}
                      source={source}
                      otherGroups={otherGroups}
                      onMoveToGroup={(groupId) => void moveSourceToGroup(source.id, groupId)}
                      onMoveToNewGroup={() => void moveSourceToNewGroup(source.id)}
                      onRemove={() => setPendingRemove(source)}
                    />
                  ))}
                </ul>
              </div>
            )
          })}

          {isImporting && (
            <ul className="flex flex-col gap-2">
              {importingFiles.map((update, index) => {
                const finished = update.stage === 'done' || update.stage === 'cancelled'
                return (
                  <li
                    key={update.filePath}
                    ref={index === 0 ? loadingAnchorRef : undefined}
                    className="flex items-center gap-3 rounded-md border border-dashed border-border bg-card px-3 py-2"
                  >
                    <div className="flex size-11 shrink-0 items-center justify-center rounded bg-muted">
                      {update.stage === 'cancelled' ? (
                        <X className="size-4 text-muted-foreground" />
                      ) : (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{update.fileName}</span>
                        {update.fileCount > 1 && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {update.fileIndex + 1}/{update.fileCount}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {importStageLabel(update.stage)}
                      </div>
                      <Progress
                        value={Math.round(fileCompletionFraction(update) * 100)}
                        className="mt-1.5"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Import abbrechen"
                      disabled={finished}
                      onClick={() => cancelImportFile(update.filePath)}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <Dialog open={pendingRemove != null} onOpenChange={(open) => !open && setPendingRemove(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>„{pendingRemove?.label}“ entfernen?</DialogTitle>
            <DialogDescription>
              Die Quelle wird aus dem Projekt entfernt. Die Originaldatei auf der Festplatte bleibt
              davon unberührt.
            </DialogDescription>
          </DialogHeader>

          {pendingRemove && isSourceInUse(project, pendingRemove.id) && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Diese Quelle wird aktuell als aktives Video oder aktives Audio in der Timeline
                verwendet. Entfernen kann Lücken im Schnitt verursachen.
              </span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingRemove(null)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingRemove) void removeSource(pendingRemove.id)
                setPendingRemove(null)
              }}
            >
              Entfernen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default SourcesPanel
