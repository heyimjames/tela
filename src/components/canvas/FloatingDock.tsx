import { useUIStore } from '@/store/useUIStore'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useIsProMode } from '@/hooks/useIsProMode'
import { AI_ENABLED } from '@/lib/aiApi'
import {
  Layers,
  Blocks,
  FolderOpen,
  Sparkles as IconsIcon,
  SlidersHorizontal,
  Download,
  Scaling,
  Wand2,
} from 'lucide-react'

type LeftTab = 'layers' | 'components' | 'assets' | 'icons'
type RightTab = 'inspector' | 'export' | 'auto-resize' | 'ai'

export function FloatingDock() {
  const rightPanel = useUIStore((s) => s.rightPanel)
  const setRightPanel = useUIStore((s) => s.setRightPanel)
  const setExportPanelOpen = useUIStore((s) => s.setExportPanelOpen)
  const isPro = useIsProMode()

  const setLeftTab = (tab: LeftTab) => {
    window.dispatchEvent(new CustomEvent('tela-dock-left-tab', { detail: tab }))
  }

  const handleRightTab = (tab: RightTab) => {
    if (tab === 'export') {
      setExportPanelOpen(true)
    } else {
      setExportPanelOpen(false)
    }
    setRightPanel(tab)
  }

  const allLeftItems: Array<{ id: LeftTab; icon: React.ElementType; label: string; proOnly?: boolean }> = [
    { id: 'layers', icon: Layers, label: 'Layers' },
    { id: 'components', icon: Blocks, label: 'Components' },
    { id: 'assets', icon: FolderOpen, label: 'Assets' },
    { id: 'icons', icon: IconsIcon, label: 'Icons', proOnly: true },
  ]

  const allRightItems: Array<{ id: RightTab; icon: React.ElementType; label: string; proOnly?: boolean; aiOnly?: boolean }> = [
    { id: 'inspector', icon: SlidersHorizontal, label: 'Inspector' },
    { id: 'export', icon: Download, label: 'Export' },
    { id: 'auto-resize', icon: Scaling, label: 'Resize' },
    // Only shown when an AI endpoint is configured (VITE_AI_API_ORIGIN).
    { id: 'ai', icon: Wand2, label: 'AI', aiOnly: true },
  ]

  const leftItems = isPro ? allLeftItems : allLeftItems.filter((i) => !i.proOnly)
  const rightItems = allRightItems.filter(
    (i) => (isPro || !i.proOnly) && (AI_ENABLED || !i.aiOnly),
  )

  return (
    <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-30 flex items-center gap-0.5 bg-card border border-border rounded-[7px] p-1 shadow-[var(--shadow-subtle)]">
      {leftItems.map((item) => {
        const Icon = item.icon
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger>
              <button
                aria-label={item.label}
                className="p-2 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer"
                onClick={() => setLeftTab(item.id)}
              >
                <Icon className="w-[18px] h-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">{item.label}</TooltipContent>
          </Tooltip>
        )
      })}

      <div className="w-px h-5 bg-border mx-0.5" />

      {rightItems.map((item) => {
        const Icon = item.icon
        const isActive = rightPanel === item.id
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger>
              <button
                aria-label={item.label}
                className={`
                  p-2 rounded-[5px] transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer
                  ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}
                `}
                onClick={() => handleRightTab(item.id)}
              >
                <Icon className="w-[18px] h-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">{item.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
