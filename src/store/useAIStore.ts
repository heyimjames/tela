import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { postCanvasAI } from '@/lib/aiApi'
import { DEFAULT_AI_MODEL } from '@/lib/aiModels'
import { BRAND } from '@/brand/brand.config'
import { useDesignStore } from '@/store/useDesignStore'
import { applyDesignJson, serializeLayersForAI } from '@/engine/applyDesignJson'

interface AIStore {
  // API config — the provider key lives on your own proxy endpoint, never in the
  // browser (see lib/aiApi.ts); only the model choice is client-side.
  model: string

  // Context for AI generation
  productName: string
  productDescription: string
  targetAudience: string
  brandVoice: string
  callToAction: string

  // State
  isGenerating: boolean
  lastError: string | null

  // Actions
  setModel: (model: string) => void
  setProductContext: (updates: Partial<Pick<AIStore, 'productName' | 'productDescription' | 'targetAudience' | 'brandVoice' | 'callToAction'>>) => void
  setIsGenerating: (v: boolean) => void
  setLastError: (err: string | null) => void
}

export const useAIStore = create<AIStore>()(
  persist(
    (set) => ({
      model: DEFAULT_AI_MODEL,

      productName: BRAND.productName,
      productDescription: BRAND.ai.productDescription,
      targetAudience: BRAND.ai.targetAudience,
      brandVoice: BRAND.ai.brandVoice,
      callToAction: BRAND.ai.callToAction,

      isGenerating: false,
      lastError: null,

      setModel: (model) => set({ model }),
      setProductContext: (updates) => set((s) => ({ ...s, ...updates })),
      setIsGenerating: (v) => set({ isGenerating: v }),
      setLastError: (err) => set({ lastError: err }),
    }),
    {
      name: 'tela-ai',
      partialize: (state) => ({
        model: state.model,
        productName: state.productName,
        productDescription: state.productDescription,
        targetAudience: state.targetAudience,
        brandVoice: state.brandVoice,
        callToAction: state.callToAction,
      }),
    },
  ),
)

// --- AI API call ---

async function completeCanvasAI(options: {
  model: string
  system: string
  prompt: string
  maxTokens: number
}): Promise<string> {
  const response = await postCanvasAI({
    model: options.model,
    system: options.system,
    messages: [{ role: 'user', content: options.prompt }],
    maxTokens: options.maxTokens,
    stream: false,
  })
  const data = await response.json()
  return data.text ?? ''
}

export async function generateCopy(options: {
  model: string
  prompt: string
  productContext: {
    productName: string
    productDescription: string
    targetAudience: string
    brandVoice: string
    callToAction: string
  }
}): Promise<string> {
  const systemPrompt = `You are an expert ad copywriter and marketing strategist. Write compelling, concise ad copy.

Product: ${options.productContext.productName}
Description: ${options.productContext.productDescription}
Target Audience: ${options.productContext.targetAudience}
Brand Voice: ${options.productContext.brandVoice}
Default CTA: ${options.productContext.callToAction}

Rules:
- Be concise — ads have limited space
- Write for the target audience
- Match the brand voice exactly
- No hashtags unless asked
- No emojis unless asked
- Return ONLY the copy text, nothing else`

  return completeCanvasAI({
    model: options.model,
    system: systemPrompt,
    prompt: options.prompt,
    maxTokens: 300,
  })
}

export async function generateAdDesign(options: {
  model: string
  prompt: string
  format: { width: number; height: number; label: string }
  productContext: {
    productName: string
    productDescription: string
    targetAudience: string
    brandVoice: string
    callToAction: string
  }
}): Promise<string> {
  const systemPrompt = `You are an expert ad designer. Generate JSON layouts for ads.

Product: ${options.productContext.productName}
Description: ${options.productContext.productDescription}
Target Audience: ${options.productContext.targetAudience}
Brand Voice: ${options.productContext.brandVoice}
CTA: ${options.productContext.callToAction}

Canvas size: ${options.format.width}x${options.format.height} (${options.format.label})

Available brand colors (use ONLY these):
- charcoal: #100f0f (dark text)
- white: #ffffff
- cloud: #f8f8f3 (light bg)
- paper: #f2f2eb
- brand-dark: #3e4576 (dark blue bg)
- brand-primary: #0017c7 (links, accents)
- brand-accent: #d0e6e8 (light teal)
- ember-500: #F56139 (CTA orange)

Return a JSON array of layers. Each layer is one of:
- Text: { "type": "text", "name": "string", "x": number, "y": number, "width": number, "height": number, "content": "string", "fontSize": number, "fontWeight": 300|400|500|600|700, "textAlign": "left"|"center"|"right", "colorToken": "charcoal"|"white"|"brand-primary"|"ember-500", "letterSpacing": number, "lineHeight": number, "textTransform": "none"|"uppercase" }
- Shape: { "type": "shape", "name": "string", "x": number, "y": number, "width": number, "height": number, "shape": "rectangle"|"ellipse"|"pill", "colorToken": "brand-dark"|"ember-500"|"brand-accent", "borderRadius": 0|5|7|12|9999 }

The FIRST layer should be a full-canvas rectangle as the background color.
Position elements with proper spacing (40-80px padding from edges).
Use clear visual hierarchy: large headline, smaller subtext, prominent CTA.

Return ONLY valid JSON array, no markdown, no explanation.`

  return completeCanvasAI({
    model: options.model,
    system: systemPrompt,
    prompt: options.prompt,
    maxTokens: 2000,
  })
}

export async function relayoutForFormat(options: {
  model: string
  layers: unknown[]
  format: { width: number; height: number; label: string }
}): Promise<string> {
  const systemPrompt = `You are an expert ad designer adapting an existing design to a new canvas size.

You are given a design's existing layers (their content and styling) and must
RE-COMPOSE them to fit a new canvas. Preserve the content, copy, colours, and
intent — do not invent new copy or drop anything. Re-position, re-size, and
re-align everything so it looks intentional and balanced on the new dimensions:
clear visual hierarchy, 40-80px padding from edges, no overlaps, nothing
off-canvas. A tall element from a portrait design should become a wide one in a
landscape banner, etc.

New canvas: ${options.format.width}x${options.format.height} (${options.format.label})

Existing layers to adapt:
${JSON.stringify(options.layers, null, 2)}

Available brand colours (reuse the colorToken values already present): charcoal, white, cloud, paper, brand-dark, brand-primary, brand-accent, ember-500.

Return a JSON array of layers for the NEW canvas. Each layer is one of:
- Text: { "type":"text","name","x","y","width","height","content","fontSize","fontWeight":300|400|500|600|700,"textAlign":"left"|"center"|"right","colorToken","letterSpacing","lineHeight","textTransform":"none"|"uppercase" }
- Shape: { "type":"shape","name","x","y","width","height","shape":"rectangle"|"ellipse"|"pill","colorToken","borderRadius" }
The FIRST layer should be a full-canvas rectangle for the background colour.
Return ONLY the JSON array, no markdown, no explanation.`

  return completeCanvasAI({
    model: options.model,
    system: systemPrompt,
    prompt: 'Re-layout the design for the new canvas.',
    maxTokens: 2000,
  })
}

/**
 * Re-layout the ACTIVE frame's current content for its current format via the
 * LLM. The frame is expected to already be at the target format (the
 * deterministic reflow runs on format change); this replaces that safe layout
 * with an AI composition. Returns false if there's no content or parsing fails.
 * Exposed to agents through the command bus (op: relayoutFrame).
 */
export async function relayoutActiveFrame(): Promise<boolean> {
  const d = useDesignStore.getState()
  const format = d.document.format
  const layers = serializeLayersForAI(d.document.layers)
  if (layers.length === 0) return false
  const result = await relayoutForFormat({
    model: useAIStore.getState().model,
    layers,
    format: { width: format.width, height: format.height, label: format.label },
  })
  return applyDesignJson(result)
}
