import { createHash } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { Project, TrackHeatmap } from '@shared/types/project'
import type { AppSettings } from '@shared/types/settings'
import { computeAdaptiveBucketSec, type SamplingDensity } from '@shared/types/sampling'
import { createHeatmapProvider } from '../../services/providers/heatmap'

export interface HeatmapProgressUpdate {
  progress: number
}

/**
 * Keyed by provider + bucket size + every video source's id/sync alignment + full transcript, so a
 * re-run after a re-sync (which shifts the per-source unified buckets) or transcript edit recomputes.
 */
function computeCacheKey(project: Project, bucketSec: number, density: SamplingDensity): string {
  const hash = createHash('sha256')
  hash.update(project.providerConfig.heatmap.provider)
  hash.update(String(bucketSec))
  hash.update(density)
  for (const source of project.sources) {
    if (!source.probed.hasVideo) continue
    hash.update(source.id)
    for (const seg of source.syncSegments) {
      hash.update(`${seg.localStartSec}:${seg.localEndSec}:${seg.offsetSec}`)
    }
  }
  for (const segment of project.transcript) {
    hash.update(segment.id)
    hash.update(segment.text)
    hash.update(String(segment.startSec))
    hash.update(String(segment.endSec))
  }
  return hash.digest('hex')
}

function cacheFilePath(projectDir: string, cacheKey: string): string {
  return join(projectDir, 'cache', `heatmap-${cacheKey}.json`)
}

async function readCache(projectDir: string, cacheKey: string): Promise<TrackHeatmap[] | null> {
  try {
    const raw = await readFile(cacheFilePath(projectDir, cacheKey), 'utf-8')
    return JSON.parse(raw) as TrackHeatmap[]
  } catch {
    return null
  }
}

async function writeCache(
  projectDir: string,
  cacheKey: string,
  trackHeatmaps: TrackHeatmap[]
): Promise<void> {
  await mkdir(join(projectDir, 'cache'), { recursive: true })
  await writeFile(cacheFilePath(projectDir, cacheKey), JSON.stringify(trackHeatmaps), 'utf-8')
}

export async function runHeatmapForProject(
  project: Project,
  projectDir: string,
  settings: AppSettings,
  density: SamplingDensity,
  onProgress?: (update: HeatmapProgressUpdate) => void
): Promise<TrackHeatmap[]> {
  const videoSources = project.sources.filter((s) => s.probed.hasVideo)
  if (videoSources.length === 0) {
    throw new Error('Keine Videospuren vorhanden.')
  }

  // Bucket size for the audio/motion providers scales with the timeline (finer for short projects);
  // the vision providers derive their own plan from `density`.
  const bucketSec = computeAdaptiveBucketSec(project.timelineDurationSec)

  const cacheKey = computeCacheKey(project, bucketSec, density)
  const cached = await readCache(projectDir, cacheKey)
  if (cached) {
    onProgress?.({ progress: 1 })
    return cached
  }

  const provider = createHeatmapProvider(project.providerConfig.heatmap.provider, settings)

  const sourceMediaPaths: Record<string, string> = {}
  for (const source of videoSources) sourceMediaPaths[source.id] = source.originalFilePath

  const trackHeatmaps = await provider.score({
    videoSources,
    transcript: project.transcript,
    timelineDurationSec: project.timelineDurationSec,
    bucketSec,
    density,
    sourceMediaPaths,
    settings,
    onProgress: (progress) => onProgress?.({ progress })
  })

  await writeCache(projectDir, cacheKey, trackHeatmaps)
  return trackHeatmaps
}
