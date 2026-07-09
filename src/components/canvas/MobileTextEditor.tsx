import { useEffect, useRef, useState } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useCoarsePointer } from '@/hooks/useCoarsePointer'
import type { TextLayer } from '@/types/design'

/**
 * Fullscreen text editor for touch devices. Inline canvas text editing is fiddly
 * on a phone (tiny, zoom-dependent, and the keyboard covers it), so when text
 * editing starts on a coarse pointer we take over the screen with a large,
 * comfortable field. Commits through the same `editingTextLayerId` flow as the
 * desktop inline overlay (which is suppressed on touch).
 */
export function MobileTextEditor() {
  const coarse = useCoarsePointer()
  const editingId = useDesignStore((s) => s.editingTextLayerId)
  const layer = useDesignStore((s) =>
    s.document.layers.find((l) => l.id === s.editingTextLayerId),
  ) as TextLayer | undefined
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const setEditing = useDesignStore((s) => s.setEditingTextLayerId)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  const ref = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')

  const active = coarse && !!editingId && layer?.type === 'text'

  useEffect(() => {
    if (!active || !layer) return
    setValue(layer.content)
    // Focus on the next frame so the keyboard opens and the caret lands at the end.
    const id = requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
    return () => cancelAnimationFrame(id)
    // Only re-run when the edited layer changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, active])

  if (!active || !layer) return null

  const commit = () => {
    if (value !== layer.content) {
      pushSnapshot()
      updateLayer<TextLayer>(layer.id, { content: value })
    }
    setEditing(null)
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-background md:hidden">
      <div className="flex items-center justify-between px-3 h-14 border-b border-border shrink-0">
        <button
          onClick={() => setEditing(null)}
          className="h-10 px-3 text-[15px] text-muted-foreground transition-transform active:scale-[0.96]"
        >
          Cancel
        </button>
        <span className="text-[15px] font-semibold text-foreground">Edit text</span>
        <button
          onClick={commit}
          className="h-10 px-4 rounded-full bg-primary text-primary-foreground text-[14px] font-medium transition-transform active:scale-[0.96]"
        >
          Done
        </button>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type your text…"
        className="flex-1 w-full resize-none bg-transparent px-4 py-4 text-[18px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      />
    </div>
  )
}
