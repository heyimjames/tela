/**
 * File system hierarchy for the Ads Creator:
 *
 * Homepage → Files & Folders
 * File → Pages (named, collapsible)
 * Page → Frames (individual ads on a canvas)
 * Frame → Layers
 *
 * ---
 *
 * **These are aliases, not a second model.**
 *
 * They used to be a narrower shape: `DesignFrame` had no `backgroundColor`,
 * `locked`, or `visible`, and `DesignPage` had no `looseElements`. Because the
 * library store rebuilt each frame field by field, every save through the Files
 * page silently discarded frame lock state, frame visibility, the frame's
 * background colour, and every loose element on the canvas. The data was gone
 * with no error and nothing in the UI to suggest it had happened.
 *
 * Aliasing the workspace types removes the possibility rather than fixing an
 * instance of it: there is now exactly one frame shape in the app, so there is no
 * narrower one to lose fields to.
 *
 * The durable master is the `.tela` bundle (`src/tela`). Everything stored here
 * lives in localStorage and is a recoverable editing-session cache — see
 * `docs/tela-format.md`.
 */

import type { Frame, Page } from '@/types/workspace'

export type DesignFrame = Frame
export type DesignPage = Page

export interface DesignFile {
  id: string
  name: string
  folderId: string | null // null = root level
  pages: DesignPage[]
  thumbnailUrl?: string
  isScratchpad?: boolean
  createdAt: string
  updatedAt: string
}

export interface Folder {
  id: string
  name: string
  parentId: string | null // null = root level
  createdAt: string
}
