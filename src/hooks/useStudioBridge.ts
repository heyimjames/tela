import { useEffect, useRef } from 'react'
import { useRouterStore, type Route } from '@/store/useRouterStore'

/**
 * Bridges this app's in-memory state router with a parent `/studio` host when
 * it is embedded as an iframe. Two jobs:
 *   1. Announce ("navigate") the current view up to the host on every route
 *      change, so the host can mirror it in the URL + sidebar highlight.
 *   2. Apply "show" commands coming down from the host (sidebar clicks /
 *      browser back-forward) without reloading.
 *
 * The initial view is adopted synchronously by the router store (from `?view=`),
 * so there is no boot transient to announce. All of this no-ops when not
 * embedded (top-level window). Messages are same-origin and origin-validated.
 */

const SOURCE = 'tela-canvas'
type View = 'editor' | 'files'

function viewForRoute(route: Route): View {
  return route.page === 'library' ? 'files' : 'editor'
}

const isEmbedded = () => typeof window !== 'undefined' && window.parent !== window

export function useStudioBridge() {
  const route = useRouterStore((s) => s.route)
  const lastPosted = useRef<View | null>(null)

  // child → parent: announce the current view (deduped).
  useEffect(() => {
    if (!isEmbedded()) return
    const view = viewForRoute(route)
    if (lastPosted.current === view) return
    lastPosted.current = view
    const message: { source: string; type: string; view: View; designId?: string } = {
      source: SOURCE,
      type: 'navigate',
      view,
    }
    if (route.page === 'editor') message.designId = route.designId
    window.parent.postMessage(message, window.location.origin)
  }, [route])

  // parent → child: apply a view the host asks for.
  useEffect(() => {
    if (!isEmbedded()) return
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const data = e.data
      if (!data || data.source !== SOURCE || data.type !== 'show') return
      const { navigate } = useRouterStore.getState()
      if (data.view === 'files') navigate({ page: 'library' })
      else navigate({ page: 'editor-standalone' })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
}
