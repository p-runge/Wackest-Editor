import { useEffect } from 'react'
import { FolderOpen, FolderPlus, Clapperboard, X } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { useSettingsStore } from '../../state/settings-store'
import { Button } from '../ui/button'
import SettingsPanel from '../SettingsPanel/SettingsPanel'

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} Min.`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `vor ${hours} Std.`
  const days = Math.round(hours / 24)
  if (days === 1) return 'gestern'
  if (days < 7) return `vor ${days} Tagen`
  return new Date(iso).toLocaleDateString('de-DE')
}

function StartScreen(): React.JSX.Element {
  const error = useProjectStore((state) => state.projectError)
  const newProject = useProjectStore((state) => state.newProject)
  const openProject = useProjectStore((state) => state.openProject)
  const openRecentProject = useProjectStore((state) => state.openRecentProject)

  const settings = useSettingsStore((state) => state.settings)
  const loaded = useSettingsStore((state) => state.loaded)
  const load = useSettingsStore((state) => state.load)
  const removeRecentProject = useSettingsStore((state) => state.removeRecentProject)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const recentProjects = settings.recentProjects ?? []

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-y-auto p-8">
      <div className="absolute right-4 top-4">
        <SettingsPanel />
      </div>

      <div className="w-full max-w-xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Clapperboard className="size-7" />
          </div>
          <h1 className="text-2xl font-semibold">Wackest Tool</h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Highlight-Videos per Fingerschnipp
          </p>
        </div>

        <div className="mb-8 flex justify-center gap-3">
          <Button size="lg" onClick={() => void newProject()}>
            <FolderPlus /> Neues Projekt
          </Button>
          <Button size="lg" variant="secondary" onClick={() => void openProject()}>
            <FolderOpen /> Projekt öffnen
          </Button>
        </div>

        {error && (
          <p className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            {error}
          </p>
        )}

        {recentProjects.length > 0 && (
          <div>
            <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Zuletzt geöffnet
            </h2>
            <ul className="flex flex-col gap-1 rounded-lg border border-border bg-card/50 p-1">
              {recentProjects.map((entry) => (
                <li key={entry.projectDir}>
                  <button
                    className="group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent"
                    onClick={() => void openRecentProject(entry.projectDir)}
                  >
                    <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{entry.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {entry.projectDir}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(entry.lastOpenedAt)}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      title="Aus Liste entfernen"
                      className="ml-1 shrink-0 rounded-sm p-1 text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeRecentProject(entry.projectDir)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation()
                          e.preventDefault()
                          void removeRecentProject(entry.projectDir)
                        }
                      }}
                    >
                      <X className="size-3.5" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

export default StartScreen
