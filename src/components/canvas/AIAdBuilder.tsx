import { useState } from 'react'
import { useAIStore, generateAdDesign } from '@/store/useAIStore'
import { applyDesignJson } from '@/engine/applyDesignJson'
import { useDesignStore } from '@/store/useDesignStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useUIStore } from '@/store/useUIStore'
import { getBrandColor } from '@/brand/palette'
import {
  Sparkles,
  ChevronDown,
  Loader2,
  Menu,
  EyeOff,
  Palette,
  Eraser,
  Scissors,
  X,
} from 'lucide-react'
import type { TextLayer, ShapeLayer, BackgroundLayer } from '@/types/design'

type StyleApproach = 'variety' | 'minimal' | 'bold' | 'corporate' | 'playful'

const STYLE_OPTIONS: { value: StyleApproach; label: string }[] = [
  { value: 'variety', label: 'Variety pack' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'bold', label: 'Bold' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'playful', label: 'Playful' },
]

const STYLE_PROMPTS: Record<StyleApproach, string> = {
  variety: 'Create a unique design with your own creative direction.',
  minimal: 'Use a minimal design approach: lots of whitespace, simple typography, restrained color palette, subtle hierarchy.',
  bold: 'Use a bold design approach: large text, strong contrasts, vibrant fills, impactful visual weight.',
  corporate: 'Use a corporate design approach: clean lines, professional color palette (brand-dark, white), structured grid, formal hierarchy.',
  playful: 'Use a playful design approach: dynamic layout, rounded shapes, warm accent colors (ember-500, brand-accent), friendly tone.',
}

function buildPromptForVersion(userPrompt: string, style: StyleApproach, versionIndex: number, totalVersions: number): string {
  const base = userPrompt.trim() || 'Design a compelling ad for this product.'
  const styleInstruction = STYLE_PROMPTS[style]

  if (totalVersions === 1) {
    return `${base}\n\n${styleInstruction}`
  }

  if (style === 'variety') {
    const angles = ['minimal and clean', 'bold and impactful', 'corporate and professional', 'playful and energetic']
    const angle = angles[versionIndex % angles.length]
    return `${base}\n\nDesign version ${versionIndex + 1} of ${totalVersions}. Use a ${angle} design approach. Make it distinctly different from other versions.`
  }

  return `${base}\n\n${styleInstruction}\nThis is version ${versionIndex + 1} of ${totalVersions}. Vary the layout and copy while keeping the same style.`
}


export function AIAdBuilder() {
  const rightPanel = useUIStore((s) => s.rightPanel)
  const isVisible = rightPanel === 'ai'

  const [prompt, setPrompt] = useState('')
  const [versions, setVersions] = useState(1)
  const [style, setStyle] = useState<StyleApproach>('variety')
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)

  if (!isVisible) return null

  const handleGenerate = async () => {
    setIsGenerating(true)
    setError(null)

    const ai = useAIStore.getState()
    const format = useDesignStore.getState().document.format

    try {
      for (let i = 0; i < versions; i++) {
        setProgress(versions > 1 ? `Generating version ${i + 1} of ${versions}...` : 'Generating...')

        const fullPrompt = buildPromptForVersion(prompt, style, i, versions)
        const result = await generateAdDesign({
          model: ai.model,
          prompt: fullPrompt,
          format: { width: format.width, height: format.height, label: format.label },
          productContext: {
            productName: ai.productName,
            productDescription: ai.productDescription,
            targetAudience: ai.targetAudience,
            brandVoice: ai.brandVoice,
            callToAction: ai.callToAction,
          },
        })

        if (i === 0) {
          // Apply first version to current canvas
          const success = applyDesignJson(result)
          if (!success) {
            setError('Failed to parse AI design output. Try again.')
            break
          }
        } else {
          // Additional versions: create new frames in workspace
          const ws = useWorkspaceStore.getState()
          ws.addFrame(format, undefined, `Version ${i + 1}`)
          // Apply the design to the current canvas
          applyDesignJson(result)
        }
      }

      setProgress(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
      setProgress(null)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-40 w-[560px] max-w-[calc(100vw-2rem)]">
      <div className="bg-card border border-border rounded-[10px] shadow-[0_8px_30px_-4px_rgba(17,17,17,0.15)] overflow-hidden">
        {/* Error display */}
        {error && (
          <div className="px-4 py-2 bg-destructive/10 text-destructive text-[12px] flex items-center justify-between">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError(null)} className="p-0.5 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Progress display */}
        {progress && (
          <div className="px-4 py-2 bg-primary/5 text-primary text-[12px] flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {progress}
          </div>
        )}

        {/* Main input row */}
        <div className="flex items-center gap-2 p-2.5">
          {/* Hamburger menu */}
          <div className="relative">
            <button
              aria-label="More actions"
              className="p-2 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Menu className="w-[18px] h-[18px]" />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-[-1]" onClick={() => setMenuOpen(false)} />
                <div className="absolute bottom-full left-0 mb-1 bg-card border border-border rounded-[7px] shadow-[0_8px_30px_-4px_rgba(17,17,17,0.12)] py-1 min-w-[180px] z-50">
                  {[
                    { icon: Scissors, label: 'Vectorize', action: () => {} },
                    { icon: Palette, label: 'Extract colors', action: () => {} },
                    { icon: Eraser, label: 'Remove background', action: () => {} },
                    { icon: EyeOff, label: 'Hide other UI', action: () => {} },
                  ].map((item) => (
                    <button
                      key={item.label}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-foreground/80 hover:bg-muted/50 transition-colors cursor-pointer text-left"
                      onClick={() => { item.action(); setMenuOpen(false) }}
                    >
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Prompt input */}
          <input
            className="flex-1 px-3 py-2 text-[13px] bg-muted/30 border-none rounded-[6px] outline-none focus:bg-muted/50 transition-colors placeholder:text-muted-foreground/50"
            placeholder="Describe the ad you want..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !isGenerating) {
                e.preventDefault()
                handleGenerate()
              }
            }}
            disabled={isGenerating}
          />

          {/* Version count dropdown */}
          <div className="relative">
            <button
              className="flex items-center gap-1 px-2.5 py-2 text-[12px] text-muted-foreground bg-muted/30 rounded-[6px] hover:bg-muted/50 transition-colors cursor-pointer min-w-[48px] justify-center"
              onClick={() => setVersionsOpen(!versionsOpen)}
            >
              {versions}x
              <ChevronDown className="w-3 h-3" />
            </button>
            {versionsOpen && (
              <>
                <div className="fixed inset-0 z-[-1]" onClick={() => setVersionsOpen(false)} />
                <div className="absolute bottom-full right-0 mb-1 bg-card border border-border rounded-[7px] shadow-[0_8px_30px_-4px_rgba(17,17,17,0.12)] py-1 min-w-[80px] z-50">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors cursor-pointer ${versions === n ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-muted/50'}`}
                      onClick={() => { setVersions(n); setVersionsOpen(false) }}
                    >
                      {n} version{n > 1 ? 's' : ''}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Style dropdown */}
          <div className="relative">
            <button
              className="flex items-center gap-1 px-2.5 py-2 text-[12px] text-muted-foreground bg-muted/30 rounded-[6px] hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => setStyleOpen(!styleOpen)}
            >
              {STYLE_OPTIONS.find((s) => s.value === style)?.label}
              <ChevronDown className="w-3 h-3" />
            </button>
            {styleOpen && (
              <>
                <div className="fixed inset-0 z-[-1]" onClick={() => setStyleOpen(false)} />
                <div className="absolute bottom-full right-0 mb-1 bg-card border border-border rounded-[7px] shadow-[0_8px_30px_-4px_rgba(17,17,17,0.12)] py-1 min-w-[140px] z-50">
                  {STYLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors cursor-pointer ${style === opt.value ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-muted/50'}`}
                      onClick={() => { setStyle(opt.value); setStyleOpen(false) }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Generate button */}
          <button
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-[13px] font-medium rounded-[6px] hover:bg-primary/90 transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {isGenerating ? 'Creating...' : 'Create Ad'}
          </button>
        </div>
      </div>
    </div>
  )
}
