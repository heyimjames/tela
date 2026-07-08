import { AD_FORMATS } from '@/brand/formats'
import { useDesignStore } from '@/store/useDesignStore'
import type { AdFormat } from '@/types/design'

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  generic: 'Generic',
}

interface Props {
  onClose?: () => void
}

export function FormatSelector({ onClose }: Props) {
  const currentFormat = useDesignStore((s) => s.document.format)
  const setFormat = useDesignStore((s) => s.setFormat)

  // Group by platform
  const grouped = AD_FORMATS.reduce((acc, format) => {
    const key = format.platform
    if (!acc[key]) acc[key] = []
    acc[key].push(format)
    return acc
  }, {} as Record<string, AdFormat[]>)

  return (
    <div className="space-y-3 p-1">
      {Object.entries(grouped).map(([platform, formats]) => (
        <div key={platform}>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium px-2 mb-1">
            {PLATFORM_LABELS[platform] ?? platform}
          </div>
          {formats.map((format) => {
            const isActive = currentFormat.id === format.id
            const maxPreviewW = 32
            const maxPreviewH = 24
            const scale = Math.min(maxPreviewW / format.width, maxPreviewH / format.height)
            const previewW = format.width * scale
            const previewH = format.height * scale

            return (
              <button
                key={format.id}
                className={`
                  w-full flex items-center gap-3 px-2 py-1.5 rounded-[5px] text-left transition-colors duration-100
                  ${isActive ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/50 text-foreground/80'}
                `}
                onClick={() => {
                  setFormat(format)
                  onClose?.()
                }}
              >
                {/* Aspect ratio preview */}
                <div
                  className="border border-muted-foreground/40 rounded-[2px] bg-muted-foreground/25 shrink-0"
                  style={{ width: previewW, height: previewH }}
                />

                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium truncate">{format.label}</div>
                  <div className="text-[9px] text-muted-foreground tabular-nums">
                    {format.width} x {format.height} ({format.aspectRatio})
                  </div>
                </div>

                {isActive && (
                  <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
