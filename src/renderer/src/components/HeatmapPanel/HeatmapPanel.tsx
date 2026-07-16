import { useProjectStore } from '../../state/project-store'
import { colorForScore } from '../../lib/colors'
import type { HeatmapProviderId } from '@shared/types/project'
import './heatmap-panel.css'

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

  if (!project || project.transcript.length === 0) return null

  const duration = project.timelineDurationSec || 1

  return (
    <div className="heatmap-panel">
      <header className="heatmap-panel__header">
        <h2>Interessen-Heatmap</h2>
        <div className="heatmap-panel__controls">
          <select
            value={project.providerConfig.heatmap.provider}
            onChange={(e) => void setHeatmapProvider(e.target.value as HeatmapProviderId)}
          >
            <option value="heuristic-local">Lokale Heuristik</option>
            <option value="llm-claude">Claude API</option>
            <option value="llm-openai">OpenAI API</option>
          </select>
          <button disabled={isScoringHeatmap} onClick={() => void runHeatmap()}>
            {isScoringHeatmap
              ? `Analysiere…${heatmapProgress != null ? ` ${Math.round(heatmapProgress * 100)}%` : ''}`
              : 'Heatmap berechnen'}
          </button>
        </div>
      </header>

      {error && <p className="heatmap-panel__error">{error}</p>}

      {project.heatmap.length === 0 ? (
        <p className="heatmap-panel__hint">Noch keine Heatmap berechnet.</p>
      ) : (
        <>
          <div className="heatmap-strip">
            {project.heatmap.map((point, i) => (
              <div
                key={i}
                className="heatmap-strip__bucket"
                style={{
                  width: `${((point.endSec - point.startSec) / duration) * 100}%`,
                  backgroundColor: colorForScore(point.score)
                }}
                title={`${formatTime(point.startSec)}–${formatTime(point.endSec)} · Score ${point.score.toFixed(2)}${point.reason ? `\n${point.reason}` : ''}`}
              />
            ))}
          </div>
          <div className="heatmap-legend">
            <span>niedrig</span>
            <div className="heatmap-legend__gradient" />
            <span>hoch</span>
          </div>
        </>
      )}
    </div>
  )
}

export default HeatmapPanel
