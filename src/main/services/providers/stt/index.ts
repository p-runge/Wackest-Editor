import type { SttProviderId } from '@shared/types/project'
import type { AppSettings } from '@shared/types/settings'
import type { SttProvider } from './types'
import { createOpenAiWhisperProvider } from './openai-whisper'
import { createWhisperCppProvider } from './whispercpp-local'

export function createSttProvider(id: SttProviderId, settings: AppSettings): SttProvider {
  switch (id) {
    case 'openai-whisper-api':
      if (!settings.openaiApiKey) {
        throw new Error('Kein OpenAI API-Key hinterlegt. Bitte in den Einstellungen eintragen.')
      }
      return createOpenAiWhisperProvider(settings.openaiApiKey)
    case 'whispercpp-local': {
      if (!settings.whisperCppModelPath) {
        throw new Error(
          'Kein whisper.cpp-Modellpfad hinterlegt. Bitte in den Einstellungen ein ggml-Modell auswählen.'
        )
      }
      const binaryPath = settings.whisperCppBinaryPath || 'whisper-cli'
      return createWhisperCppProvider(binaryPath, settings.whisperCppModelPath)
    }
  }
}

export type { SttProvider } from './types'
