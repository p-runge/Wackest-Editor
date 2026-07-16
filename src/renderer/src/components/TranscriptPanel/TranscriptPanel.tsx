import { Captions } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import type { SttProviderId } from '@shared/types/project'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function TranscriptPanel(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const isTranscribing = useProjectStore((state) => state.isTranscribing)
  const sttProgress = useProjectStore((state) => state.sttProgress)
  const error = useProjectStore((state) => state.error)
  const runStt = useProjectStore((state) => state.runStt)
  const setSttProvider = useProjectStore((state) => state.setSttProvider)
  const setSttLanguageHint = useProjectStore((state) => state.setSttLanguageHint)
  const setTranscriptionSource = useProjectStore((state) => state.setTranscriptionSource)

  if (!project) return null
  const audioSources = project.sources.filter((source) => source.probed.hasAudio)
  if (audioSources.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Keine Quelle mit Audio vorhanden – Transkription benötigt Ton.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Untertitel per Spracherkennung erzeugen.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={project.providerConfig.stt.provider}
            onValueChange={(v) => void setSttProvider(v as SttProviderId)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai-whisper-api">OpenAI Whisper API</SelectItem>
              <SelectItem value="whispercpp-local">whisper.cpp (lokal)</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={project.providerConfig.stt.languageHint ?? 'auto'}
            onValueChange={(v) => void setSttLanguageHint(v)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Sprache: Automatisch</SelectItem>
              <SelectItem value="de">Sprache: Deutsch</SelectItem>
              <SelectItem value="en">Sprache: Englisch</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={project.providerConfig.transcriptionSourceClipId ?? '__auto__'}
            onValueChange={(v) => void setTranscriptionSource(v === '__auto__' ? undefined : v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__auto__">Automatisch wählen</SelectItem>
              {audioSources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button disabled={isTranscribing} onClick={() => void runStt()}>
            <Captions />
            {isTranscribing
              ? `Transkribiere…${sttProgress != null ? ` ${Math.round(sttProgress * 100)}%` : ''}`
              : 'Transkribieren'}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
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
