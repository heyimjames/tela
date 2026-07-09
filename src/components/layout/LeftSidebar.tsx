import { useState, useEffect } from 'react'
import { Layers, Blocks, FolderOpen, Sparkles } from 'lucide-react'
import { LayerListPanel } from '@/components/panels/LayerListPanel'
import { AssetLibraryPanel } from '@/components/panels/AssetLibraryPanel'
import { IconPickerPanel } from '@/components/panels/IconPickerPanel'
import { DSComponentLibraryPanel } from '@/components/panels/DSComponentLibraryPanel'
import { useIsProMode } from '@/hooks/useIsProMode'

type Tab = 'layers' | 'components' | 'assets' | 'icons'

export function LeftSidebar() {
  const [tab, setTab] = useState<Tab>('layers')
  const isPro = useIsProMode()

  // Also honour the dock event (if/when the floating dock is mounted) so both
  // entry points drive the same tab state.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Tab
      setTab(detail)
    }
    window.addEventListener('tela-dock-left-tab', handler)
    return () => window.removeEventListener('tela-dock-left-tab', handler)
  }, [])

  const tabs: Array<{ id: Tab; icon: typeof Layers; label: string }> = [
    { id: 'layers', icon: Layers, label: 'Layers' },
    { id: 'components', icon: Blocks, label: 'Components' },
    { id: 'assets', icon: FolderOpen, label: 'Assets' },
    ...(isPro ? [{ id: 'icons' as const, icon: Sparkles, label: 'Icons' }] : []),
  ]

  return (
    <aside className="hidden md:flex flex-col bg-card border-r border-border h-full overflow-hidden">
      <div className="flex items-center gap-0.5 px-2 h-10 border-b border-border shrink-0">
        {tabs.map(({ id, icon: Icon, label }) => {
          const active = tab === id
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              title={label}
              aria-label={label}
              aria-pressed={active}
              className={`flex items-center justify-center h-7 px-2 rounded-[5px] text-[12px] transition-[color,background-color,transform] active:scale-[0.97] cursor-pointer ${
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              <Icon className="w-[15px] h-[15px] shrink-0" />
              {/* Only the active tab spells out its label; the rest collapse to
                  icon-only (tooltip via title) so all four fit the sidebar. */}
              <span
                className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-200 ease-out ${
                  active ? 'max-w-[120px] opacity-100 ml-1.5' : 'max-w-0 opacity-0 ml-0'
                }`}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        {tab === 'layers' && <LayerListPanel />}
        {tab === 'components' && <div className="p-3"><DSComponentLibraryPanel /></div>}
        {tab === 'assets' && <div className="p-3"><AssetLibraryPanel /></div>}
        {isPro && tab === 'icons' && <div className="p-3"><IconPickerPanel /></div>}
      </div>
    </aside>
  )
}
