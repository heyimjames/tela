import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'

export interface Asset {
  id: string
  name: string
  type: 'image' | 'svg' | 'icon'
  dataUrl: string
  thumbnailUrl?: string
  width?: number
  height?: number
  category: string
  createdAt: string
}

interface AssetStore {
  assets: Asset[]
  searchQuery: string
  activeCategory: string

  addAsset: (file: File) => Promise<string>
  addSvgAsset: (name: string, svgContent: string, category?: string) => string
  removeAsset: (id: string) => void
  renameAsset: (id: string, name: string) => void
  setSearchQuery: (query: string) => void
  setActiveCategory: (category: string) => void
  getFilteredAssets: () => Asset[]
}

export const ASSET_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'logos', label: 'Logos' },
  { id: 'photos', label: 'Photos' },
  { id: 'icons', label: 'Icons' },
  { id: 'graphics', label: 'Graphics' },
]

export const useAssetStore = create<AssetStore>()(
  persist(
    (set, get) => ({
      assets: [],
      searchQuery: '',
      activeCategory: 'all',

      addAsset: async (file) => {
        const id = nanoid()
        const isSvg = file.type === 'image/svg+xml' || file.name.endsWith('.svg')

        return new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string

            // Get image dimensions
            if (!isSvg) {
              const img = new Image()
              img.onload = () => {
                const asset: Asset = {
                  id,
                  name: file.name.replace(/\.[^.]+$/, ''),
                  type: isSvg ? 'svg' : 'image',
                  dataUrl,
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                  category: 'photos',
                  createdAt: new Date().toISOString(),
                }
                set((s) => ({ assets: [asset, ...s.assets] }))
                resolve(id)
              }
              img.src = dataUrl
            } else {
              const asset: Asset = {
                id,
                name: file.name.replace(/\.[^.]+$/, ''),
                type: 'svg',
                dataUrl,
                category: 'graphics',
                createdAt: new Date().toISOString(),
              }
              set((s) => ({ assets: [asset, ...s.assets] }))
              resolve(id)
            }
          }
          reader.readAsDataURL(file)
        })
      },

      addSvgAsset: (name, svgContent, category = 'icons') => {
        const id = nanoid()
        const dataUrl = `data:image/svg+xml;base64,${btoa(svgContent)}`
        const asset: Asset = {
          id,
          name,
          type: 'icon',
          dataUrl,
          category,
          createdAt: new Date().toISOString(),
        }
        set((s) => ({ assets: [asset, ...s.assets] }))
        return id
      },

      removeAsset: (id) => {
        set((s) => ({ assets: s.assets.filter((a) => a.id !== id) }))
      },

      renameAsset: (id, name) => {
        set((s) => ({
          assets: s.assets.map((a) => (a.id === id ? { ...a, name } : a)),
        }))
      },

      setSearchQuery: (query) => set({ searchQuery: query }),
      setActiveCategory: (category) => set({ activeCategory: category }),

      getFilteredAssets: () => {
        const { assets, searchQuery, activeCategory } = get()
        let filtered = assets
        if (activeCategory !== 'all') {
          filtered = filtered.filter((a) => a.category === activeCategory)
        }
        if (searchQuery) {
          const q = searchQuery.toLowerCase()
          filtered = filtered.filter((a) => a.name.toLowerCase().includes(q))
        }
        return filtered
      },
    }),
    {
      name: 'canvas-studio-assets',
    },
  ),
)
