import { motion, AnimatePresence } from 'motion/react'
import { Pen, Highlighter, Eraser } from 'lucide-react'
import { useDesignStore } from '@/store/useDesignStore'
import { useUIStore } from '@/store/useUIStore'
import { getBrandColor } from '@/brand/palette'
import { haptic } from '@/lib/haptics'

// A curated quick palette — the full picker still lives in the sidebar panel.
const SWATCHES = ['charcoal', 'brand-primary', 'red', 'green', 'orange', 'gold-300']
const PEN_SIZES = [3, 6, 12, 24]
const MARKER_SIZES = [12, 22, 40, 64]

/**
 * A contextual quick bar that springs in above the main FloatingToolbar while
 * the pen or eraser is active (tldraw-style). Fast access to mode, a handful of
 * colours, and sizes without opening the sidebar. Desktop and mobile.
 */
export function DrawQuickBar() {
  const tool = useDesignStore((s) => s.tool)
  const setTool = useDesignStore((s) => s.setTool)
  const drawMode = useUIStore((s) => s.drawMode)
  const setDrawMode = useUIStore((s) => s.setDrawMode)
  const drawColor = useUIStore((s) => s.drawColor)
  const highlighterColor = useUIStore((s) => s.highlighterColor)
  const drawWidth = useUIStore((s) => s.drawWidth)
  const highlighterWidth = useUIStore((s) => s.highlighterWidth)
  const setDrawColor = useUIStore((s) => s.setDrawColor)
  const setHighlighterColor = useUIStore((s) => s.setHighlighterColor)
  const setDrawWidth = useUIStore((s) => s.setDrawWidth)
  const setHighlighterWidth = useUIStore((s) => s.setHighlighterWidth)

  const show = tool === 'draw' || tool === 'eraser'
  const isEraser = tool === 'eraser'
  const isH = drawMode === 'highlighter'
  const color = isH ? highlighterColor : drawColor
  const setColor = isH ? setHighlighterColor : setDrawColor
  const width = isH ? highlighterWidth : drawWidth
  const setWidth = isH ? setHighlighterWidth : setDrawWidth
  const sizes = isH ? MARKER_SIZES : PEN_SIZES

  const modes = [
    { id: 'pen', label: 'Pen (P)', Icon: Pen, active: tool === 'draw' && !isH, onClick: () => { setTool('draw'); setDrawMode('pen') } },
    { id: 'marker', label: 'Marker', Icon: Highlighter, active: tool === 'draw' && isH, onClick: () => { setTool('draw'); setDrawMode('highlighter') } },
    { id: 'eraser', label: 'Eraser (E)', Icon: Eraser, active: isEraser, onClick: () => setTool('eraser') },
  ]

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30, bounce: 0 }}
          className="pointer-events-auto absolute bottom-[4.75rem] left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-[14px] border border-black/5 bg-white/95 p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] backdrop-blur max-md:max-w-[calc(100vw-1.5rem)] max-md:overflow-x-auto no-scrollbar"
        >
          {modes.map(({ id, label, Icon, active, onClick }) => (
            <button
              key={id}
              title={label}
              aria-label={label}
              onPointerDown={() => haptic('light')}
              onClick={(e) => { e.currentTarget.blur(); onClick() }}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] transition-[color,background-color,transform] duration-150 active:scale-[0.94] cursor-pointer ${
                active ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className="h-[17px] w-[17px]" />
            </button>
          ))}

          {!isEraser && (
            <>
              <div className="mx-0.5 h-5 w-px shrink-0 bg-border" />
              {SWATCHES.map((token) => {
                const c = getBrandColor(token)
                const active = color.token === token
                return (
                  <button
                    key={token}
                    title={c.token}
                    onPointerDown={() => haptic('light')}
                    onClick={(e) => { e.currentTarget.blur(); setColor(c) }}
                    className={`h-6 w-6 shrink-0 rounded-full transition-transform duration-150 active:scale-[0.9] cursor-pointer ${
                      active ? 'ring-2 ring-primary ring-offset-1 ring-offset-white' : 'ring-1 ring-black/10'
                    }`}
                    style={{ background: c.hex }}
                    aria-label={`Colour ${c.token}`}
                  />
                )
              })}
              <div className="mx-0.5 h-5 w-px shrink-0 bg-border" />
              {sizes.map((sz) => {
                const active = Math.round(width) === sz
                const dot = Math.max(4, Math.min(16, 4 + sz * 0.5))
                return (
                  <button
                    key={sz}
                    title={`${sz}px`}
                    onPointerDown={() => haptic('light')}
                    onClick={(e) => { e.currentTarget.blur(); setWidth(sz) }}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] transition-[background-color,transform] duration-150 active:scale-[0.94] cursor-pointer ${
                      active ? 'bg-foreground text-background' : 'bg-transparent text-foreground hover:bg-muted'
                    }`}
                    aria-label={`${sz}px`}
                  >
                    <span className="rounded-full bg-current" style={{ width: dot, height: dot }} />
                  </button>
                )
              })}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
