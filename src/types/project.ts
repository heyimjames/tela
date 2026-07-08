import type { DesignDocument } from '@/types/design'

export type ApprovalStatus = 'draft' | 'in-review' | 'approved' | 'rejected'

export interface Comment {
  id: string
  text: string
  author: string
  pinX?: number
  pinY?: number
  resolved: boolean
  createdAt: string
}

export interface AdDesign {
  id: string
  document: DesignDocument
  status: ApprovalStatus
  thumbnailUrl?: string
  comments: Comment[]
  versions: DesignVersion[]
  createdAt: string
  updatedAt: string
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}

export interface Project {
  id: string
  name: string
  description: string
  folders: Folder[]
  designs: AdDesign[]
  createdAt: string
  updatedAt: string
}

export interface DesignVersion {
  id: string
  name: string
  document: DesignDocument
  createdAt: string
}
