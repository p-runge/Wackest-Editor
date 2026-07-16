import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../state/settings-store'
import './settings-panel.css'

const BREW_INSTALL_COMMAND = 'brew install whisper-cpp'
const WHISPER_MODELS_URL = 'https://huggingface.co/ggerganov/whisper.cpp/tree/main'

function SettingsPanel(): React.JSX.Element {
  const [open, setOpen] = useState(false)
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
    <div className="settings-panel">
      <button className="settings-panel__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? 'Einstellungen schließen' : '⚙ Einstellungen'}
      </button>
      {open && (
        <div className="settings-panel__body">
          <label className="settings-field">
            OpenAI API-Key
            <input
              type="password"
              value={settings.openaiApiKey ?? ''}
              placeholder="sk-..."
              onChange={(e) => void update({ openaiApiKey: e.target.value })}
            />
          </label>

          <label className="settings-field">
            Anthropic (Claude) API-Key
            <input
              type="password"
              value={settings.anthropicApiKey ?? ''}
              placeholder="sk-ant-..."
              onChange={(e) => void update({ anthropicApiKey: e.target.value })}
            />
          </label>

          <label className="settings-field">
            whisper.cpp Binary-Pfad
            <div className="settings-field__row">
              <input
                type="text"
                value={settings.whisperCppBinaryPath ?? ''}
                placeholder="whisper-cli (auf PATH)"
                onChange={(e) => void update({ whisperCppBinaryPath: e.target.value })}
              />
              <button onClick={() => void pickWhisperBinary()}>Durchsuchen</button>
            </div>
          </label>

          <label className="settings-field">
            whisper.cpp Modell (.bin)
            <div className="settings-field__row">
              <input
                type="text"
                value={settings.whisperCppModelPath ?? ''}
                placeholder="/pfad/zu/ggml-base.bin"
                onChange={(e) => void update({ whisperCppModelPath: e.target.value })}
              />
              <button onClick={() => void pickWhisperModel()}>Durchsuchen</button>
            </div>
          </label>

          <p className="settings-panel__hint">
            Lokales whisper.cpp installieren:
            <button
              type="button"
              className="settings-panel__copy-command"
              title="In die Zwischenablage kopieren"
              onClick={copyInstallCommand}
            >
              <code>{BREW_INSTALL_COMMAND}</code>
              <span>{copied ? '✓ kopiert' : '⧉'}</span>
            </button>
            Modelle laden von{' '}
            <a href={WHISPER_MODELS_URL} target="_blank" rel="noreferrer">
              huggingface.co/ggerganov/whisper.cpp
            </a>
            .
          </p>
        </div>
      )}
    </div>
  )
}

export default SettingsPanel
