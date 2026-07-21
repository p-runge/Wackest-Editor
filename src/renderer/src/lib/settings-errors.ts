export function settingsFieldIdForErrorMessage(message: string): string | null {
  if (message.includes('OpenAI API-Key')) return 'openai-key'
  if (message.includes('Anthropic API-Key')) return 'anthropic-key'
  return null
}
