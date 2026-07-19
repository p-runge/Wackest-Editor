import { z } from 'zod'

export const SCHEMA_VERSION = 1

export const SourceKindSchema = z.enum(['video', 'audio'])
export type SourceKind = z.infer<typeof SourceKindSchema>

export const ProbedMediaInfoSchema = z.object({
  durationSec: z.number(),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  frameRate: z.number().optional(),
  sampleRate: z.number().optional(),
  channels: z.number().optional(),
  container: z.string()
})
export type ProbedMediaInfo = z.infer<typeof ProbedMediaInfoSchema>

// unifiedTime = localTime + offsetSec, valid only within [localStartSec, localEndSec) of the source file.
export const SyncMethodSchema = z.enum(['cross-correlation', 'manual', 'no-overlap-gap'])
export type SyncMethod = z.infer<typeof SyncMethodSchema>

export const SyncSegmentSchema = z.object({
  id: z.string(),
  localStartSec: z.number(),
  localEndSec: z.number(),
  offsetSec: z.number(),
  confidence: z.number().min(0).max(1),
  method: SyncMethodSchema
})
export type SyncSegment = z.infer<typeof SyncSegmentSchema>

export const SourceRoleSchema = z.enum(['main', 'supplemental'])
export type SourceRole = z.infer<typeof SourceRoleSchema>

export const SourceClipSchema = z.object({
  id: z.string(),
  kind: SourceKindSchema,
  originalFilePath: z.string(),
  relativeFilePath: z.string(),
  importedAt: z.string(),
  label: z.string(),
  probed: ProbedMediaInfoSchema,
  role: SourceRoleSchema.optional(),
  // always exactly one segment per source; non-overlapping source clusters are placed sequentially
  // with a fixed gap instead — see Project.hardCutMarkers and method: 'no-overlap-gap'
  syncSegments: z.array(SyncSegmentSchema),
  waveformCachePath: z.string().optional(),
  thumbnailCachePath: z.string().optional()
})
export type SourceClip = z.infer<typeof SourceClipSchema>

export const TranscriptWordSchema = z.object({
  word: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  confidence: z.number().optional()
})
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>

export const SttProviderIdSchema = z.enum(['openai-whisper-api', 'whispercpp-local'])
export type SttProviderId = z.infer<typeof SttProviderIdSchema>

export const TranscriptSegmentSchema = z.object({
  id: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
  words: z.array(TranscriptWordSchema).optional(),
  sourceClipId: z.string(),
  provider: SttProviderIdSchema
})
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>

export const HeatmapProviderIdSchema = z.enum(['llm-claude', 'llm-openai', 'heuristic-local'])
export type HeatmapProviderId = z.infer<typeof HeatmapProviderIdSchema>

export const HeatmapPointSchema = z.object({
  startSec: z.number(),
  endSec: z.number(),
  score: z.number().min(0).max(1),
  reason: z.string().optional(),
  provider: HeatmapProviderIdSchema
})
export type HeatmapPoint = z.infer<typeof HeatmapPointSchema>

// a time range where `value` (a SourceClip.id) is the active video / active audio source
export const TrackIntervalSchema = z.object({
  id: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  value: z.string()
})
export type TrackInterval = z.infer<typeof TrackIntervalSchema>

// non-destructive: only kept ranges are exported, source/track lanes stay full-length
export const KeptRangeSchema = z.object({
  id: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  label: z.string().optional()
})
export type KeptRange = z.infer<typeof KeptRangeSchema>

export const EditStateSchema = z.object({
  activeVideoIntervals: z.array(TrackIntervalSchema),
  activeAudioIntervals: z.array(TrackIntervalSchema),
  keptRanges: z.array(KeptRangeSchema)
})
export type EditState = z.infer<typeof EditStateSchema>

// 'auto' lets the provider auto-detect the spoken language; extendable without a schema migration
// since it's a plain optional string, though the UI currently only offers auto/de/en.
export const SttLanguageHintSchema = z.string().optional()
export type SttLanguageHint = z.infer<typeof SttLanguageHintSchema>

export const ProviderConfigSnapshotSchema = z.object({
  stt: z.object({
    provider: SttProviderIdSchema,
    model: z.string().optional(),
    languageHint: SttLanguageHintSchema
  }),
  heatmap: z.object({
    provider: HeatmapProviderIdSchema,
    model: z.string().optional(),
    chunkSec: z.number().optional()
  })
})
export type ProviderConfigSnapshot = z.infer<typeof ProviderConfigSnapshotSchema>

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sources: z.array(SourceClipSchema),
  timelineDurationSec: z.number(),
  // unified-timeline seconds; each is the start of a fixed NO_OVERLAP_GAP_SEC-wide hard-cut gap
  // between two source clusters with no trustworthy temporal overlap (see main/jobs/sync/graph.ts)
  hardCutMarkers: z.array(z.number()),
  transcript: z.array(TranscriptSegmentSchema),
  heatmap: z.array(HeatmapPointSchema),
  edit: EditStateSchema,
  providerConfig: ProviderConfigSnapshotSchema
})
export type Project = z.infer<typeof ProjectSchema>

export function createEmptyProject(name: string, id: string): Project {
  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    sources: [],
    timelineDurationSec: 0,
    hardCutMarkers: [],
    transcript: [],
    heatmap: [],
    edit: { activeVideoIntervals: [], activeAudioIntervals: [], keptRanges: [] },
    providerConfig: {
      stt: { provider: 'openai-whisper-api', languageHint: 'auto' },
      heatmap: { provider: 'heuristic-local' }
    }
  }
}

export function recomputeTimelineDuration(project: Project): number {
  let maxEnd = 0
  for (const source of project.sources) {
    for (const segment of source.syncSegments) {
      const unifiedEnd = segment.localEndSec + segment.offsetSec
      if (unifiedEnd > maxEnd) maxEnd = unifiedEnd
    }
  }
  return maxEnd
}
