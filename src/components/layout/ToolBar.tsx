import { useState, useRef, useEffect } from 'react'
import { useDesignStore, createTextLayer } from '@/store/useDesignStore'
import { getBrandColor } from '@/brand/palette'
import { TemplateBrowser } from '@/components/panels/TemplateBrowser'
import { LayoutPicker } from '@/components/panels/LayoutPicker'
import { useIsProMode } from '@/hooks/useIsProMode'
import { measureImportedSvg } from '@/engine/svgMeasure'
import {
  MousePointer2, Type, ImageIcon, Square, Circle, Triangle, Star, Minus, ArrowRight, Palette, FileCode, Hand, LayoutTemplate, LayoutGrid, MessageCircle, ChevronDown,
} from 'lucide-react'
import type { ShapeLayer, GradientLayer, ImageLayer, SvgLayer } from '@/types/design'

// The shape tool is a small dropdown: rectangle / ellipse / triangle / star / line / arrow.
const SHAPES: { id: string; label: string; Icon: typeof Square; make: () => Partial<ShapeLayer> }[] = [
  { id: 'rectangle', label: 'Rectangle', Icon: Square, make: () => ({ shape: 'rectangle', name: 'Rectangle', fill: getBrandColor('brand-dark'), borderRadius: 7 }) },
  { id: 'ellipse', label: 'Ellipse', Icon: Circle, make: () => ({ shape: 'ellipse', name: 'Ellipse', fill: getBrandColor('brand-accent'), borderRadius: 0 }) },
  { id: 'triangle', label: 'Triangle', Icon: Triangle, make: () => ({ shape: 'triangle', name: 'Triangle', fill: getBrandColor('accent-2'), borderRadius: 0 }) },
  { id: 'star', label: 'Star', Icon: Star, make: () => ({ shape: 'star', name: 'Star', fill: getBrandColor('orange'), borderRadius: 0 }) },
  { id: 'line', label: 'Line', Icon: Minus, make: () => ({ shape: 'line', name: 'Line', fill: getBrandColor('charcoal'), borderRadius: 0, width: 240, height: 0, stroke: { color: getBrandColor('charcoal'), width: 3 }, lineCap: 'round' }) },
  { id: 'arrow', label: 'Arrow', Icon: ArrowRight, make: () => ({ shape: 'line', name: 'Arrow', fill: getBrandColor('charcoal'), borderRadius: 0, width: 240, height: 0, stroke: { color: getBrandColor('charcoal'), width: 3 }, lineCap: 'round', arrowEnd: true }) },
]

function ShapeMenu({ addLayer }: { addLayer: (l: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])

  const add = (s: (typeof SHAPES)[number]) => {
    addLayer({ type: 'shape', visible: true, locked: false, opacity: 1, x: 100, y: 100, width: 200, height: 200, rotation: 0, borderRadius: 0, ...s.make() })
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        title="Shapes (R)"
        aria-label="Shapes"
        className={`flex items-center p-2.5 rounded-none transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer ${open ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Square className="w-[18px] h-[18px]" />
        <ChevronDown className="w-3 h-3 -mr-0.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-40 rounded-[8px] border border-border bg-card p-1 shadow-[0_8px_30px_-4px_rgba(17,17,17,0.16)]">
          {SHAPES.map((s) => (
            <button
              key={s.id}
              className="flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-1.5 text-[13px] text-foreground transition-colors hover:bg-muted cursor-pointer"
              onClick={() => add(s)}
            >
              <s.Icon className="w-4 h-4 text-muted-foreground" />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ToolBar() {
  const tool = useDesignStore((s) => s.tool)
  const addLayer = useDesignStore((s) => s.addLayer)
  const [templateBrowserOpen, setTemplateBrowserOpen] = useState(false)
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false)
  const isPro = useIsProMode()

  const handleAddImage = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return
      const reader = new FileReader()
      reader.onload = (e) => {
        addLayer({ type: 'image', name: file.name.split('.')[0] || 'Image', visible: true, locked: false, opacity: 1, x: 100, y: 100, width: 300, height: 300, rotation: 0, imageUrl: e.target?.result as string, fit: 'cover', cropX: 0, cropY: 0, cropW: 1, cropH: 1, borderRadius: 0, aspectRatioLocked: true })
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const handleAddSvg = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.svg'
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return
      const reader = new FileReader()
      reader.onload = (e) => {
        const { svgContent, width, height } = measureImportedSvg(e.target?.result as string)
        addLayer({ type: 'svg', name: file.name.split('.')[0] || 'SVG', visible: true, locked: false, opacity: 1, x: 100, y: 100, width, height, rotation: 0, svgContent })
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const tools = [
    { id: 'select', icon: MousePointer2, label: 'Select (V)', active: tool === 'select', action: () => useDesignStore.getState().setTool('select') },
    { id: 'pan', icon: Hand, label: 'Pan (H)', active: tool === 'pan', action: () => useDesignStore.getState().setTool('pan') },
    { id: 'sep1' },
    { id: 'text', icon: Type, label: 'Text (T)', action: () => addLayer(createTextLayer()) },
    { id: 'shape' }, // rendered as a dropdown (ShapeMenu) in the map below
    ...(isPro ? [{ id: 'gradient', icon: Palette, label: 'Gradient', action: () => addLayer({ type: 'gradient', name: 'Gradient', visible: true, locked: false, opacity: 1, x: 50, y: 50, width: 500, height: 300, rotation: 0, gradientType: 'linear', angle: 135, grain: 0.1, borderRadius: 0, stops: [{ position: 0, oklchL: 0.55, oklchC: 0.2, oklchH: 265, alpha: 1 }, { position: 1, oklchL: 0.35, oklchC: 0.15, oklchH: 280, alpha: 1 }] }) }] : []),
    { id: 'image', icon: ImageIcon, label: 'Image', action: handleAddImage },
    { id: 'svg', icon: FileCode, label: 'SVG', action: handleAddSvg },
    { id: 'sep2' },
    { id: 'comment', icon: MessageCircle, label: 'Comment (C)', active: tool === 'comment', action: () => useDesignStore.getState().setTool(tool === 'comment' ? 'select' : 'comment') },
  ]

  return (
    <div className="h-10 bg-card border-b border-border flex items-center px-4 gap-0.5 col-span-full shrink-0">
      {tools.map((item: any) => {
        if (item.id.startsWith('sep')) return <div key={item.id} className="w-px h-5 bg-border mx-1" />
        if (item.id === 'shape') return <ShapeMenu key="shape" addLayer={addLayer} />
        const Icon = item.icon
        return (
          <button
            key={item.id}
            title={item.label}
            aria-label={item.label}
            className={`p-2.5 rounded-none transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer ${item.active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
            onClick={item.action}
          >
            <Icon className="w-[18px] h-[18px]" />
          </button>
        )
      })}
      <div className="flex-1" />
      <button
        title="Layouts"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-none text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer"
        onClick={() => setLayoutPickerOpen(true)}
      >
        <LayoutGrid className="w-[16px] h-[16px]" />
        <span className="hidden sm:inline">Layouts</span>
      </button>
      <button
        title="Templates"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-none text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer"
        onClick={() => setTemplateBrowserOpen(true)}
      >
        <LayoutTemplate className="w-[16px] h-[16px]" />
        <span className="hidden sm:inline">Templates</span>
      </button>
      {templateBrowserOpen && <TemplateBrowser onClose={() => setTemplateBrowserOpen(false)} />}
      {layoutPickerOpen && <LayoutPicker onClose={() => setLayoutPickerOpen(false)} />}
    </div>
  )
}
