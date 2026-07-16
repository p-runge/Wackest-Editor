import type { SttProviderId } from '@shared/types/project'

export interface SttSegmentResult {
  startSec: number
  endSec: number
  text: string
}

export interface SttTranscribeInput {
  audioFilePath: string
  languageHint?: string
  onProgress?: (progress: number) => void
}

export interface SttTranscribeOutput {
  segments: SttSegmentResult[]
}

export interface SttProvider {
  id: SttProviderId
  transcribe(input: SttTranscribeInput): Promise<SttTranscribeOutput>
}
