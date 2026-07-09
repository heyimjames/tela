import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Layers, SlidersHorizontal } from 'lucide-react'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { LayerListPanel } from '@/components/panels/LayerListPanel'
import { LayerInspector } from '@/components/panels/LayerInspector'
import { useDesignStore } from '@/store/useDesignStore'

/**
 * Mobile-only control cluster (bottom-left corner, clearing the centred
 * FloatingToolbar). Progressive disclosure: Layers is always available; the
 * properties sheet (the desktop inspector, in a bottom drawer) appears only when
 * a layer is selected — so the canvas stays uncluttered until you ask to edit.
 */
export function MobileControlSheet() {
  const [drawer, setDrawer] = useState<'layers' | 'inspector' | null>(null)
  const activeLayer = useDesignStore((s) => s.document.layers.find((l) => l.id === s.activeLayerId) ?? null)
  const editable = !!activeLayer && activeLayer.type !== 'background'

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
            {/* Edit properties — only when a layer is selected (progressive disclosure) */}
            <AnimatePresence>
              {editable && (
                <motion.button
                  key="edit"
                  aria-label="Edit properties"
                  className="h-11 w-11 flex items-center justify-center bg-primary text-primary-foreground rounded-full shadow-lg transition-transform active:scale-[0.92]"
                  initial={{ opacity: 0, scale: 0.6, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.6, y: 6 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 28 }}
                  onClick={() => setDrawer('inspector')}
                >
                  <SlidersHorizontal className="w-5 h-5" />
                </motion.button>
              )}
            </AnimatePresence>

            {/* Layers */}
            <button
              aria-label="Layers"
              className="h-11 w-11 flex items-center justify-center bg-foreground text-background rounded-full shadow-lg transition-transform active:scale-[0.92]"
              onClick={() => setDrawer('layers')}
            >
              <Layers className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Layers drawer */}
      <Drawer open={drawer === 'layers'} onOpenChange={(open) => !open && setDrawer(null)}>
        <DrawerContent className="max-h-[80vh]">
          <DrawerTitle className="sr-only">Layers</DrawerTitle>
          <div className="overflow-y-auto max-h-[70vh] pb-8">
            <LayerListPanel />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Properties drawer — the shared inspector, on demand */}
      <Drawer open={drawer === 'inspector'} onOpenChange={(open) => !open && setDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerTitle className="sr-only">Properties</DrawerTitle>
          <div className="overflow-y-auto max-h-[80vh] p-3 pb-8 no-scrollbar">
            {activeLayer ? <LayerInspector layer={activeLayer} /> : null}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
