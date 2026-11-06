import { useEffect, useRef, useState } from 'react'
import { Cloud, Database, FileText } from 'lucide-react'
import { AppShell } from '../app-shell'
import type { PersistentStorageStatus } from '../durable-storage'
import { openResource, useDriveSync } from './drive-sync-context'
import { readOpenLinkPreview } from './drive-copy'
import { cachedToken } from './google-auth'
import { PRIVACY_NOTE } from './sync-button'

/**
 * Where a Drive Copy's "Open in Test Parrot" banner leads (ADR-0052). A file
 * this browser syncs, or any file while the Google sign-in is good, opens
 * straight away; otherwise Google needs a click, so the page asks for one. A
 * file this account cannot read yet is handed over through the Google
 * Picker, with it preselected, first.
 */
export function OpenFromDrivePage({ persistentStorage }: { persistentStorage: PersistentStorageStatus }) {
  const drive = useDriveSync()
  const fileId = new URLSearchParams(window.location.search).get('drive') ?? ''
  const [problem, setProblem] = useState('')
  const open = async () => {
    if (!drive) return
    setProblem('')
    try {
      let target = await drive.openDriveFile(fileId)
      // A teammate's file: `drive.file` cannot read it until it is handed
      // over, which is what picking it does.
      if (!target && await drive.pickToOpen(fileId)) target = await drive.openDriveFile(fileId)
      if (target) openResource(target)
      else setProblem('This file isn’t shared with the Google account you chose, or it is no longer in Drive. Ask its owner to share it with you, then try again.')
    } catch {
      // The controller already says what went wrong.
    }
  }
  // No second click when none is needed: a file this browser already syncs
  // opens at once, and so does any file while Google's sign-in is still good.
  // Only a sign-in that has run out waits for the button, because Google's
  // popup needs a click to open.
  const started = useRef(false)
  useEffect(() => {
    if (started.current || !drive?.configured || !fileId) return
    if (!drive.state.files || (!Object.values(drive.state.files).some((entry) => entry.fileId === fileId) && !cachedToken())) return
    started.current = true
    void open()
  })
  const preview = readOpenLinkPreview(window.location.search)
  const kindLabel = preview?.kind === 'exam' ? 'Exam' : preview?.kind === 'bank' ? 'Question Bank' : 'Test Parrot file'
  const Icon = preview?.kind === 'exam' ? FileText : Database
  const opening = drive?.busy === 'opening'
  return (
    <AppShell crumbs={[{ label: 'Home', href: '/' }, { label: preview?.title ?? 'Open from Google Drive' }]} persistentStorage={persistentStorage}>
      <div className="open-drive">
        {!drive?.configured || !fileId ? (
          <p className="site-lede">This link opens a Test Parrot file kept in Google Drive, but Google Drive isn’t available here.</p>
        ) : (
          <article className="open-drive-card" aria-labelledby="open-drive-title">
            {/* A sheet of the file, drawn from what the link says: enough to
                recognise it before Google is asked for the real thing. */}
            <div className="open-drive-sheet" aria-hidden="true">
              <span className="open-drive-sheet-kind"><Icon />{kindLabel}</span>
              <span className="open-drive-sheet-title">{preview?.title ?? 'Shared from Google Drive'}</span>
              {Array.from({ length: Math.min(Math.max(preview?.questions ?? 3, 2), 5) }, (_, index) => (
                <span key={index} className="open-drive-sheet-question">
                  <span>{index + 1}.</span><span className="open-drive-line" /><span className="open-drive-line open-drive-line--short" />
                </span>
              ))}
            </div>
            <div className="open-drive-details">
              <p className="open-drive-kind"><Icon aria-hidden="true" />{kindLabel} in Google Drive</p>
              <h1 id="open-drive-title">{preview?.title ?? 'Open from Google Drive'}</h1>
              {preview && <p className="open-drive-meta">{preview.questions === 1 ? '1 Question' : `${preview.questions} Questions`}</p>}
              <p>Open it in Test Parrot to work on it. It stays in step with Drive each time you sync.</p>
              <div className="account-actions">
                <button type="button" className="primary-button account-action" disabled={drive.busy !== null} onClick={() => void open()}>
                  <Cloud aria-hidden="true" />
                  {opening ? 'Opening…' : 'Open in Test Parrot'}
                </button>
              </div>
              {(problem || drive.error) && <p className="account-warning" role="alert">{problem || drive.error}</p>}
              <p className="sync-privacy">{PRIVACY_NOTE}</p>
            </div>
          </article>
        )}
      </div>
    </AppShell>
  )
}
