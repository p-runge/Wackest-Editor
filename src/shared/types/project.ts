import { z } from 'zod'

// v2: per-source `trackHeatmaps` replaced the single global `heatmap`, and the heatmap providers
// switched from transcript-only to per-source (audio/video/vision) scoring for camera comparison.
// v3: the hard-cut-gap concept was removed — non-overlapping clusters are now concatenated directly,
// so the `hardCutMarkers` field is gone.
// v4: `providerConfig.stt` was renamed to `providerConfig.transcription` (naming cleanup, no data change).
// v5: sources are grouped into `deviceGroups` (a `deviceGroupId` per source) so all clips of one
// device share a single editor lane / export track; `probed` gained make/model/encoder for auto-grouping.
export const SCHEMA_VERSION = 5

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
  container: z.string(),
  // Recording-device fingerprint from container/stream metadata tags (when present) — used to
  // auto-group clips that came from the same device. See device-grouping.ts.
  make: z.string().optional(),
  model: z.string().optional(),
  encoder: z.string().optional()
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
  // The device group this clip belongs to (see DeviceGroupSchema). All clips sharing a
  // deviceGroupId render on one editor lane / export track. Optional so pre-v5 projects load;
  // `ensureDeviceGroups` (device-grouping.ts) assigns any missing ones on import/open.
  deviceGroupId: z.string().optional(),
  // always exactly one segment per source; non-overlapping source clusters are concatenated
  // directly one after another (method: 'no-overlap-gap' marks a cluster placed without overlap)
  syncSegments: z.array(SyncSegmentSchema),
  waveformCachePath: z.string().optional(),
  thumbnailCachePath: z.string().optional()
})
export type SourceClip = z.infer<typeof SourceClipSchema>

// A recording device (camera, phone, GoPro, external mic, …). Every source belongs to exactly one.
// `order` drives both the editor lane order and the export track order (first group = V1/A1).
export const DeviceGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number()
})
export type DeviceGroup = z.infer<typeof DeviceGroupSchema>

export const TranscriptWordSchema = z.object({
  word: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  confidence: z.number().optional()
})
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>

export const TranscriptionProviderIdSchema = z.enum(['openai-whisper-api', 'whispercpp-local'])
export type TranscriptionProviderId = z.infer<typeof TranscriptionProviderIdSchema>

export const TranscriptSegmentSchema = z.object({
  id: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
  words: z.array(TranscriptWordSchema).optional(),
  sourceClipId: z.string(),
  provider: TranscriptionProviderIdSchema
})
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>

// Each id is a distinct scoring strategy selectable in the UI, from cheap/offline to vision-LLM.
// See src/main/services/providers/heatmap/. Kept as separate options so the user can compare which
// signal drives the best automatic camera cut for their footage.
export const HeatmapProviderIdSchema = z.enum([
  'audio-energy-local', // per-source mic RMS + transcript speaking rate — "who is speaking"
  'video-motion-local', // per-source ffmpeg motion/scene change — visual dynamism
  'vision-llm-claude', // sampled frames per camera → Claude vision judgement
  'vision-llm-openai', // sampled frames per camera → OpenAI vision judgement
  'vision-llm-local' // sampled frames per camera → local Ollama vision model
])
export type HeatmapProviderId = z.infer<typeof HeatmapProviderIdSchema>

export const HeatmapPointSchema = z.object({
  startSec: z.number(),
  endSec: z.number(),
  score: z.number().min(0).max(1),
  reason: z.string().optional()
})
export type HeatmapPoint = z.infer<typeof HeatmapPointSchema>

// One interest curve per source, on the unified timeline. `points` are gapless buckets covering
// only where the source actually has footage (see sourceCoverageRange). Scores across sources share
// a common scale so parallel cameras can be compared bucket-by-bucket for the automatic cut.
export const TrackHeatmapSchema = z.object({
  sourceId: z.string(),
  provider: HeatmapProviderIdSchema,
  points: z.array(HeatmapPointSchema)
})
export type TrackHeatmap = z.infer<typeof TrackHeatmapSchema>

// a time range where `value` (a SourceClip.id) is the active video / active audio source
export const TrackIntervalSchema = z.object({
  id: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  value: z.string()
})
export type TrackInterval = z.infer<typeof TrackIntervalSchema>

// non-destructive: only kept ranges are exported, source/track lanes stay full-length.
// startSec/endSec are the *placement* on the shared timeline (where this clip sits, and hence
// what it exports as/next to). contentStartSec is the *content* origin — which stretch of raw/
// synced footage it actually plays, i.e. where it was originally picked up from before being
// dragged to a new placement (Schnitt mode's free move). Omitted/equal-to-startSec means
// "not displaced": content and placement are the same, which is the case for every kept range
// until it's explicitly moved — see `resolveMovePlacement` in lib/timeline-edit.ts.
export const KeptRangeSchema = z.object({
  id: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  contentStartSec: z.number().optional(),
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
export const TranscriptionLanguageHintSchema = z.string().optional()
export type TranscriptionLanguageHint = z.infer<typeof TranscriptionLanguageHintSchema>

export const ProviderConfigSnapshotSchema = z.object({
  transcription: z.object({
    provider: TranscriptionProviderIdSchema,
    model: z.string().optional(),
    languageHint: TranscriptionLanguageHintSchema
  }),
  heatmap: z.object({
    // .catch keeps an unknown/legacy provider id (e.g. a pre-v2 'heuristic-local') from failing the
    // whole providerConfig parse on load — it quietly falls back to the default instead.
    provider: HeatmapProviderIdSchema.catch('audio-energy-local'),
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
  deviceGroups: z.array(DeviceGroupSchema),
  timelineDurationSec: z.number(),
  transcript: z.array(TranscriptSegmentSchema),
  trackHeatmaps: z.array(TrackHeatmapSchema),
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
    deviceGroups: [],
    timelineDurationSec: 0,
    transcript: [],
    trackHeatmaps: [],
    edit: { activeVideoIntervals: [], activeAudioIntervals: [], keptRanges: [] },
    providerConfig: {
      transcription: { provider: 'openai-whisper-api', languageHint: 'auto' },
      heatmap: { provider: 'audio-energy-local' }
    }
  }
}

// Recovers a project from data whose structure doesn't fully match ProjectSchema by validating
// each top-level field independently and falling back to empty-project defaults for any field
// that fails. Used to offer a "discard unmatched properties" recovery path when loading a
// project.json that predates a schema change, instead of failing the load outright.
export function recoverProject(
  raw: unknown,
  fallback: { id: string; name: string }
): { project: Project; discardedKeys: string[] } {
  const base = createEmptyProject(fallback.name, fallback.id)
  const rawObj =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : undefined

  const discardedKeys: string[] = []
  const result: Record<string, unknown> = { ...base }

  for (const key of Object.keys(ProjectSchema.shape) as Array<keyof typeof ProjectSchema.shape>) {
    if (!rawObj || !(key in rawObj)) {
      if (key !== 'schemaVersion') discardedKeys.push(key)
      continue
    }
    const fieldResult = ProjectSchema.shape[key].safeParse(rawObj[key])
    if (fieldResult.success) {
      result[key] = fieldResult.data
    } else {
      discardedKeys.push(key)
    }
  }

  result.schemaVersion = SCHEMA_VERSION
  return { project: ProjectSchema.parse(result), discardedKeys }
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
