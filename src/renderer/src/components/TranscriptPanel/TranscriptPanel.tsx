import { Captions } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { useSettingsStore } from '../../state/settings-store'
import { useSettingsDialogStore } from '../../state/settings-dialog-store'
import { settingsFieldIdForErrorMessage } from '../../lib/settings-errors'
import type { TranscriptionProviderId } from '@shared/types/project'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

function missingSettingFor(
  provider: TranscriptionProviderId,
  settings: { openaiApiKey?: string; whisperCppModelPath?: string }
): { message: string; fieldId: string } | null {
  if (provider === 'openai-whisper-api' && !settings.openaiApiKey) {
    return {
      message: 'Für OpenAI Whisper API wird ein OpenAI API-Key benötigt.',
      fieldId: 'openai-key'
    }
  }
  if (provider === 'whispercpp-local' && !settings.whisperCppModelPath) {
    return {
      message: 'Für whisper.cpp (lokal) wird ein Modellpfad benötigt.',
      fieldId: 'whisper-model'
    }
  }
  return null
}

function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function TranscriptPanel(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const isTranscribing = useProjectStore((state) => state.isTranscribing)
  const transcriptionProgress = useProjectStore((state) => state.transcriptionProgress)
  const error = useProjectStore((state) => state.transcriptionError)
  const runTranscription = useProjectStore((state) => state.runTranscription)
  const setTranscriptionProvider = useProjectStore((state) => state.setTranscriptionProvider)
  const setTranscriptionLanguageHint = useProjectStore(
    (state) => state.setTranscriptionLanguageHint
  )
  const settings = useSettingsStore((state) => state.settings)
  const openSettings = useSettingsDialogStore((state) => state.openSettings)

  if (!project) return null
  const audioSources = project.sources.filter((source) => source.probed.hasAudio)
  if (audioSources.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Keine Quelle mit Audio vorhanden – Transkription benötigt Ton.
      </p>
    )
  }

  const missingSetting = missingSettingFor(project.providerConfig.transcription.provider, settings)
  const errorFieldId = error ? settingsFieldIdForErrorMessage(error) : null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Untertitel per Spracherkennung erzeugen.</p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-normal text-muted-foreground">Anbieter</Label>
          <Select
            value={project.providerConfig.transcription.provider}
            onValueChange={(v) => void setTranscriptionProvider(v as TranscriptionProviderId)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai-whisper-api">OpenAI Whisper API</SelectItem>
              <SelectItem value="whispercpp-local">whisper.cpp (lokal)</SelectItem>
            </SelectContent>
          </Select>
          {missingSetting && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-warning">
              {missingSetting.message}
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => openSettings(missingSetting.fieldId)}
              >
                Jetzt einstellen
              </button>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs font-normal text-muted-foreground">Sprache</Label>
          <Select
            value={project.providerConfig.transcription.languageHint ?? 'auto'}
            onValueChange={(v) => void setTranscriptionLanguageHint(v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatisch</SelectItem>
              <SelectItem value="de">Deutsch</SelectItem>
              <SelectItem value="en">Englisch</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        className="w-full"
        disabled={isTranscribing || !!missingSetting}
        onClick={() => void runTranscription()}
      >
        <Captions />
        {isTranscribing
          ? `Transkribiere…${transcriptionProgress != null ? ` ${Math.round(transcriptionProgress * 100)}%` : ''}`
          : 'Transkribieren'}
      </Button>

      {error && (
        <p className="flex flex-wrap items-center gap-x-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
          {errorFieldId && (
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() => openSettings(errorFieldId)}
            >
              Jetzt einstellen
            </button>
          )}
        </p>
      )}

      {project.transcript.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Noch kein Transkript vorhanden.
        </p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-card p-2">
          {project.transcript.map((segment) => (
            <li key={segment.id} className="flex gap-3 rounded px-2 py-1 text-sm hover:bg-accent">
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {formatTime(segment.startSec)}–{formatTime(segment.endSec)}
              </span>
              <span>{segment.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default TranscriptPanel
