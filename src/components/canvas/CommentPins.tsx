import { useState, useRef, useEffect } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { useProjectStore } from '@/store/useProjectStore'
import { MessageCircle, Check, X } from 'lucide-react'
import type { Comment } from '@/types/project'

interface CommentPinsProps {
  zoom: number
}

export function CommentPins({ zoom }: CommentPinsProps) {
  const tool = useDesignStore((s) => s.tool)
  const isCommentMode = tool === 'comment'

  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const projects = useProjectStore((s) => s.projects)
  const addComment = useProjectStore((s) => s.addComment)
  const resolveComment = useProjectStore((s) => s.resolveComment)

  // Find the first design in the active project (current canvas = first design)
  const activeProject = activeProjectId
    ? projects.find((p) => p.id === activeProjectId)
    : null
  const firstDesign = activeProject?.designs?.[0]
  const comments: Comment[] = firstDesign?.comments ?? []

  const [activePinId, setActivePinId] = useState<string | null>(null)
  const [newPinPos, setNewPinPos] = useState<{ x: number; y: number } | null>(null)
  const [newText, setNewText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus new pin input
  useEffect(() => {
    if (newPinPos && inputRef.current) {
      inputRef.current.focus()
    }
  }, [newPinPos])

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!isCommentMode) return

    // Ignore clicks on pins themselves
    if ((e.target as HTMLElement).closest('[data-comment-pin]')) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.round((e.clientX - rect.left) / zoom)
    const y = Math.round((e.clientY - rect.top) / zoom)

    setNewPinPos({ x, y })
    setNewText('')
    setActivePinId(null)
  }

  const submitNewComment = () => {
    if (!newText.trim() || !newPinPos) return

    if (!activeProjectId) {
      // Auto-create a project if none exists
      const pid = useProjectStore.getState().createProject('My Project')
      const designStore = useDesignStore.getState()
      const did = useProjectStore.getState().addDesign(pid, designStore.document)
      useProjectStore.getState().setActiveProject(pid)
      useProjectStore.getState().addComment(pid, did, newText.trim(), 'You', newPinPos.x, newPinPos.y)
    } else if (firstDesign) {
      addComment(activeProjectId, firstDesign.id, newText.trim(), 'You', newPinPos.x, newPinPos.y)
    } else {
      // Project exists but no design — add one
      const designStore = useDesignStore.getState()
      const did = useProjectStore.getState().addDesign(activeProjectId, designStore.document)
      addComment(activeProjectId, did, newText.trim(), 'You', newPinPos.x, newPinPos.y)
    }

    setNewPinPos(null)
    setNewText('')
  }

  const handleResolve = (commentId: string) => {
    if (!activeProjectId || !firstDesign) return
    resolveComment(activeProjectId, firstDesign.id, commentId)
    setActivePinId(null)
  }

  // Only render when there are comments or in comment mode
  if (!isCommentMode && comments.length === 0) return null

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 50 }}
    >
      {/* Click catcher for comment mode */}
      {isCommentMode && (
        <div
          className="absolute inset-0 pointer-events-auto"
          style={{ cursor: 'crosshair' }}
          onClick={handleCanvasClick}
        />
      )}

      {/* Existing comment pins */}
      {comments.map((comment, index) => {
        if (comment.pinX == null || comment.pinY == null) return null
        const isActive = activePinId === comment.id
        const isResolved = comment.resolved

        return (
          <div
            key={comment.id}
            data-comment-pin
            className="absolute pointer-events-auto"
            style={{
              left: comment.pinX * zoom - 14,
              top: comment.pinY * zoom - 14,
            }}
          >
            {/* Pin marker */}
            <button
              aria-label={`Comment ${index + 1}`}
              className={`
                w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums
                shadow-[0_2px_8px_rgba(0,0,0,0.15)] cursor-pointer transition-[color,background-color,transform,opacity] duration-150
                ${isResolved
                  ? 'bg-muted text-muted-foreground/50 opacity-50'
                  : 'bg-primary text-primary-foreground hover:scale-110'}
              `}
              onClick={(e) => {
                e.stopPropagation()
                setActivePinId(isActive ? null : comment.id)
                setNewPinPos(null)
              }}
            >
              {index + 1}
            </button>

            {/* Comment popover */}
            {isActive && (
              <div
                className="absolute top-8 left-0 bg-card border border-border rounded-[7px] shadow-[0_8px_30px_-4px_rgba(17,17,17,0.12)] p-3 min-w-[200px] max-w-[280px] z-50"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-[11px] font-medium text-foreground">{comment.author}</span>
                  <span className="text-[10px] text-muted-foreground/50 shrink-0">
                    {new Date(comment.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className={`text-[13px] leading-relaxed ${isResolved ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {comment.text}
                </p>
                {!isResolved && (
                  <button
                    className="mt-2 flex items-center gap-1 px-2 py-1 text-[11px] text-primary bg-primary/10 rounded-[4px] hover:bg-primary/20 transition-colors cursor-pointer"
                    onClick={() => handleResolve(comment.id)}
                  >
                    <Check className="w-3 h-3" />
                    Resolve
                  </button>
                )}
                {isResolved && (
                  <span className="mt-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground/50">
                    <Check className="w-3 h-3" />
                    Resolved
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* New pin being placed */}
      {newPinPos && (
        <div
          data-comment-pin
          className="absolute pointer-events-auto"
          style={{
            left: newPinPos.x * zoom - 14,
            top: newPinPos.y * zoom - 14,
          }}
        >
          <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.15)] animate-in zoom-in-50 duration-150">
            <MessageCircle className="w-3.5 h-3.5" />
          </div>
          <div
            className="absolute top-8 left-0 bg-card border border-border rounded-[7px] shadow-[0_8px_30px_-4px_rgba(17,17,17,0.12)] p-2 min-w-[220px] z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                className="flex-1 px-2 py-1.5 text-[13px] bg-white border border-border rounded-[5px] outline-none focus:ring-1 focus:ring-ring"
                placeholder="Add a comment..."
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNewComment()
                  if (e.key === 'Escape') setNewPinPos(null)
                }}
              />
              <button
                aria-label="Add comment"
                className="p-1.5 rounded-[5px] bg-primary text-primary-foreground hover:bg-primary/90 transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer disabled:opacity-40"
                onClick={submitNewComment}
                disabled={!newText.trim()}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                aria-label="Cancel comment"
                className="p-1.5 rounded-[5px] bg-muted text-muted-foreground hover:bg-muted/80 transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer"
                onClick={() => setNewPinPos(null)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
