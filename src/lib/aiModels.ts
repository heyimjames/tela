// The AI model choices shown in Settings. This id is sent to your AI endpoint
// (see lib/aiApi.ts) as the `model` field; how it maps to a concrete provider
// model is up to your proxy. The default ids are current, correct model names.

export interface AIModelOption {
  id: string
  label: string
}

export const AI_MODELS: AIModelOption[] = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — balanced (recommended)' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — best quality' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest' },
]

export const DEFAULT_AI_MODEL = 'claude-sonnet-5'

/**
 * Map any persisted or legacy model id to a current option, so the Settings
 * dropdown always shows a valid selection (old stored ids like
 * `claude-sonnet-4-6-20250627` still route correctly on the backend, but aren't
 * in the list). Matches the backend's keyword routing.
 */
export function normalizeAIModel(id: string): string {
  if (AI_MODELS.some((m) => m.id === id)) return id
  const hint = id.toLowerCase()
  if (hint.includes('haiku')) return 'claude-haiku-4-5'
  if (hint.includes('opus')) return 'claude-opus-4-8'
  return DEFAULT_AI_MODEL
}
