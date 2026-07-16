import type { TranscriptSegment } from '@shared/types/project'

export interface TranscriptChunk {
  startSec: number
  endSec: number
  text: string
}

const CHUNK_DURATION_SEC = 8 * 60 // ~8 min windows keep prompts small and calls fast

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Groups transcript segments into contiguous ~8-minute windows for per-chunk LLM scoring. */
export function buildTranscriptChunks(
  transcript: TranscriptSegment[],
  chunkDurationSec = CHUNK_DURATION_SEC
): TranscriptChunk[] {
  if (transcript.length === 0) return []

  const sorted = [...transcript].sort((a, b) => a.startSec - b.startSec)
  const chunks: TranscriptChunk[] = []
  let chunkStartSec = sorted[0].startSec
  let current: TranscriptSegment[] = []

  const flush = (endSec: number): void => {
    if (current.length === 0) return
    const text = current.map((s) => `[${formatTime(s.startSec)}] ${s.text}`).join('\n')
    chunks.push({ startSec: chunkStartSec, endSec, text })
    current = []
  }

  for (const segment of sorted) {
    if (current.length > 0 && segment.startSec - chunkStartSec >= chunkDurationSec) {
      flush(current[current.length - 1].endSec)
      chunkStartSec = segment.startSec
    }
    current.push(segment)
  }
  flush(sorted[sorted.length - 1].endSec)

  return chunks
}

export function buildHeatmapPrompt(
  chunk: TranscriptChunk,
  bucketSec: number,
  previousContext: string | undefined
): string {
  return `Du analysierst das Transkript eines Videos, um potenziell interessante bzw. hervorhebenswerte Momente (Highlights) zu finden - z.B. spannende Aussagen, Emotionen, Humor, Themenwechsel, Konflikte, überraschende Wendungen.
${previousContext ? `\nKontext aus dem vorherigen Abschnitt: "${previousContext}"\n` : ''}
Transkript-Abschnitt (Zeitstempel als [m:ss], Abschnitt reicht von ${chunk.startSec.toFixed(0)}s bis ${chunk.endSec.toFixed(0)}s ab Video-Start):
${chunk.text}

Teile diesen Abschnitt in aufeinanderfolgende, lückenlose ${bucketSec}-Sekunden-Buckets ein (beginnend bei ${chunk.startSec.toFixed(0)}s, endend bei ${chunk.endSec.toFixed(0)}s) und bewerte jeden Bucket mit einem Interesse-Score von 0 (uninteressant) bis 1 (sehr interessant/Highlight-würdig). Gib je Bucket einen kurzen Grund (max. 10 Wörter, auf Deutsch) an. Antworte ausschließlich über das bereitgestellte Tool/Funktions-Schema.`
}

// plain (non-`as const`) object: both the Anthropic and OpenAI SDKs expect mutable `string[]` for
// `required`, which a readonly const-asserted tuple isn't assignable to.
export const HEATMAP_POINTS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startSec: { type: 'number', description: 'Bucket start in seconds from video start' },
          endSec: { type: 'number', description: 'Bucket end in seconds from video start' },
          score: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' }
        },
        required: ['startSec', 'endSec', 'score', 'reason']
      }
    }
  },
  required: ['points']
}

export interface RawHeatmapPoint {
  startSec: number
  endSec: number
  score: number
  reason: string
}
