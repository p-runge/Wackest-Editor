import { z } from 'zod'

export const RecentProjectSchema = z.object({
  projectDir: z.string(),
  name: z.string(),
  lastOpenedAt: z.string()
})
export type RecentProject = z.infer<typeof RecentProjectSchema>

export const AppSettingsSchema = z.object({
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  whisperCppModelPath: z.string().optional(),
  recentProjects: z.array(RecentProjectSchema).default([])
})
export type AppSettings = z.infer<typeof AppSettingsSchema>

export function createDefaultSettings(): AppSettings {
  return { recentProjects: [] }
}

const MAX_RECENT_PROJECTS = 8

/** Moves/creates `entry` to the front, deduped by projectDir, capped at MAX_RECENT_PROJECTS. */
export function withRecentProject(
  recentProjects: RecentProject[],
  entry: RecentProject
): RecentProject[] {
  const rest = recentProjects.filter((p) => p.projectDir !== entry.projectDir)
  return [entry, ...rest].slice(0, MAX_RECENT_PROJECTS)
}

export function withoutRecentProject(
  recentProjects: RecentProject[],
  projectDir: string
): RecentProject[] {
  return recentProjects.filter((p) => p.projectDir !== projectDir)
}
