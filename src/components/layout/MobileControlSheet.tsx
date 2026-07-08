import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Layers, Settings } from 'lucide-react'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { LayerListPanel } from '@/components/panels/LayerListPanel'

export function MobileControlSheet() {
  const [drawer, setDrawer] = useState<'layers' | 'inspector' | null>(null)

  return (
    <>
      {/* Floating pills */}
      <AnimatePresence>
        {drawer === null && (
          <motion.div
            className="fixed bottom-20 left-1/2 -translate-x-1/2 flex gap-2 z-30 md:hidden"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <button
              className="flex items-center gap-1.5 px-4 py-2 bg-foreground text-background rounded-full text-[12px] font-medium shadow-lg transition-transform active:scale-[0.96]"
              onClick={() => setDrawer('layers')}
            >
              <Layers className="w-3.5 h-3.5" />
              Layers
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
    </>
  )
}
