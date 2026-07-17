import { RefreshCw } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Input } from '../ui/input'
import { cn } from '@renderer/lib/utils'

function confidenceBadge(
  confidence: number,
  method: string
): { text: string; variant: 'secondary' | 'success' | 'destructive' } {
  if (method === 'manual') return { text: 'manuell', variant: 'secondary' }
  if (confidence >= 0.02) return { text: 'hoch', variant: 'success' }
  if (confidence >= 0.005) return { text: 'mittel', variant: 'secondary' }
  return { text: 'niedrig – bitte prüfen', variant: 'destructive' }
}

function SyncPanel(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const isSyncing = useProjectStore((state) => state.isSyncing)
  const syncProgress = useProjectStore((state) => state.syncProgress)
  const error = useProjectStore((state) => state.syncError)
  const runSync = useProjectStore((state) => state.runSync)
  const setManualOffset = useProjectStore((state) => state.setManualOffset)

  if (!project || project.sources.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Zuerst Quellen importieren, um sie zu synchronisieren.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Zeitversatz zwischen den Aufnahmen automatisch berechnen oder manuell justieren.
      </p>

      <Button className="w-full" disabled={isSyncing} onClick={() => void runSync()}>
        <RefreshCw className={cn(isSyncing && 'animate-spin')} />
        {isSyncing ? 'Synchronisiere…' : 'Sync starten'}
      </Button>

      {isSyncing && syncProgress && (
        <p className="text-sm text-muted-foreground">
          {syncProgress.stage === 'extracting' &&
            `Extrahiere Audio: ${syncProgress.sourceLabel ?? ''}`}
          {syncProgress.stage === 'correlating' && 'Berechne Zeitversätze…'}
          {syncProgress.stage === 'done' && 'Fertig.'}
        </p>
      )}

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {project.sources.map((source) => (
          <li key={source.id} className="rounded-md border border-border bg-card px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
              {source.label}
              {source.role === 'main' && (
                <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                  Haupt
                </Badge>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {source.syncSegments.map((segment) => {
                const badge = confidenceBadge(segment.confidence, segment.method)
                return (
                  <div key={segment.id} className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-muted-foreground">
                      {segment.localStartSec.toFixed(1)}s–{segment.localEndSec.toFixed(1)}s
                    </span>
                    <label className="flex items-center gap-1.5">
                      Offset (s)
                      <Input
                        type="number"
                        step="0.01"
                        value={segment.offsetSec}
                        className="h-7 w-24"
                        onChange={(e) => {
                          const value = Number(e.target.value)
                          if (!Number.isNaN(value)) {
                            void setManualOffset(source.id, segment.id, value)
                          }
                        }}
                      />
                    </label>
                    <Badge variant={badge.variant} className="px-1.5 py-0 text-[10px]">
                      {badge.text}
                    </Badge>
                  </div>
                )
              })}
            </div>
            {source.hardCutMarkers.length > 0 && (
              <div className="mt-1.5 text-xs text-warning">
                Hard-Cuts erkannt bei:{' '}
                {source.hardCutMarkers.map((t) => `${t.toFixed(1)}s`).join(', ')}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default SyncPanel
