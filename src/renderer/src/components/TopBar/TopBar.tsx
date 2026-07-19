import { useStore } from 'zustand'
import { FolderOpen, FolderPlus, Redo2, Undo2 } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'
import { modKeyLabel } from '../../lib/platform'
import SettingsPanel from '../SettingsPanel/SettingsPanel'
import logo from '../../assets/logo.png'

function TopBar(): React.JSX.Element {
  const projectName = useProjectStore((state) => state.project?.name)
  const newProject = useProjectStore((state) => state.newProject)
  const openProject = useProjectStore((state) => state.openProject)
  const { undo, redo, pastStates, futureStates } = useStore(useProjectStore.temporal)

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <img src={logo} alt="Wackest Tool" className="size-5 rounded-md object-cover" />
        <span className="hidden sm:inline">Wackest Tool</span>
      </div>
      {projectName && (
        <>
          <Separator orientation="vertical" className="h-5" />
          <span className="truncate text-sm text-muted-foreground">{projectName}</span>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={pastStates.length === 0}
              onClick={() => undo()}
              title={`Rückgängig (${modKeyLabel}+Z)`}
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={futureStates.length === 0}
              onClick={() => redo()}
              title={`Wiederholen (${modKeyLabel}+Umschalt+Z)`}
            >
              <Redo2 />
            </Button>
          </div>
        </>
      )}

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => void newProject()} title="Neues Projekt">
          <FolderPlus /> Neu
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void openProject()} title="Projekt öffnen">
          <FolderOpen /> Öffnen
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <SettingsPanel />
      </div>
    </header>
  )
}

export default TopBar
