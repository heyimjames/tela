import { Shuffle } from 'lucide-react'
import { useDesignStore } from '@/store/useDesignStore'
import { randomAvatarDataUrl } from '@/brand/avatars'
// import { SliderField } from '@/components/controls/SliderField'

import type { ImageLayer } from '@/types/design'

// SliderField still used for Opacity and Rotation

interface Props {
  layer: ImageLayer
}

export function ImagePropertiesPanel({ layer }: Props) {
  const updateLayer = useDesignStore((s) => s.updateLayer)
  const pushSnapshot = useDesignStore((s) => s.pushSnapshot)

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    pushSnapshot()
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      updateLayer<ImageLayer>(layer.id, { imageUrl: dataUrl })
    }
    reader.readAsDataURL(file)
  }

  const handleShuffle = async () => {
    // Exclude the current face so the shuffle always visibly changes.
    const dataUrl = await randomAvatarDataUrl(layer.imageUrl)
    pushSnapshot()
    updateLayer<ImageLayer>(layer.id, { imageUrl: dataUrl })
  }

  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        {layer.avatarSet ? 'Avatar' : 'Image'}
      </div>

      {/* Shuffle — cycle through the bundled avatar set (avatar images only). */}
      {layer.avatarSet && (
        <button
          onClick={() => void handleShuffle()}
          className="flex w-full items-center justify-center gap-1.5 py-2 text-[11px] bg-foreground text-background rounded-[5px] cursor-pointer transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
        >
          <Shuffle className="size-3.5" strokeWidth={2} />
          Shuffle photo
        </button>
      )}

      {/* Upload */}
      <div>
        <label
          className="block w-full py-2 text-center text-[11px] bg-muted text-muted-foreground rounded-[5px] cursor-pointer hover:bg-muted/80 transition-colors"
        >
          {layer.imageUrl ? 'Replace Image' : 'Upload Image'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
        </label>
      </div>

      {/* Fit mode */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Fit</label>
        <div className="flex gap-1">
          {(['cover', 'contain', 'fill'] as const).map((fit) => (
            <button
              key={fit}
              className={`
                flex-1 py-1 text-[12px] rounded-[5px] transition-colors duration-150
                ${layer.fit === fit
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'}
              `}
              onClick={() => {
                pushSnapshot()
                updateLayer<ImageLayer>(layer.id, { fit })
              }}
            >
              {fit.charAt(0).toUpperCase() + fit.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Border radius — brand-constrained presets */}
      <div className="space-y-1.5">
        <label className="text-[13px] text-muted-foreground font-normal">Corner Radius</label>
        <div className="flex gap-1 flex-wrap">
          {[
            { label: '0', value: 0 },
            { label: '3px', value: 3 },
            { label: '5px', value: 5 },
            { label: '7px', value: 7 },
            { label: '8px', value: 8 },
            { label: '12px', value: 12 },
            { label: 'Full', value: 9999 },
          ].map((r) => (
            <button
              key={r.value}
              className={`
                px-2.5 py-1 text-[12px] rounded-[5px] transition-colors duration-150
                ${layer.borderRadius === r.value
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'}
              `}
              onClick={() => {
                pushSnapshot()
                updateLayer<ImageLayer>(layer.id, { borderRadius: r.value })
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Position, Size, Opacity, Rotation are in PositionSizePanel */}
    </div>
  )
}
