import { z } from 'zod'

export const AppSettingsSchema = z.object({
  openaiApiKey: z.string().optional(),
  whisperCppBinaryPath: z.string().optional(),
  whisperCppModelPath: z.string().optional()
})
export type AppSettings = z.infer<typeof AppSettingsSchema>

export function createDefaultSettings(): AppSettings {
  return {}
}
