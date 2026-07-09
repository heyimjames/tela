import { type ComponentProps } from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { cn } from '@/lib/utils'

const Drawer = DrawerPrimitive.Root
const DrawerTrigger = DrawerPrimitive.Trigger
const DrawerPortal = DrawerPrimitive.Portal
const DrawerClose = DrawerPrimitive.Close

function DrawerOverlay({ className, ...props }: ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-black/40', className)}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        className={cn(
          // Depth via layered shadow (not a border); softer 20px top radius.
          'fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[92vh] flex-col rounded-t-[20px] bg-card shadow-[0_-1px_0_rgba(0,0,0,0.04),0_-12px_36px_rgba(0,0,0,0.14)]',
          className,
        )}
        {...props}
      >
        {/* Grab handle inside a ≥40px-tall hit area so it's easy to drag. */}
        <div className="mx-auto flex h-6 w-16 shrink-0 touch-none items-center justify-center pt-1">
          <div className="h-1 w-9 rounded-full bg-muted-foreground/25" />
        </div>
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

function DrawerTitle({ className, ...props }: ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      className={cn('px-4 pb-2 text-sm font-medium text-foreground/80', className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerTrigger,
  DrawerPortal,
  DrawerClose,
  DrawerOverlay,
  DrawerContent,
  DrawerTitle,
}
