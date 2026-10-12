import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloudOff, Download, RefreshCw, Settings, Upload, X } from 'lucide-react'
import {
  accountBackupBlob,
  accountBackupFileName,
  captureAccount,
  readAccountBackup,
  stageRestore,
  AccountBackupError,
  type AccountManifest,
} from './account-backup'
import type { PersistentStorageStatus } from './durable-storage'
import { useModalScrollLock } from './use-modal-scroll-lock'
import { navigate } from './use-route'
import './account-menu.css'

/**
 * Where the work lives, and the way to keep it. An icon in the top bar says
 * the work is saved in this browser and points to Settings, which holds the
 * backup: download the whole account as one file, or restore from one.
 */

export const SETTINGS_PATH = '/settings'

async function downloadBackup() {
  const blob = await accountBackupBlob(await captureAccount())
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = accountBackupFileName()
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AccountBadge({ status }: { status: PersistentStorageStatus }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="account-badge" ref={root}>
      <button
        type="button"
        className="storage-badge-button"
        data-status={status}
        aria-label="Where your work is stored"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <CloudOff aria-hidden="true" />
      </button>
      {open && (
        <div className="account-panel" id={panelId} role="region" aria-label="Where your work is stored">
          <strong>Your work is saved in your browser.</strong>
          <p>Go to Settings to export your data.</p>
          {status === 'denied' && (
            <p className="account-warning">
              Persistent storage was denied. Your browser may clear this local data when space is needed.
            </p>
          )}
          <div className="account-actions">
            <button
              type="button"
              className="secondary-button account-action"
              onClick={() => { setOpen(false); navigate(SETTINGS_PATH) }}
            >
              <Settings aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


export function BackupSettings({ status }: { status: PersistentStorageStatus }) {
  const [restoring, setRestoring] = useState<{ file: File; manifest: AccountManifest } | null>(null)
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const backup = async () => {
    setBusy('backup')
    setError('')
    try {
      await downloadBackup()
    } catch {
      setError('The backup could not be created. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const chooseRestore = async (file: File | undefined) => {
    if (!file) return
    setBusy('restore')
    setError('')
    try {
      const snapshot = await readAccountBackup(file)
      setRestoring({ file, manifest: snapshot.manifest })
    } catch (caught) {
      setError(caught instanceof AccountBackupError ? caught.message : 'This backup could not be read.')
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <section className="site-card account-settings" aria-labelledby="settings-backup">
      <h2 id="settings-backup">Back up your work</h2>
      <p>
        Exams, Question Banks, Working Copies, and Export History are saved in this browser. Download
        a backup now and then, and restore it here or in another browser.
      </p>
      {status === 'denied' && (
        <p className="account-warning">
          Persistent storage was denied. Your browser may clear this local data when space is needed.
        </p>
      )}
      {status === 'granted' && <p className="account-ok">Persistent browser storage is enabled.</p>}
      <div className="account-actions">
        <button type="button" className="secondary-button account-action" onClick={backup} disabled={busy !== null}>
          {busy === 'backup' ? <RefreshCw aria-hidden="true" className="account-spin" /> : <Download aria-hidden="true" />}
          {busy === 'backup' ? 'Preparing…' : 'Download backup'}
        </button>
        <button type="button" className="secondary-button account-action" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
          <Upload aria-hidden="true" />
          {busy === 'restore' ? 'Reading…' : 'Restore…'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          aria-label="Choose an account backup to restore"
          onChange={(event) => void chooseRestore(event.target.files?.[0])}
        />
      </div>
      {error && <p className="account-warning" role="alert">{error}</p>}
      {restoring && (
        <RestoreDialog
          file={restoring.file}
          manifest={restoring.manifest}
          onClose={() => setRestoring(null)}
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

function Modal({ title, onClose, children, className = '' }: {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  useModalScrollLock()
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
        className={`account-dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="resource-picker-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="question-bank-action" aria-label="Close" onClick={onClose}><X /></button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  )
}

function RestoreDialog({ file, manifest, onClose }: {
  file: File
  manifest: AccountManifest
  onClose: () => void
}) {
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null)
  const [error, setError] = useState('')
  const made = new Date(manifest.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const restore = async () => {
    setBusy('restore')
    setError('')
    try {
      await stageRestore({ bytes: await file.arrayBuffer() })
      window.location.reload()
    } catch {
      setError('The backup could not be restored. Nothing in this browser was changed.')
      setBusy(null)
    }
  }
  const backupFirst = async () => {
    setBusy('backup')
    setError('')
    try {
      await downloadBackup()
    } catch {
      setError('The backup could not be created. Try again.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <Modal title="Restore this backup?" onClose={onClose}>
      <p className="account-dialog-copy">
        <strong>{file.name}</strong> was made {made}. Restoring replaces every Exam, Question Bank,
        Working Copy, and Export History in this browser with the ones in the backup, then reloads
        Test Parrot.
      </p>
      {error && <p className="account-warning" role="alert">{error}</p>}
      <div className="account-actions account-actions--end">
        <button type="button" className="secondary-button account-action" disabled={busy !== null} onClick={() => void backupFirst()}>
          <Download aria-hidden="true" />
          {busy === 'backup' ? 'Preparing…' : 'Download current work first'}
        </button>
        <button type="button" className="primary-button" disabled={busy !== null} onClick={() => void restore()}>
          {busy === 'restore' ? 'Restoring…' : 'Replace and reload'}
        </button>
      </div>
    </Modal>
  )
}
