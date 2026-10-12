import { useEffect } from 'react'

/**
 * A modal owns the viewport, not only its own scrolling panes. Otherwise a
 * wheel gesture over its controls or dimmed backdrop scrolls the page
 * underneath, and the apparent modal state and the background drift apart.
 */
export function useModalScrollLock() {
  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow
    const previousRootOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousRootOverflow
    }
  }, [])
}
