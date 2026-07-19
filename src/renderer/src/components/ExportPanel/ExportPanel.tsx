import { FolderOpen, Rocket } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { Button } from '../ui/button'
import { Progress } from '../ui/progress'

function stageLabel(stage: string): string {
  switch (stage) {
    case 'rendering-video':
      return 'Rendere Video-Abschnitte'
    case 'rendering-audio':
      return 'Rendere Audio-Abschnitte'
    case 'concatenating':
      return 'Füge Abschnitte zusammen'
    case 'muxing':
      return 'Führe Video und Audio zusammen'
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
  const error = useProjectStore((state) => state.exportError)
  const runExport = useProjectStore((state) => state.runExport)

  if (!project) return null
  if (project.edit.keptRanges.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Zuerst synchronisieren, damit Bereiche zum Exportieren entstehen.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Das fertige Video anhand der aktiven Video-/Audio-Bereiche rendern.
      </p>

      <Button className="w-full" disabled={isExporting} onClick={() => void runExport()}>
        <Rocket /> {isExporting ? 'Exportiere…' : 'Exportieren'}
      </Button>

      {isExporting && exportProgress && (
        <div className="flex flex-col gap-1.5">
          <div className="text-sm text-muted-foreground">
            {stageLabel(exportProgress.stage)}
            {exportProgress.segmentCount != null &&
              ` (Abschnitt ${(exportProgress.segmentIndex ?? 0) + 1}/${exportProgress.segmentCount})`}
          </div>
          <Progress value={Math.round(exportProgress.progress * 100)} />
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!isExporting && lastExportPath && (
        <p className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          Export fertig:
          <button
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
            onClick={() => void window.api.export.showInFolder(lastExportPath)}
          >
            <FolderOpen className="size-3.5" />
            {lastExportPath}
          </button>
        </p>
      )}
    </div>
  )
}

export default ExportPanel
