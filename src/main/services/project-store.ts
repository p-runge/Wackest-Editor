import { readFile, writeFile, copyFile, mkdir } from 'fs/promises'
import { randomUUID } from 'crypto'
import { basename, join } from 'path'
import { ProjectSchema, recoverProject, type Project } from '@shared/types/project'

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

export async function readProjectFile(projectFilePath: string): Promise<ProjectLoadOutcome> {
  const raw = await readFile(projectFilePath, 'utf-8')
  const parsed = JSON.parse(raw)
  // Future schema migrations (parsed.schemaVersion -> current) would run here before validation.
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
