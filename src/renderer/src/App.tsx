import { useRef, useState } from 'react'
import { useProjectStore } from './state/project-store'
import { useToolSidebarStore } from './state/tool-sidebar-store'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import TopBar from './components/TopBar/TopBar'
import StartScreen from './components/StartScreen/StartScreen'
import ToolSidebar from './components/ToolSidebar/ToolSidebar'
import TimelineEditor from './components/TimelineEditor/TimelineEditor'

function App(): React.JSX.Element {
  const project = useProjectStore((state) => state.project)
  const importFromDrop = useProjectStore((state) => state.importFromDrop)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounter = useRef(0)

  useGlobalShortcuts()

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounter.current += 1
    setIsDraggingOver(true)
  }
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setIsDraggingOver(false)
  }
  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDraggingOver(false)
    try {
      const filePaths = Array.from(e.dataTransfer.files).map((file) =>
        window.api.ingest.getPathForFile(file)
      )
      if (filePaths.length > 0) {
        void importFromDrop(filePaths)
        useToolSidebarStore.getState().setActiveTool('files')
      }
    } catch (err) {
      console.error('Drag&Drop-Import fehlgeschlagen', err)
      useProjectStore.setState({ importError: String(err) })
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      {!project ? (
        <StartScreen />
      ) : (
        <div
          className="relative flex min-h-0 min-w-0 flex-1"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <ToolSidebar />
          <div className="min-h-0 min-w-0 flex-1">
            <TimelineEditor />
          </div>

          {isDraggingOver && (
            <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/5 text-sm font-medium text-primary">
              Dateien hier ablegen
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
