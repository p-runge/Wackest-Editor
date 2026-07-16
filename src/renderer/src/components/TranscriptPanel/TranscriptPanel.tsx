import { useProjectStore } from '../../state/project-store'
import type { SttProviderId } from '@shared/types/project'
import './transcript-panel.css'

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
  if (audioSources.length === 0) return null

  return (
    <div className="transcript-panel">
      <header className="transcript-panel__header">
        <h2>Transkript</h2>
        <div className="transcript-panel__controls">
          <select
            value={project.providerConfig.stt.provider}
            onChange={(e) => void setSttProvider(e.target.value as SttProviderId)}
          >
            <option value="openai-whisper-api">OpenAI Whisper API</option>
            <option value="whispercpp-local">whisper.cpp (lokal)</option>
          </select>
          <select
            value={project.providerConfig.stt.languageHint ?? 'auto'}
            onChange={(e) => void setSttLanguageHint(e.target.value)}
          >
            <option value="auto">Sprache: Automatisch</option>
            <option value="de">Sprache: Deutsch</option>
            <option value="en">Sprache: Englisch</option>
          </select>
          <select
            value={project.providerConfig.transcriptionSourceClipId ?? ''}
            onChange={(e) => void setTranscriptionSource(e.target.value || undefined)}
          >
            <option value="">Automatisch wählen</option>
            {audioSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
          <button disabled={isTranscribing} onClick={() => void runStt()}>
            {isTranscribing
              ? `Transkribiere…${sttProgress != null ? ` ${Math.round(sttProgress * 100)}%` : ''}`
              : 'Transkribieren'}
          </button>
        </div>
      </header>

      {error && <p className="transcript-panel__error">{error}</p>}

      {project.transcript.length === 0 ? (
        <p className="transcript-panel__hint">Noch kein Transkript vorhanden.</p>
      ) : (
        <ul className="transcript-panel__list">
          {project.transcript.map((segment) => (
            <li key={segment.id} className="transcript-segment">
              <span className="transcript-segment__time">
                {formatTime(segment.startSec)}–{formatTime(segment.endSec)}
              </span>
              <span className="transcript-segment__text">{segment.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default TranscriptPanel
