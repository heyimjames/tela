// The AI model choices shown in Settings. The Canvas backend
// (`backend_service/.../canvas_ai.py`) maps this string to an LLMLevel by
// keyword — "haiku" → small, "opus" → large, anything else → medium — and never
// forwards the raw id to a provider. So the exact id only needs to carry the
// right keyword; we still use the current, correct model ids for accurate
// labels and future-proofing.

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
