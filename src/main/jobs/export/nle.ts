import { writeFile } from 'fs/promises'
import { buildCutTimeline, buildMulticamTimeline } from './nle-timeline'
import { serializeFcp7Xml } from './fcp7xml'
import type { Project } from '@shared/types/project'
import type { ExportFormat } from '@shared/types/ipc'

/**
 * Writes a non-destructive NLE interchange file referencing the original media for the given format.
 * Unlike the MP4 export this does no encoding — it just builds the neutral timeline and serializes
 * it — so it completes near-instantly. Both current formats serialize to FCP7 XML; they differ only
 * in timeline layout (finished cut vs. raw parallel multicam).
 */
export async function runNleExportForProject(
  project: Project,
  outputPath: string,
  format: Exclude<ExportFormat, 'mp4'>
): Promise<void> {
  let content: string
  switch (format) {
    case 'fcp7xml':
      content = serializeFcp7Xml(buildCutTimeline(project))
      break
    case 'fcp7xml-multicam':
      content = serializeFcp7Xml(buildMulticamTimeline(project))
      break
  }

  await writeFile(outputPath, content, 'utf-8')
}
