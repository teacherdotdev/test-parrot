import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Cloud, RefreshCw, Settings } from 'lucide-react'
import { SETTINGS_PATH } from '../account-menu'
import { navigate } from '../use-route'
import type { DriveSync } from './drive-sync-context'
import type { SyncReport } from './sync-engine'
import './sync-button.css'

export const PRIVACY_NOTE = 'Your work goes straight from this browser to your own Google Drive.'

function when(iso: string | undefined) {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function summary(report: SyncReport): string {
  const parts = [
    report.uploaded.length > 0 && `${report.uploaded.length} sent to Drive`,
    report.downloaded.length > 0 && `${report.downloaded.length} brought down`,
    report.trashed.length > 0 && `${report.trashed.length} trashed`,
  ].filter(Boolean)
  if (report.failed.length > 0) return `Sync finished, but ${report.failed.length === 1 ? '1 file' : `${report.failed.length} files`} could not be synced.`
  return parts.length > 0 ? `Synced: ${parts.join(', ')}.` : 'Everything is in sync.'
}

/** Sync with Drive, in the top bar: one click syncs, and the arrow beside it
 *  opens what the connection is and what the last sync did. */
export function SyncButton({ drive }: { drive: DriveSync }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const { state, busy, report, error } = drive
  const syncing = busy === 'syncing' || busy === 'connecting'

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // What a sync leaves to say opens the panel: a choice to make, or a problem.
  useEffect(() => {
    if (error || drive.backupOffer || (report && (report.conflicts.length > 0 || report.failed.length > 0 || report.readOnly.length > 0))) setOpen(true)
  }, [drive.backupOffer, error, report])

  const onSync = () => {
    if (!drive.connected) {
      setOpen(true)
      return
    }
    void drive.sync()
  }

  return (
    <div className="sync-control" ref={root}>
      <button
        type="button"
        className="sync-button"
        onClick={onSync}
        disabled={busy !== null}
        aria-label={drive.dot ? 'Sync with Drive (changes waiting)' : 'Sync with Drive'}
        title="Sync with Drive"
      >
        {syncing ? <RefreshCw aria-hidden="true" className="account-spin" /> : <Cloud aria-hidden="true" />}
        <span>{syncing ? 'Syncing…' : 'Sync'}</span>
        {drive.dot && !syncing && <span className="sync-dot" data-testid="sync-dot" aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="sync-menu-button"
        aria-label="Drive Connection"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown aria-hidden="true" />
      </button>
      <span className="sr-only" role="status">{report && !syncing ? summary(report) : ''}</span>
      {open && (
        <div className="account-panel sync-panel" id={panelId} role="region" aria-label="Drive Connection">
          {!drive.connected ? (
            <>
              <strong>Sync with Google Drive</strong>
              <p>Keep your Exams and Question Banks in your own Google Drive, to use them on another computer or share them with colleagues. Test Parrot works the same without it.</p>
            </>
          ) : (
            <>
              <strong>Synced with {state.account!.email}</strong>
              <p>Last synced: {when(state.lastSyncAt)}</p>
              {drive.backupOffer ? (
                <div className="sync-offer">
                  <p>Your Drive already has Test Parrot work from another computer. Bring it here, replacing what this browser has, or sync this browser’s work alongside it.</p>
                  <div className="account-actions">
                    <button type="button" className="primary-button account-action" disabled={busy !== null} onClick={() => void drive.restoreFromDrive()}>
                      {busy === 'restoring' ? 'Bringing it here…' : 'Use the work in Drive'}
                    </button>
                    <button type="button" className="secondary-button account-action" disabled={busy !== null} onClick={() => void drive.sync()}>
                      Sync this browser
                    </button>
                  </div>
                </div>
              ) : report && (
                <div className="sync-report">
                  <p>{summary(report)}</p>
                  {report.readOnly.length > 0 && (
                    <p className="account-warning">Shared with you to view only, so your changes stay in this browser: {report.readOnly.join(', ')}.</p>
                  )}
                  {report.failed.map((failure) => (
                    <p key={failure.name} className="account-warning">{failure.name}: {failure.message}</p>
                  ))}
                </div>
              )}
              {state.conflicts.length > 0 && (
                <div className="sync-conflicts">
                  <p className="account-warning">Changed both here and in Drive since this browser last synced, so sync skipped {state.conflicts.length === 1 ? 'it' : 'them'}. Nothing is merged: choose for each.</p>
                  {state.conflicts.map((conflict) => (
                    <div key={conflict.fileId} className="sync-conflict" role="group" aria-label={conflict.name}>
                      <strong>{conflict.name}</strong>
                      <div className="account-actions">
                        <button type="button" className="secondary-button account-action" disabled={busy !== null} onClick={() => void drive.resolve(conflict, 'theirs')}>
                          Use theirs
                        </button>
                        <button type="button" className="secondary-button account-action" disabled={busy !== null} onClick={() => void drive.resolve(conflict, 'both')}>
                          Keep both
                        </button>
                      </div>
                      <p className="sync-footnote">Use theirs replaces your copy with the one in Drive. Keep both keeps yours too, as “{conflict.name} (your copy)”.</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {error && <p className="account-warning" role="alert">{error}</p>}
          <div className="account-actions">
            {!drive.connected && (
              <button type="button" className="primary-button account-action" disabled={busy !== null} onClick={() => void drive.connect()}>
                <Cloud aria-hidden="true" />
                {busy === 'connecting' ? 'Connecting…' : 'Connect Google Drive'}
              </button>
            )}
            <button type="button" className="secondary-button account-action" onClick={() => { setOpen(false); navigate(SETTINGS_PATH) }}>
              <Settings aria-hidden="true" />
              Settings
            </button>
          </div>
          <p className="sync-privacy">{PRIVACY_NOTE}</p>
        </div>
      )}
    </div>
  )
}
