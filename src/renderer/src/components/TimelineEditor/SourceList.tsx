import { Film, Mic, X } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { toMediaUrl } from '@shared/types/media-url'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'

function formatDuration(sec: number): string {
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function SourceList(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const removeSource = useProjectStore((state) => state.removeSource)

  if (!project || project.sources.length === 0) return null

  return (
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
            onClick={() => {
              if (window.confirm(`"${source.label}" aus dem Projekt entfernen?`)) {
                void removeSource(source.id)
              }
            }}
          >
            <X className="size-4" />
          </Button>
        </li>
      ))}
    </ul>
  )
}

export default SourceList
