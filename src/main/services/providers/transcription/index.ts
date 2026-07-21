import type { TranscriptionProviderId } from '@shared/types/project'
import type { AppSettings } from '@shared/types/settings'
import type { TranscriptionProvider } from './types'
import { getBundledWhisperCliPath, getBundledWhisperModelPath } from './bundled-resources'
import { getDownloadedModelPath, isModelDownloaded } from '../../model-catalog'
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
      const downloadedPath =
        settings.selectedModelFilename && isModelDownloaded(settings.selectedModelFilename)
          ? getDownloadedModelPath(settings.selectedModelFilename)
          : undefined
      const modelPath =
        settings.whisperCppModelPath || downloadedPath || getBundledWhisperModelPath()
      return createWhisperCppProvider(getBundledWhisperCliPath(), modelPath)
    }
  }
}

export type { TranscriptionProvider } from './types'
