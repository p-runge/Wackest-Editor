import { useEffect } from 'react'
import { Settings2 } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { useSettingsStore } from '../../state/settings-store'
import { useSettingsDialogStore } from '../../state/settings-dialog-store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger
} from '../ui/dialog'

const WHISPER_MODELS_URL = 'https://huggingface.co/ggerganov/whisper.cpp/tree/main'

function missingFieldMessage(value: string | undefined, requiredBy: string[]): string | null {
  if (value || requiredBy.length === 0) return null
  return `Wird benötigt für: ${requiredBy.join(', ')}.`
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

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const pickWhisperModel = async (): Promise<void> => {
    const path = await window.api.settings.pickFile({
      title: 'whisper.cpp Modell wählen',
      extensions: ['bin']
    })
    if (path) await update({ whisperCppModelPath: path })
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (open ? openSettings() : closeSettings())}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Einstellungen">
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
          <DialogDescription>API-Keys und lokale Modelle für Transkription.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="whisper-model">Eigenes whisper.cpp Modell (.bin, optional)</Label>
            <div className="flex gap-2">
              <Input
                id="whisper-model"
                value={settings.whisperCppModelPath ?? ''}
                placeholder="mitgeliefertes Standardmodell (ggml-base) verwenden"
                onChange={(e) => void update({ whisperCppModelPath: e.target.value })}
              />
              <Button variant="outline" onClick={() => void pickWhisperModel()}>
                Durchsuchen
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Ein kleines Standardmodell ist bereits mitgeliefert. Für höhere Genauigkeit (auf
              Kosten von Geschwindigkeit und Downloadgröße) z.B.{' '}
              <a
                href={WHISPER_MODELS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                ggml-large-v3 von huggingface.co/ggerganov/whisper.cpp
              </a>{' '}
              laden und hier auswählen.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsDialog
