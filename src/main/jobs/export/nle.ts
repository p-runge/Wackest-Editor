import { writeFile } from 'fs/promises'
import { buildMulticamTimeline } from './nle-timeline'
import { serializeFcp7Xml } from './fcp7xml'
import type { Project } from '@shared/types/project'
import type { ExportFormat } from '@shared/types/ipc'

/**
 * Writes a non-destructive NLE interchange file (raw multicam, FCP7 XML) referencing the original
 * media. Unlike the MP4 export this does no encoding — it just builds the neutral timeline and
 * serializes it — so it completes near-instantly.
 */
export async function runNleExportForProject(
  project: Project,
  outputPath: string,
  format: Exclude<ExportFormat, 'mp4'>
): Promise<void> {
  let content: string
  switch (format) {
    case 'fcp7xml':
      content = serializeFcp7Xml(buildMulticamTimeline(project))
      break
  }

  await writeFile(outputPath, content, 'utf-8')
}
