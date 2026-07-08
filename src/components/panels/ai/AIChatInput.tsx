import { useRef } from 'react'
import {
  PenLine,
  LayoutTemplate,
  Lightbulb,
  Send,
  X,
} from 'lucide-react'

export type QuickAction = 'copy' | 'design' | 'hooks'

interface AIChatInputProps {
  input: string
  setInput: (value: string) => void
  isStreaming: boolean
  onSend: (text: string) => void
  onQuickAction: (action: QuickAction) => void
  onStop: () => void
}

export function AIChatInput({
  input,
  setInput,
  isStreaming,
  onSend,
  onQuickAction,
  onStop,
}: AIChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend(input)
    }
  }

  return (
    <div className="shrink-0 border-t border-border p-2 space-y-2">
      {/* Quick action buttons */}
      {!isStreaming && (
        <div className="flex gap-1.5">
          <button
            className="flex items-center gap-1 px-2 py-1.5 text-[11px] bg-muted/50 hover:bg-muted rounded-[5px] transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={() => onQuickAction('copy')}
          >
            <PenLine className="w-3 h-3" />
            Write copy
          </button>
          <button
            className="flex items-center gap-1 px-2 py-1.5 text-[11px] bg-muted/50 hover:bg-muted rounded-[5px] transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={() => onQuickAction('design')}
          >
            <LayoutTemplate className="w-3 h-3" />
            Design ad
          </button>
          <button
            className="flex items-center gap-1 px-2 py-1.5 text-[11px] bg-muted/50 hover:bg-muted rounded-[5px] transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={() => onQuickAction('hooks')}
          >
            <Lightbulb className="w-3 h-3" />
            Hooks
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="flex gap-1.5 items-end">
        <textarea
          ref={inputRef}
          className="flex-1 min-h-[36px] max-h-[100px] px-2.5 py-2 text-[13px] bg-white border border-border rounded-[6px] resize-none outline-none focus:ring-1 focus:ring-ring leading-snug"
          placeholder="Ask anything about your ad..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button
            className="shrink-0 p-2 rounded-[6px] bg-destructive/10 text-destructive hover:bg-destructive/20 transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer"
            onClick={onStop}
            title="Stop"
            aria-label="Stop generating"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            className="shrink-0 p-2 rounded-[6px] bg-primary text-primary-foreground hover:bg-primary/90 transition-[color,background-color,transform] active:scale-[0.96] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => onSend(input)}
            disabled={!input.trim()}
            title="Send"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
