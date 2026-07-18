import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Film, Loader2, Mic, Upload, X } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { toMediaUrl } from '@shared/types/media-url'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog'
import type { Project, SourceClip } from '@shared/types/project'

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

function FilesPanel(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const removeSource = useProjectStore((state) => state.removeSource)
  const importFiles = useProjectStore((state) => state.importFiles)
  const isImporting = useProjectStore((state) => state.isImporting)
  const importingCount = useProjectStore((state) => state.importingCount)
  const importError = useProjectStore((state) => state.importError)
  const loadingAnchorRef = useRef<HTMLLIElement>(null)
  const [pendingRemove, setPendingRemove] = useState<SourceClip | null>(null)

  useEffect(() => {
    if (isImporting) loadingAnchorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [isImporting])

  if (!project) return null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Dateien hierher ziehen oder ins Projekt ablegen, um sie zu importieren.
      </p>

      <Button className="w-full" disabled={isImporting} onClick={() => void importFiles()}>
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
        <ul className="flex flex-col gap-2">
          {project.sources.map((source) => (
            <li
              key={source.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
            >
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
              <Button
                variant="ghost"
                size="icon"
                title="Quelle entfernen"
                onClick={() => setPendingRemove(source)}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
          {isImporting &&
            Array.from({ length: importingCount }).map((_, index) => (
              <li
                key={`importing-${index}`}
                ref={index === 0 ? loadingAnchorRef : undefined}
                className="flex animate-pulse items-center gap-3 rounded-md border border-dashed border-border bg-card px-3 py-2"
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded bg-muted">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1 text-sm text-muted-foreground">Importiere…</div>
              </li>
            ))}
        </ul>
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

export default FilesPanel
