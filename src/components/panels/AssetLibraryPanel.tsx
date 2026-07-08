import { useRef } from 'react'
import { useAssetStore, ASSET_CATEGORIES } from '@/store/useAssetStore'
import { useDesignStore } from '@/store/useDesignStore'
import { Upload, Search, Trash2, Plus } from 'lucide-react'
import { measureImportedSvg } from '@/engine/svgMeasure'
import type { ImageLayer, SvgLayer } from '@/types/design'

export function AssetLibraryPanel() {
  const assets = useAssetStore((s) => s.getFilteredAssets())
  const searchQuery = useAssetStore((s) => s.searchQuery)
  const activeCategory = useAssetStore((s) => s.activeCategory)
  const setSearchQuery = useAssetStore((s) => s.setSearchQuery)
  const setActiveCategory = useAssetStore((s) => s.setActiveCategory)
  const addAsset = useAssetStore((s) => s.addAsset)
  const removeAsset = useAssetStore((s) => s.removeAsset)
  const addLayer = useDesignStore((s) => s.addLayer)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/') || file.name.endsWith('.svg')) {
        await addAsset(file)
      }
    }
  }

  const handleAddToCanvas = (asset: typeof assets[0]) => {
    if (asset.type === 'svg' || asset.type === 'icon') {
      // Decode base64 back to SVG string
      const raw = atob(asset.dataUrl.split(',')[1] ?? '')
      const { svgContent, width, height } = measureImportedSvg(raw)
      addLayer({
        type: 'svg',
        name: asset.name,
        visible: true,
        locked: false,
        opacity: 1,
        x: 100,
        y: 100,
        width,
        height,
        rotation: 0,
        svgContent,
      } satisfies Omit<SvgLayer, 'id' | 'zIndex'>)
    } else {
      addLayer({
        type: 'image',
        name: asset.name,
        visible: true,
        locked: false,
        opacity: 1,
        x: 100,
        y: 100,
        width: Math.min(asset.width ?? 400, 400),
        height: Math.min(asset.height ?? 300, 300),
        rotation: 0,
        imageUrl: asset.dataUrl,
        fit: 'cover',
        cropX: 0,
        cropY: 0,
        cropW: 1,
        cropH: 1,
        borderRadius: 0,
      } satisfies Omit<ImageLayer, 'id' | 'zIndex'>)
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60 font-medium">
        Asset Library
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
        <input
          className="w-full pl-9 pr-3 py-2 text-[13px] bg-white border border-border rounded-[5px] outline-none focus:ring-1 focus:ring-ring"
          placeholder="Search assets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Categories */}
      <div className="flex gap-1 flex-wrap">
        {ASSET_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            className={`
              px-2.5 py-1 text-[12px] rounded-[5px] transition-colors cursor-pointer
              ${activeCategory === cat.id
                ? 'bg-foreground text-background'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'}
            `}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Upload */}
      <div
        className="border-2 border-dashed border-border rounded-[7px] p-4 text-center cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-colors"
        onClick={() => fileInputRef.current?.click()}
        onDrop={(e) => {
          e.preventDefault()
          handleUpload(e.dataTransfer.files)
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        <Upload className="w-5 h-5 mx-auto mb-2 text-muted-foreground/40" />
        <p className="text-[12px] text-muted-foreground">Drop files or click to upload</p>
        <p className="text-[10px] text-muted-foreground/50 mt-1">PNG, JPG, SVG</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.svg"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {/* Assets grid */}
      {assets.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/50 text-center py-4">
          No assets yet. Upload images, SVGs, or icons.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="group relative aspect-square bg-white border border-border rounded-[5px] overflow-hidden cursor-grab hover:border-primary/30 transition-colors active:cursor-grabbing"
              draggable
              onClick={() => handleAddToCanvas(asset)}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/jj-asset', JSON.stringify({
                  id: asset.id,
                  name: asset.name,
                  type: asset.type,
                  dataUrl: asset.dataUrl,
                  width: asset.width,
                  height: asset.height,
                }))
                e.dataTransfer.effectAllowed = 'copy'
              }}
              title={`${asset.name} — Click or drag to canvas`}
            >
              <img
                src={asset.dataUrl}
                alt={asset.name}
                className="w-full h-full object-contain p-1"
              />

              {/* Delete button */}
              <button
                className="absolute top-1 right-1 p-1 bg-white/90 rounded-[3px] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  removeAsset(asset.id)
                }}
                aria-label={`Delete ${asset.name}`}
              >
                <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
              </button>

              {/* Name */}
              <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[9px] text-white truncate block">{asset.name}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
