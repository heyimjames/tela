import { create } from 'zustand'
import type { ComponentType } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
  action: () => void
  danger?: boolean
  separatorBefore?: boolean
}

interface ContextMenuState {
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  /** Open a menu at screen coords with a target-specific set of items. */
  openMenu: (x: number, y: number, items: ContextMenuItem[]) => void
  close: () => void
}

/**
 * Single shared right-click menu. Trigger sites (frame, layer row, canvas) build
 * their own item list with closures and call openMenu(); <ContextMenu/> (mounted
 * once in App) renders it. Keeps one menu on screen and one dismiss path.
 */
export const useContextMenuStore = create<ContextMenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  openMenu: (x, y, items) => set({ open: true, x, y, items }),
  close: () => set({ open: false, items: [] }),
}))
