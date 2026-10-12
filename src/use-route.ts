import { useEffect, useState } from 'react'

/**
 * The whole router. Test Parrot is one editor plus two static pages, so the
 * path is all the state a route needs and `history.pushState` is all the
 * navigation — no library, no route table.
 */
const NAVIGATE_EVENT = 'testparrot:navigate'
export const BEFORE_NAVIGATE_EVENT = 'testparrot:before-navigate'

function currentPath(): string {
  return window.location.pathname || '/'
}

export function useRoute(): string {
  const [route, setRoute] = useState(currentPath)
  useEffect(() => {
    const onChange = () => setRoute(currentPath())
    // Back/forward buttons fire `popstate`; our own links fire the custom
    // event, because `pushState` deliberately does not.
    window.addEventListener('popstate', onChange)
    window.addEventListener(NAVIGATE_EVENT, onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener(NAVIGATE_EVENT, onChange)
    }
  }, [])
  return route
}

/** The query string, for the routes that keep state in it — the Question Bank
 *  page's `id`. Changes with every navigation, the path's or not. */
export function useLocationSearch(): string {
  const [search, setSearch] = useState(() => window.location.search)
  useEffect(() => {
    const onChange = () => setSearch(window.location.search)
    window.addEventListener('popstate', onChange)
    window.addEventListener(NAVIGATE_EVENT, onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener(NAVIGATE_EVENT, onChange)
    }
  }, [])
  return search
}

/** Correct the address without adding to history, as a route that finds its
 *  resource gone does. */
export function replaceRoute(to: string): void {
  window.history.replaceState(null, '', to)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

/**
 * Move to another screen without loading a document. Home, the collections
 * and the Question Bank page are reached this way, because the Question Bank
 * Pop-over is a view of this document and closes with it (ADR-0030); the
 * editor is still entered and left by a document load.
 */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (`${window.location.pathname}${window.location.search}` === to) return
  // Unlike a full document navigation, pushState never raises beforeunload.
  // Give editor-owned durability guards the same cancellable boundary first.
  if (!window.dispatchEvent(new Event(BEFORE_NAVIGATE_EVENT, { cancelable: true }))) return
  if (options.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
  window.scrollTo(0, 0)
}
