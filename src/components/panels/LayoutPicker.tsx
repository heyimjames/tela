import { useEffect, useState } from 'react'
import { DESIGN_LAYOUTS, type DesignLayout, type LayoutLayer } from '@/brand/layouts'
import { useDesignStore } from '@/store/useDesignStore'
import { useIsMobile } from '@/hooks/useIsMobile'
import { Drawer, DrawerContent, DrawerTitle, DrawerClose } from '@/components/ui/drawer'
import { LayoutTemplate, X } from 'lucide-react'

interface Props {
  onClose: () => void
}

/**
 * Pick a composition. Each layout drops well-placed placeholder layers into the
 * current frame, adapted to its aspect ratio. A bottom sheet on mobile, a
 * centred modal on desktop.
 */
export function LayoutPicker({ onClose }: Props) {
  const format = useDesignStore((s) => s.document.format)
  const addLayers = useDesignStore((s) => s.addLayers)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)
  const isMobile = useIsMobile()
  const [sheetOpen, setSheetOpen] = useState(false)
  useEffect(() => { setSheetOpen(true) }, [])

  const apply = (layout: DesignLayout) => {
    pushSnapshot()
    addLayers(layout.build(format.width, format.height) as unknown as Record<string, unknown>[])
    onClose()
  }

  const grid = (
    <div className="grid grid-cols-2 gap-3 md:gap-4">
      {DESIGN_LAYOUTS.map((layout) => (
        <button
          key={layout.id}
          className="group text-left bg-white border border-border rounded-[9px] overflow-hidden hover:shadow-[0_8px_30px_-4px_rgba(17,17,17,0.12)] transition-shadow cursor-pointer active:scale-[0.98]"
          onClick={() => apply(layout)}
        >
          <div className="bg-muted/40 p-3 flex items-center justify-center aspect-[1.6/1]">
            <LayoutThumb layout={layout} w={format.width} h={format.height} />
          </div>
          <div className="p-3">
            <div className="text-[14px] font-medium text-foreground">{layout.name}</div>
            <div className="text-[12px] text-muted-foreground line-clamp-2">{layout.description}</div>
          </div>
        </button>
      ))}
    </div>
  )

  if (isMobile) {
    return (
      <Drawer open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) window.setTimeout(onClose, 250) }}>
        <DrawerContent className="mt-0 h-[92vh] max-h-none">
          <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-0.5">
            <DrawerTitle className="flex items-center gap-2 p-0 text-[16px] font-semibold text-foreground">
              <LayoutTemplate className="w-4 h-4 text-primary" />Layouts
            </DrawerTitle>
            <DrawerClose asChild>
              <button className="h-10 rounded-full bg-muted px-4 text-[13px] font-medium text-foreground transition-transform active:scale-[0.96]">Done</button>
            </DrawerClose>
          </div>
          <p className="shrink-0 px-4 pb-2 text-[12px] text-muted-foreground">Pick a layout — it drops placeholders you fill in, fitted to this format.</p>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] no-scrollbar">{grid}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative bg-white rounded-[12px] shadow-xl w-[720px] max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="w-5 h-5 text-primary" />
            <h2 className="text-[17px] font-semibold text-foreground">Layouts</h2>
          </div>
          <button className="p-1.5 hover:bg-muted rounded-[5px] cursor-pointer transition-[background-color,transform] active:scale-[0.96]" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
        <p className="px-6 pt-3 text-[13px] text-muted-foreground">Pick a composition — it drops placeholders you fill in, fitted to your current format.</p>
        <div className="flex-1 overflow-y-auto p-6">{grid}</div>
      </div>
    </div>
  )
}

// A wireframe preview: media boxes are filled, text is drawn as bars, the CTA as
// a pill — so the thumbnail shows the actual composition for this frame's shape.
function LayoutThumb({ layout, w, h }: { layout: DesignLayout; w: number; h: number }) {
  const PREVIEW_W = 150
  const previewH = Math.round(PREVIEW_W * (h / w))
  const s = PREVIEW_W / w
  const layers = layout.build(w, h)
  return (
    <svg width={PREVIEW_W} height={previewH} viewBox={`0 0 ${PREVIEW_W} ${previewH}`} className="rounded-[4px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
      {layers.map((l: LayoutLayer, i) => {
        const x = l.x * s, y = l.y * s, lw = l.width * s, lh = l.height * s
        if (l.type === 'shape') {
          const isPill = (l as { shape?: string }).shape === 'pill'
          return <rect key={i} x={x} y={y} width={lw} height={lh} rx={isPill ? lh / 2 : 3} fill={isPill ? '#F56139' : '#e2ded3'} />
        }
        // text → a stack of bars filling roughly the text box
        const rows = Math.max(1, Math.round(lh / 6))
        return Array.from({ length: rows }).map((_, r) => (
          <rect key={`${i}-${r}`} x={x} y={y + r * 5} width={r === rows - 1 ? lw * 0.7 : lw} height={2.5} rx={1.25} fill="#100f0f" opacity={0.55} />
        ))
      })}
    </svg>
  )
}
