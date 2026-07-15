import { useProjectStore } from '../../state/project-store'
import './import-panel.css'

function formatDuration(sec: number): string {
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function ImportPanel(): React.JSX.Element {
  const project = useProjectStore((state) => state.project)
  const projectDir = useProjectStore((state) => state.projectDir)
  const isImporting = useProjectStore((state) => state.isImporting)
  const error = useProjectStore((state) => state.error)
  const newProject = useProjectStore((state) => state.newProject)
  const openProject = useProjectStore((state) => state.openProject)
  const importFiles = useProjectStore((state) => state.importFiles)

  if (!project || !projectDir) {
    return (
      <div className="import-panel import-panel--empty">
        <h1>Wackest Tool</h1>
        <p>Multicam-Schnittwerkzeug: Sync, Untertitel, Highlight-Heatmap, manueller Schnitt.</p>
        <div className="import-panel__actions">
          <button onClick={() => void newProject()}>Neues Projekt</button>
          <button onClick={() => void openProject()}>Projekt öffnen</button>
        </div>
        {error && <p className="import-panel__error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="import-panel">
      <header className="import-panel__header">
        <h1>{project.name}</h1>
        <button disabled={isImporting} onClick={() => void importFiles()}>
          {isImporting ? 'Importiere…' : 'Rohspuren importieren'}
        </button>
      </header>

      {error && <p className="import-panel__error">{error}</p>}

      {project.sources.length === 0 ? (
        <p className="import-panel__hint">
          Noch keine Quellen importiert. Importiere Kamera-, Mikro- und Handy-Aufnahmen.
        </p>
      ) : (
        <ul className="import-panel__list">
          {project.sources.map((source) => (
            <li key={source.id} className="source-row">
              <div className="source-row__thumb">
                {source.thumbnailCachePath ? (
                  <img src={`file://${source.thumbnailCachePath}`} alt="" />
                ) : (
                  <div className="source-row__thumb-placeholder">
                    {source.kind === 'audio' ? '🎙️' : '🎬'}
                  </div>
                )}
              </div>
              <div className="source-row__meta">
                <div className="source-row__label">{source.label}</div>
                <div className="source-row__details">
                  <span className={`source-row__kind source-row__kind--${source.kind}`}>
                    {source.kind === 'video' ? 'Video' : 'Audio'}
                  </span>
                  <span>{formatDuration(source.probed.durationSec)}</span>
                  {source.probed.width && source.probed.height && (
                    <span>
                      {source.probed.width}×{source.probed.height}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ImportPanel
