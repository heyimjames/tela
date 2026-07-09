import { useState } from 'react'
import { useRouterStore } from '@/store/useRouterStore'
import { useUIStore, type AppMode } from '@/store/useUIStore'
import { useAIStore } from '@/store/useAIStore'
import { AI_MODELS, normalizeAIModel } from '@/lib/aiModels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ArrowLeft,
  Settings,
  Wand2,
  Mouse,
  Palette,
  Shield,
  Sparkles,
} from 'lucide-react'

type Tab = 'general' | 'ai' | 'canvas' | 'appearance'

export function SettingsPage() {
  const navigate = useRouterStore((s) => s.navigate)
  const [tab, setTab] = useState<Tab>('general')

  return (
    <div className="h-dvh flex bg-background">
      {/* Sidebar */}
      <aside className="w-[240px] bg-card border-r border-border flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-border">
          <button
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={() => navigate({ page: 'library' })}
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-[14px] font-medium">Back to Files</span>
          </button>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          <h2 className="px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/50 font-medium">Settings</h2>
          {([
            { id: 'general' as Tab, label: 'General', icon: Settings },
            { id: 'ai' as Tab, label: 'AI Assistant', icon: Wand2 },
            { id: 'canvas' as Tab, label: 'Canvas & Tools', icon: Mouse },
            { id: 'appearance' as Tab, label: 'Appearance', icon: Palette },
          ]).map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[5px] text-[14px] transition-colors cursor-pointer ${tab === t.id ? 'bg-muted/60 text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/30'}`}
                onClick={() => setTab(t.id)}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[640px] mx-auto px-8 py-8">
          {tab === 'general' && <GeneralSettings />}
          {tab === 'ai' && <AISettings />}
          {tab === 'canvas' && <CanvasSettings />}
          {tab === 'appearance' && <AppearanceSettings />}
        </div>
      </main>
    </div>
  )
}

function GeneralSettings() {
  const appMode = useUIStore((s) => s.appMode)
  const setAppMode = useUIStore((s) => s.setAppMode)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[24px] font-semibold text-foreground mb-1">General</h1>
        <p className="text-[14px] text-muted-foreground">Manage your workspace preferences.</p>
      </div>

      <div className="space-y-3">
        <h3 className="text-[16px] font-medium text-foreground">Editor Mode</h3>
        <p className="text-[14px] text-muted-foreground">Choose the level of control you want.</p>
        <div className="grid grid-cols-2 gap-4">
          <ModeCard
            icon={Shield}
            title="Basic"
            description="Guided experience with templates, auto-alignment, and brand guardrails."
            features={['Template-first workflow', 'Auto-snap to grid', 'Simplified palette', 'AI copy suggestions']}
            active={appMode === 'basic'}
            onClick={() => setAppMode('basic')}
          />
          <ModeCard
            icon={Sparkles}
            title="Pro"
            description="Full design tool with complete control over every detail."
            features={['All tools & layer types', 'Free positioning', 'OKLCH gradients & effects', 'AI design generation']}
            active={appMode === 'pro'}
            onClick={() => setAppMode('pro')}
          />
        </div>
      </div>

      <div className="space-y-2 pt-4 border-t border-border">
        <h3 className="text-[16px] font-medium text-foreground">Data</h3>
        <p className="text-[14px] text-muted-foreground">All data is stored locally in your browser.</p>
        <Button
          variant="outline"
          className="rounded-[5px]"
          onClick={() => {
            if (confirm('Clear all projects, designs, and settings?')) {
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
  const store = useAIStore()
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[24px] font-semibold text-foreground mb-1">AI Assistant</h1>
        <p className="text-[14px] text-muted-foreground">Configure AI-powered copywriting and design generation.</p>
      </div>

      <div className="space-y-3">
        <h3 className="text-[16px] font-medium">Model</h3>
        <select className="w-full px-3 py-2 text-[14px] bg-white border border-border rounded-[5px] cursor-pointer" value={normalizeAIModel(store.model)} onChange={(e) => store.setModel(e.target.value)}>
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-4 pt-4 border-t border-border">
        <h3 className="text-[16px] font-medium">Product Context</h3>
        <p className="text-[13px] text-muted-foreground">This context is sent with every AI request.</p>
        <SettingsField label="Product Name" value={store.productName} onChange={(v) => store.setProductContext({ productName: v })} />
        <SettingsTextarea label="Description" value={store.productDescription} onChange={(v) => store.setProductContext({ productDescription: v })} />
        <SettingsTextarea label="Target Audience" value={store.targetAudience} onChange={(v) => store.setProductContext({ targetAudience: v })} />
        <SettingsTextarea label="Brand Voice" value={store.brandVoice} onChange={(v) => store.setProductContext({ brandVoice: v })} />
        <SettingsField label="Default CTA" value={store.callToAction} onChange={(v) => store.setProductContext({ callToAction: v })} />
      </div>
    </div>
  )
}

function CanvasSettings() {
  const snap = useUIStore((s) => s.snapToGrid)
  const padding = useUIStore((s) => s.smartPadding)
  const toggleSnap = useUIStore((s) => s.toggleSnap)
  const togglePadding = useUIStore((s) => s.toggleSmartPadding)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[24px] font-semibold text-foreground mb-1">Canvas & Tools</h1>
        <p className="text-[14px] text-muted-foreground">Configure canvas behavior and defaults.</p>
      </div>

      <div className="space-y-4">
        <Toggle label="Snap to alignment guides" desc="Layers snap to canvas edges, centres, and other layers" value={snap} onChange={toggleSnap} />
        <Toggle label="Smart padding" desc="Equalize distances to edges when inside containers" value={padding} onChange={togglePadding} />
      </div>
    </div>
  )
}

function AppearanceSettings() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[24px] font-semibold text-foreground mb-1">Appearance</h1>
        <p className="text-[14px] text-muted-foreground">Customize how the app looks.</p>
      </div>
      <div className="space-y-3">
        <h3 className="text-[16px] font-medium">Theme</h3>
        <div className="flex gap-3">
          <div className="px-4 py-2 bg-foreground text-background rounded-[5px] text-[13px] font-medium">Light</div>
          <div className="px-4 py-2 bg-muted text-muted-foreground rounded-[5px] text-[13px] opacity-50 cursor-not-allowed">Dark (soon)</div>
        </div>
      </div>
    </div>
  )
}

// Shared components

function ModeCard({ icon: Icon, title, description, features, active, onClick }: { icon: React.ElementType; title: string; description: string; features: string[]; active: boolean; onClick: () => void }) {
  return (
    <button className={`p-5 rounded-[7px] border-2 text-left transition-[border-color,background-color] cursor-pointer ${active ? 'border-primary bg-primary/5' : 'border-border hover:border-border/80'}`} onClick={onClick}>
      <div className="flex items-center gap-2 mb-2"><Icon className="w-5 h-5 text-primary" /><span className="text-[15px] font-semibold">{title}</span></div>
      <p className="text-[13px] text-muted-foreground leading-relaxed mb-3">{description}</p>
      <ul className="space-y-1">{features.map((f) => <li key={f} className="text-[12px] text-muted-foreground/70">• {f}</li>)}</ul>
    </button>
  )
}

function SettingsField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div className="space-y-1.5"><label className="text-[14px] text-muted-foreground">{label}</label><Input className="rounded-[5px]" value={value} onChange={(e) => onChange(e.target.value)} /></div>
}

function SettingsTextarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div className="space-y-1.5"><label className="text-[14px] text-muted-foreground">{label}</label><textarea className="w-full min-h-[60px] px-3 py-2 text-[14px] bg-white border border-border rounded-[5px] resize-none outline-none focus:ring-1 focus:ring-ring" value={value} onChange={(e) => onChange(e.target.value)} /></div>
}

function Toggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div><span className="text-[14px] font-medium text-foreground">{label}</span><p className="text-[13px] text-muted-foreground mt-0.5">{desc}</p></div>
      <button aria-label={label} aria-pressed={value} className={`w-10 h-5 rounded-full transition-colors cursor-pointer relative shrink-0 mt-0.5 ${value ? 'bg-primary' : 'bg-muted'}`} onClick={onChange}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}
