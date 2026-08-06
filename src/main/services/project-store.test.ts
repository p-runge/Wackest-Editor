import { describe, expect, it } from 'vitest'
import { writeFile, rm, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { readProjectFile } from './project-store'
import { createEmptyProject } from '@shared/types/project'

describe('readProjectFile migration', () => {
  it('migrates a pre-v5 project (no deviceGroups) to a valid v5 project', async () => {
    // Build a valid current project, then strip it back to the v4 shape on disk.
    const v5 = createEmptyProject('Old Project', 'proj-1')
    const v4 = JSON.parse(JSON.stringify(v5)) as Record<string, unknown>
    delete v4.deviceGroups
    v4.schemaVersion = 4

    const dir = await mkdtemp(join(tmpdir(), 'wackest-migration-'))
    const filePath = join(dir, 'project.json')
    try {
      await writeFile(filePath, JSON.stringify(v4), 'utf-8')
      const result = await readProjectFile(filePath)

      expect(result.status).toBe('ok')
      if (result.status === 'ok') {
        expect(result.project.schemaVersion).toBe(5)
        expect(result.project.deviceGroups).toEqual([])
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
