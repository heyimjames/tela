import { useRef, useEffect, useCallback } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useCoarsePointer } from '@/hooks/useCoarsePointer'
import { FONT_FAMILY } from '@/engine/textMeasure'
import type { TextLayer } from '@/types/design'

interface Props {
  zoom: number
}

/**
 * Inline text editor. It renders a contentEditable box styled *identically* to
 * the scene's TextNode — same font metrics, wrap, and (critically) the same
 * `text-box-trim` cap trim — so what you edit is pixel-for-pixel what renders.
 *
 * A plain <textarea> can't apply text-box-trim, so its untrimmed line box is
 * taller than the trimmed layer height: the text looked bigger and its bottom
 * got clipped by the box on entering edit. A contentEditable block trims like
 * the canvas and auto-grows, so there's no jump and nothing is clipped.
 */
export function TextEditOverlay({ zoom }: Props) {
  const editingTextLayerId = useDesignStore((s) => s.editingTextLayerId)
  const layers = useDesignStore((s) => s.document.layers)
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const setEditingTextLayerId = useDesignStore((s) => s.setEditingTextLayerId)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  const ref = useRef<HTMLDivElement>(null)
  const isCommitting = useRef(false)
  // On touch, MobileTextEditor takes over with a fullscreen field instead.
  const coarse = useCoarsePointer()

  const layer = editingTextLayerId
    ? (layers.find((l) => l.id === editingTextLayerId) as TextLayer | undefined)
    : null

  // Seed the text and place the caret at the end on enter — write it imperatively
  // so React never re-sets the node's content (which would fight the caret).
  useEffect(() => {
    if (!layer || !ref.current) return
    const el = ref.current
    el.textContent = layer.content
    requestAnimationFrame(() => {
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
    pushSnapshot()
    isCommitting.current = false
  }, [layer?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(() => {
    if (isCommitting.current) return
    isCommitting.current = true
    if (ref.current && layer && ref.current.innerText !== layer.content) {
      updateLayer<TextLayer>(layer.id, { content: ref.current.innerText })
    }
    setEditingTextLayerId(null)
  }, [layer, updateLayer, setEditingTextLayerId])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      commit()
    }
    // Stop propagation so canvas keyboard shortcuts don't fire while typing.
    e.stopPropagation()
  }, [commit])

  // Paste as plain text — never carry markup into a text layer.
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }, [])

  if (!layer || coarse) return null

  const x = layer.x * zoom
  const y = layer.y * zoom
  const w = layer.width * zoom
  const fontSize = layer.fontSize * zoom
  const autoWidth = (layer.textSizing ?? 'fixed') === 'auto-width'

  const decoration =
    [layer.underline && 'underline', layer.strikethrough && 'line-through']
      .filter(Boolean)
      .join(' ') || undefined

  const style: React.CSSProperties = {
    position: 'absolute',
    left: x,
    top: y,
    // Auto-width never wraps (grows sideways, one line); everything else wraps
    // at the box width. Height is always auto so the text is never clipped.
    width: autoWidth ? 'max-content' : w,
    minWidth: autoWidth ? w : undefined,
    fontFamily: FONT_FAMILY,
    fontSize,
    fontWeight: layer.fontWeight,
    color: layer.color.hex,
    textAlign: layer.textAlign,
    // letterSpacing is a font-size multiplier (matches textMeasure/scene render).
    letterSpacing: `${layer.letterSpacing * fontSize}px`,
    lineHeight: layer.lineHeight,
    textTransform: layer.textTransform,
    textDecoration: decoration,
    whiteSpace: autoWidth ? 'pre' : 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
    padding: 0,
    // Outline (not border) so the text box isn't inset — text stays put.
    outline: '2px solid #0017c7',
    outlineOffset: '0px',
    borderRadius: '2px',
    background: 'rgba(255,255,255,0.15)',
    caretColor: layer.color.hex,
    zIndex: 100,
    cursor: 'text',
  }
  // Match the scene's cap trim exactly, so the editor's line box is the same
  // height as the rendered (and stored) layer height. CSSProperties lacks types
  // for these, hence the assign.
  if ((layer.verticalTrim ?? 'cap') === 'cap') {
    Object.assign(style, { textBoxTrim: 'trim-both', textBoxEdge: 'cap alphabetic' })
  }

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      style={style}
      // Commit live so the box re-hugs as you type (auto-width grows sideways,
      // auto-height grows down) instead of clipping until blur.
      onInput={(e) => updateLayer<TextLayer>(layer.id, { content: (e.target as HTMLDivElement).innerText })}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
