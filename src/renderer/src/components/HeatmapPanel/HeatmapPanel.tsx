import { Flame } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { colorForScore } from '../../lib/colors'
import type { HeatmapProviderId } from '@shared/types/project'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function HeatmapPanel(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const isScoringHeatmap = useProjectStore((state) => state.isScoringHeatmap)
  const heatmapProgress = useProjectStore((state) => state.heatmapProgress)
  const error = useProjectStore((state) => state.error)
  const runHeatmap = useProjectStore((state) => state.runHeatmap)
  const setHeatmapProvider = useProjectStore((state) => state.setHeatmapProvider)

  if (!project) return null
  if (project.transcript.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Zuerst ein Transkript erzeugen – die Heatmap wertet den gesprochenen Inhalt aus.
      </p>
    )
  }

  const duration = project.timelineDurationSec || 1

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Interessante Abschnitte anhand des Transkripts bewerten.
        </p>
        <div className="flex items-center gap-2">
          <Select
            value={project.providerConfig.heatmap.provider}
            onValueChange={(v) => void setHeatmapProvider(v as HeatmapProviderId)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="heuristic-local">Lokale Heuristik</SelectItem>
              <SelectItem value="llm-claude">Claude API</SelectItem>
              <SelectItem value="llm-openai">OpenAI API</SelectItem>
            </SelectContent>
          </Select>
          <Button disabled={isScoringHeatmap} onClick={() => void runHeatmap()}>
            <Flame />
            {isScoringHeatmap
              ? `Analysiere…${heatmapProgress != null ? ` ${Math.round(heatmapProgress * 100)}%` : ''}`
              : 'Heatmap berechnen'}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {project.heatmap.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Noch keine Heatmap berechnet.
        </p>
      ) : (
        <>
          <div className="flex h-6 w-full overflow-hidden rounded-md border border-border">
            {project.heatmap.map((point, i) => (
              <div
                key={i}
                style={{
                  width: `${((point.endSec - point.startSec) / duration) * 100}%`,
                  backgroundColor: colorForScore(point.score)
                }}
                title={`${formatTime(point.startSec)}–${formatTime(point.endSec)} · Score ${point.score.toFixed(2)}${point.reason ? `\n${point.reason}` : ''}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>niedrig</span>
            <div
              className="h-2 flex-1 rounded-full"
              style={{
                background: `linear-gradient(to right, ${colorForScore(0)}, ${colorForScore(1)})`
              }}
            />
            <span>hoch</span>
          </div>
        </>
      )}
    </div>
  )
}

export default HeatmapPanel
