// Home, Folders, Recent, Starred, Trash and search (ADR-0051): one page that
// lays out Folders and Resources the way Google Drive does, as preview cards
// or a list, with a ⋮ menu (or a right-click) on each, Shift- and
// Ctrl/Cmd-click to select several, and drag-and-drop to move them.

import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import {
  Database,
  ArrowRightLeft,
  Copy,
  EllipsisVertical,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderX,
  LayoutGrid,
  List,
  PencilLine,
  PictureInPicture2,
  Search,
  Star,
  StarOff,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { AppShell, type Crumb } from './app-shell'
import { LibraryActionsContext, type LibraryActions } from './library-actions'
import type { PersistentStorageStatus } from './durable-storage'
import { TopicBadge } from './badges'
import { ContextMenu, type MenuItem, type MenuPoint } from './context-menu'
import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty, type QuestionType } from './exam'
import {
  refKey,
  refOf,
  type DeletionWarning,
  type EntryRef,
  type LibraryEntry,
  type LibraryService,
  type LibrarySnapshot,
} from './library'
import { ForeverDialog, MoveDialog, NameDialog, TrashDialog } from './library-dialogs'
import { usePopOver } from './pop-over-context'
import { daysLeftInTrash, folderPath, inTrash, TRASH_DAYS, type FolderRecord } from './resource-places'
import { ExamSheetPreview } from './resource-cards'
import { SECTION_TITLE } from './section-headings'
import { Link } from './site-chrome'
import { navigate, useLocationSearch } from './use-route'
import { carriesEntries, DRAG_TYPE, draggedRefs, folderHref, searchEntries, type LibraryView } from './library-routes'

type SortKey = 'name' | 'modified' | 'opened'
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'modified', label: 'Last modified' },
  { value: 'opened', label: 'Last opened' },
]
type Layout = 'grid' | 'list'
const LAYOUT_KEY = 'test-parrot:library-layout'

/** Grid or list, as this browser last chose; list on a narrow screen until a
 *  choice is made. */
function useLayout(): [Layout, (layout: Layout) => void] {
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      const stored = window.localStorage.getItem(LAYOUT_KEY)
      if (stored === 'grid' || stored === 'list') return stored
    } catch { /* storage unavailable: fall through to the default */ }
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 899px)').matches ? 'list' : 'grid'
  })
  return [layout, (next) => {
    setLayout(next)
    try { window.localStorage.setItem(LAYOUT_KEY, next) } catch { /* kept for this page only */ }
  }]
}

function byName(left: LibraryEntry, right: LibraryEntry) {
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}
const opened = (entry: LibraryEntry) => entry.lastOpenedAt ?? ''
const recency = (entry: LibraryEntry) => [entry.lastOpenedAt ?? '', entry.lastModifiedAt].sort().at(-1)!

/** Folders first, always; then by the chosen order. */
function sortEntries(entries: readonly LibraryEntry[], sort: SortKey): LibraryEntry[] {
  const compare = (left: LibraryEntry, right: LibraryEntry) => {
    if (sort === 'modified') return right.lastModifiedAt.localeCompare(left.lastModifiedAt) || byName(left, right)
    if (sort === 'opened') return opened(right).localeCompare(opened(left)) || byName(left, right)
    return byName(left, right)
  }
  return [...entries].sort((left, right) => {
    const folders = Number(right.kind === 'folder') - Number(left.kind === 'folder')
    return folders || compare(left, right)
  })
}

function when(iso: string | undefined) {
  if (!iso) return '—'
  const date = new Date(iso)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  })
}

const KIND_LABEL: Record<LibraryEntry['kind'], string> = { folder: 'Folder', exam: 'Exam', bank: 'Question Bank' }

export function EntryIcon({ kind }: { kind: LibraryEntry['kind'] }) {
  if (kind === 'folder') return <Folder className="entry-icon entry-icon--folder" aria-hidden="true" />
  if (kind === 'exam') return <FileText className="entry-icon entry-icon--exam" aria-hidden="true" />
  return <Database className="entry-icon entry-icon--bank" aria-hidden="true" />
}

const TYPE_ORDER: QuestionType[] = ['multiple-choice', 'true-false', 'matching', 'fill-in-the-blank', 'open', 'multipart']
const SHOWN_TOPICS = 4

/** What a Question Bank holds, at a glance: how many Questions of each
 *  Question Type, its Topics, and how its Difficulties spread. */
function BankPreview({ entry }: { entry: Extract<LibraryEntry, { kind: 'bank' }> }) {
  const { bank } = entry
  const types = TYPE_ORDER.filter((type) => bank.typeCounts[type])
  const rated = DIFFICULTIES.reduce((total, difficulty) => total + (bank.difficultyCounts[difficulty] ?? 0), 0)
  return (
    <div className="bank-preview">
      <p className="bank-preview-count">{bank.questionCount} {bank.questionCount === 1 ? 'Question' : 'Questions'}</p>
      {types.length > 0 && (
        <ul className="bank-preview-types" aria-label="Question Types">
          {types.map((type) => <li key={type}><span>{SECTION_TITLE[type]}</span> <strong>{bank.typeCounts[type]}</strong></li>)}
        </ul>
      )}
      {rated > 0 && <DifficultySpread counts={bank.difficultyCounts} total={rated} />}
      {bank.topics.length > 0 && (
        <div className="bank-preview-topics" aria-label="Topics">
          {bank.topics.slice(0, SHOWN_TOPICS).map((topic) => <TopicBadge key={topic} topic={topic} />)}
          {bank.topics.length > SHOWN_TOPICS && <span className="badge">+{bank.topics.length - SHOWN_TOPICS}</span>}
        </div>
      )}
    </div>
  )
}

function DifficultySpread({ counts, total }: { counts: Partial<Record<Difficulty, number>>; total: number }) {
  const shown = DIFFICULTIES.filter((difficulty) => counts[difficulty])
  return (
    <div className="difficulty-spread" aria-label={`Difficulty: ${shown.map((difficulty) => `${counts[difficulty]} ${difficulty}`).join(', ')}`}>
      <div className="difficulty-spread-bar" aria-hidden="true">
        {shown.map((difficulty) => (
          <span key={difficulty} className={`difficulty-spread-${difficulty}`} style={{ flexGrow: counts[difficulty]! / total }} />
        ))}
      </div>
      <div className="difficulty-spread-legend" aria-hidden="true">
        {shown.map((difficulty) => <span key={difficulty} className={`difficulty-spread-label-${difficulty}`}>{DIFFICULTY_LABELS[difficulty]} {counts[difficulty]}</span>)}
      </div>
    </div>
  )
}

type ItemHandlers = {
  layout: Layout
  selected: boolean
  dropTarget: boolean
  location: { label: string; folderId: string | null } | null
  trash: { daysLeft: number } | null
  onClick: (entry: LibraryEntry, event: MouseEvent) => void
  onMenu: (entry: LibraryEntry, point: MenuPoint, fromButton: boolean) => void
  drag: {
    onDragStart: (entry: LibraryEntry, event: DragEvent) => void
    onDragEnd: () => void
    onDragOver: (entry: LibraryEntry, event: DragEvent) => void
    onDragLeave: (entry: LibraryEntry) => void
    onDrop: (entry: LibraryEntry, event: DragEvent) => void
  } | null
}

function LibraryItem({ entry, handlers }: { entry: LibraryEntry; handlers: ItemHandlers }) {
  const { layout, selected, dropTarget, location, trash, drag } = handlers
  const nameId = useId()
  const menuButton = (
    <button
      type="button"
      className="library-item-menu"
      aria-label="More actions"
      aria-describedby={nameId}
      title="More actions"
      aria-haspopup="menu"
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        handlers.onMenu(entry, { x: bounds.right, y: bounds.bottom + 4 }, true)
      }}
    >
      <EllipsisVertical aria-hidden="true" />
    </button>
  )
  const name = (
    <span className="library-item-name">
      <EntryIcon kind={entry.kind} />
      <span className="library-item-title" id={nameId}>{entry.name}</span>
      {entry.starred && <Star className="library-item-star" aria-label="Starred" />}
      {entry.kind === 'exam' && entry.exam.unsaved && (
        <span className="unsaved-mark" title="Unsaved changes"><TriangleAlert aria-hidden="true" /><span className="sr-only">Unsaved changes</span></span>
      )}
    </span>
  )
  const open = (children: ReactNode) => (
    <button
      type="button"
      className="library-item-open"
      aria-label={entry.name}
      onClick={(event) => handlers.onClick(entry, event)}
    >
      {children}
      {selected && <span className="sr-only">, selected</span>}
    </button>
  )
  const locationText = location && (
    <span className="library-item-location">
      {location.folderId ? <Link href={folderHref(location.folderId)}>{location.label}</Link> : location.label}
    </span>
  )
  const className = [
    'library-item',
    `library-item--${entry.kind}`,
    selected ? 'is-selected' : '',
    dropTarget ? 'is-drop-target' : '',
  ].filter(Boolean).join(' ')
  const common = {
    className,
    'data-kind': entry.kind,
    'data-selected': selected ? 'true' : undefined,
    draggable: Boolean(drag),
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault()
      handlers.onMenu(entry, { x: event.clientX, y: event.clientY }, false)
    },
    ...(drag ? {
      onDragStart: (event: DragEvent) => drag.onDragStart(entry, event),
      onDragEnd: drag.onDragEnd,
      ...(entry.kind === 'folder' ? {
        onDragOver: (event: DragEvent) => drag.onDragOver(entry, event),
        onDragLeave: () => drag.onDragLeave(entry),
        onDrop: (event: DragEvent) => drag.onDrop(entry, event),
      } : {}),
    } : {}),
  }
  if (layout === 'list') {
    return (
      <li {...common}>
        {open(name)}
        <span className="library-item-modified">{trash ? `${trash.daysLeft} days left` : when(entry.lastModifiedAt)}</span>
        {locationText ?? <span className="library-item-location" />}
        {menuButton}
      </li>
    )
  }
  if (entry.kind === 'folder') {
    return (
      <li {...common}>
        {open(<>
          {name}
          {trash && <span className="library-card-meta">{trash.daysLeft} days left in Trash</span>}
        </>)}
        {menuButton}
      </li>
    )
  }
  return (
    <li {...common}>
      {open(<>
        <span className="library-card-caption">{name}</span>
        <span className="library-card-preview" aria-hidden="true">
          {entry.kind === 'exam' ? <ExamSheetPreview exam={entry.exam} /> : <BankPreview entry={entry} />}
        </span>
        {trash && <span className="library-card-meta">{trash.daysLeft} days left in Trash</span>}
      </>)}
      {locationText}
      {menuButton}
    </li>
  )
}

type Notice = { text: string; undo?: () => Promise<void> }

export function LibraryPage({
  view,
  snapshot,
  library,
  persistentStorage,
  error,
  onChanged,
  onOpenExam,
  onOpenBank,
  onExportBank,
  onCopyExam,
}: {
  view: LibraryView
  snapshot: LibrarySnapshot | null
  library: LibraryService
  persistentStorage: PersistentStorageStatus
  error: string | null
  onChanged: () => Promise<void>
  onOpenExam: (id: string) => void
  onOpenBank: (id: string) => void
  onExportBank: (id: string) => void
  onCopyExam: (id: string) => Promise<void>
}) {
  const shellActions = useContext(LibraryActionsContext)
  const search = useLocationSearch()
  const params = useMemo(() => new URLSearchParams(search), [search])
  const popOver = usePopOver()
  const [layout, setLayout] = useLayout()
  const [selection, setSelection] = useState<{ view: string; keys: Set<string> }>({ view: '', keys: new Set() })
  const anchor = useRef<string | null>(null)
  const [menu, setMenu] = useState<{ point: MenuPoint; side: 'left' | 'right'; targets: LibraryEntry[] } | null>(null)
  const [renaming, setRenaming] = useState<LibraryEntry | null>(null)
  const [moving, setMoving] = useState<LibraryEntry[] | null>(null)
  const [trashing, setTrashing] = useState<{ entries: LibraryEntry[]; warning: DeletionWarning } | null>(null)
  const [forever, setForever] = useState<LibraryEntry[] | 'empty' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dragging = useRef<EntryRef[]>([])

  const viewKey = JSON.stringify(view)
  // A selection belongs to the page it was made on.
  const selected = selection.view === viewKey ? selection.keys : new Set<string>()
  const setSelected = (keys: Set<string>) => setSelection({ view: viewKey, keys })

  const folders = useMemo(() => snapshot?.folders ?? new Map<string, FolderRecord>(), [snapshot])
  const folder = view.kind === 'folder' && view.folderId ? folders.get(view.folderId) ?? null : null
  const folderState = view.kind !== 'folder' || view.folderId === null
    ? 'ok'
    : !snapshot ? 'loading' : !folder ? 'missing' : inTrash(folder, folders) ? 'trashed' : 'ok'

  useEffect(() => {
    if (view.kind === 'folder' && view.folderId && folderState === 'ok') void library.openedFolder(view.folderId)
  }, [library, view, folderState])

  const defaultSort: SortKey = view.kind === 'recent' ? 'opened' : view.kind === 'search' ? 'modified' : 'name'
  const sort = (SORTS.find((option) => option.value === params.get('sort'))?.value) ?? defaultSort
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    const query = next.toString()
    navigate(`${window.location.pathname}${query ? `?${query}` : ''}`, { replace: true })
  }

  const visible = useMemo(() => {
    if (!snapshot) return []
    const live = (entry: LibraryEntry) => !inTrash(entry, folders)
    let entries: LibraryEntry[]
    if (view.kind === 'folder') entries = snapshot.entries.filter((entry) => entry.parentId === view.folderId && !entry.trashedAt)
    else if (view.kind === 'recent') entries = snapshot.entries.filter((entry) => entry.kind !== 'folder' && live(entry))
    else if (view.kind === 'starred') entries = snapshot.entries.filter((entry) => entry.starred && live(entry))
    else if (view.kind === 'trash') entries = snapshot.entries.filter((entry) => entry.trashedAt)
    else entries = searchEntries(snapshot.entries, folders, view.query)
    if (view.kind === 'recent') return [...entries].sort((left, right) => recency(right).localeCompare(recency(left)))
    if (view.kind === 'trash') return [...entries].sort((left, right) => (right.trashedAt ?? '').localeCompare(left.trashedAt ?? ''))
    return sortEntries(entries, sort)
  }, [snapshot, folders, view, sort])

  const selectedEntries = visible.filter((entry) => selected.has(refKey(entry)))
  const inTrashView = view.kind === 'trash'
  // Grid cards say where they live only away from their Folder; the list
  // always has a Location column.
  const showLocation = view.kind !== 'folder' || layout === 'list'

  const locationOf = (entry: LibraryEntry) => {
    const path = folderPath(entry.parentId, folders)
    const parent = path.at(-1)
    return { label: parent ? parent.name : 'Home', folderId: parent?.id ?? null }
  }

  const open = (entry: LibraryEntry) => {
    if (entry.kind === 'folder') navigate(folderHref(entry.id))
    else if (entry.kind === 'exam') onOpenExam(entry.id)
    else onOpenBank(entry.id)
  }

  const run = async (text: string, action: () => Promise<void>, undo?: () => Promise<void>) => {
    await action()
    await onChanged()
    setSelected(new Set())
    setNotice({ text, ...(undo ? { undo } : {}) })
  }

  const describe = (entries: readonly LibraryEntry[]) => entries.length === 1 ? `“${entries[0]!.name}”` : `${entries.length} items`

  const folderName = (folderId: string | null) => (folderId ? folders.get(folderId)?.name ?? 'the folder' : 'Home')
  /** Moves things dropped or chosen into a Folder, and says so. */
  const onMoveInto = (refs: readonly EntryRef[], folderId: string | null) =>
    run(`Moved ${refs.length === 1 ? (snapshot?.entries.find((entry) => refKey(entry) === refKey(refs[0]!))?.name ?? '1 item') : `${refs.length} items`} to ${folderName(folderId)}`,
      () => library.move(refs, folderId))
  const requestTrash = async (entries: LibraryEntry[]) => {
    const warning = await library.deletionWarning(entries.map(refOf))
    setTrashing({ entries, warning })
  }
  const setStar = (entries: readonly LibraryEntry[], starred: boolean) =>
    void run(`${describe(entries)} ${starred ? 'starred' : 'unstarred'}`, () => library.setStarred(entries.map(refOf), starred))
  const restore = (entries: readonly LibraryEntry[]) =>
    void run(`${describe(entries)} restored`, () => library.restore(entries.map(refOf)))

  const menuItems = (targets: LibraryEntry[]): MenuItem[] => {
    if (inTrashView) {
      return [
        { kind: 'action', label: 'Restore', icon: <Undo2 />, onSelect: () => restore(targets) },
        { kind: 'separator' },
        { kind: 'action', label: 'Delete forever', icon: <Trash2 />, destructive: true, onSelect: () => setForever(targets) },
      ]
    }
    const allStarred = targets.every((entry) => entry.starred)
    const star: MenuItem = allStarred
      ? { kind: 'action', label: 'Unstar', icon: <StarOff />, onSelect: () => setStar(targets, false) }
      : { kind: 'action', label: 'Star', icon: <Star />, onSelect: () => setStar(targets, true) }
    const move: MenuItem = { kind: 'action', label: 'Move to…', icon: <FolderInput />, onSelect: () => setMoving(targets) }
    const remove: MenuItem = { kind: 'action', label: 'Delete', icon: <Trash2 />, destructive: true, onSelect: () => void requestTrash(targets) }
    if (targets.length > 1) return [move, star, { kind: 'separator' }, remove]
    const entry = targets[0]!
    const items: MenuItem[] = [{ kind: 'action', label: 'Open', icon: <FolderOpen />, onSelect: () => open(entry) }]
    if (entry.kind === 'exam') {
      items.push({
        kind: 'action', label: 'Make a copy', icon: <Copy />,
        onSelect: () => void run(`Copied “${entry.name}”`, () => onCopyExam(entry.id)),
      })
    }
    if (entry.kind === 'bank') {
      if (popOver.supported) items.push({ kind: 'action', label: 'Pop-over', icon: <PictureInPicture2 />, onSelect: () => popOver.open(entry.id) })
      items.push({ kind: 'action', label: 'Export', icon: <Upload />, disabled: entry.bank.questionCount === 0, onSelect: () => onExportBank(entry.id) })
    }
    items.push(
      { kind: 'separator' },
      { kind: 'action', label: 'Rename', icon: <PencilLine />, onSelect: () => setRenaming(entry) },
      move,
      star,
      { kind: 'separator' },
      remove,
    )
    return items
  }

  const onClick = (entry: LibraryEntry, event: MouseEvent) => {
    const key = refKey(entry)
    if (event.shiftKey && anchor.current) {
      event.preventDefault()
      const keys = visible.map(refKey)
      const [from, to] = [keys.indexOf(anchor.current), keys.indexOf(key)].sort((a, b) => a - b)
      if (from! >= 0) {
        setSelected(new Set([...selected, ...keys.slice(from, to! + 1)]))
        return
      }
    }
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault()
      const next = new Set(selected)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      anchor.current = key
      setSelected(next)
      return
    }
    if (inTrashView) {
      anchor.current = key
      setSelected(new Set([key]))
      setNotice({ text: `${KIND_LABEL[entry.kind]}s in Trash can’t be opened. Restore “${entry.name}” to open it.` })
      return
    }
    open(entry)
  }

  const onMenu = (entry: LibraryEntry, point: MenuPoint, fromButton: boolean) => {
    const key = refKey(entry)
    // A menu on one of several selected things acts on all of them.
    const targets = selected.has(key) && selectedEntries.length > 1 ? selectedEntries : [entry]
    setMenu({ point, side: fromButton ? 'left' : 'right', targets })
  }

  const drag: ItemHandlers['drag'] = inTrashView ? null : {
    onDragStart: (entry, event) => {
      const key = refKey(entry)
      const refs = (selected.has(key) ? selectedEntries : [entry]).map(refOf)
      dragging.current = refs
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(refs))
      event.dataTransfer.setData('text/plain', refs.length === 1 ? entry.name : `${refs.length} items`)
      event.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: () => { dragging.current = []; setDropTarget(null) },
    onDragOver: (entry, event) => {
      if (!carriesEntries(event)) return
      if (dragging.current.some((ref) => ref.kind === 'folder' && ref.id === entry.id)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropTarget(refKey(entry))
    },
    onDragLeave: (entry) => setDropTarget((current) => (current === refKey(entry) ? null : current)),
    onDrop: (entry, event) => {
      event.preventDefault()
      setDropTarget(null)
      const refs = draggedRefs(event).filter((ref) => !(ref.kind === 'folder' && ref.id === entry.id))
      if (refs.length > 0) void onMoveInto(refs, entry.id)
    },
  }

  // Escape lets go of a selection; Delete sends it to Trash.
  const selectionRef = useRef(selectedEntries)
  useEffect(() => { selectionRef.current = selectedEntries })
  const requestTrashRef = useRef(requestTrash)
  useEffect(() => { requestTrashRef.current = requestTrash })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"], [role="menu"]')) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'Escape' && selectionRef.current.length > 0) setSelection({ view: '', keys: new Set() })
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectionRef.current.length > 0 && !inTrashView) {
        event.preventDefault()
        void requestTrashRef.current(selectionRef.current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [inTrashView])

  const handlers = (entry: LibraryEntry): ItemHandlers => ({
    layout,
    selected: selected.has(refKey(entry)),
    dropTarget: dropTarget === refKey(entry),
    location: showLocation ? locationOf(entry) : null,
    trash: inTrashView && entry.trashedAt ? { daysLeft: daysLeftInTrash(entry.trashedAt, new Date()) } : null,
    onClick,
    onMenu,
    drag,
  })

  const title = view.kind === 'folder'
    ? (folder?.name ?? 'Home')
    : view.kind === 'recent' ? 'Recent'
      : view.kind === 'starred' ? 'Starred'
        : view.kind === 'trash' ? 'Trash'
          : view.query ? `Results for “${view.query}”` : 'Search'

  const crumbs: Crumb[] = view.kind === 'folder'
    ? [
        { label: 'Home', href: '/', folderId: null },
        ...folderPath(view.folderId, folders).map((step) => ({ label: step.name, href: folderHref(step.id), folderId: step.id })),
      ]
    : [{ label: title }]

  const searchBox = <LibrarySearch query={view.kind === 'search' ? view.query : ''} />

  if (folderState === 'missing' || folderState === 'trashed') {
    return (
      <AppShell crumbs={[{ label: 'Home', href: '/', folderId: null }, { label: folder?.name ?? 'Folder not found' }]} persistentStorage={persistentStorage} search={searchBox}>
        <section className="library-gone">
          <FolderX aria-hidden="true" />
          {folderState === 'trashed' && folder ? <>
            <h1>“{folder.name}” is in Trash</h1>
            <p>Restore it to see what’s inside. Things in Trash are deleted for good after {TRASH_DAYS} days.</p>
            <button type="button" className="primary-button" onClick={() => {
              const trashedChain = [folder, ...folderPath(folder.parentId, folders)].filter((step) => step.trashedAt)
              void library.restore(trashedChain.map((step) => ({ kind: 'folder' as const, id: step.id }))).then(onChanged)
            }}>Restore</button>
          </> : <>
            <h1>This folder doesn’t exist</h1>
            <p>It may have been deleted for good.</p>
            <Link href="/" className="primary-button">Go to Home</Link>
          </>}
        </section>
      </AppShell>
    )
  }

  const folderEntries = visible.filter((entry) => entry.kind === 'folder')
  const resourceEntries = visible.filter((entry) => entry.kind !== 'folder')
  const list = (entries: LibraryEntry[], label: string, className: string) => entries.length > 0 && (
    <ul className={className} aria-label={label}>
      {entries.map((entry) => <LibraryItem key={refKey(entry)} entry={entry} handlers={handlers(entry)} />)}
    </ul>
  )

  const actions: LibraryActions | null = shellActions && {
    ...shellActions,
    canDrop: carriesEntries,
    onDropInto: (folderId, event) => {
      const refs = draggedRefs(event).filter((ref) => !(ref.kind === 'folder' && ref.id === folderId))
      if (refs.length > 0) void onMoveInto(refs, folderId)
    },
  }

  return (
    <LibraryActionsContext.Provider value={actions}>
    <AppShell
      crumbs={crumbs}
      persistentStorage={persistentStorage}
      search={searchBox}
      folderId={view.kind === 'folder' ? view.folderId : null}
    >
      {error && <p className="home-error" role="alert">{error}</p>}
      <div className="library-page" onClick={(event) => {
        // A click on empty ground lets go of the selection, as Drive's does.
        if (event.target === event.currentTarget) setSelected(new Set())
      }}>
        <header className="library-header">
          <h1>{title}</h1>
          <div className="library-view-controls">
            {inTrashView && visible.length > 0 && <button type="button" className="secondary-button" onClick={() => setForever('empty')}>Empty Trash</button>}
            {view.kind !== 'recent' && view.kind !== 'trash' && (
              <label className="library-sort">
                <span>Sort by</span>
                <select value={sort} onChange={(event) => setParam('sort', event.target.value === defaultSort ? null : event.target.value)}>
                  {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            )}
            <div className="library-layout-toggle" role="group" aria-label="Layout">
              <button type="button" aria-label="List view" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List aria-hidden="true" /></button>
              <button type="button" aria-label="Grid view" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><LayoutGrid aria-hidden="true" /></button>
            </div>
          </div>
        </header>
        {inTrashView && <p className="library-trash-note">Things in Trash are deleted for good after {TRASH_DAYS} days.</p>}
        {selectedEntries.length > 0 && (
          <div className="library-toolbar library-selection" role="toolbar" aria-label="Selection">
            <button type="button" className="question-bank-action" aria-label="Clear selection" onClick={() => setSelected(new Set())}><X /></button>
            <span className="library-selection-count">{selectedEntries.length} selected</span>
            {inTrashView ? <>
              <button type="button" className="library-tool" onClick={() => restore(selectedEntries)}><Undo2 aria-hidden="true" />Restore</button>
              <button type="button" className="library-tool" onClick={() => setForever(selectedEntries)}><Trash2 aria-hidden="true" />Delete forever</button>
            </> : <>
              <button type="button" className="library-tool" onClick={() => setMoving(selectedEntries)}><ArrowRightLeft aria-hidden="true" />Move</button>
              <button type="button" className="library-tool" onClick={() => setStar(selectedEntries, !selectedEntries.every((entry) => entry.starred))}>
                <Star aria-hidden="true" />{selectedEntries.every((entry) => entry.starred) ? 'Unstar' : 'Star'}
              </button>
              <button type="button" className="library-tool" onClick={() => void requestTrash(selectedEntries)}><Trash2 aria-hidden="true" />Delete</button>
            </>}
          </div>
        )}
        {!snapshot ? null : visible.length === 0 ? (
          <EmptyLibrary view={view} />
        ) : layout === 'list' ? (
          <div className="library-list-frame">
            <div className="library-list-head" aria-hidden="true">
              <span>Name</span>
              <span>{inTrashView ? 'Time left' : 'Last modified'}</span>
              <span>Location</span>
              <span />
            </div>
            {list(visible, 'Contents', 'library-list')}
          </div>
        ) : (
          <>
            {folderEntries.length > 0 && <h2 className="library-section-label">Folders</h2>}
            {list(folderEntries, 'Folders', 'library-folder-grid')}
            {resourceEntries.length > 0 && <h2 className="library-section-label">Resources</h2>}
            {list(resourceEntries, 'Resources', 'library-card-grid')}
          </>
        )}
      </div>
      <div className="library-notice-slot" role="status" aria-live="polite">
        {notice && (
          <div className="library-notice">
            <span>{notice.text}</span>
            {notice.undo && <button type="button" onClick={() => {
              const undo = notice.undo!
              setNotice(null)
              void undo().then(onChanged)
            }}>Undo</button>}
            <button type="button" className="library-notice-close" aria-label="Dismiss" onClick={() => setNotice(null)}><X aria-hidden="true" /></button>
          </div>
        )}
      </div>
      {menu && (
        <ContextMenu
          point={menu.point}
          side={menu.side}
          ariaLabel={menu.targets.length === 1 ? `${menu.targets[0]!.name} actions` : `${menu.targets.length} items actions`}
          items={menuItems(menu.targets)}
          onClose={() => setMenu(null)}
        />
      )}
      {renaming && (
        <NameDialog
          title="Rename"
          label={`New name for ${renaming.name}`}
          initial={renaming.name}
          confirmLabel="OK"
          onCancel={() => setRenaming(null)}
          onConfirm={async (name) => {
            await run(`Renamed to “${name}”`, () => library.rename(refOf(renaming), name))
            setRenaming(null)
          }}
        />
      )}
      {moving && (
        <MoveDialog
          title={`Move ${describe(moving)}`}
          moving={moving.map(refOf)}
          from={moving.map((entry) => entry.parentId)}
          startAt={moving[0]!.parentId}
          folders={folders}
          onCancel={() => setMoving(null)}
          onMove={async (folderId) => {
            await onMoveInto(moving.map(refOf), folderId)
            setMoving(null)
          }}
        />
      )}
      {trashing && (
        <TrashDialog
          name={trashing.entries.length === 1 ? trashing.entries[0]!.name : null}
          warning={trashing.warning}
          refs={trashing.entries.map(refOf)}
          onCancel={() => setTrashing(null)}
          onConfirm={async () => {
            const refs = trashing.entries.map(refOf)
            await run(`${describe(trashing.entries)} moved to Trash`, () => library.trash(refs), () => library.restore(refs))
            setTrashing(null)
          }}
        />
      )}
      {forever && (
        <ForeverDialog
          title={forever === 'empty' ? 'Empty Trash?' : `Delete ${describe(forever)} forever?`}
          body={<p>
            {forever === 'empty' ? 'Everything in Trash will be deleted for good.' : 'It will be deleted for good, with everything inside it.'}{' '}
            Exams take their Export History with them, and Questions from deleted Question Banks leave the Exams using them.
            This can’t be undone.
          </p>}
          confirmLabel={forever === 'empty' ? 'Empty Trash' : 'Delete forever'}
          onCancel={() => setForever(null)}
          onConfirm={async () => {
            const going = forever
            await run(
              going === 'empty' ? 'Trash emptied' : `${describe(going)} deleted forever`,
              () => going === 'empty' ? library.emptyTrash() : library.deleteForever(going.map(refOf)),
            )
            setForever(null)
          }}
        />
      )}
    </AppShell>
    </LibraryActionsContext.Provider>
  )
}

function EmptyLibrary({ view }: { view: LibraryView }) {
  const [heading, body] = view.kind === 'trash' ? ['Trash is empty', `Things you delete wait here for ${TRASH_DAYS} days.`]
      : view.kind === 'starred' ? ['Nothing starred yet', 'Star Folders, Exams and Question Banks to find them here.']
        : view.kind === 'recent' ? ['Nothing opened yet', 'Exams and Question Banks you open will show here.']
          : view.kind === 'search' ? (view.query ? ['No results', 'Nothing’s name or Topic matches that.'] : ['Search', 'Type a name or a Topic.'])
            : view.folderId ? ['This folder is empty', 'Drag things here, or use New to make something in it.']
              : ['Nothing here yet', 'Use New to make a Folder, an Exam or a Question Bank.']
  return (
    <section className="library-empty">
      <h2>{heading}</h2>
      <p>{body}</p>
    </section>
  )
}

/** Searching starts from any Library page and lands on its own, where the
 *  query is in the address like any other place. */
export function LibrarySearch({ query }: { query: string }) {
  const [value, setValue] = useState(query)
  useEffect(() => setValue(query), [query])
  const go = useCallback((next: string) => {
    if (!next.trim()) return
    navigate(`/search?q=${encodeURIComponent(next.trim())}`, { replace: window.location.pathname === '/search' })
  }, [])
  return (
    <form className="library-search" role="search" onSubmit={(event) => { event.preventDefault(); go(value) }}>
      <Search aria-hidden="true" />
      <input
        type="search"
        aria-label="Search Test Parrot"
        placeholder="Search Test Parrot"
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          if (window.location.pathname === '/search' && event.target.value.trim()) go(event.target.value)
        }}
      />
    </form>
  )
}
