import { useState } from 'react'
import { useDesignStore, createTextLayer } from '@/store/useDesignStore'
import { getBrandColor } from '@/brand/palette'
import { TemplateBrowser } from '@/components/panels/TemplateBrowser'
import { LayoutPicker } from '@/components/panels/LayoutPicker'
import { useIsProMode } from '@/hooks/useIsProMode'
import { measureImportedSvg } from '@/engine/svgMeasure'
import {
  MousePointer2, Type, ImageIcon, Square, Palette, FileCode, Hand, LayoutTemplate, LayoutGrid, MessageCircle,
} from 'lucide-react'
import type { ShapeLayer, GradientLayer, ImageLayer, SvgLayer } from '@/types/design'

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
    { id: 'shape', icon: Square, label: 'Shape (R)', action: () => addLayer({ type: 'shape', name: 'Rectangle', visible: true, locked: false, opacity: 1, x: 100, y: 100, width: 200, height: 200, rotation: 0, shape: 'rectangle', fill: getBrandColor('brand-dark'), borderRadius: 7 }) },
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
