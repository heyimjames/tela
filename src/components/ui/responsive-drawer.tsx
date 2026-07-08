import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Drawer, DrawerContent, DrawerTitle } from './drawer'
import { useIsMobile } from '@/hooks/useIsMobile'

interface ResponsiveDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  children: ReactNode
  /** Desktop-only: extra classes on the motion wrapper */
  desktopClassName?: string
  /** Desktop-only: y offset for enter/exit animation (default 8) */
  desktopAnimateY?: number
}

export function ResponsiveDrawer({
  open,
  onOpenChange,
  title,
  children,
  desktopClassName,
  desktopAnimateY = 8,
}: ResponsiveDrawerProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          {title && <DrawerTitle>{title}</DrawerTitle>}
          <div className="flex-1 overflow-y-auto px-4 pb-6">{children}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: desktopAnimateY }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: desktopAnimateY }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className={desktopClassName}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
