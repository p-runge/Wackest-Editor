import { useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useSettingsStore } from '../../state/settings-store'
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

const BREW_INSTALL_COMMAND = 'brew install whisper-cpp'
const WHISPER_MODELS_URL = 'https://huggingface.co/ggerganov/whisper.cpp/tree/main'

function SettingsPanel(): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const settings = useSettingsStore((state) => state.settings)
  const loaded = useSettingsStore((state) => state.loaded)
  const load = useSettingsStore((state) => state.load)
  const update = useSettingsStore((state) => state.update)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const copyInstallCommand = (): void => {
    window.api.system.copyToClipboard(BREW_INSTALL_COMMAND)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const pickWhisperBinary = async (): Promise<void> => {
    const path = await window.api.settings.pickFile({
      title: 'whisper.cpp Binary wählen',
      extensions: ['*']
    })
    if (path) await update({ whisperCppBinaryPath: path })
  }

  const pickWhisperModel = async (): Promise<void> => {
    const path = await window.api.settings.pickFile({
      title: 'whisper.cpp Modell wählen',
      extensions: ['bin']
    })
    if (path) await update({ whisperCppModelPath: path })
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Einstellungen">
          <Settings2 />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="whisper-bin">whisper.cpp Binary-Pfad</Label>
            <div className="flex gap-2">
              <Input
                id="whisper-bin"
                value={settings.whisperCppBinaryPath ?? ''}
                placeholder="whisper-cli (auf PATH)"
                onChange={(e) => void update({ whisperCppBinaryPath: e.target.value })}
              />
              <Button variant="outline" onClick={() => void pickWhisperBinary()}>
                Durchsuchen
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="whisper-model">whisper.cpp Modell (.bin)</Label>
            <div className="flex gap-2">
              <Input
                id="whisper-model"
                value={settings.whisperCppModelPath ?? ''}
                placeholder="/pfad/zu/ggml-base.bin"
                onChange={(e) => void update({ whisperCppModelPath: e.target.value })}
              />
              <Button variant="outline" onClick={() => void pickWhisperModel()}>
                Durchsuchen
              </Button>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Lokales whisper.cpp installieren:{' '}
            <button
              type="button"
              className="mx-1 inline-flex items-center gap-1.5 rounded border border-border px-1.5 py-0.5 align-middle text-foreground"
              title="In die Zwischenablage kopieren"
              onClick={copyInstallCommand}
            >
              <code className="bg-transparent p-0">{BREW_INSTALL_COMMAND}</code>
              <span>{copied ? '✓' : '⧉'}</span>
            </button>{' '}
            Modelle laden von{' '}
            <a
              href={WHISPER_MODELS_URL}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              huggingface.co/ggerganov/whisper.cpp
            </a>
            .
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsPanel
