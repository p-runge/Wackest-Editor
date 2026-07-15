import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { ProjectSchema, type Project } from '@shared/types/project'

export async function saveProject(projectDir: string, project: Project): Promise<void> {
  await mkdir(projectDir, { recursive: true })
  await mkdir(join(projectDir, 'cache'), { recursive: true })

  const validated = ProjectSchema.parse({
    ...project,
    updatedAt: new Date().toISOString()
  })

  await writeFile(join(projectDir, 'project.json'), JSON.stringify(validated, null, 2), 'utf-8')
}

export async function loadProject(projectFilePath: string): Promise<Project> {
  const raw = await readFile(projectFilePath, 'utf-8')
  const parsed = JSON.parse(raw)
  // Future schema migrations (parsed.schemaVersion -> current) would run here before validation.
  return ProjectSchema.parse(parsed)
}
