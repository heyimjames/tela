import { useState, useRef, useEffect, useCallback } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useAIStore, generateCopy, generateAdDesign } from '@/store/useAIStore'
import { getBrandColor } from '@/brand/palette'
import { Sparkles, Loader2, X, Wand2 } from 'lucide-react'
import type { TextLayer, ShapeLayer, BackgroundLayer } from '@/types/design'

export function InlineAIPrompt() {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'design' | 'edit'>('design')
  const [status, setStatus] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const activeLayerId = useDesignStore((s) => s.activeLayerId)
  const format = useDesignStore((s) => s.document.format)

  // Cmd+I to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault()

        // If a text layer is selected, default to edit mode
        const state = useDesignStore.getState()
        const activeLayer = state.activeLayerId ? state.getLayer(state.activeLayerId) : null
        if (activeLayer?.type === 'text') {
          setMode('edit')
          setPrompt('')
        } else {
          setMode('design')
          setPrompt('')
        }

        setOpen(true)
        setStatus('')
        setTimeout(() => inputRef.current?.focus(), 50)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) return
    setLoading(true)

    const aiStore = useAIStore.getState()
    const store = useDesignStore.getState()
    const productContext = {
      productName: aiStore.productName,
      productDescription: aiStore.productDescription,
      targetAudience: aiStore.targetAudience,
      brandVoice: aiStore.brandVoice,
      callToAction: aiStore.callToAction,
    }

    try {
      if (mode === 'edit' && activeLayerId) {
        // Edit selected layer
        const layer = store.getLayer(activeLayerId)
        if (layer?.type === 'text') {
          setStatus('Writing copy...')
          const copy = await generateCopy({
            model: aiStore.model,
            prompt: prompt,
            productContext,
          })
          store.pushSnapshot()
          store.updateLayer<TextLayer>(activeLayerId, { content: copy })
          setStatus('Done')
        }
      } else {
        // Generate full design
        setStatus('Designing ad...')
        const jsonStr = await generateAdDesign({
          model: aiStore.model,
          prompt: prompt,
          format: { width: format.width, height: format.height, label: format.label },
          productContext,
        })

        const cleanJson = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
        const layers = JSON.parse(cleanJson)

        if (!Array.isArray(layers)) throw new Error('Invalid response')

        store.pushSnapshot()
        setStatus('Adding layers...')

        // Remove existing non-background layers
        const existing = store.document.layers.filter((l) => l.type !== 'background')
        for (const l of existing) {
          store.removeLayer(l.id)
        }

        // Add layers one by one with slight delay for visual effect
        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i]
          setStatus(`Adding layer ${i + 1}/${layers.length}...`)

          if (layer.type === 'text') {
            store.addLayer({
              type: 'text',
              name: layer.name || 'AI Text',
              visible: true, locked: false, opacity: 1,
              x: layer.x, y: layer.y, width: layer.width, height: layer.height,
              rotation: 0,
              content: layer.content,
              fontSize: layer.fontSize || 32,
              fontWeight: layer.fontWeight || 400,
              textAlign: layer.textAlign || 'left',
              color: getBrandColor(layer.colorToken || 'charcoal'),
              letterSpacing: layer.letterSpacing ?? -0.01,
              lineHeight: layer.lineHeight ?? 1.2,
              textTransform: layer.textTransform || 'none',
              textWrap: 'pretty',
              textSizing: 'fixed',
              textRole: 'none',
              verticalAlign: 'top',
            } as Omit<TextLayer, 'id' | 'zIndex'>)
          } else if (layer.type === 'shape') {
            if (layer.x === 0 && layer.y === 0 && layer.width >= format.width * 0.9 && layer.height >= format.height * 0.9) {
              const bgLayer = store.document.layers.find((l) => l.type === 'background')
              if (bgLayer) {
                store.updateLayer<BackgroundLayer>(bgLayer.id, {
                  fill: { type: 'solid', color: getBrandColor(layer.colorToken || 'cloud') },
                })
              }
            } else {
              store.addLayer({
                type: 'shape',
                name: layer.name || 'AI Shape',
                visible: true, locked: false, opacity: 1,
                x: layer.x, y: layer.y, width: layer.width, height: layer.height,
                rotation: 0,
                shape: layer.shape || 'rectangle',
                fill: getBrandColor(layer.colorToken || 'brand-dark'),
                borderRadius: layer.borderRadius ?? 7,
              } as Omit<ShapeLayer, 'id' | 'zIndex'>)
            }
          }

          // Small delay between layers for visual streaming effect
          await new Promise((r) => setTimeout(r, 100))
        }

        setStatus(`Done — ${layers.length} layers created`)
      }
    } catch (err: any) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setLoading(false)
      setTimeout(() => setOpen(false), 1500)
    }
  }, [prompt, mode, activeLayerId, format])

  if (!open) return null

  const activeLayer = activeLayerId ? useDesignStore.getState().getLayer(activeLayerId) : null
  const isEditMode = mode === 'edit' && activeLayer?.type === 'text'

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 w-[min(560px,calc(100vw-1.5rem))]">
      <div className="bg-white border border-border rounded-[12px] shadow-[0_8px_30px_-4px_rgba(17,17,17,0.15)] overflow-hidden">
        {/* Mode indicator */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-[12px] font-medium text-foreground">
            {isEditMode ? `Edit: ${(activeLayer as TextLayer).content.slice(0, 30)}...` : 'AI Design'}
          </span>
          <button aria-label="Close" className="ml-auto p-1 hover:bg-muted rounded-[3px] cursor-pointer" onClick={() => setOpen(false)}>
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Prompt input */}
        <div className="flex items-center gap-2 px-4 pb-3">
          <input
            ref={inputRef}
            className="flex-1 text-[14px] text-foreground bg-transparent outline-none placeholder:text-muted-foreground/40 py-1"
            placeholder={isEditMode
              ? 'Describe how to change this text...'
              : 'Describe the ad you want to create...'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
              e.stopPropagation()
            }}
            disabled={loading}
          />
          <button
            aria-label={isEditMode ? 'Generate copy' : 'Generate design'}
            className={`
              p-2 rounded-[5px] transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer
              ${loading ? 'bg-muted text-muted-foreground' : 'bg-primary text-white hover:bg-primary/90'}
            `}
            onClick={handleSubmit}
            disabled={loading || !prompt.trim()}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          </button>
        </div>

        {/* Status */}
        {status && (
          <div className="px-4 pb-3 text-[12px] text-muted-foreground">
            {status}
          </div>
        )}

        {/* Quick suggestions */}
        {!loading && !status && !isEditMode && (
          <div className="px-4 pb-3 flex flex-wrap gap-1.5">
            {[
              'Hiring ad for engineers',
              'Stat callout: 93% placement rate',
              'Employee testimonial card',
              'Bold story with CTA',
            ].map((s) => (
              <button
                key={s}
                className="px-2.5 py-1 text-[11px] bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground rounded-full transition-colors cursor-pointer"
                onClick={() => { setPrompt(s); inputRef.current?.focus() }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
