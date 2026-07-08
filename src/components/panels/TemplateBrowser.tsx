import { useState } from 'react'
import { nanoid } from 'nanoid'
import { DESIGN_TEMPLATES, TEMPLATE_CATEGORIES } from '@/brand/templates'
import { DEFAULT_FORMAT } from '@/brand/formats'
import { getBrandColor } from '@/brand/palette'
import type { DesignDocument } from '@/types/design'
import { useDesignStore } from '@/store/useDesignStore'
import { useRouterStore } from '@/store/useRouterStore'
import { useProjectStore } from '@/store/useProjectStore'
import { Button } from '@/components/ui/button'
import { Layout, X } from 'lucide-react'

interface Props {
  projectId?: string
  onClose: () => void
}

export function TemplateBrowser({ projectId, onClose }: Props) {
  const [category, setCategory] = useState<string>('all')
  const navigate = useRouterStore((s) => s.navigate)

  const filtered = category === 'all'
    ? DESIGN_TEMPLATES
    : DESIGN_TEMPLATES.filter((t) => t.category === category)

  const handleSelect = (templateId: string) => {
    const template = DESIGN_TEMPLATES.find((t) => t.id === templateId)
    if (!template) return

    const doc = template.create()

    if (projectId) {
      // Add to project and open in editor
      const designId = useProjectStore.getState().addDesign(projectId, doc)
      useDesignStore.setState({ document: doc })
      navigate({ page: 'editor', projectId, designId })
    } else {
      // Standalone — just load into editor
      useDesignStore.setState({ document: doc })
      navigate({ page: 'editor-standalone' })
    }

    onClose()
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      <div
        className="relative bg-white rounded-[12px] shadow-xl w-[760px] max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Layout className="w-5 h-5 text-primary" />
            <h2 className="text-[17px] font-semibold text-foreground">Start from a template</h2>
          </div>
          <button className="p-1.5 hover:bg-muted rounded-[5px] cursor-pointer transition-[background-color,transform] active:scale-[0.96]" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 px-6 py-3 border-b border-border">
          <FilterTab label="All" active={category === 'all'} onClick={() => setCategory('all')} />
          {TEMPLATE_CATEGORIES.map((cat) => (
            <FilterTab
              key={cat.id}
              label={cat.label}
              active={category === cat.id}
              onClick={() => setCategory(cat.id)}
            />
          ))}
        </div>

        {/* Template grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            {filtered.map((template) => (
              <button
                key={template.id}
                className="group text-left bg-white border border-border rounded-[7px] overflow-hidden hover:shadow-[0_8px_30px_-4px_rgba(17,17,17,0.12)] transition-shadow cursor-pointer"
                onClick={() => handleSelect(template.id)}
              >
                {/* Preview placeholder */}
                <div className="aspect-[1.6/1] bg-muted/50 flex items-center justify-center">
                  <span className="text-[12px] text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors">
                    {template.formatId.replace('-', ' ')}
                  </span>
                </div>
                <div className="p-3">
                  <div className="text-[14px] font-medium text-foreground mb-0.5">{template.name}</div>
                  <div className="text-[12px] text-muted-foreground">{template.description}</div>
                </div>
              </button>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-12 text-[14px] text-muted-foreground">
              No templates in this category yet.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border flex justify-between items-center">
          <button
            className="text-[13px] text-primary hover:underline cursor-pointer"
            onClick={() => {
              // Start with blank
              const now = new Date().toISOString()
              const doc: DesignDocument = {
                id: nanoid(),
                name: 'Untitled Ad',
                format: DEFAULT_FORMAT,
                layers: [{
                  id: nanoid(), type: 'background', name: 'Background',
                  visible: true, locked: false, opacity: 1,
                  x: 0, y: 0, width: DEFAULT_FORMAT.width, height: DEFAULT_FORMAT.height,
                  rotation: 0, zIndex: 0,
                  fill: { type: 'solid', color: getBrandColor('cloud') },
                }],
                createdAt: now, updatedAt: now,
              }
              useDesignStore.setState({ document: doc })
              if (projectId) {
                const designId = useProjectStore.getState().addDesign(projectId, doc)
                navigate({ page: 'editor', projectId, designId })
              } else {
                navigate({ page: 'editor-standalone' })
              }
              onClose()
            }}
          >
            Start with blank canvas
          </button>
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {DESIGN_TEMPLATES.length} templates
          </span>
        </div>
      </div>
    </div>
  )
}

function FilterTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`
        px-3 py-1.5 text-[13px] rounded-[5px] transition-colors cursor-pointer
        ${active ? 'bg-foreground text-background font-medium' : 'text-muted-foreground hover:bg-muted/80'}
      `}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
