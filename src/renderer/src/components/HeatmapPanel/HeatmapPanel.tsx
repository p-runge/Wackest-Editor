import { useState } from 'react'
import { Flame, SwitchCamera } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { useSettingsStore } from '../../state/settings-store'
import { useSettingsUIStore } from '../../state/settings-ui-store'
import { settingsFieldIdForErrorMessage } from '../../lib/settings-errors'
import { colorForScore, colorForSourceId } from '../../lib/colors'
import { deriveGlobalHeatmap, findHeatmapPeakIndices } from '../../lib/heatmap'
import type { HeatmapProviderId } from '@shared/types/project'
import { planSampling, estimateVisionRun, type SamplingDensity } from '@shared/types/sampling'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Slider } from '../ui/slider'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

const PROVIDER_LABELS: Record<HeatmapProviderId, string> = {
  'audio-energy-local': 'Wer spricht (Audio, lokal)',
  'video-motion-local': 'Video-Dynamik (lokal)',
  'vision-llm-claude': 'Vision-Urteil (Claude)',
  'vision-llm-openai': 'Vision-Urteil (OpenAI)',
  'vision-llm-local': 'Vision-Urteil (lokal/Ollama)'
}

const DENSITY_LABELS: Record<SamplingDensity, string> = {
  low: 'niedrig',
  medium: 'mittel',
  high: 'hoch'
}

function isVisionProvider(provider: HeatmapProviderId): boolean {
  return (
    provider === 'vision-llm-claude' ||
    provider === 'vision-llm-openai' ||
    provider === 'vision-llm-local'
  )
}

function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDurationEstimate(sec: number): string {
  if (sec < 90) return `~${Math.round(sec)} s`
  return `~${Math.round(sec / 60)} min`
}

function providerExplanationFor(provider: HeatmapProviderId): string {
  switch (provider) {
    case 'audio-energy-local':
      return 'Vergleicht pro Kamera die Lautstärke der eigenen Tonspur (wer spricht ins eigene Mikro) und gewichtet mit dem Sprechtempo aus dem Transkript – lokal, ohne API-Aufruf.'
    case 'video-motion-local':
      return 'Misst pro Kamera, wie viel sich im Bild bewegt (Bewegung/Szenenwechsel) – rein visuell, lokal, ohne API-Aufruf.'
    case 'vision-llm-claude':
      return 'Schickt Standbilder jeder Kamera an die Claude-Vision-API, die bewertet, welche Einstellung am interessantesten ist (z. B. sichtbarer Sprecher, Handlung).'
    case 'vision-llm-openai':
      return 'Schickt Standbilder jeder Kamera an die OpenAI-Vision-API, die bewertet, welche Einstellung am interessantesten ist.'
    case 'vision-llm-local':
      return 'Bewertet Standbilder jeder Kamera mit einem lokal laufenden Vision-Modell über Ollama (z. B. moondream) – offline, kostenlos.'
  }
}

function missingSettingFor(
  provider: HeatmapProviderId,
  settings: { openaiApiKey?: string; anthropicApiKey?: string }
): { message: string; fieldId: string } | null {
  if (provider === 'vision-llm-claude' && !settings.anthropicApiKey) {
    return {
      message: 'Für die Claude-Vision-API wird ein Anthropic API-Key benötigt.',
      fieldId: 'anthropic-key'
    }
  }
  if (provider === 'vision-llm-openai' && !settings.openaiApiKey) {
    return {
      message: 'Für die OpenAI-Vision-API wird ein OpenAI API-Key benötigt.',
      fieldId: 'openai-key'
    }
  }
  return null
}

/** One source's interest curve, buckets positioned on the unified timeline. */
function TrackHeatmapRow({
  label,
  color,
  points,
  durationSec
}: {
  label: string
  color: string
  points: Array<{ startSec: number; endSec: number; score: number }>
  durationSec: number
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-20 shrink-0 items-center gap-1.5 truncate text-xs text-foreground/90">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate">{label}</span>
      </span>
      <div className="relative h-5 flex-1 overflow-hidden rounded border border-border bg-muted/40">
        {points.map((point, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0"
            style={{
              left: `${(point.startSec / durationSec) * 100}%`,
              width: `${((point.endSec - point.startSec) / durationSec) * 100}%`,
              backgroundColor: colorForScore(point.score)
            }}
            title={`${formatTime(point.startSec)}–${formatTime(point.endSec)} · Score ${point.score.toFixed(2)}`}
          />
        ))}
      </div>
    </div>
  )
}

function HeatmapPanel(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const isScoringHeatmap = useProjectStore((state) => state.isScoringHeatmap)
  const heatmapProgress = useProjectStore((state) => state.heatmapProgress)
  const error = useProjectStore((state) => state.heatmapError)
  const runHeatmap = useProjectStore((state) => state.runHeatmap)
  const setHeatmapProvider = useProjectStore((state) => state.setHeatmapProvider)
  const generateAutoCut = useProjectStore((state) => state.generateAutoCut)
  const autoCutSummary = useProjectStore((state) => state.autoCutSummary)
  const settings = useSettingsStore((state) => state.settings)
  const openSettings = useSettingsUIStore((state) => state.openSettings)

  const [minShotSec, setMinShotSec] = useState(2.5)
  const [audioFollowsVideo, setAudioFollowsVideo] = useState(false)
  const [density, setDensity] = useState<SamplingDensity>('medium')

  if (!project) return null

  const videoSources = project.sources.filter((s) => s.probed.hasVideo)
  const isSynced = project.sources.some((s) => s.syncSegments.length > 0)

  if (videoSources.length === 0 || !isSynced) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        {videoSources.length === 0
          ? 'Keine Videospuren vorhanden – zuerst Videos importieren.'
          : 'Zuerst synchronisieren, damit die parallelen Kameras verglichen werden können.'}
      </p>
    )
  }

  const provider = project.providerConfig.heatmap.provider
  const missingSetting = missingSettingFor(provider, settings)
  const errorFieldId = error ? settingsFieldIdForErrorMessage(error) : null
  const duration = project.timelineDurationSec || 1
  const sourceIds = project.sources.map((s) => s.id)

  const globalHeatmap = deriveGlobalHeatmap(project.trackHeatmaps)
  const peakIndices = findHeatmapPeakIndices(globalHeatmap)
  const hasResult = project.trackHeatmaps.length > 0

  // Vision providers sample frames (API cost) — show a rough cost/time estimate for the chosen
  // density so the user can decide before committing.
  const vision = isVisionProvider(provider)
  const estimate = vision
    ? estimateVisionRun(planSampling(videoSources, density).totalFrames, provider)
    : null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Interesse pro Kamera bewerten und daraus einen automatischen Schnitt erzeugen.
      </p>

      <div className="flex flex-col gap-1">
        <Label className="text-xs font-normal text-muted-foreground">Kriterium / Anbieter</Label>
        <Select
          value={provider}
          onValueChange={(v) => void setHeatmapProvider(v as HeatmapProviderId)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PROVIDER_LABELS) as HeatmapProviderId[]).map((id) => (
              <SelectItem key={id} value={id}>
                {PROVIDER_LABELS[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{providerExplanationFor(provider)}</p>
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

      {vision && (
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-normal text-muted-foreground">Sampling-Dichte</Label>
          <Select value={density} onValueChange={(v) => setDensity(v as SamplingDensity)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DENSITY_LABELS) as SamplingDensity[]).map((id) => (
                <SelectItem key={id} value={id}>
                  {DENSITY_LABELS[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {estimate && (
            <p className="text-xs text-muted-foreground">
              Grobe Schätzung: ~{estimate.totalFrames} Frames ·{' '}
              {estimate.costUsd > 0 ? `~$${estimate.costUsd.toFixed(2)}` : 'kostenlos'} ·{' '}
              {formatDurationEstimate(estimate.durationSec)}
            </p>
          )}
        </div>
      )}

      <Button
        className="w-full"
        disabled={isScoringHeatmap || !!missingSetting}
        onClick={() => void runHeatmap(density)}
      >
        <Flame />
        {isScoringHeatmap
          ? `Analysiere…${heatmapProgress != null ? ` ${Math.round(heatmapProgress * 100)}%` : ''}`
          : 'Heatmap berechnen'}
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

      {!hasResult ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Noch keine Heatmap berechnet.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-normal text-muted-foreground">Pro Kamera</Label>
            {project.trackHeatmaps.map((track) => {
              const source = project.sources.find((s) => s.id === track.sourceId)
              return (
                <TrackHeatmapRow
                  key={track.sourceId}
                  label={source?.label ?? track.sourceId}
                  color={colorForSourceId(track.sourceId, sourceIds)}
                  points={track.points}
                  durationSec={duration}
                />
              )
            })}
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs font-normal text-muted-foreground">
              Gesamt (interessanteste Kamera)
            </Label>
            <TooltipProvider delayDuration={150}>
              <div className="flex h-6 w-full overflow-hidden rounded-md border border-border">
                {globalHeatmap.map((point, i) => {
                  const isPeak = peakIndices.has(i)
                  return (
                    <div
                      key={i}
                      className="relative"
                      style={{
                        width: `${((point.endSec - point.startSec) / duration) * 100}%`,
                        backgroundColor: colorForScore(point.score)
                      }}
                      title={
                        isPeak
                          ? undefined
                          : `${formatTime(point.startSec)}–${formatTime(point.endSec)} · Score ${point.score.toFixed(2)}`
                      }
                    >
                      {isPeak && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="absolute inset-x-0 top-0.5 mx-auto h-1.5 w-1.5 cursor-help rounded-full border border-black/40 bg-foreground" />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="font-medium">
                              {formatTime(point.startSec)}–{formatTime(point.endSec)} · Score{' '}
                              {point.score.toFixed(2)}
                            </p>
                            <p className="text-muted-foreground">{point.reason}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  )
                })}
              </div>
            </TooltipProvider>
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">Automatischer Schnitt</p>
            <p className="text-xs text-muted-foreground">
              Setzt die aktive Kamera pro Zeitpunkt auf die höchstbewertete Spur. Rückgängig per
              Undo.
            </p>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Mindest-Shot-Länge</span>
                <span>{minShotSec.toFixed(1)}s</span>
              </div>
              <Slider
                min={0.5}
                max={8}
                step={0.5}
                value={[minShotSec]}
                onValueChange={([v]) => setMinShotSec(v)}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={audioFollowsVideo}
                onChange={(e) => setAudioFollowsVideo(e.target.checked)}
              />
              Ton folgt Bild (aktives Audio mit umschalten)
            </label>
            <Button
              className="w-full"
              onClick={() => void generateAutoCut({ minShotSec, audioFollowsVideo })}
            >
              <SwitchCamera />
              Auto-Schnitt generieren
            </Button>
            {autoCutSummary &&
              (autoCutSummary.changed ? (
                <p className="text-xs text-success">
                  Auto-Schnitt angewendet – {autoCutSummary.switches} Kamerawechsel gesetzt.
                </p>
              ) : (
                <p className="text-xs text-warning">
                  Keine Änderung – die höchstbewertete Kamera war überall schon aktiv. Anderen
                  Provider probieren oder Heatmap neu berechnen.
                </p>
              ))}
          </div>
        </>
      )}
    </div>
  )
}

export default HeatmapPanel
