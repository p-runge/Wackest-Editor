import { useState } from 'react'
import { FolderOpen, Rocket } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import type { ExportFormat } from '@shared/types/ipc'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Progress } from '../ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

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

const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string; hint: string }> = [
  {
    value: 'mp4',
    label: 'MP4-Video (fertig gerendert)',
    hint: 'Ein fertiges Video anhand der aktiven Video-/Audio-Bereiche.'
  },
  {
    value: 'fcp7xml',
    label: 'Premiere / Resolve (XML)',
    hint: 'Alle Rohquellen parallel auf der Sync-Timeline, an den Kamera-/Audio-Wechseln geschnitten. Nicht-aktive Abschnitte sind pro Clip deaktiviert – so bleibt die aktive Wahl erhalten und lässt sich in Premiere oder DaVinci Resolve frei um-schalten.'
  }
]

function ExportPanel(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const isExporting = useProjectStore((state) => state.isExporting)
  const exportProgress = useProjectStore((state) => state.exportProgress)
  const lastExportPath = useProjectStore((state) => state.lastExportPath)
  const error = useProjectStore((state) => state.exportError)
  const runExport = useProjectStore((state) => state.runExport)

  const [format, setFormat] = useState<ExportFormat>('mp4')

  if (!project) return null
  if (project.timelineDurationSec === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Zuerst synchronisieren, damit Bereiche zum Exportieren entstehen.
      </p>
    )
  }
  // Distinct from "never synced": the timeline exists but the Schnitt Tool has cut every
  // highlight out of it, so there's currently nothing left to render.
  if (project.edit.keptRanges.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Alle Bereiche wurden herausgeschnitten — im Schnitt Tool mindestens einen Abschnitt
        wiederherstellen, um exportieren zu können.
      </p>
    )
  }

  const selectedHint = FORMAT_OPTIONS.find((o) => o.value === format)?.hint

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="export-format">Format</Label>
        <Select
          value={format}
          onValueChange={(v) => setFormat(v as ExportFormat)}
          disabled={isExporting}
        >
          <SelectTrigger id="export-format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMAT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedHint && <p className="text-sm text-muted-foreground">{selectedHint}</p>}
      </div>

      <Button className="w-full" disabled={isExporting} onClick={() => void runExport(format)}>
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
