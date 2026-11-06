import { useContext, useEffect, useId, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  CircleQuestionMark,
  Cloud,
  Database,
  Clock,
  FileText,
  FolderPlus,
  House,
  Import,
  Menu,
  Plus,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { AccountBadge, SETTINGS_PATH } from './account-menu'
import { useDriveSync } from './drive/drive-sync-context'
import { SyncButton } from './drive/sync-button'
import { ContextMenu, type MenuItem, type MenuPoint } from './context-menu'
import { LibraryActionsContext, type LibraryActions, type NewKind } from './library-actions'
import type { PersistentStorageStatus } from './durable-storage'
import { Footer, Link } from './site-chrome'
import { SUPPORT_EMAIL } from './support-email'
import { useRoute } from './use-route'

/**
 * The utility-app chrome every page outside the editor wears: a fixed left nav
 * naming the resource destinations, breadcrumbs across the top, and the page
 * itself in between. The editor keeps its own full-width document bar and is
 * reached by opening or creating an Exam rather than by a separate nav entry.
 */

/** A step of the breadcrumbs. One that names a Folder (null for Home) takes
 *  things dropped on it, as Drive's do. */
export type Crumb = { label: string; href?: string; folderId?: string | null }

const NAV = [
  { href: '/', label: 'Home', Icon: House },
  { href: '/recent', label: 'Recent', Icon: Clock },
  { href: '/starred', label: 'Starred', Icon: Star },
  { href: '/imports', label: 'Imports', Icon: Import },
  { href: '/trash', label: 'Trash', Icon: Trash2 },
] as const

function isCurrent(href: string, route: string) {
  if (href === '/') return route === '/' || route.startsWith('/folders/')
  if (href === '/imports') return route === '/imports' || route === '/import'
  return route === href
}


function newMenuItems(actions: LibraryActions, folderId: string | null, drive: boolean): MenuItem[] {
  const make = (kind: NewKind) => () => actions.onNew(kind, folderId)
  return [
    { kind: 'action', label: 'New folder', icon: <FolderPlus />, onSelect: make('folder') },
    { kind: 'action', label: 'New Exam', icon: <FileText />, onSelect: make('exam') },
    { kind: 'action', label: 'New Question Bank', icon: <Database />, onSelect: make('bank') },
    { kind: 'separator' },
    { kind: 'action', label: 'Import file…', icon: <Upload />, onSelect: make('import') },
    { kind: 'action', label: 'Convert a test with AI…', icon: <Sparkles />, onSelect: make('convert') },
    ...(drive ? [{ kind: 'action' as const, label: 'Add from Google Drive…', icon: <Cloud />, onSelect: make('drive') }] : []),
  ]
}

/** The one way to make anything: the button under the logo, or on a narrow
 *  screen the round "+" at the bottom right. */
function NewButton({ actions, folderId, floating = false }: { actions: LibraryActions; folderId: string | null; floating?: boolean }) {
  const [menu, setMenu] = useState<MenuPoint | null>(null)
  const drive = useDriveSync()
  return (
    <>
      <button
        type="button"
        className={floating ? 'new-fab' : 'new-button'}
        aria-label={floating ? 'New' : undefined}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          setMenu(floating ? { x: bounds.right, y: bounds.top - 8 } : { x: bounds.left, y: bounds.bottom + 6 })
        }}
      >
        <Plus aria-hidden="true" />
        {!floating && 'New'}
      </button>
      {menu && (
        <ContextMenu
          point={menu}
          side={floating ? 'left' : 'right'}
          ariaLabel="New"
          items={newMenuItems(actions, folderId, Boolean(drive?.configured))}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

function useNarrow() {
  const query = '(max-width: 899px)'
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const onChange = () => setNarrow(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [])
  return narrow
}


/**
 * The one way to reach a person. It lives at the foot of the nav, out of the
 * way of the work but on every page, and says a single thing when opened.
 */
function HelpDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? [])
    requestAnimationFrame(() => focusable()[0]?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = focusable()
      if (controls.length === 0) return
      const first = controls[0]!
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      requestAnimationFrame(() => { if (previous?.isConnected) previous.focus() })
    }
  }, [])
  return createPortal(
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <section
        ref={dialog}
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="resource-picker-header">
          <h2 id={titleId}>Need a hand?</h2>
          <button type="button" className="question-bank-action" aria-label="Close help" onClick={onClose}><X /></button>
        </header>
        <p>
          If you’re running into trouble or have suggestions, email us at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=Test%20Parrot`}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>
    </div>,
    document.body,
  )
}

function HelpButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="help-button"
        aria-label="Help"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <CircleQuestionMark aria-hidden="true" />
      </button>
      {open && <HelpDialog onClose={() => setOpen(false)} />}
    </>
  )
}

export function AppShell({
  crumbs,
  persistentStorage,
  actions,
  search,
  folderId = null,
  children,
}: {
  crumbs: readonly Crumb[]
  persistentStorage: PersistentStorageStatus
  /** Page-level actions, shown in the top bar beside the storage badge. */
  actions?: ReactNode
  /** The search box, across the top bar of the pages that have one. */
  search?: ReactNode
  /** The Folder the New menu makes things in: the one being shown, or the
   *  top level everywhere else. */
  folderId?: string | null
  children: ReactNode
}) {
  const route = useRoute()
  const library = useContext(LibraryActionsContext)
  const drive = useDriveSync()
  const narrow = useNarrow()
  const [drawer, setDrawer] = useState(false)
  const [dropping, setDropping] = useState<number | null>(null)
  // A link followed from the drawer closes it.
  useEffect(() => { setDrawer(false) }, [route])
  useEffect(() => {
    if (!drawer) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawer(false) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawer])
  return (
    <div className={`app-shell${drawer ? ' app-shell--drawer' : ''}`}>
      {drawer && <div className="app-nav-scrim" role="presentation" onClick={() => setDrawer(false)} />}
      <aside className="app-nav" id="app-nav" {...(narrow && !drawer ? { inert: true } : {})}>
        <Link href="/" className="site-wordmark app-nav-brand">
          <img className="app-logo" src="/logo.png" alt="" width={36} height={36} />
          Test Parrot
        </Link>
        {library && !narrow && <NewButton actions={library} folderId={folderId} />}
        <nav aria-label="Sections">
          <ul className="app-nav-list">
            {NAV.map(({ href, label, Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="app-nav-link"
                  {...(isCurrent(href, route) ? { 'aria-current': 'page' } : {})}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="app-nav-foot">
          <HelpButton />
          <Link
            href={SETTINGS_PATH}
            className="app-nav-link"
            {...(route === SETTINGS_PATH ? { 'aria-current': 'page' } : {})}
          >
            <Settings aria-hidden="true" />
            Settings
          </Link>
        </div>
      </aside>
      <div className="app-frame">
        <header className="app-topbar">
          {narrow && (
            <button
              type="button"
              className="app-nav-toggle"
              aria-label="Open navigation"
              aria-controls="app-nav"
              aria-expanded={drawer}
              onClick={() => setDrawer(true)}
            >
              <Menu aria-hidden="true" />
            </button>
          )}
          <nav aria-label="Breadcrumb">
            <ol className="breadcrumbs">
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1
                const droppable = library?.onDropInto && crumb.folderId !== undefined
                return (
                  <li
                    key={`${index}:${crumb.label}`}
                    className={dropping === index ? 'is-drop-target' : undefined}
                    {...(droppable ? {
                      onDragOver: (event: DragEvent) => {
                        if (library.canDrop && !library.canDrop(event)) return
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        setDropping(index)
                      },
                      onDragLeave: () => setDropping((current) => (current === index ? null : current)),
                      onDrop: (event: DragEvent) => {
                        event.preventDefault()
                        setDropping(null)
                        library.onDropInto!(crumb.folderId ?? null, event)
                      },
                    } : {})}
                  >
                    {crumb.href && !last ? (
                      <Link href={crumb.href}>{crumb.label}</Link>
                    ) : (
                      <span {...(last ? { 'aria-current': 'page' as const } : {})}>
                        {crumb.label}
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          </nav>
          {search}
          <div className="app-topbar-actions">
            {actions}
            {drive?.configured
              ? <SyncButton drive={drive} />
              : <AccountBadge status={persistentStorage} />}
          </div>
        </header>
        <main className="app-main">{children}</main>
        {library && narrow && <NewButton actions={library} folderId={folderId} floating />}
        <Footer />
      </div>
    </div>
  )
}
