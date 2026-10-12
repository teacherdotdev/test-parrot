import type { MouseEvent, ReactNode } from 'react'
import { navigate } from './use-route'

/**
 * An in-app link. Plain-clicked it routes without a reload; modified clicks
 * (new tab, new window, download) fall through to the browser, so the href
 * has to be a real path rather than a `#`.
 */
export function Link({
  href,
  className,
  children,
  'aria-current': ariaCurrent,
  'aria-label': ariaLabel,
}: {
  href: string
  className?: string
  children: ReactNode
  'aria-current'?: 'page'
  'aria-label'?: string
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (event.button !== 0) return
    event.preventDefault()
    navigate(href)
  }
  return (
    <a href={href} className={className} aria-current={ariaCurrent} aria-label={ariaLabel} onClick={onClick}>
      {children}
    </a>
  )
}

export function Footer() {
  return (
    <footer className="site-footer">
      <a
        href="https://teacher.dev"
        target="_blank"
        rel="noopener noreferrer"
        className="site-footer-credit"
      >
        <img src="/edtechathon-logo.svg" alt="" width={24} height={24} />
        Built by teacher.dev
      </a>
      <Link href="/about" className="site-footer-link">
        about
      </Link>
      <Link href="/privacy" className="site-footer-link">
        privacy
      </Link>
    </footer>
  )
}
