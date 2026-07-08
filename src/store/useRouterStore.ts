import { create } from 'zustand'

export type Route =
  | { page: 'library' }
  | { page: 'settings' }
  | { page: 'project'; projectId: string }
  | { page: 'editor'; projectId: string; designId: string }
  | { page: 'editor-standalone' }

interface RouterStore {
  route: Route
  navigate: (route: Route) => void
}

/**
 * Initial route. When embedded in a parent /studio host it deep-links a view via
 * `?view=editor|files` on the iframe URL — adopt it synchronously here so there
 * is no transient `library` state on boot (which would otherwise post a spurious
 * navigation up to the host). Standalone (no `?view`) falls back to the library.
 */
function initialRoute(): Route {
  if (typeof window !== 'undefined') {
    const view = new URLSearchParams(window.location.search).get('view')
    if (view === 'editor') return { page: 'editor-standalone' }
    if (view === 'files') return { page: 'library' }
  }
  return { page: 'library' }
}

export const useRouterStore = create<RouterStore>((set) => ({
  route: initialRoute(),
  navigate: (route) => set({ route }),
}))
