import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { useContextMenuStore } from '@/store/useContextMenuStore'

/**
 * The shared right-click menu, mounted once in App. Renders the items set by the
 * most recent openMenu() call (frame / layer / canvas), clamped to stay on
 * screen. Closes on outside click, Escape, scroll, or resize.
 */
export function ContextMenu() {
  const open = useContextMenuStore((s) => s.open)
  const x = useContextMenuStore((s) => s.x)
  const y = useContextMenuStore((s) => s.y)
  const items = useContextMenuStore((s) => s.items)
  const close = useContextMenuStore((s) => s.close)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  if (!open) return null

  // Clamp so the menu never overflows the viewport.
  const menuW = 200
  const estH = items.length * 32 + 8
  const left = Math.max(8, Math.min(x, window.innerWidth - menuW - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - estH - 8))

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      style={{ left, top, transformOrigin: 'top left' }}
      className="fixed z-[100] min-w-[190px] overflow-hidden rounded-[8px] border border-border bg-white py-1 shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="my-1 h-px bg-border" />}
          <button
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors active:scale-[0.99] ${
              item.danger
                ? 'text-red-600 hover:bg-red-50'
                : 'text-foreground hover:bg-muted'
            }`}
            onClick={() => {
              item.action()
              close()
            }}
          >
            {item.icon && <item.icon className="h-3.5 w-3.5 opacity-70" />}
            {item.label}
          </button>
        </div>
      ))}
    </motion.div>
  )
}
