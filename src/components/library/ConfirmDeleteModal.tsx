import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { Trash2 } from 'lucide-react'

interface Props {
  open: boolean
  /** Name of the thing being deleted, shown quoted in the title. */
  itemName?: string
  /** e.g. "file" | "folder" — tunes the body copy. */
  kind?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmation before a destructive delete. Grows from centre (never teleports),
 * fades its backdrop, and settles on the golden easing curve. The safe action
 * (Cancel) takes focus so an accidental Enter/Escape can't destroy anything.
 */
export function ConfirmDeleteModal({ open, itemName, kind = 'file', onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    // Focus the safe action; Enter then dismisses rather than deletes.
    const raf = requestAnimationFrame(() => cancelRef.current?.focus())
    return () => { window.removeEventListener('keydown', onKey); cancelAnimationFrame(raf) }
  }, [open, onCancel])

  if (!open) return null

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
          {/* Backdrop — dim + soft blur, click to dismiss. */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} />

          {/* Panel — grows in on the golden curve; concentric radius (20 → 10). */}
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            className="relative w-full max-w-[380px] rounded-[20px] bg-white p-6 shadow-[0_24px_70px_-16px_rgba(0,0,0,0.35),0_2px_8px_-2px_rgba(0,0,0,0.1)]"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div
              aria-hidden
              className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.05, type: 'spring', stiffness: 420, damping: 24 }}
            >
              <Trash2 className="h-5 w-5" />
            </motion.div>

            <h2 id="confirm-delete-title" className="text-[17px] font-semibold tracking-tight text-foreground">
              Delete {itemName ? `“${itemName}”` : `this ${kind}`}?
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {kind === 'folder'
                ? 'This removes the folder. Files inside it move back to Files. You can’t undo this.'
                : 'This permanently removes it. You can’t undo this.'}
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={onCancel}
                className="rounded-[10px] px-4 py-2.5 text-[13px] font-medium text-foreground transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.96]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="rounded-[10px] bg-destructive px-4 py-2.5 text-[13px] font-medium text-white transition-[background-color,transform] duration-150 hover:bg-destructive/90 active:scale-[0.96]"
              >
                Delete
              </button>
            </div>
          </motion.div>
    </motion.div>
  )
}
