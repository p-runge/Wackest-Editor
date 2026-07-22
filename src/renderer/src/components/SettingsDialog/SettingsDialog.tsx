import { useEffect, useRef, useState } from 'react'
import { Settings2, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { useSettingsStore } from '../../state/settings-store'
import { useSettingsDialogStore } from '../../state/settings-dialog-store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Progress } from '../ui/progress'
import { ScrollArea } from '../ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog'
import { modKeyLabel } from '../../lib/platform'
import type { ModelInfo, UpdateStatus } from '@shared/types/ipc'

const WHISPER_MODELS_URL = 'https://huggingface.co/ggerganov/whisper.cpp/tree/main'

function missingFieldMessage(value: string | undefined, requiredBy: string[]): string | null {
  if (value || requiredBy.length === 0) return null
  return `Wird benötigt für: ${requiredBy.join(', ')}.`
}

function formatModelSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

// Rough estimate only (no real connection speed measurement available upfront) — assumes a
// typical broadband download speed of 10 MB/s so users get a sense of scale before downloading.
const ASSUMED_DOWNLOAD_BYTES_PER_SEC = 10 * 1024 * 1024

function formatEstimatedDownloadTime(bytes: number): string {
  const seconds = bytes / ASSUMED_DOWNLOAD_BYTES_PER_SEC
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))} Sek.`
  const minutes = seconds / 60
  if (minutes < 60) return `~${Math.round(minutes)} Min.`
  return `~${(minutes / 60).toFixed(1)} Std.`
}

// H:MM:SS, or M:SS while under an hour — a ticking clock reads better than prose ("~2 Min.")
// once a download is actually in progress and counting down.
function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function SettingsDialog(): React.JSX.Element {
  const project = useProjectStore((state) => state.project)
  const settings = useSettingsStore((state) => state.settings)
  const loaded = useSettingsStore((state) => state.loaded)
  const load = useSettingsStore((state) => state.load)
  const update = useSettingsStore((state) => state.update)
  const isOpen = useSettingsDialogStore((state) => state.isOpen)
  const focusFieldId = useSettingsDialogStore((state) => state.focusFieldId)
  const openSettings = useSettingsDialogStore((state) => state.openSettings)
  const closeSettings = useSettingsDialogStore((state) => state.closeSettings)

  const [models, setModels] = useState<ModelInfo[]>([])
  const [bundledFilename, setBundledFilename] = useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({})
  // Estimated seconds remaining, derived from observed throughput (see onDownloadProgress below).
  // Not state-derived-from-render — computed once per progress event, where reading Date.now() is
  // fine (it's an event handler, not the render body).
  const [downloadRemaining, setDownloadRemaining] = useState<Record<string, number>>({})
  const downloadStartedAtRef = useRef<Record<string, number>>({})
  // Last time the displayed remaining-time was recomputed per filename, so a burst of progress
  // events (chunks can arrive many times a second) doesn't make the countdown jitter — the
  // progress bar itself still updates live, only this derived number is throttled.
  const downloadRemainingUpdatedAtRef = useRef<Record<string, number>>({})

  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  useEffect(() => {
    void window.api.updates.getVersion().then(setAppVersion)
  }, [])

  useEffect(() => {
    return window.api.updates.onStateChanged(setUpdateStatus)
  }, [])

  useEffect(() => {
    return window.api.menu.onOpenSettings(() => openSettings())
  }, [openSettings])

  useEffect(() => {
    return window.api.models.onDownloadProgress(({ filename, progress }) => {
      setDownloadProgress((prev) => ({ ...prev, [filename]: progress }))
      // First progress event for this download marks its start.
      if (downloadStartedAtRef.current[filename] === undefined) {
        downloadStartedAtRef.current[filename] = Date.now()
      }
      // Below ~2% progress the elapsed/progress ratio is too noisy (a couple of chunks can swing
      // it wildly) — the render side falls back to the size-based guess until then.
      const now = Date.now()
      const lastUpdate = downloadRemainingUpdatedAtRef.current[filename] ?? 0
      if (progress > 0.02 && now - lastUpdate >= 1000) {
        downloadRemainingUpdatedAtRef.current[filename] = now
        const elapsedSec = (now - downloadStartedAtRef.current[filename]) / 1000
        const remainingSec = elapsedSec * ((1 - progress) / progress)
        setDownloadRemaining((prev) => ({ ...prev, [filename]: remainingSec }))
      }
    })
  }, [])

  useEffect(() => {
    if (!isOpen || models.length > 0 || catalogLoading) return
    const loadCatalog = async (): Promise<void> => {
      setCatalogLoading(true)
      setCatalogError(null)
      try {
        const result = await window.api.models.list()
        setModels(result.models)
        setBundledFilename(result.bundledFilename)
      } catch (err) {
        setCatalogError(err instanceof Error ? err.message : String(err))
      } finally {
        setCatalogLoading(false)
      }
    }
    void loadCatalog()
  }, [isOpen, models.length, catalogLoading])

  const pickWhisperModel = async (): Promise<void> => {
    const path = await window.api.settings.pickFile({
      title: 'whisper.cpp Modell wählen',
      extensions: ['bin']
    })
    if (path) await update({ whisperCppModelPath: path })
  }

  const handleDownload = async (filename: string): Promise<void> => {
    setDownloadProgress((prev) => ({ ...prev, [filename]: 0 }))
    try {
      await window.api.models.download({ filename })
      setModels((prev) =>
        prev.map((m) => (m.filename === filename ? { ...m, downloaded: true } : m))
      )
      await update({ selectedModelFilename: filename, whisperCppModelPath: undefined })
    } catch (err) {
      console.error(err)
    } finally {
      delete downloadStartedAtRef.current[filename]
      delete downloadRemainingUpdatedAtRef.current[filename]
      setDownloadProgress((prev) => {
        const next = { ...prev }
        delete next[filename]
        return next
      })
      setDownloadRemaining((prev) => {
        const next = { ...prev }
        delete next[filename]
        return next
      })
    }
  }

  const handleCancelDownload = (filename: string): void => {
    void window.api.models.cancelDownload({ filename })
  }

  const handleDeleteDownloaded = async (filename: string): Promise<void> => {
    await window.api.models.delete({ filename })
    setModels((prev) =>
      prev.map((m) => (m.filename === filename ? { ...m, downloaded: false } : m))
    )
    if (settings.selectedModelFilename === filename) {
      await update({ selectedModelFilename: undefined })
    }
  }

  const handleCheckForUpdates = async (): Promise<void> => {
    try {
      await window.api.updates.check()
    } catch (err) {
      console.error(err)
    }
  }

  const openaiKeyRequiredBy: string[] = []
  if (project?.providerConfig.transcription.provider === 'openai-whisper-api') {
    openaiKeyRequiredBy.push('Transkription (OpenAI Whisper API)')
  }
  if (project?.providerConfig.heatmap.provider === 'vision-llm-openai') {
    openaiKeyRequiredBy.push('Heatmap (OpenAI Vision API)')
  }

  const anthropicKeyRequiredBy: string[] = []
  if (project?.providerConfig.heatmap.provider === 'vision-llm-claude') {
    anthropicKeyRequiredBy.push('Heatmap (Claude Vision API)')
  }

  const openaiKeyMessage = missingFieldMessage(settings.openaiApiKey, openaiKeyRequiredBy)
  const anthropicKeyMessage = missingFieldMessage(settings.anthropicApiKey, anthropicKeyRequiredBy)
  // The bundled model is always shown as a fixed Select option (works even if the Hugging Face
  // catalog fetch fails), so any matching catalog entry is excluded here to avoid a duplicate.
  const otherDownloadedModels = models.filter((m) => m.downloaded && !m.bundled)

  // Mirrors the priority order used at transcription time
  // (src/main/services/providers/transcription/index.ts), so the dialog always shows which model
  // actually wins, regardless of which tab is open.
  const effectiveModelLabel = settings.whisperCppModelPath
    ? `${settings.whisperCppModelPath.split(/[/\\]/).pop()} (eigene Datei)`
    : settings.selectedModelFilename &&
        models.some((m) => m.filename === settings.selectedModelFilename && m.downloaded)
      ? settings.selectedModelFilename
      : bundledFilename

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (open ? openSettings() : closeSettings())}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title={`Einstellungen (${modKeyLabel}+,)`}>
          <Settings2 />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-lg"
        onOpenAutoFocus={(e) => {
          if (!focusFieldId) return
          e.preventDefault()
          document.getElementById(focusFieldId)?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Einstellungen</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="api-keys">
          <TabsList>
            <TabsTrigger value="api-keys">API Keys</TabsTrigger>
            <TabsTrigger value="language-models">Language Models</TabsTrigger>
            <TabsTrigger value="updates">Updates</TabsTrigger>
          </TabsList>

          <TabsContent value="api-keys" className="flex min-h-[28rem] flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="openai-key">OpenAI API-Key</Label>
              <Input
                id="openai-key"
                type="password"
                value={settings.openaiApiKey ?? ''}
                placeholder="sk-..."
                onChange={(e) => void update({ openaiApiKey: e.target.value })}
              />
              {openaiKeyMessage && <p className="text-xs text-warning">{openaiKeyMessage}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="anthropic-key">Anthropic (Claude) API-Key</Label>
              <Input
                id="anthropic-key"
                type="password"
                value={settings.anthropicApiKey ?? ''}
                placeholder="sk-ant-..."
                onChange={(e) => void update({ anthropicApiKey: e.target.value })}
              />
              {anthropicKeyMessage && <p className="text-xs text-warning">{anthropicKeyMessage}</p>}
            </div>
          </TabsContent>

          <TabsContent value="language-models" className="flex min-h-[28rem] flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Transkriptionsmodell (whisper.cpp, lokal)</Label>
              {effectiveModelLabel && (
                <p className="text-xs text-muted-foreground">
                  Aktives Modell: <span className="font-medium">{effectiveModelLabel}</span>
                </p>
              )}
              <Tabs defaultValue="models">
                <TabsList>
                  <TabsTrigger value="models">Modelle herunterladen</TabsTrigger>
                  <TabsTrigger value="advanced">Erweitert: eigene Modelldatei</TabsTrigger>
                </TabsList>

                <TabsContent value="models" className="flex flex-col gap-1.5">
                  {settings.whisperCppModelPath && (
                    <p className="text-xs leading-relaxed text-warning">
                      Aktuell ist ein eigenes lokales Modell aktiv (Tab &quot;Erweitert&quot;) —
                      eine Auswahl hier übernimmt sofort die Kontrolle und deaktiviert es.
                    </p>
                  )}
                  <Select
                    value={settings.selectedModelFilename ?? bundledFilename ?? ''}
                    onValueChange={(value) =>
                      void update({
                        selectedModelFilename: value === bundledFilename ? undefined : value,
                        whisperCppModelPath: undefined
                      })
                    }
                  >
                    <SelectTrigger id="model-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {bundledFilename && (
                        <SelectItem value={bundledFilename}>{bundledFilename}</SelectItem>
                      )}
                      {otherDownloadedModels.map((model) => (
                        <SelectItem key={model.filename} value={model.filename}>
                          {model.filename} ({formatModelSize(model.sizeBytes)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {bundledFilename ?? 'Ein kleines Standardmodell'} ist bereits mitgeliefert. Für
                    höhere Genauigkeit (auf Kosten von Geschwindigkeit und Downloadgröße) weitere
                    Modelle von{' '}
                    <a
                      href={WHISPER_MODELS_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Huggingface
                    </a>{' '}
                    laden:
                  </p>

                  <ScrollArea className="h-40 rounded-md border border-border">
                    <div className="flex flex-col divide-y divide-border">
                      {catalogLoading && (
                        <p className="p-3 text-xs text-muted-foreground">Lade Modellliste…</p>
                      )}
                      {catalogError && (
                        <p className="p-3 text-xs text-destructive">{catalogError}</p>
                      )}
                      {models.map((model) => {
                        const progress = downloadProgress[model.filename]
                        const remainingSeconds =
                          downloadRemaining[model.filename] ??
                          model.sizeBytes / ASSUMED_DOWNLOAD_BYTES_PER_SEC
                        return (
                          <div
                            key={model.filename}
                            className="flex items-center justify-between gap-2 p-2"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm">{model.filename}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatModelSize(model.sizeBytes)} ·{' '}
                                {progress !== undefined
                                  ? `noch ${formatClock(remainingSeconds)}`
                                  : formatEstimatedDownloadTime(model.sizeBytes)}
                                {model.bundled && ' · mitgeliefert, Standard'}
                              </p>
                              {progress !== undefined && (
                                <Progress value={progress * 100} className="mt-1" />
                              )}
                            </div>
                            {progress !== undefined ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleCancelDownload(model.filename)}
                              >
                                Abbrechen
                              </Button>
                            ) : model.downloaded ? (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">
                                  Heruntergeladen
                                </span>
                                {!model.bundled && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Entfernen"
                                    onClick={() => void handleDeleteDownloaded(model.filename)}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleDownload(model.filename)}
                              >
                                Laden
                              </Button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="advanced" className="flex flex-col gap-1.5">
                  <Label htmlFor="whisper-model">Eigenes whisper.cpp Modell (.bin, optional)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="whisper-model"
                      value={settings.whisperCppModelPath ?? ''}
                      placeholder="Modellauswahl oben verwenden"
                      onChange={(e) => void update({ whisperCppModelPath: e.target.value })}
                    />
                    <Button variant="outline" onClick={() => void pickWhisperModel()}>
                      Durchsuchen
                    </Button>
                    {settings.whisperCppModelPath && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Eigenes Modell entfernen"
                        onClick={() => void update({ whisperCppModelPath: undefined })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Überschreibt die Modellauswahl im Tab &quot;Modelle herunterladen&quot;, bis
                    dort erneut ein Modell ausgewählt wird.
                  </p>
                </TabsContent>
              </Tabs>
            </div>
          </TabsContent>

          <TabsContent value="updates" className="flex min-h-[28rem] flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Updates</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCheckForUpdates()}
                  disabled={
                    updateStatus.state === 'checking' || updateStatus.state === 'downloading'
                  }
                >
                  Nach Updates suchen
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {appVersion ? `Aktuelle Version: ${appVersion}` : 'Version wird geladen…'}
              </p>
              {updateStatus.state === 'checking' && (
                <p className="text-xs text-muted-foreground">Suche nach Updates…</p>
              )}
              {updateStatus.state === 'not-available' && (
                <p className="text-xs text-muted-foreground">Du verwendest die aktuelle Version.</p>
              )}
              {updateStatus.state === 'available' && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Version {updateStatus.version} ist verfügbar.
                  </p>
                  {updateStatus.canAutoInstall ? (
                    <span className="text-xs text-muted-foreground">Wird heruntergeladen…</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void window.api.updates.openDownloadPage()}
                    >
                      Herunterladen
                    </Button>
                  )}
                </div>
              )}
              {updateStatus.state === 'downloading' && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">
                    Lädt Update herunter… {Math.round(updateStatus.progress * 100)}%
                  </p>
                  <Progress value={updateStatus.progress * 100} />
                </div>
              )}
              {updateStatus.state === 'downloaded' && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Version {updateStatus.version} ist bereit.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void window.api.updates.install()}
                  >
                    Jetzt neu starten
                  </Button>
                </div>
              )}
              {updateStatus.state === 'error' && (
                <p className="text-xs text-destructive">{updateStatus.message}</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsDialog
