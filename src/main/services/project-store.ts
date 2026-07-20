import { readFile, writeFile, copyFile, mkdir } from 'fs/promises'
import { randomUUID } from 'crypto'
import { basename, join } from 'path'
import { ProjectSchema, recoverProject, SCHEMA_VERSION, type Project } from '@shared/types/project'

export async function saveProject(projectDir: string, project: Project): Promise<void> {
  await mkdir(projectDir, { recursive: true })
  await mkdir(join(projectDir, 'cache'), { recursive: true })

  const validated = ProjectSchema.parse({
    ...project,
    updatedAt: new Date().toISOString()
  })

  await writeFile(join(projectDir, 'project.json'), JSON.stringify(validated, null, 2), 'utf-8')
}

export type ProjectLoadOutcome =
  { status: 'ok'; project: Project } | { status: 'invalid'; issues: string[] }

// Forward-migrates an older project.json shape to the current schema before validation, so old
// projects open without the "invalid fields" recovery prompt. Each step is additive and idempotent.
function migrateProjectData(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null) return parsed
  const data = parsed as Record<string, unknown>

  // v1 -> v2: the single global `heatmap` was replaced by per-source `trackHeatmaps`. The old
  // curve isn't per-source, so it's dropped — the heatmap is recomputed on the next run.
  if (!('trackHeatmaps' in data)) {
    delete data.heatmap
    data.trackHeatmaps = []
  }

  // v2 -> v3: the hard-cut-gap concept was removed. Drop the stale markers; the baked-in cluster
  // offsets stay until the next sync, which now concatenates non-overlapping clusters directly.
  if ('hardCutMarkers' in data) {
    delete data.hardCutMarkers
  }

  // v3 -> v4: `providerConfig.stt` was renamed to `providerConfig.transcription` (naming cleanup only).
  if (
    data.providerConfig &&
    typeof data.providerConfig === 'object' &&
    'stt' in (data.providerConfig as Record<string, unknown>)
  ) {
    const providerConfig = data.providerConfig as Record<string, unknown>
    providerConfig.transcription = providerConfig.stt
    delete providerConfig.stt
  }

  data.schemaVersion = SCHEMA_VERSION
  return data
}

export async function readProjectFile(projectFilePath: string): Promise<ProjectLoadOutcome> {
  const raw = await readFile(projectFilePath, 'utf-8')
  const parsed = migrateProjectData(JSON.parse(raw))
  const result = ProjectSchema.safeParse(parsed)
  if (result.success) return { status: 'ok', project: result.data }

  const issues = result.error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`
  )
  return { status: 'invalid', issues }
}

// Backs up the unparseable project.json alongside the project directory, then rewrites it with
// unmatched top-level fields reset to defaults so the project can be reopened.
export async function discardInvalidProjectFields(
  projectFilePath: string,
  projectDir: string
): Promise<Project> {
  const raw = await readFile(projectFilePath, 'utf-8')
  const parsed = JSON.parse(raw)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  await copyFile(projectFilePath, join(projectDir, `project.backup-${timestamp}.json`))

  const { project } = recoverProject(parsed, { id: randomUUID(), name: basename(projectDir) })
  await saveProject(projectDir, project)
  return project
}
