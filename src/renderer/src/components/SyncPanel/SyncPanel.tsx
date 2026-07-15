import { useProjectStore } from '../../state/project-store'
import './sync-panel.css'

function confidenceLabel(confidence: number, method: string): { text: string; className: string } {
  if (method === 'manual') return { text: 'manuell', className: 'confidence--manual' }
  if (confidence >= 0.02) return { text: 'hoch', className: 'confidence--high' }
  if (confidence >= 0.005) return { text: 'mittel', className: 'confidence--medium' }
  return { text: 'niedrig – bitte prüfen', className: 'confidence--low' }
}

function SyncPanel(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const isSyncing = useProjectStore((state) => state.isSyncing)
  const syncProgress = useProjectStore((state) => state.syncProgress)
  const runSync = useProjectStore((state) => state.runSync)
  const setManualOffset = useProjectStore((state) => state.setManualOffset)

  if (!project || project.sources.length === 0) return null

  return (
    <div className="sync-panel">
      <header className="sync-panel__header">
        <h2>Synchronisation</h2>
        <button disabled={isSyncing} onClick={() => void runSync()}>
          {isSyncing ? 'Synchronisiere…' : 'Sync starten'}
        </button>
      </header>

      {isSyncing && syncProgress && (
        <p className="sync-panel__progress">
          {syncProgress.stage === 'extracting' &&
            `Extrahiere Audio: ${syncProgress.sourceLabel ?? ''}`}
          {syncProgress.stage === 'correlating' && 'Berechne Zeitversätze…'}
          {syncProgress.stage === 'done' && 'Fertig.'}
        </p>
      )}

      <ul className="sync-panel__list">
        {project.sources.map((source) => (
          <li key={source.id} className="sync-source">
            <div className="sync-source__label">
              {source.label}
              {source.role === 'main' && <span className="sync-source__main-badge">Haupt</span>}
            </div>
            {source.syncSegments.map((segment) => {
              const badge = confidenceLabel(segment.confidence, segment.method)
              return (
                <div key={segment.id} className="sync-segment">
                  <span className="sync-segment__range">
                    {segment.localStartSec.toFixed(1)}s–{segment.localEndSec.toFixed(1)}s
                  </span>
                  <label className="sync-segment__offset">
                    Offset (s)
                    <input
                      type="number"
                      step="0.01"
                      value={segment.offsetSec}
                      onChange={(e) => {
                        const value = Number(e.target.value)
                        if (!Number.isNaN(value)) void setManualOffset(source.id, segment.id, value)
                      }}
                    />
                  </label>
                  <span className={`sync-segment__confidence ${badge.className}`}>
                    {badge.text}
                  </span>
                </div>
              )
            })}
            {source.hardCutMarkers.length > 0 && (
              <div className="sync-source__hardcuts">
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
