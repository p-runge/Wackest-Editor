import { Files, Loader2, RefreshCw, FileText, Flame, Download, PanelLeftClose } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { useToolSidebarStore, type ToolId } from '../../state/tool-sidebar-store'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import FilesPanel from '../FilesPanel/FilesPanel'
import SyncPanel from '../SyncPanel/SyncPanel'
import TranscriptPanel from '../TranscriptPanel/TranscriptPanel'
import HeatmapPanel from '../HeatmapPanel/HeatmapPanel'
import ExportPanel from '../ExportPanel/ExportPanel'

const TOOLS: Array<{
  id: ToolId
  label: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { id: 'files', label: 'Dateien', icon: Files },
  { id: 'sync', label: 'Sync', icon: RefreshCw },
  { id: 'transcript', label: 'Transkript', icon: FileText },
  { id: 'heatmap', label: 'Heatmap', icon: Flame },
  { id: 'export', label: 'Export', icon: Download }
]

function StepDot({ done }: { done: boolean }): React.JSX.Element {
  return (
    <span
      className={cn('size-1.5 rounded-full', done ? 'bg-success' : 'bg-muted-foreground/40')}
      aria-hidden
    />
  )
}

function ToolSidebar(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const lastExportPath = useProjectStore((state) => state.lastExportPath)
  const isImporting = useProjectStore((state) => state.isImporting)
  const activeTool = useToolSidebarStore((state) => state.activeTool)
  const setActiveTool = useToolSidebarStore((state) => state.setActiveTool)

  if (!project) return null

  const hasFiles = project.sources.length > 0
  const isSynced = project.sources.some((s) => s.syncSegments.length > 0)
  const hasTranscript = project.transcript.length > 0
  const hasHeatmap = project.trackHeatmaps.length > 0
  const hasExported = !!lastExportPath

  const doneById: Record<ToolId, boolean> = {
    files: hasFiles,
    sync: isSynced,
    transcript: hasTranscript,
    heatmap: hasHeatmap,
    export: hasExported
  }

  return (
    <div className="flex h-full shrink-0 border-r border-border bg-card">
      <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
        {TOOLS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="ghost"
            size="icon"
            title={label}
            className={cn(
              'relative flex-col gap-0.5',
              activeTool === id && 'bg-accent text-accent-foreground'
            )}
            onClick={() => setActiveTool(activeTool === id ? null : id)}
          >
            {id === 'files' && isImporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Icon className="size-4" />
            )}
            <StepDot done={doneById[id]} />
          </Button>
        ))}
      </nav>

      {activeTool && (
        <div className="flex w-80 shrink-0 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-sm font-medium">
              {TOOLS.find((t) => t.id === activeTool)?.label}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              title="Einklappen"
              onClick={() => setActiveTool(null)}
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </div>
          <div className="h-full overflow-y-auto px-3 pb-3 pt-3">
            {activeTool === 'files' && <FilesPanel />}
            {activeTool === 'sync' && <SyncPanel />}
            {activeTool === 'transcript' && <TranscriptPanel />}
            {activeTool === 'heatmap' && <HeatmapPanel />}
            {activeTool === 'export' && <ExportPanel />}
          </div>
        </div>
      )}
    </div>
  )
}

export default ToolSidebar
