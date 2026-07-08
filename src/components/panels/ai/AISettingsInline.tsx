import { useAIStore } from '@/store/useAIStore'
import { AI_MODELS, normalizeAIModel } from '@/lib/aiModels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronDown } from 'lucide-react'

export function AISettingsInline({ onDone, showBackButton }: { onDone?: () => void; showBackButton?: boolean }) {
  const model = useAIStore((s) => s.model)
  const productName = useAIStore((s) => s.productName)
  const productDescription = useAIStore((s) => s.productDescription)
  const targetAudience = useAIStore((s) => s.targetAudience)
  const brandVoice = useAIStore((s) => s.brandVoice)
  const callToAction = useAIStore((s) => s.callToAction)
  const setModel = useAIStore((s) => s.setModel)
  const setProductContext = useAIStore((s) => s.setProductContext)

  return (
    <div className="space-y-4">
      {showBackButton && (
        <button
          className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          onClick={onDone}
        >
          <ChevronDown className="w-3.5 h-3.5 rotate-90" />
          Back to chat
        </button>
      )}

      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        AI Settings
      </div>

      {/* Model */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Model</label>
        <select
          className="w-full px-2 py-1.5 text-[13px] bg-white border border-border rounded-[5px] outline-none cursor-pointer"
          value={normalizeAIModel(model)}
          onChange={(e) => setModel(e.target.value)}
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Product context */}
      <div className="space-y-3 pt-3 border-t border-border">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
          Product Context
        </div>

        <div className="space-y-1.5">
          <label className="text-[13px] text-muted-foreground font-normal">Product Name</label>
          <Input className="rounded-[5px]" value={productName} onChange={(e) => setProductContext({ productName: e.target.value })} />
        </div>

        <div className="space-y-1.5">
          <label className="text-[13px] text-muted-foreground font-normal">Description</label>
          <textarea
            className="w-full min-h-[50px] px-2 py-1.5 text-[13px] bg-white border border-border rounded-[5px] resize-none outline-none focus:ring-1 focus:ring-ring"
            value={productDescription}
            onChange={(e) => setProductContext({ productDescription: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[13px] text-muted-foreground font-normal">Target Audience</label>
          <textarea
            className="w-full min-h-[40px] px-2 py-1.5 text-[13px] bg-white border border-border rounded-[5px] resize-none outline-none focus:ring-1 focus:ring-ring"
            value={targetAudience}
            onChange={(e) => setProductContext({ targetAudience: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[13px] text-muted-foreground font-normal">Brand Voice</label>
          <textarea
            className="w-full min-h-[40px] px-2 py-1.5 text-[13px] bg-white border border-border rounded-[5px] resize-none outline-none focus:ring-1 focus:ring-ring"
            value={brandVoice}
            onChange={(e) => setProductContext({ brandVoice: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[13px] text-muted-foreground font-normal">Default CTA</label>
          <Input className="rounded-[5px]" value={callToAction} onChange={(e) => setProductContext({ callToAction: e.target.value })} />
        </div>
      </div>

      {onDone && (
        <Button className="w-full rounded-[5px]" onClick={onDone}>
          {showBackButton ? 'Save & Return' : 'Done — Start Creating'}
        </Button>
      )}
    </div>
  )
}
