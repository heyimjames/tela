import { useDesignStore } from '@/store/useDesignStore'
import { contrastRatio } from '@/lib/contrast'
import { BrandColorPicker } from '@/components/panels/BrandColorPicker'
import { SliderField } from '@/components/controls/SliderField'
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react'
import { getTextBounds, createMeasureContext } from '@/engine/textMeasure'
import { useIsProMode } from '@/hooks/useIsProMode'
import type { TextLayer, FontWeight, TextWrap, TextSizing, TextRole } from '@/types/design'

const FONT_WEIGHTS: { label: string; value: FontWeight }[] = [
  { label: 'Light', value: 300 },
  { label: 'Regular', value: 400 },
  { label: 'Medium', value: 500 },
  { label: 'Semi', value: 600 },
  { label: 'Bold', value: 700 },
]

const TEXT_TRANSFORMS = [
  { label: 'Aa', value: 'none' as const },
  { label: 'AA', value: 'uppercase' as const },
  { label: 'aa', value: 'lowercase' as const },
]

// A harmonious type scale. In Basic, font sizes snap to these so text sizes
// relate to each other instead of landing on arbitrary values.
const TYPE_SCALE = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 72, 96, 120]
const snapToTypeScale = (v: number) =>
  TYPE_SCALE.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), TYPE_SCALE[0])

interface Props {
  layer: TextLayer
}

export function TextPropertiesPanel({ layer }: Props) {
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)
  const isPro = useIsProMode()

  // Legibility nudge: compare the text colour against a solid frame background.
  const bgHex = useDesignStore((s) => {
    const bg = s.document.layers.find((l) => l.type === 'background')
    return bg && bg.type === 'background' && bg.fill.type === 'solid'
      ? bg.fill.color.hex
      : null
  })
  const contrast = bgHex ? contrastRatio(layer.color.hex, bgHex) : null

  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        Text
      </div>

      {/* Content */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Content</label>
        <textarea
          className="w-full min-h-[60px] px-2 py-1.5 text-[12px] bg-white border border-border rounded-[5px] resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          value={layer.content}
          onChange={(e) => updateLayer<TextLayer>(layer.id, { content: e.target.value })}
          onFocus={() => pushSnapshot()}
        />
      </div>

      {/* Text Role */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Role</label>
        <select
          className="w-full px-2 py-1.5 text-[13px] bg-white border border-border rounded-[5px] outline-none focus:ring-1 focus:ring-ring cursor-pointer"
          value={layer.textRole ?? 'none'}
          onChange={(e) => {
            pushSnapshot()
            updateLayer<TextLayer>(layer.id, { textRole: e.target.value as TextRole })
          }}
        >
          <option value="none">None</option>
          <option value="headline">Headline</option>
          <option value="subheadline">Subheadline</option>
          <option value="body">Body</option>
          <option value="cta">CTA</option>
          <option value="tagline">Tagline</option>
          <option value="job-title">Job Title</option>
          <option value="company">Company</option>
        </select>
      </div>

      {/* Font size */}
      <SliderField
        label="Size"
        value={layer.fontSize}
        min={8}
        max={120}
        step={1}
        format={(v) => `${v}px`}
        // Basic snaps to a harmonious type scale so sizes fit together; Pro is free.
        onChange={(fontSize) => updateLayer<TextLayer>(layer.id, { fontSize: isPro ? fontSize : snapToTypeScale(fontSize) })}
      />

      {/* Font weight */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Weight</label>
        <div className="flex gap-1">
          {FONT_WEIGHTS.map((w) => (
            <button
              key={w.value}
              className={`
                flex-1 py-1 text-[12px] rounded-[5px] transition-colors duration-150
                ${layer.fontWeight === w.value
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'}
              `}
              style={{ fontWeight: w.value }}
              onClick={() => {
                pushSnapshot()
                updateLayer<TextLayer>(layer.id, { fontWeight: w.value })
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alignment */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Alignment</label>
        <div className="flex gap-1">
          {([
            { icon: AlignLeft, value: 'left' as const },
            { icon: AlignCenter, value: 'center' as const },
            { icon: AlignRight, value: 'right' as const },
          ]).map(({ icon: Icon, value }) => (
            <button
              key={value}
              className={`
                p-1.5 rounded-[5px] transition-colors duration-150
                ${layer.textAlign === value
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'}
              `}
              onClick={() => {
                pushSnapshot()
                updateLayer<TextLayer>(layer.id, { textAlign: value })
              }}
              aria-label={`Align ${value}`}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>
      </div>

      {/* Text transform */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Transform</label>
        <div className="flex gap-1">
          {TEXT_TRANSFORMS.map((t) => (
            <button
              key={t.value}
              className={`
                px-3 py-1 text-[11px] rounded-[5px] transition-colors duration-150
                ${layer.textTransform === t.value
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'}
              `}
              onClick={() => {
                pushSnapshot()
                updateLayer<TextLayer>(layer.id, { textTransform: t.value })
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Color */}
      <BrandColorPicker
        label="Color"
        value={layer.color}
        onChange={(color) => {
          pushSnapshot()
          updateLayer<TextLayer>(layer.id, { color })
        }}
      />

      {/* Legibility nudge — inline, not a toast. */}
      {contrast != null && contrast < 4.5 && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-600">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
          Low contrast with background ({contrast.toFixed(1)}:1)
        </div>
      )}

      {/* Letter spacing */}
      <SliderField
        label="Letter Spacing"
        value={layer.letterSpacing}
        min={-0.05}
        max={0.2}
        step={0.005}
        format={(v) => `${v.toFixed(3)}em`}
        onChange={(letterSpacing) => updateLayer<TextLayer>(layer.id, { letterSpacing })}
      />

      {/* Line height */}
      <SliderField
        label="Line Height"
        value={layer.lineHeight}
        min={0.8}
        max={2.5}
        step={0.05}
        format={(v) => v.toFixed(2)}
        onChange={(lineHeight) => updateLayer<TextLayer>(layer.id, { lineHeight })}
      />

      {/* Vertical trim — hug cap→baseline vs keep the font's leading. Toggling
          re-hugs the box height so the change is visible immediately. */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Vertical trim</label>
        <div className="flex gap-1">
          {([
            { label: 'Standard', value: 'standard' as const },
            { label: 'Cap', value: 'cap' as const },
          ]).map((opt) => (
            <button
              key={opt.value}
              className={`
                flex-1 py-1.5 text-[12px] rounded-[5px] transition-colors duration-150 cursor-pointer
                ${(layer.verticalTrim ?? 'cap') === opt.value
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'}
              `}
              onClick={() => {
                pushSnapshot()
                updateLayer<TextLayer>(layer.id, { verticalTrim: opt.value })
                const ctx = createMeasureContext()
                const bounds = getTextBounds(ctx, { ...layer, verticalTrim: opt.value })
                updateLayer<TextLayer>(layer.id, { height: Math.round(bounds.height + (opt.value === 'cap' ? 2 : 4)) })
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Text Decoration */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Decoration</label>
        <div className="flex gap-1">
          <button
            className={`
              px-3 py-1.5 text-[12px] rounded-[5px] transition-colors duration-150 cursor-pointer
              ${layer.underline
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'}
            `}
            style={{ textDecoration: 'underline' }}
            onClick={() => {
              pushSnapshot()
              updateLayer<TextLayer>(layer.id, { underline: !layer.underline })
            }}
          >
            U
          </button>
          <button
            className={`
              px-3 py-1.5 text-[12px] rounded-[5px] transition-colors duration-150 cursor-pointer
              ${layer.strikethrough
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'}
            `}
            style={{ textDecoration: 'line-through' }}
            onClick={() => {
              pushSnapshot()
              updateLayer<TextLayer>(layer.id, { strikethrough: !layer.strikethrough })
            }}
          >
            S
          </button>
        </div>
      </div>

      {/* Vertical Alignment — Pro only */}
      {isPro && (
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Vertical Align</label>
        <div className="flex gap-1">
          {([
            { label: 'Top', value: 'top' as const },
            { label: 'Middle', value: 'middle' as const },
            { label: 'Bottom', value: 'bottom' as const },
          ]).map((opt) => (
            <button
              key={opt.value}
              className={`
                flex-1 py-1.5 text-[12px] rounded-[5px] transition-colors duration-150 cursor-pointer
                ${(layer.verticalAlign ?? 'top') === opt.value
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'}
              `}
              onClick={() => {
                pushSnapshot()
                updateLayer<TextLayer>(layer.id, { verticalAlign: opt.value })
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Text Wrap — Pro only */}
      {isPro && (
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Text Wrap</label>
        <div className="flex gap-1">
          {([
            { label: 'Normal', value: 'normal' as TextWrap },
            { label: 'Pretty', value: 'pretty' as TextWrap },
            { label: 'Balance', value: 'balance' as TextWrap },
          ]).map((opt) => (
            <button
              key={opt.value}
              className={`
                flex-1 py-1.5 text-[12px] rounded-[5px] transition-colors duration-150 cursor-pointer
                ${(layer.textWrap ?? 'pretty') === opt.value
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'}
              `}
              onClick={() => {
                pushSnapshot()
                updateLayer<TextLayer>(layer.id, { textWrap: opt.value })
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Text Sizing — Pro only */}
      {isPro && (
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Sizing</label>
        <div className="flex gap-1">
          {([
            { label: 'Fixed', value: 'fixed' as TextSizing },
            { label: 'Auto W', value: 'auto-width' as TextSizing },
            { label: 'Auto H', value: 'auto-height' as TextSizing },
          ]).map((opt) => (
            <button
              key={opt.value}
              className={`
                flex-1 py-1.5 text-[12px] rounded-[5px] transition-colors duration-150 cursor-pointer
                ${(layer.textSizing ?? 'fixed') === opt.value
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'}
              `}
              onClick={() => {
                pushSnapshot()
                updateLayer<TextLayer>(layer.id, { textSizing: opt.value })

                // Auto-size immediately when switching.
                if (opt.value !== 'fixed') {
                  const ctx = createMeasureContext()
                  if (opt.value === 'auto-width') {
                    // De-wrap: measure the natural (unwrapped) width, not the
                    // current wrapped box, so the text collapses to one line.
                    const bounds = getTextBounds(ctx, { ...layer, width: 100000 })
                    updateLayer<TextLayer>(layer.id, { width: Math.round(bounds.width + 8) })
                  } else {
                    // Auto-height keeps the width and grows/shrinks vertically.
                    const bounds = getTextBounds(ctx, layer)
                    updateLayer<TextLayer>(layer.id, { height: Math.round(bounds.height + 4) })
                  }
                }
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          className="text-[12px] text-primary hover:underline cursor-pointer"
          onClick={() => {
            pushSnapshot()
            const ctx = createMeasureContext()
            // De-wrap to the text's natural size AND lock it to auto-width, so it
            // stays trimmed (one line, hugging the text) as you keep editing.
            const bounds = getTextBounds(ctx, { ...layer, width: 100000 })
            updateLayer<TextLayer>(layer.id, {
              textSizing: 'auto-width',
              width: Math.round(bounds.width + 8),
              height: Math.round(bounds.height + 4),
            })
          }}
        >
          Trim to text
        </button>
      </div>
      )}

      {/* Position, Size, Opacity, Rotation are in PositionSizePanel */}
    </div>
  )
}
