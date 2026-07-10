import { useDesignStore } from '@/store/useDesignStore'
import { useIsProMode } from '@/hooks/useIsProMode'
import { AlignmentPanel } from '@/components/panels/AlignmentPanel'
import { BackgroundPanel } from '@/components/panels/BackgroundPanel'
import { TextPropertiesPanel } from '@/components/panels/TextPropertiesPanel'
import { ImagePropertiesPanel } from '@/components/panels/ImagePropertiesPanel'
import { ShapePropertiesPanel } from '@/components/panels/ShapePropertiesPanel'
import { SvgPropertiesPanel } from '@/components/panels/SvgPropertiesPanel'
import { DrawPropertiesPanel } from '@/components/panels/DrawPropertiesPanel'
import { GradientPropertiesPanel } from '@/components/panels/GradientPropertiesPanel'
import { EffectsPanel } from '@/components/panels/EffectsPanel'
import { PositionSizePanel } from '@/components/panels/PositionSizePanel'
import { AutoLayoutPanel } from '@/components/panels/AutoLayoutPanel'
import { LayoutGrid } from 'lucide-react'
import type { TextLayer, ImageLayer, ShapeLayer, SvgLayer, GradientLayer, DrawLayer, Layer } from '@/types/design'

/**
 * The properties inspector for the active layer. Shared by the desktop right
 * sidebar and the mobile property bottom sheet.
 */
export function LayerInspector({ layer }: { layer: Layer }) {
  const isPro = useIsProMode()

  // Figma-style hierarchy: geometry and layout first (they're universal to every
  // object — where it is, how big, how it's laid out), then the type-specific
  // content (typography, fill…), then effects last.
  return (
    <>
      <AlignmentPanel />
      {layer.type !== 'background' && <PositionSizePanel layer={layer} />}
      <AutoLayoutSection layer={layer} />
      <LayerTypeInspector layer={layer} />
      {isPro && layer.type !== 'background' && <EffectsPanel layer={layer} />}
    </>
  )
}

// Auto Layout: the config panel when the active layer's group has one, else an
// "Add auto layout" CTA when ≥2 layers are selected (a group-able selection).
//
// A selection spanning more than one *unit* (multiple Auto Layout groups, or a
// group plus loose layers) shows the CTA even though the active layer already
// has a config — applying then *nests* those units into a new outer layout
// rather than editing the active group.
function AutoLayoutSection({ layer }: { layer: Layer }) {
  const groupId = layer.groupId
  const config = useDesignStore((s) => (groupId ? s.document.autoLayouts?.[groupId] : undefined))
  const autoLayouts = useDesignStore((s) => s.document.autoLayouts)
  const layers = useDesignStore((s) => s.document.layers)
  const selectedLayerIds = useDesignStore((s) => s.selectedLayerIds)
  const applyAutoLayout = useDesignStore((s) => s.applyAutoLayout)

  const selectedLayers = layers.filter((l) => selectedLayerIds.has(l.id) && l.type !== 'background')
  const selectedCount = selectedLayers.length
  // Distinct layout units in the selection: each Auto Layout group counts once;
  // every loose layer is its own unit.
  const unitCount = new Set(
    selectedLayers.map((l) => (l.groupId && autoLayouts?.[l.groupId] ? `g:${l.groupId}` : `l:${l.id}`)),
  ).size
  const isSingleAutoLayoutUnit = !!(groupId && config) && unitCount === 1

  if (isSingleAutoLayoutUnit && groupId) {
    return (
      <div className="pb-4 mb-4 border-b border-border">
        <AutoLayoutPanel groupId={groupId} activeLayer={layer} />
      </div>
    )
  }
  if (selectedCount >= 2) {
    return (
      <div className="pb-4 mb-4 border-b border-border">
        <button
          className="flex w-full items-center justify-center gap-1.5 py-2 text-[12px] bg-muted text-foreground rounded-[5px] cursor-pointer transition-[transform,background-color] duration-150 hover:bg-muted/70 active:scale-[0.98]"
          onClick={() => applyAutoLayout()}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          Add auto layout
        </button>
      </div>
    )
  }
  return null
}

function LayerTypeInspector({ layer }: { layer: Layer }) {
  const isPro = useIsProMode()

  switch (layer.type) {
    case 'background':
      return <BackgroundPanel />
    case 'text':
      return <TextPropertiesPanel layer={layer as TextLayer} />
    case 'image':
      return <ImagePropertiesPanel layer={layer as ImageLayer} />
    case 'shape':
      return <ShapePropertiesPanel layer={layer as ShapeLayer} />
    case 'gradient':
      return isPro ? <GradientPropertiesPanel layer={layer as GradientLayer} /> : null
    case 'svg':
      return <SvgPropertiesPanel layer={layer as SvgLayer} />
    case 'draw':
      return <DrawPropertiesPanel layer={layer as DrawLayer} />
    default:
      return null
  }
}
