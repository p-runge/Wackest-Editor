import { useProjectStore } from '../../state/project-store'
import './export-panel.css'

function stageLabel(stage: string): string {
  switch (stage) {
    case 'rendering':
      return 'Rendere Abschnitte'
    case 'concatenating':
      return 'Füge Abschnitte zusammen'
    case 'done':
      return 'Fertig'
    default:
      return stage
  }
}

function ExportPanel(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const isExporting = useProjectStore((state) => state.isExporting)
  const exportProgress = useProjectStore((state) => state.exportProgress)
  const lastExportPath = useProjectStore((state) => state.lastExportPath)
  const error = useProjectStore((state) => state.error)
  const runExport = useProjectStore((state) => state.runExport)

  if (!project || project.edit.keptRanges.length === 0) return null

  return (
    <div className="export-panel">
      <header className="export-panel__header">
        <h2>Export</h2>
        <button disabled={isExporting} onClick={() => void runExport()}>
          {isExporting ? 'Exportiere…' : 'Exportieren'}
        </button>
      </header>

      {isExporting && exportProgress && (
        <div className="export-panel__progress">
          <div className="export-panel__progress-label">
            {stageLabel(exportProgress.stage)}
            {exportProgress.segmentCount != null &&
              ` (Abschnitt ${(exportProgress.segmentIndex ?? 0) + 1}/${exportProgress.segmentCount})`}
          </div>
          <div className="export-panel__progress-bar">
            <div
              className="export-panel__progress-fill"
              style={{ width: `${Math.round(exportProgress.progress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {error && <p className="export-panel__error">{error}</p>}

      {!isExporting && lastExportPath && (
        <p className="export-panel__success">
          Export fertig:{' '}
          <button
            className="export-panel__link"
            onClick={() => void window.api.export.showInFolder(lastExportPath)}
          >
            {lastExportPath}
          </button>
        </p>
      )}
    </div>
  )
}

export default ExportPanel
