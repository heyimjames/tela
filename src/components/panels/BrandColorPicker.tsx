import { useState } from 'react'
import { BRAND_PALETTE, BRAND_GROUPS, getTokensByGroup } from '@/brand/palette'
import type { BrandColor } from '@/types/design'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { ChevronDown, ChevronRight, Pipette } from 'lucide-react'

// EyeDropper API — supported in Chromium; feature-detected below.
interface EyeDropperResult { sRGBHex: string }
interface EyeDropperCtor { new (): { open: () => Promise<EyeDropperResult> } }
declare global {
  interface Window { EyeDropper?: EyeDropperCtor }
}

// Core groups shown in simplified mode
const CORE_GROUPS = new Set(['neutrals', 'brand', 'accent', 'traffic'])

interface Props {
  value: BrandColor
  onChange: (color: BrandColor) => void
  label?: string
}

export function BrandColorPicker({ value, onChange, label }: Props) {
  const [simplified, setSimplified] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const canPick = typeof window !== 'undefined' && 'EyeDropper' in window
  const pickFromScreen = async () => {
    if (!window.EyeDropper) return
    try {
      const { sRGBHex } = await new window.EyeDropper().open()
      onChange({ token: 'custom', hex: sRGBHex })
    } catch {
      /* user pressed Escape — ignore */
    }
  }

  const toggleCollapse = (groupId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const visibleGroups = simplified
    ? BRAND_GROUPS.filter((g) => CORE_GROUPS.has(g.id))
    : BRAND_GROUPS

  return (
    <div className="space-y-2">
      {label && (
        <div className="text-[13px] text-muted-foreground font-normal">{label}</div>
      )}

      {/* Current color preview + mode toggle */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-7 h-7 rounded-[5px] border border-border shrink-0"
          style={{ backgroundColor: value.hex }}
        />
        <span className="text-[13px] text-muted-foreground flex-1">
          {value.token === 'custom' ? value.hex : (BRAND_PALETTE[value.token]?.label ?? value.token)}
        </span>
        {canPick && (
          <button
            className="p-1 rounded-[5px] text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
            title="Pick colour from screen"
            aria-label="Pick colour from screen"
            onClick={() => void pickFromScreen()}
          >
            <Pipette className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          className="text-[11px] text-primary hover:underline cursor-pointer shrink-0"
          onClick={() => setSimplified(!simplified)}
        >
          {simplified ? 'All colours' : 'Simplified'}
        </button>
      </div>

      {/* Palette groups */}
      <TooltipProvider>
        <div className="space-y-1">
          {visibleGroups.map((group) => {
            const tokens = getTokensByGroup(group.id)
            if (tokens.length === 0) return null
            const isCollapsed = collapsed.has(group.id)

            return (
              <div key={group.id}>
                <button
                  className="flex items-center gap-1 w-full text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium py-1 hover:text-muted-foreground transition-colors cursor-pointer"
                  onClick={() => toggleCollapse(group.id)}
                >
                  {isCollapsed
                    ? <ChevronRight className="w-3 h-3" />
                    : <ChevronDown className="w-3 h-3" />
                  }
                  {group.label}
                </button>
                {!isCollapsed && (
                  <div className="flex flex-wrap gap-1 pb-1">
                    {tokens.map((t) => (
                      <Tooltip key={t.token}>
                        {/* `render` composes the trigger onto the swatch itself
                            so we don't nest a <button> inside the trigger's
                            <button> (which throws a hydration error). */}
                        <TooltipTrigger
                          render={
                            <button
                              className="w-7 h-7 rounded-[5px] border transition-transform duration-150 hover:scale-110 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                              style={{
                                backgroundColor: t.hex,
                                borderColor: value.token === t.token ? '#0017c7' : 'var(--border)',
                                borderWidth: value.token === t.token ? '2px' : '1px',
                              }}
                              onClick={() => onChange({ token: t.token, hex: t.hex })}
                            />
                          }
                        />
                        <TooltipContent side="top" className="text-xs">
                          {t.label}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </TooltipProvider>
    </div>
  )
}
