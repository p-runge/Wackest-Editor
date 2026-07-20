import type { TranscriptionProviderId } from '@shared/types/project'

export interface TranscriptionSegmentResult {
  startSec: number
  endSec: number
  text: string
}

export interface TranscriptionInput {
  audioFilePath: string
  languageHint?: string
  onProgress?: (progress: number) => void
}

export interface TranscriptionOutput {
  segments: TranscriptionSegmentResult[]
}

export interface TranscriptionProvider {
  id: TranscriptionProviderId
  transcribe(input: TranscriptionInput): Promise<TranscriptionOutput>
}
