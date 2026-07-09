import { useRef, useEffect, useCallback } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useCoarsePointer } from '@/hooks/useCoarsePointer'
import { FONT_FAMILY } from '@/engine/textMeasure'
import type { TextLayer } from '@/types/design'

interface Props {
  zoom: number
}

export function TextEditOverlay({ zoom }: Props) {
  const editingTextLayerId = useDesignStore((s) => s.editingTextLayerId)
  const layers = useDesignStore((s) => s.document.layers)
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const setEditingTextLayerId = useDesignStore((s) => s.setEditingTextLayerId)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isCommitting = useRef(false)
  // On touch, MobileTextEditor takes over with a fullscreen field instead.
  const coarse = useCoarsePointer()

  const layer = editingTextLayerId
    ? (layers.find((l) => l.id === editingTextLayerId) as TextLayer | undefined)
    : null

  // Focus textarea on enter — place cursor at end rather than select-all
  // so the user can click inside to position their cursor
  useEffect(() => {
    if (!layer || !textareaRef.current) return

    const el = textareaRef.current
    // Small delay to ensure DOM is ready
    requestAnimationFrame(() => {
      el.focus()
      // Place cursor at end instead of selecting all text
      const len = el.value.length
      el.setSelectionRange(len, len)
    })

    // Push snapshot when starting to edit
    pushSnapshot()
    isCommitting.current = false
  }, [layer?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(() => {
    if (isCommitting.current) return
    isCommitting.current = true

    if (!textareaRef.current || !layer) {
      setEditingTextLayerId(null)
      return
    }

    const newContent = textareaRef.current.value
    if (newContent !== layer.content) {
      updateLayer<TextLayer>(layer.id, { content: newContent })
    }
    setEditingTextLayerId(null)
  }, [layer, updateLayer, setEditingTextLayerId])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      commit()
    }
    // Allow Enter for newlines (no commit on Enter — use Escape or click outside)
    // Stop propagation so keyboard shortcuts don't fire while typing
    e.stopPropagation()
  }, [commit])

  if (!layer || coarse) return null

  // Calculate overlay position and styling to match canvas render exactly
  const x = layer.x * zoom
  const y = layer.y * zoom
  const w = layer.width * zoom
  const fontSize = layer.fontSize * zoom
  const lineHeightValue = layer.lineHeight
  const letterSpacingPx = layer.letterSpacing * fontSize

  // Apply text transform to show what user will see
  const displayTransform = layer.textTransform === 'uppercase'
    ? 'uppercase' as const
    : layer.textTransform === 'lowercase'
      ? 'lowercase' as const
      : 'none' as const

  const h = layer.height * zoom

  return (
    <textarea
      ref={textareaRef}
      className="absolute resize-none"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        fontFamily: FONT_FAMILY,
        fontSize,
        fontWeight: layer.fontWeight,
        color: layer.color.hex,
        textAlign: layer.textAlign,
        letterSpacing: `${letterSpacingPx}px`,
        lineHeight: lineHeightValue,
        textTransform: displayTransform,
        // Match canvas rendering. Use an *outline* (drawn outside the box, no
        // layout impact) rather than a border — a border with box-sizing:border-box
        // would inset the text 2px and make it jump on entering/leaving edit mode.
        padding: '0',
        margin: '0',
        outline: '2px solid #0017c7',
        outlineOffset: '0px',
        borderRadius: '2px',
        background: 'rgba(255,255,255,0.15)',
        zIndex: 100,
        cursor: 'text',
        // Prevent browser default textarea styling
        overflow: 'hidden',
        wordWrap: 'break-word',
        whiteSpace: 'pre-wrap',
        boxSizing: 'border-box',
        // Match canvas text rendering baseline
        verticalAlign: 'top',
        // Prevent scrollbars
        scrollbarWidth: 'none',
      }}
      defaultValue={layer.content}
      // Commit live so the box re-hugs as you type — an auto-width text grows
      // with its text instead of clipping inside the old width until blur. The
      // textarea stays uncontrolled (defaultValue), so the caret never jumps.
      onChange={(e) => updateLayer<TextLayer>(layer.id, { content: e.target.value })}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      // Prevent canvas interactions while editing
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
