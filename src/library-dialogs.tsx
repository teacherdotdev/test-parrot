// The Library's dialogs: naming a Folder or renaming anything, choosing a
// Folder to move into, and the warnings before Trash and before deleting for
// good (ADR-0051).

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Folder, House, X } from 'lucide-react'
import type { DeletionWarning, EntryRef } from './library'
import { useDriveSync, type SharingSummary } from './drive/drive-sync-context'
import { folderPath, inTrash, isWithin, TRASH_DAYS, type FolderRecord } from './resource-places'

/** A modal that takes the keyboard: focus starts inside, Tab stays inside,
 *  Escape cancels, and focus goes back where it was when it closes. */
function Modal({ label, className, onClose, children, busy = false }: {
  label: string
  className: string
  onClose: () => void
  children: ReactNode
  busy?: boolean
}) {
  const dialog = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const busyRef = useRef(busy)
  useEffect(() => { onCloseRef.current = onClose; busyRef.current = busy }, [onClose, busy])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('input, select, button:not(:disabled), a[href]') ?? [])
    requestAnimationFrame(() => {
      const first = dialog.current?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0]
      first?.focus()
      if (first instanceof HTMLInputElement) first.select()
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!busyRef.current) onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = focusable()
      if (controls.length === 0) return
      const first = controls[0]!
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      requestAnimationFrame(() => { if (previous?.isConnected) previous.focus() })
    }
  }, [])
  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section ref={dialog} className={className} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </section>
    </div>,
    document.body,
  )
}

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.'
}

/** New folder and Rename: one name, OK or Cancel. */
export function NameDialog({ title, label, initial, confirmLabel, onCancel, onConfirm }: {
  title: string
  label: string
  initial: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const submit = () => {
    if (!name.trim() || busy) return
    setBusy(true)
    void onConfirm(name.trim()).catch((reason) => {
      setError(errorText(reason))
      setBusy(false)
    })
  }
  return (
    <Modal label={title} className="library-dialog" onClose={onCancel} busy={busy}>
      <form onSubmit={(event) => { event.preventDefault(); submit() }}>
        <h2>{title}</h2>
        <label className="sr-only" htmlFor={inputId}>{label}</label>
        <input
          id={inputId}
          className="library-dialog-input"
          data-autofocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {error && <p className="dialog-save-error" role="alert">{error}</p>}
        <footer className="destructive-dialog-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy || !name.trim()}>{confirmLabel}</button>
        </footer>
      </form>
    </Modal>
  )
}

/** Move to…: browse Folders from wherever the things sit now and move them
 *  into the one being shown. A Folder cannot go inside itself, so a Folder
 *  being moved, and everything in it, cannot be opened here. */
export function MoveDialog({ title, moving, from, startAt, folders, onCancel, onMove }: {
  title: string
  moving: readonly EntryRef[]
  /** Where each of them sits now. */
  from: readonly (string | null)[]
  startAt: string | null
  folders: ReadonlyMap<string, FolderRecord>
  onCancel: () => void
  onMove: (folderId: string | null) => Promise<void>
}) {
  const [at, setAt] = useState<string | null>(startAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const movingFolders = moving.filter((ref) => ref.kind === 'folder').map((ref) => ref.id)
  const blocked = (id: string) => movingFolders.some((movingId) => isWithin(id, movingId, folders))
  const children = useMemo(() => [...folders.values()]
    .filter((folder) => (folder.parentId ?? null) === at && !inTrash(folder, folders))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })), [at, folders])
  const path = folderPath(at, folders)
  const here = at === null ? 'Home' : folders.get(at)?.name ?? 'Home'
  // Moving things to where they already all are does nothing.
  const unchanged = from.length > 0 && from.every((parentId) => parentId === at)
  return (
    <Modal label={title} className="library-dialog move-dialog" onClose={onCancel} busy={busy}>
      <header className="resource-picker-header">
        <h2>{title}</h2>
        <button type="button" className="question-bank-action" aria-label="Close" onClick={onCancel}><X /></button>
      </header>
      <nav aria-label="Folder path" className="move-dialog-path">
        <button type="button" onClick={() => setAt(null)} aria-current={at === null ? 'location' : undefined}>
          <House aria-hidden="true" /> Home
        </button>
        {path.map((folder) => (
          <span key={folder.id}>
            <ChevronRight aria-hidden="true" />
            <button type="button" onClick={() => setAt(folder.id)} aria-current={folder.id === at ? 'location' : undefined}>{folder.name}</button>
          </span>
        ))}
      </nav>
      <ul className="move-dialog-list" aria-label={`Folders in ${here}`}>
        {children.length === 0 && <li className="move-dialog-empty">No folders here</li>}
        {children.map((folder) => (
          <li key={folder.id}>
            <button type="button" disabled={blocked(folder.id)} onClick={() => setAt(folder.id)}>
              <Folder aria-hidden="true" />
              <span>{folder.name}</span>
              <ChevronRight aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="dialog-save-error" role="alert">{error}</p>}
      <footer className="destructive-dialog-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={busy || unchanged || (at !== null && blocked(at))}
          onClick={() => {
            setBusy(true)
            void onMove(at).catch((reason) => { setError(errorText(reason)); setBusy(false) })
          }}
        >
          Move to {here}
        </button>
      </footer>
    </Modal>
  )
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

/** "2 Exams, 1 Question Bank and 1 Folder" */
function countsText(warning: Pick<DeletionWarning, 'folders' | 'exams' | 'banks'>) {
  const parts = [
    warning.exams > 0 ? plural(warning.exams, 'Exam', 'Exams') : null,
    warning.banks > 0 ? plural(warning.banks, 'Question Bank', 'Question Banks') : null,
    warning.folders > 0 ? plural(warning.folders, 'Folder', 'Folders') : null,
  ].filter((part): part is string => part !== null)
  if (parts.length <= 1) return parts[0] ?? 'nothing'
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/** Before Trash: what is going, by kind, and which Exams use Questions from
 *  any bank among it. */
export function TrashDialog({ name, warning, refs = [], onCancel, onConfirm }: {
  /** The one thing being deleted, or null for several. */
  name: string | null
  warning: DeletionWarning
  /** What is being deleted, so a Shared Resource can say what Trash does to
   *  its Drive Copy (ADR-0052). */
  refs?: readonly EntryRef[]
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const drive = useDriveSync()
  const [sharing, setSharing] = useState<SharingSummary | null>(null)
  useEffect(() => {
    if (!drive?.connected || refs.length === 0) return
    let current = true
    void drive.sharing(refs).then((summary) => { if (current) setSharing(summary) }).catch(() => undefined)
    return () => { current = false }
    // Asked once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [error, setError] = useState<string | null>(null)
  const total = warning.exams + warning.banks + warning.folders
  const title = name ? `Delete “${name}”?` : `Delete ${total} items?`
  return (
    <Modal label={title} className="destructive-dialog" onClose={onCancel} busy={busy}>
      <h2>{title}</h2>
      <p>
        {total > 1 ? `This sends ${countsText(warning)} to Trash.` : 'This sends it to Trash.'}{' '}
        Things in Trash are deleted for good after {TRASH_DAYS} days, and can be restored until then.
      </p>
      {warning.affectedExams.length > 0 && <>
        <p>
          {warning.affectedExams.length === 1 ? 'This Exam uses' : 'These Exams use'} Questions from{' '}
          {warning.banks === 1 ? 'this Question Bank' : 'these Question Banks'}. They keep them while it’s in Trash,
          and lose them if it’s deleted for good:
        </p>
        <ul>{warning.affectedExams.map((exam) => <li key={exam.id}>{exam.title}</li>)}</ul>
      </>}
      {sharing && sharing.owned > 0 && (
        <p className="trash-drive-warning">
          {sharing.counted && sharing.people > 0
            ? `Shared with ${sharing.people === 1 ? '1 person' : `${sharing.people} people`}. `
            : ''}
          You own {sharing.owned === 1 && total <= 1 ? 'it' : 'what is going'} in Google Drive, so your next sync moves {sharing.owned === 1 ? 'its Drive Copy' : 'their Drive Copies'} to Drive’s trash, for everyone {sharing.counted && sharing.people > 0 ? 'it’s shared with' : 'you shared it with'}.
        </p>
      )}
      {sharing && sharing.othersOwn > 0 && (
        <p className="trash-drive-warning">
          {sharing.othersOwn === 1 ? 'One of these is' : `${sharing.othersOwn} of these are`} shared with you by someone else, so this only removes {sharing.othersOwn === 1 ? 'it' : 'them'} from your Library. Their file in Drive stays.
        </p>
      )}
      {error && <p className="dialog-save-error" role="alert">{error}</p>}
      <footer className="destructive-dialog-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="danger-button" data-autofocus disabled={busy} onClick={() => {
          setBusy(true)
          void onConfirm().catch((reason) => { setError(errorText(reason)); setBusy(false) })
        }}>{busy ? 'Deleting…' : 'Move to Trash'}</button>
      </footer>
    </Modal>
  )
}

/** Delete forever and Empty Trash: nothing comes back from these. */
export function ForeverDialog({ title, body, confirmLabel, onCancel, onConfirm }: {
  title: string
  body: ReactNode
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal label={title} className="destructive-dialog" onClose={onCancel} busy={busy}>
      <h2>{title}</h2>
      {body}
      {error && <p className="dialog-save-error" role="alert">{error}</p>}
      <footer className="destructive-dialog-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="danger-button" disabled={busy} onClick={() => {
          setBusy(true)
          void onConfirm().catch((reason) => { setError(errorText(reason)); setBusy(false) })
        }}>{busy ? 'Deleting…' : confirmLabel}</button>
      </footer>
    </Modal>
  )
}
