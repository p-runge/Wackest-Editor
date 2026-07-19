import { useProjectStore } from '../../state/project-store'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog'

function InvalidProjectModal(): React.JSX.Element {
  const invalidProject = useProjectStore((state) => state.invalidProject)
  const resolveInvalidProject = useProjectStore((state) => state.resolveInvalidProject)

  const open = invalidProject !== null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void resolveInvalidProject('cancel')
      }}
    >
      <DialogContent
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Projektdatei entspricht nicht der erwarteten Struktur</DialogTitle>
          <DialogDescription>
            Die Datei project.json in diesem Ordner enthält Felder, die nicht (mehr) zum erwarteten
            Format passen. Das kann passieren, wenn das Projekt mit einer anderen Version von
            Wackest Editor gespeichert wurde.
          </DialogDescription>
        </DialogHeader>

        {invalidProject && invalidProject.issues.length > 0 && (
          <ul className="max-h-40 list-disc overflow-y-auto rounded-md border border-border bg-muted/40 px-6 py-3 text-xs text-muted-foreground">
            {invalidProject.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}

        <p className="text-sm text-muted-foreground">
          Unpassende Eigenschaften können verworfen (auf Standardwerte zurückgesetzt) werden. Der
          aktuelle Stand der Datei wird vorher als Backup mit Zeitstempel gesichert.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => void resolveInvalidProject('cancel')}>
            Abbrechen
          </Button>
          <Button variant="destructive" onClick={() => void resolveInvalidProject('discard')}>
            Unpassende Eigenschaften verwerfen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default InvalidProjectModal
