import type { HeatmapProviderId } from '@shared/types/project'
import type { AppSettings } from '@shared/types/settings'
import type { HeatmapProvider } from './types'
import { createHeuristicLocalProvider } from './heuristic-local'
import { createClaudeHeatmapProvider } from './llm-claude'
import { createOpenAiHeatmapProvider } from './llm-openai'

export function createHeatmapProvider(
  id: HeatmapProviderId,
  settings: AppSettings
): HeatmapProvider {
  switch (id) {
    case 'heuristic-local':
      return createHeuristicLocalProvider()
    case 'llm-claude':
      if (!settings.anthropicApiKey) {
        throw new Error('Kein Anthropic API-Key hinterlegt. Bitte in den Einstellungen eintragen.')
      }
      return createClaudeHeatmapProvider(settings.anthropicApiKey)
    case 'llm-openai':
      if (!settings.openaiApiKey) {
        throw new Error('Kein OpenAI API-Key hinterlegt. Bitte in den Einstellungen eintragen.')
      }
      return createOpenAiHeatmapProvider(settings.openaiApiKey)
  }
}

export type { HeatmapProvider } from './types'
