import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs'
import { Button } from '../ui/button'
import { cn } from '@renderer/lib/utils'
import ImportPanel from '../ImportPanel/ImportPanel'
import SyncPanel from '../SyncPanel/SyncPanel'
import TranscriptPanel from '../TranscriptPanel/TranscriptPanel'
import HeatmapPanel from '../HeatmapPanel/HeatmapPanel'
import ExportPanel from '../ExportPanel/ExportPanel'

function StepDot({ done }: { done: boolean }): React.JSX.Element {
  return (
    <span
      className={cn('size-1.5 rounded-full', done ? 'bg-success' : 'bg-muted-foreground/40')}
      aria-hidden
    />
  )
}

function WorkflowPanel(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const lastExportPath = useProjectStore((state) => state.lastExportPath)
  const [activeTab, setActiveTab] = useState('import')
  const [collapsed, setCollapsed] = useState(false)

  if (!project) return null

  const hasSources = project.sources.length > 0
  const isSynced = project.sources.some((s) => s.syncSegments.length > 0)
  const hasTranscript = project.transcript.length > 0
  const hasHeatmap = project.heatmap.length > 0
  const hasExported = !!lastExportPath

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="shrink-0 border-b border-border bg-card"
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        <TabsList>
          <TabsTrigger value="import">
            <StepDot done={hasSources} /> Import
          </TabsTrigger>
          <TabsTrigger value="sync">
            <StepDot done={isSynced} /> Sync
          </TabsTrigger>
          <TabsTrigger value="transcript">
            <StepDot done={hasTranscript} /> Transkript
          </TabsTrigger>
          <TabsTrigger value="heatmap">
            <StepDot done={hasHeatmap} /> Heatmap
          </TabsTrigger>
          <TabsTrigger value="export">
            <StepDot done={hasExported} /> Export
          </TabsTrigger>
        </TabsList>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          title={collapsed ? 'Ausklappen' : 'Einklappen'}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronDown /> : <ChevronUp />}
        </Button>
      </div>

      {!collapsed && (
        <div className="max-h-[38vh] overflow-y-auto px-3 pb-3 pt-3">
          <TabsContent value="import">
            <ImportPanel />
          </TabsContent>
          <TabsContent value="sync">
            <SyncPanel />
          </TabsContent>
          <TabsContent value="transcript">
            <TranscriptPanel />
          </TabsContent>
          <TabsContent value="heatmap">
            <HeatmapPanel />
          </TabsContent>
          <TabsContent value="export">
            <ExportPanel />
          </TabsContent>
        </div>
      )}
    </Tabs>
  )
}

export default WorkflowPanel
