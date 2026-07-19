import { Flame } from 'lucide-react'
import { useProjectStore } from '../../state/project-store'
import { useSettingsStore } from '../../state/settings-store'
import { useSettingsUIStore } from '../../state/settings-ui-store'
import { settingsFieldIdForErrorMessage } from '../../lib/settings-errors'
import { colorForScore } from '../../lib/colors'
import { findHeatmapPeakIndices } from '../../lib/heatmap'
import type { HeatmapProviderId } from '@shared/types/project'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

function formatTime(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function providerExplanationFor(provider: HeatmapProviderId): string {
  switch (provider) {
    case 'heuristic-local':
      return 'Wertet Lautstärke, Sprechtempo und Ausrufe/Fragen im Transkript aus und kombiniert sie zu einem Score – läuft lokal, ohne API-Aufruf.'
    case 'llm-claude':
      return 'Schickt das Transkript abschnittsweise an die Claude API, die Inhalte wie spannende Aussagen, Emotionen oder Wendepunkte erkennt und bewertet.'
    case 'llm-openai':
      return 'Schickt das Transkript abschnittsweise an die OpenAI API, die Inhalte wie spannende Aussagen, Emotionen oder Wendepunkte erkennt und bewertet.'
  }
}

function missingSettingFor(
  provider: HeatmapProviderId,
  settings: { openaiApiKey?: string; anthropicApiKey?: string }
): { message: string; fieldId: string } | null {
  if (provider === 'llm-claude' && !settings.anthropicApiKey) {
    return {
      message: 'Für die Claude API wird ein Anthropic API-Key benötigt.',
      fieldId: 'anthropic-key'
    }
  }
  if (provider === 'llm-openai' && !settings.openaiApiKey) {
    return {
      message: 'Für die OpenAI API wird ein OpenAI API-Key benötigt.',
      fieldId: 'openai-key'
    }
  }
  return null
}

function HeatmapPanel(): React.JSX.Element | null {
  const project = useProjectStore((state) => state.project)
  const isScoringHeatmap = useProjectStore((state) => state.isScoringHeatmap)
  const heatmapProgress = useProjectStore((state) => state.heatmapProgress)
  const error = useProjectStore((state) => state.heatmapError)
  const runHeatmap = useProjectStore((state) => state.runHeatmap)
  const setHeatmapProvider = useProjectStore((state) => state.setHeatmapProvider)
  const settings = useSettingsStore((state) => state.settings)
  const openSettings = useSettingsUIStore((state) => state.openSettings)

  if (!project) return null
  if (project.transcript.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Zuerst ein Transkript erzeugen – die Heatmap wertet den gesprochenen Inhalt aus.
      </p>
    )
  }

  const duration = project.timelineDurationSec || 1
  const peakIndices = findHeatmapPeakIndices(project.heatmap)
  const missingSetting = missingSettingFor(project.providerConfig.heatmap.provider, settings)
  const errorFieldId = error ? settingsFieldIdForErrorMessage(error) : null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Interessante Abschnitte anhand des Transkripts bewerten.
      </p>

      <div className="flex flex-col gap-1">
        <Label className="text-xs font-normal text-muted-foreground">Anbieter</Label>
        <Select
          value={project.providerConfig.heatmap.provider}
          onValueChange={(v) => void setHeatmapProvider(v as HeatmapProviderId)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="heuristic-local">Lokale Heuristik</SelectItem>
            <SelectItem value="llm-claude">Claude API</SelectItem>
            <SelectItem value="llm-openai">OpenAI API</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {providerExplanationFor(project.providerConfig.heatmap.provider)}
        </p>
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

      <Button
        className="w-full"
        disabled={isScoringHeatmap || !!missingSetting}
        onClick={() => void runHeatmap()}
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

      {project.heatmap.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Noch keine Heatmap berechnet.
        </p>
      ) : (
        <>
          <TooltipProvider delayDuration={150}>
            <div className="flex h-6 w-full overflow-hidden rounded-md border border-border">
              {project.heatmap.map((point, i) => {
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>niedrig</span>
            <div
              className="h-2 flex-1 rounded-full"
              style={{
                background: `linear-gradient(to right, ${colorForScore(0)}, ${colorForScore(1)})`
              }}
            />
            <span>hoch</span>
          </div>
        </>
      )}
    </div>
  )
}

export default HeatmapPanel
