import { useState } from 'react'
import { useUIStore, type AppMode } from '@/store/useUIStore'
import { useAIStore } from '@/store/useAIStore'
import { AI_ENABLED } from '@/lib/aiApi'
import { AI_MODELS, normalizeAIModel } from '@/lib/aiModels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SliderField } from '@/components/controls/SliderField'
import {
  X,
  Settings,
  Wand2,
  Palette,
  Mouse,
  Sparkles,
  Shield,
} from 'lucide-react'

type SettingsTab = 'general' | 'ai' | 'canvas' | 'appearance'

export function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen)
  const setOpen = useUIStore((s) => s.setSettingsOpen)
  const [tab, setTab] = useState<SettingsTab>('general')

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      <div
        className="relative bg-white rounded-[12px] shadow-xl w-[700px] max-h-[80vh] overflow-hidden flex"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="w-[200px] bg-card border-r border-border p-3 space-y-1 shrink-0">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium px-3 py-2">
            Settings
          </div>
          {([
            { id: 'general' as SettingsTab, label: 'General', icon: Settings },
            { id: 'ai' as SettingsTab, label: 'AI Assistant', icon: Wand2 },
            { id: 'canvas' as SettingsTab, label: 'Canvas & Tools', icon: Mouse },
            { id: 'appearance' as SettingsTab, label: 'Appearance', icon: Palette },
          ].filter((t) => t.id !== 'ai' || AI_ENABLED)).map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                className={`
                  w-full flex items-center gap-2.5 px-3 py-2 rounded-[5px] text-[13px] transition-colors cursor-pointer
                  ${tab === t.id ? 'bg-primary/10 text-primary font-medium' : 'text-foreground/70 hover:bg-muted/50'}
                `}
                onClick={() => setTab(t.id)}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[17px] font-semibold text-foreground">
              {tab === 'general' ? 'General' : tab === 'ai' ? 'AI Assistant' : tab === 'canvas' ? 'Canvas & Tools' : 'Appearance'}
            </h2>
            <button className="p-1.5 hover:bg-muted rounded-[5px] cursor-pointer transition-[background-color,transform] active:scale-[0.96]" onClick={() => setOpen(false)} aria-label="Close settings">
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          {tab === 'general' && <GeneralSettings />}
          {tab === 'ai' && <AISettings />}
          {tab === 'canvas' && <CanvasSettings />}
          {tab === 'appearance' && <AppearanceSettings />}
        </div>
      </div>
    </div>
  )
}

function GeneralSettings() {
  const appMode = useUIStore((s) => s.appMode)
  const setAppMode = useUIStore((s) => s.setAppMode)

  return (
    <div className="space-y-6">
      {/* Mode selector */}
      <div className="space-y-3">
        <label className="text-[14px] font-medium text-foreground">Editor Mode</label>
        <p className="text-[13px] text-muted-foreground">Choose the level of control you want.</p>

        <div className="grid grid-cols-2 gap-3">
          <button
            className={`
              p-4 rounded-[7px] border-2 text-left transition-[border-color,background-color] cursor-pointer
              ${appMode === 'basic'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-border/80'}
            `}
            onClick={() => setAppMode('basic')}
          >
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-5 h-5 text-primary" />
              <span className="text-[14px] font-semibold">Basic</span>
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Guided experience with templates, auto-alignment, and brand guardrails. Perfect for non-designers.
            </p>
            <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground/70">
              <li>Template-first workflow</li>
              <li>Auto-snap to grid</li>
              <li>Simplified colour palette</li>
              <li>AI copy suggestions</li>
            </ul>
          </button>

          <button
            className={`
              p-4 rounded-[7px] border-2 text-left transition-[border-color,background-color] cursor-pointer
              ${appMode === 'pro'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-border/80'}
            `}
            onClick={() => setAppMode('pro')}
          >
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="text-[14px] font-semibold">Pro</span>
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Full design tool with complete control. Layers, effects, gradients, custom positioning.
            </p>
            <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground/70">
              <li>All tools & layer types</li>
              <li>Free positioning</li>
              <li>OKLCH gradients & effects</li>
              <li>AI design generation</li>
            </ul>
          </button>
        </div>
      </div>

      {/* Auto-save */}
      <div className="space-y-2">
        <label className="text-[14px] font-medium text-foreground">Auto-Save</label>
        <p className="text-[13px] text-muted-foreground">Your work is automatically saved to your browser.</p>
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground/60">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          Auto-save enabled
        </div>
      </div>

      {/* Data */}
      <div className="space-y-2">
        <label className="text-[14px] font-medium text-foreground">Data Storage</label>
        <p className="text-[13px] text-muted-foreground">All data is stored locally in your browser. Nothing is sent to our servers.</p>
        <Button
          variant="outline"
          size="sm"
          className="rounded-[5px]"
          onClick={() => {
            if (confirm('This will clear all projects, designs, and settings. Are you sure?')) {
              // Only clear this app's own keys — the Ads Creator runs as a
              // same-origin iframe inside a host app, so localStorage.clear() would
              // wipe the host app's data too.
              Object.keys(localStorage)
                .filter((k) => k.startsWith('tela-'))
                .forEach((k) => localStorage.removeItem(k))
              window.location.reload()
            }
          }}
        >
          Clear All Data
        </Button>
      </div>
    </div>
  )
}

function AISettings() {
  const model = useAIStore((s) => s.model)
  const productName = useAIStore((s) => s.productName)
  const productDescription = useAIStore((s) => s.productDescription)
  const targetAudience = useAIStore((s) => s.targetAudience)
  const brandVoice = useAIStore((s) => s.brandVoice)
  const callToAction = useAIStore((s) => s.callToAction)
  const setModel = useAIStore((s) => s.setModel)
  const setProductContext = useAIStore((s) => s.setProductContext)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-[14px] font-medium text-foreground">Model</label>
        <select
          className="w-full px-3 py-2 text-[13px] bg-white border border-border rounded-[5px] outline-none cursor-pointer"
          value={normalizeAIModel(model)}
          onChange={(e) => setModel(e.target.value)}
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="border-t border-border pt-6 space-y-4">
        <h3 className="text-[14px] font-medium text-foreground">Product Context</h3>
        <p className="text-[12px] text-muted-foreground">This context is sent with every AI request to ensure copy matches your brand.</p>

        <div className="space-y-3">
          <SettingsField label="Product Name" value={productName} onChange={(v) => setProductContext({ productName: v })} />
          <SettingsTextarea label="Description" value={productDescription} onChange={(v) => setProductContext({ productDescription: v })} />
          <SettingsTextarea label="Target Audience" value={targetAudience} onChange={(v) => setProductContext({ targetAudience: v })} />
          <SettingsTextarea label="Brand Voice" value={brandVoice} onChange={(v) => setProductContext({ brandVoice: v })} />
          <SettingsField label="Default CTA" value={callToAction} onChange={(v) => setProductContext({ callToAction: v })} />
        </div>
      </div>
    </div>
  )
}

function CanvasSettings() {
  const snapToGrid = useUIStore((s) => s.snapToGrid)
  const smartPadding = useUIStore((s) => s.smartPadding)
  const toggleSnap = useUIStore((s) => s.toggleSnap)
  const toggleSmartPadding = useUIStore((s) => s.toggleSmartPadding)

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-[14px] font-medium text-foreground">Snapping</h3>

        <SettingsToggle
          label="Snap to alignment guides"
          description="Layers snap to canvas edges, centres, and other layers"
          value={snapToGrid}
          onChange={toggleSnap}
        />

        <SettingsToggle
          label="Smart padding equalization"
          description="When moving layers inside containers, snap to equal distances from edges"
          value={smartPadding}
          onChange={toggleSmartPadding}
        />
      </div>

      <div className="border-t border-border pt-6 space-y-4">
        <h3 className="text-[14px] font-medium text-foreground">Defaults</h3>
        <p className="text-[12px] text-muted-foreground">Default settings for new elements.</p>

        <div className="grid grid-cols-2 gap-4">
          <div className="text-[12px] text-muted-foreground">
            <span className="block font-medium text-foreground mb-1">Default font size</span>
            32px
          </div>
          <div className="text-[12px] text-muted-foreground">
            <span className="block font-medium text-foreground mb-1">Default border radius</span>
            7px
          </div>
          <div className="text-[12px] text-muted-foreground">
            <span className="block font-medium text-foreground mb-1">Pixel rounding</span>
            Always (whole pixels only)
          </div>
          <div className="text-[12px] text-muted-foreground">
            <span className="block font-medium text-foreground mb-1">Export DPI</span>
            2x default
          </div>
        </div>
      </div>
    </div>
  )
}

function AppearanceSettings() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-[14px] font-medium text-foreground">Theme</h3>
        <p className="text-[12px] text-muted-foreground">Light mode only for now. Dark mode coming soon.</p>
        <div className="flex gap-2">
          <div className="px-4 py-2 bg-foreground text-background rounded-[5px] text-[12px] font-medium">Light</div>
          <div className="px-4 py-2 bg-muted text-muted-foreground rounded-[5px] text-[12px] opacity-50 cursor-not-allowed">Dark (soon)</div>
        </div>
      </div>

      <div className="border-t border-border pt-6 space-y-3">
        <h3 className="text-[14px] font-medium text-foreground">Canvas Background</h3>
        <p className="text-[12px] text-muted-foreground">The grey area around your design.</p>
        <div className="flex gap-2">
          {[
            { label: 'Light', color: '#e8e8e2' },
            { label: 'Medium', color: '#d5d5cc' },
            { label: 'Dark', color: '#8a8a82' },
          ].map((bg) => (
            <button
              key={bg.label}
              className="flex flex-col items-center gap-1 cursor-pointer"
              title={bg.label}
            >
              <div className="w-12 h-8 rounded-[5px] border border-border" style={{ backgroundColor: bg.color }} />
              <span className="text-[10px] text-muted-foreground">{bg.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// --- Shared components ---

function SettingsField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[13px] text-muted-foreground font-normal">{label}</label>
      <Input className="rounded-[5px]" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function SettingsTextarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[13px] text-muted-foreground font-normal">{label}</label>
      <textarea
        className="w-full min-h-[50px] px-3 py-2 text-[13px] bg-white border border-border rounded-[5px] resize-none outline-none focus:ring-1 focus:ring-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function SettingsToggle({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        <p className="text-[12px] text-muted-foreground mt-0.5">{description}</p>
      </div>
      <button
        className={`
          w-10 h-5 rounded-full transition-colors duration-150 cursor-pointer relative shrink-0 mt-0.5
          ${value ? 'bg-primary' : 'bg-muted'}
        `}
        onClick={onChange}
      >
        <div
          className={`
            absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-150
            ${value ? 'translate-x-5' : 'translate-x-0.5'}
          `}
        />
      </button>
    </div>
  )
}
