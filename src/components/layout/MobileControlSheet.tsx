import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Layers, SlidersHorizontal, Copy, Trash2 } from 'lucide-react'
import { Drawer, DrawerContent, DrawerTitle, DrawerClose } from '@/components/ui/drawer'
import { LayerListPanel } from '@/components/panels/LayerListPanel'
import { LayerInspector } from '@/components/panels/LayerInspector'
import { useDesignStore } from '@/store/useDesignStore'

/**
 * Mobile-only control cluster (bottom-left corner, clearing the centred
 * FloatingToolbar). Progressive disclosure: Layers is always available; the
 * properties sheet (the desktop inspector, in a bottom drawer) appears only when
 * a layer is selected — so the canvas stays uncluttered until you ask to edit.
 */
// A round 44px action in the bottom-left selection cluster.
function ClusterButton({
  label, onClick, variant = 'default', children,
}: {
  label: string
  onClick: () => void
  variant?: 'default' | 'primary' | 'danger'
  children: React.ReactNode
}) {
  const tone =
    variant === 'primary'
      ? 'bg-primary text-primary-foreground'
      : variant === 'danger'
        ? 'bg-white text-red-600'
        : 'bg-white text-foreground'
  return (
    <motion.button
      aria-label={label}
      className={`h-11 w-11 flex items-center justify-center rounded-full shadow-lg border border-black/5 transition-transform active:scale-[0.96] ${tone}`}
      initial={{ opacity: 0, scale: 0.6, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.6, y: 6 }}
      transition={{ type: 'spring', stiffness: 520, damping: 28 }}
      onClick={onClick}
    >
      {children}
    </motion.button>
  )
}

export function MobileControlSheet() {
  const [drawer, setDrawer] = useState<'layers' | 'inspector' | null>(null)
  const activeLayer = useDesignStore((s) => s.document.layers.find((l) => l.id === s.activeLayerId) ?? null)
  const selectedCount = useDesignStore((s) => s.selectedLayerIds.size)
  const editable = !!activeLayer && activeLayer.type !== 'background'
  const hasSelection = selectedCount > 0

  const duplicateSelection = () => {
    const s = useDesignStore.getState()
    for (const id of [...s.selectedLayerIds]) s.duplicateLayer(id)
  }
  const deleteSelection = () => {
    const s = useDesignStore.getState()
    s.pushSnapshot()
    s.removeLayers([...s.selectedLayerIds])
  }

  return (
    <>
      <AnimatePresence>
        {drawer === null && (
          <motion.div
            className="fixed bottom-16 left-3 z-30 flex flex-col gap-2 md:hidden"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Selection actions — spring in only when something is selected
                (progressive disclosure): Edit properties, Duplicate, Delete. */}
            <AnimatePresence>
              {editable && (
                <ClusterButton key="edit" label="Edit properties" onClick={() => setDrawer('inspector')} variant="primary">
                  <SlidersHorizontal className="w-5 h-5" />
                </ClusterButton>
              )}
              {hasSelection && (
                <ClusterButton key="dup" label="Duplicate" onClick={duplicateSelection}>
                  <Copy className="w-5 h-5" />
                </ClusterButton>
              )}
              {hasSelection && (
                <ClusterButton key="del" label="Delete" onClick={deleteSelection} variant="danger">
                  <Trash2 className="w-5 h-5" />
                </ClusterButton>
              )}
            </AnimatePresence>

            {/* Layers — always available */}
            <button
              aria-label="Layers"
              className="h-11 w-11 flex items-center justify-center bg-foreground text-background rounded-full shadow-lg transition-transform active:scale-[0.96]"
              onClick={() => setDrawer('layers')}
            >
              <Layers className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Layers drawer — content-hugging up to ~72vh, scrolls beyond. */}
      <Drawer open={drawer === 'layers'} onOpenChange={(open) => !open && setDrawer(null)}>
        <DrawerContent>
          <SheetHeader title="Layers" />
          <div className="overflow-y-auto max-h-[72vh] pb-[calc(env(safe-area-inset-bottom)+1.5rem)] no-scrollbar">
            <LayerListPanel />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Properties drawer — the shared inspector, on demand. */}
      <Drawer open={drawer === 'inspector'} onOpenChange={(open) => !open && setDrawer(null)}>
        <DrawerContent>
          <SheetHeader title={activeLayer?.name ?? 'Properties'} />
          <div className="mobile-inspector overflow-y-auto max-h-[82vh] px-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] no-scrollbar">
            {activeLayer ? <LayerInspector layer={activeLayer} /> : null}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

// Sheet header: a visible title (also the accessible DrawerTitle) + a Done pill
// with a ≥40px hit area. Tapping down / dragging the sheet also dismisses.
function SheetHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between px-4 pb-3 pt-0.5">
      <DrawerTitle className="p-0 text-[16px] font-semibold text-foreground">{title}</DrawerTitle>
      <DrawerClose asChild>
        <button className="h-10 rounded-full bg-muted px-4 text-[13px] font-medium text-foreground transition-transform active:scale-[0.96]">
          Done
        </button>
      </DrawerClose>
    </div>
  )
}
