import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// The keyboard map, grouped. Keys render as little <kbd> chips; multiple keys in
// one string (space-separated) render as separate chips.
const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Tools',
    items: [
      ['V', 'Select'],
      ['H', 'Hand / pan'],
      ['T', 'Text'],
      ['R', 'Rectangle'],
      ['P', 'Pen'],
      ['E', 'Eraser'],
      ['C', 'Comment'],
    ],
  },
  {
    title: 'Edit',
    items: [
      ['⌘ Z', 'Undo'],
      ['⇧ ⌘ Z', 'Redo'],
      ['⌘ C', 'Copy'],
      ['⌘ X', 'Cut'],
      ['⌘ V', 'Paste'],
      ['⌘ D', 'Duplicate'],
      ['⌘ A', 'Select all'],
      ['⌫', 'Delete'],
      ['⌘ G', 'Group'],
      ['⇧ ⌘ G', 'Ungroup'],
    ],
  },
  {
    title: 'View',
    items: [
      ['⌘ +', 'Zoom in'],
      ['⌘ -', 'Zoom out'],
      ['⌘ 0', 'Zoom to 100%'],
      ['⇧ 1', 'Fit to view'],
      ['⇧ 2', 'Zoom to selection'],
      ['Space', 'Hold to pan'],
    ],
  },
  {
    title: 'Pen',
    items: [
      ['[', 'Thinner'],
      [']', 'Thicker'],
      ['1 – 4', 'Size presets'],
      ['⇧', 'Straight line (while drawing)'],
    ],
  },
  {
    title: 'Move',
    items: [
      ['← ↑ → ↓', 'Nudge'],
      ['⇧ + arrows', 'Nudge further'],
    ],
  },
  {
    title: 'General',
    items: [
      ['⌘ K', 'Command palette'],
      ['?', 'This cheat sheet'],
      ['Esc', 'Deselect / close'],
    ],
  },
]

function Keys({ combo }: { combo: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {combo.split(' ').map((k, i) => (
        <kbd
          key={i}
          className="inline-flex min-w-[20px] items-center justify-center rounded-[5px] border border-black/10 bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/80 tabular-nums"
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}

/**
 * A keyboard-shortcut cheat sheet. Opens on "?" (Shift+/) or the `tela:shortcuts`
 * event (fired by the command palette). Self-contained, like the command palette.
 */
export function ShortcutsCheatSheet() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      if (!typing && e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    const onEvent = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('tela:shortcuts', onEvent)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('tela:shortcuts', onEvent)
    }
  }, [])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-charcoal/30 backdrop-blur-sm" />
      <div
        className="relative w-[min(720px,calc(100vw-2rem))] max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-[14px] border border-border bg-card shadow-[0_10px_40px_-4px_rgba(17,17,17,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card/95 px-5 py-3.5 backdrop-blur">
          <h2 className="text-[15px] font-semibold text-foreground">Keyboard shortcuts</h2>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 p-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
                {group.title}
              </div>
              <div className="space-y-1">
                {group.items.map(([combo, label]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-0.5">
                    <span className="text-[13px] text-foreground/80">{label}</span>
                    <Keys combo={combo} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
