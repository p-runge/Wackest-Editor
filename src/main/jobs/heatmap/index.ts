import { createHash } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { Project, HeatmapPoint } from '@shared/types/project'
import type { AppSettings } from '@shared/types/settings'
import { createHeatmapProvider } from '../../services/providers/heatmap'
import { pickPrimaryAudioSource } from '../stt'

export interface HeatmapProgressUpdate {
  progress: number
}

/** Keyed by provider + bucket size + full transcript content, so a re-run after edits recomputes. */
function computeCacheKey(project: Project, bucketSec: number): string {
  const hash = createHash('sha256')
  hash.update(project.providerConfig.heatmap.provider)
  hash.update(String(bucketSec))
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

async function readCache(projectDir: string, cacheKey: string): Promise<HeatmapPoint[] | null> {
  try {
    const raw = await readFile(cacheFilePath(projectDir, cacheKey), 'utf-8')
    return JSON.parse(raw) as HeatmapPoint[]
  } catch {
    return null
  }
}

async function writeCache(
  projectDir: string,
  cacheKey: string,
  points: HeatmapPoint[]
): Promise<void> {
  await mkdir(join(projectDir, 'cache'), { recursive: true })
  await writeFile(cacheFilePath(projectDir, cacheKey), JSON.stringify(points), 'utf-8')
}

export async function runHeatmapForProject(
  project: Project,
  projectDir: string,
  settings: AppSettings,
  bucketSec: number,
  onProgress?: (update: HeatmapProgressUpdate) => void
): Promise<HeatmapPoint[]> {
  if (project.transcript.length === 0) {
    throw new Error('Kein Transkript vorhanden. Bitte zuerst transkribieren.')
  }

  const cacheKey = computeCacheKey(project, bucketSec)
  const cached = await readCache(projectDir, cacheKey)
  if (cached) {
    onProgress?.({ progress: 1 })
    return cached
  }

  const provider = createHeatmapProvider(project.providerConfig.heatmap.provider, settings)

  // the local heuristic needs actual audio; LLM providers only need the transcript text
  const audioFilePath =
    provider.id === 'heuristic-local'
      ? pickPrimaryAudioSource(project)?.originalFilePath
      : undefined

  const points = await provider.score({
    transcript: project.transcript,
    timelineDurationSec: project.timelineDurationSec,
    bucketSec,
    audioFilePath,
    onProgress: (progress) => onProgress?.({ progress })
  })

  await writeCache(projectDir, cacheKey, points)
  return points
}
