import { useState } from 'react'
import { useDesignStore } from '@/store/useDesignStore'
import { AD_FORMATS } from '@/brand/formats'
import { autoResize } from '@/engine/autoResize'
import { exportDesign, downloadBlob } from '@/engine/compositor'
import { Button } from '@/components/ui/button'
import { Download, Loader2 } from 'lucide-react'

export function AutoResizePanel() {
  const document = useDesignStore((s) => s.document)
  const [exporting, setExporting] = useState(false)

  // Formats other than the current one
  const otherFormats = AD_FORMATS.filter((f) => f.id !== document.format.id)

  const handleExportAll = async () => {
    setExporting(true)
    try {
      for (const format of AD_FORMATS) {
        const resized = format.id === document.format.id
          ? document
          : autoResize(document, format)

        const blob = await exportDesign(resized, {
          format: 'png',
          quality: 1,
          dpr: 2,
        })

        const filename = `${document.name.replace(/\s+/g, '-').toLowerCase()}-${format.id}-2x.png`
        downloadBlob(blob, filename)

        // Small delay between downloads so browser doesn't block them
        await new Promise((r) => setTimeout(r, 300))
      }
    } finally {
      setExporting(false)
    }
  }

  const handleExportSingle = async (formatId: string) => {
    const format = AD_FORMATS.find((f) => f.id === formatId)
    if (!format) return

    const resized = autoResize(document, format)
    const blob = await exportDesign(resized, {
      format: 'png',
      quality: 1,
      dpr: 2,
    })

    const filename = `${document.name.replace(/\s+/g, '-').toLowerCase()}-${format.id}-2x.png`
    downloadBlob(blob, filename)
  }

  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        Auto-Resize
      </div>

      <p className="text-[13px] text-muted-foreground">
        Export your design resized for all ad platforms. Layers scale proportionally and reposition automatically.
      </p>

      {/* Current format */}
      <div className="text-[11px] text-foreground/80">
        Source: <span className="font-medium">{document.format.label}</span>
        {' '}<span className="tabular-nums">({document.format.width} x {document.format.height})</span>
      </div>

      {/* Format previews */}
      <div className="space-y-1.5">
        {otherFormats.map((format) => {
          const maxW = 48
          const maxH = 32
          const scale = Math.min(maxW / format.width, maxH / format.height)
          const previewW = format.width * scale
          const previewH = format.height * scale

          return (
            <div
              key={format.id}
              className="flex items-center gap-3 p-2 bg-muted/30 rounded-[5px]"
            >
              <div
                className="border border-border/50 rounded-[2px] bg-muted/50 shrink-0"
                style={{ width: previewW, height: previewH }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{format.label}</div>
                <div className="text-[9px] text-muted-foreground tabular-nums">
                  {format.width * 2} x {format.height * 2}px @2x
                </div>
              </div>
              <button
                className="p-1.5 hover:bg-muted rounded-[5px] text-muted-foreground hover:text-foreground transition-[color,background-color,transform] active:scale-[0.96]"
                onClick={() => handleExportSingle(format.id)}
                title={`Export ${format.label}`}
                aria-label={`Export ${format.label}`}
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      {/* Export all */}
      <Button
        className="w-full rounded-[5px]"
        onClick={handleExportAll}
        disabled={exporting}
      >
        {exporting ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Exporting...</>
        ) : (
          <><Download className="w-4 h-4 mr-2" /> Export All Formats</>
        )}
      </Button>
    </div>
  )
}
