import type { TranscriptionProviderId } from '@shared/types/project'
import type { AppSettings } from '@shared/types/settings'
import type { TranscriptionProvider } from './types'
import { getBundledWhisperCliPath, getBundledWhisperModelPath } from './bundled-resources'
import { createOpenAiWhisperProvider } from './openai-whisper'
import { createWhisperCppProvider } from './whispercpp-local'

export function createTranscriptionProvider(
  id: TranscriptionProviderId,
  settings: AppSettings
): TranscriptionProvider {
  switch (id) {
    case 'openai-whisper-api':
      if (!settings.openaiApiKey) {
        throw new Error('Kein OpenAI API-Key hinterlegt. Bitte in den Einstellungen eintragen.')
      }
      return createOpenAiWhisperProvider(settings.openaiApiKey)
    case 'whispercpp-local': {
      const modelPath = settings.whisperCppModelPath || getBundledWhisperModelPath()
      return createWhisperCppProvider(getBundledWhisperCliPath(), modelPath)
    }
  }
}

export type { TranscriptionProvider } from './types'
