import { useState, useMemo, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useDesignStore } from '@/store/useDesignStore'
import { getBrandColor } from '@/brand/palette'
import { BrandColorPicker } from '@/components/panels/BrandColorPicker'
import { SliderField } from '@/components/controls/SliderField'
import { icons } from 'lucide-react'
import type { BrandColor, SvgLayer } from '@/types/design'

// Popular icons for ad creation
const POPULAR_ICONS = [
  'ArrowRight', 'ArrowUpRight', 'Check', 'CheckCircle', 'Star', 'Heart',
  'Briefcase', 'Building2', 'MapPin', 'Clock', 'Calendar', 'Mail',
  'Phone', 'Globe', 'Linkedin', 'Twitter', 'Users', 'User',
  'DollarSign', 'TrendingUp', 'Award', 'Zap', 'Target', 'Rocket',
  'Sparkles', 'ThumbsUp', 'MessageCircle', 'Share2', 'ExternalLink',
  'ChevronRight', 'Play', 'Send', 'Bookmark', 'Shield',
]

export function IconPickerPanel() {
  const addLayer = useDesignStore((s) => s.addLayer)
  const [search, setSearch] = useState('')
  const [size, setSize] = useState(48)
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [color, setColor] = useState<BrandColor>(getBrandColor('charcoal'))
  const [showAll, setShowAll] = useState(false)

  const allIconNames = Object.keys(icons)

  const filtered = useMemo(() => {
    if (!search && !showAll) {
      return POPULAR_ICONS.filter((name) => name in icons)
    }
    const q = search.toLowerCase()
    const pool = showAll ? allIconNames : POPULAR_ICONS
    return q
      ? pool.filter((name) => name.toLowerCase().includes(q))
      : pool
  }, [search, showAll, allIconNames])

  const handleAddIcon = (iconName: string) => {
    const IconComponent = icons[iconName as keyof typeof icons]
    if (!IconComponent) return

    // Use renderToStaticMarkup to synchronously get the full SVG string
    // This produces a complete <svg> with all paths/circles/lines from Lucide
    const svgContent = renderToStaticMarkup(
      createElement(IconComponent, {
        size,
        strokeWidth,
        color: color.hex,
      })
    )

    addLayer({
      type: 'svg',
      name: iconName,
      visible: true,
      locked: false,
      opacity: 1,
      x: 100,
      y: 100,
      width: size,
      height: size,
      rotation: 0,
      svgContent,
      tintColor: color,
      aspectRatioLocked: true,
    } satisfies Omit<SvgLayer, 'id' | 'zIndex'> & { aspectRatioLocked: boolean })
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        Icons
      </div>

      {/* Search */}
      <input
        className="w-full px-3 py-2 text-[13px] bg-white border border-border rounded-[5px] outline-none focus:ring-1 focus:ring-ring"
        placeholder="Search icons..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Settings */}
      <div className="space-y-2">
        <SliderField label="Size" value={size} min={16} max={120} step={4} format={(v) => `${v}px`} onChange={setSize} />
        <SliderField label="Stroke" value={strokeWidth} min={0.5} max={4} step={0.5} format={(v) => `${v}px`} onChange={setStrokeWidth} />
        <BrandColorPicker label="Color" value={color} onChange={setColor} />
      </div>

      {/* Toggle */}
      <div className="flex justify-between items-center">
        <span className="text-[12px] text-muted-foreground tabular-nums">{filtered.length} icons</span>
        <button
          className="text-[12px] text-primary hover:underline cursor-pointer tabular-nums"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? 'Show popular' : `Show all ${allIconNames.length}`}
        </button>
      </div>

      {/* Icon grid */}
      <div className="grid grid-cols-5 gap-1 max-h-[300px] overflow-y-auto">
        {filtered.slice(0, showAll ? 500 : 100).map((name) => {
          const IconComp = icons[name as keyof typeof icons]
          if (!IconComp) return null

          return (
            <button
              key={name}
              className="aspect-square flex items-center justify-center rounded-[5px] hover:bg-muted/80 transition-colors cursor-pointer group"
              onClick={() => handleAddIcon(name)}
              title={name}
            >
              <IconComp
                className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors"
                strokeWidth={strokeWidth}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
