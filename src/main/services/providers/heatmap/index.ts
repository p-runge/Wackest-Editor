import type { HeatmapProviderId } from '@shared/types/project'
import type { AppSettings } from '@shared/types/settings'
import type { HeatmapProvider } from './types'
import { createAudioEnergyLocalProvider } from './audio-energy-local'
import { createVideoMotionLocalProvider } from './video-motion-local'
import { createVisionClaudeProvider } from './vision-llm-claude'
import { createVisionOpenAiProvider } from './vision-llm-openai'
import { createVisionLocalProvider } from './vision-llm-local'

export function createHeatmapProvider(
  id: HeatmapProviderId,
  settings: AppSettings
): HeatmapProvider {
  switch (id) {
    case 'audio-energy-local':
      return createAudioEnergyLocalProvider()
    case 'video-motion-local':
      return createVideoMotionLocalProvider()
    case 'vision-llm-claude':
      if (!settings.anthropicApiKey) {
        throw new Error('Kein Anthropic API-Key hinterlegt. Bitte in den Einstellungen eintragen.')
      }
      return createVisionClaudeProvider(settings.anthropicApiKey)
    case 'vision-llm-openai':
      if (!settings.openaiApiKey) {
        throw new Error('Kein OpenAI API-Key hinterlegt. Bitte in den Einstellungen eintragen.')
      }
      return createVisionOpenAiProvider(settings.openaiApiKey)
    case 'vision-llm-local':
      return createVisionLocalProvider()
  }
}

export type { HeatmapProvider } from './types'
