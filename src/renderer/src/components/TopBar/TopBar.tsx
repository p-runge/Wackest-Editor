import { Clapperboard, FolderOpen, FolderPlus } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'
import SettingsPanel from '../SettingsPanel/SettingsPanel'

function TopBar(): React.JSX.Element {
  const projectName = useProjectStore((state) => state.project?.name)
  const newProject = useProjectStore((state) => state.newProject)
  const openProject = useProjectStore((state) => state.openProject)

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Clapperboard className="size-4 text-primary" />
        <span className="hidden sm:inline">Wackest Tool</span>
      </div>
      {projectName && (
        <>
          <Separator orientation="vertical" className="h-5" />
          <span className="truncate text-sm text-muted-foreground">{projectName}</span>
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
