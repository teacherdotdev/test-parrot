// The Drive Connection and Sync with Drive as the app uses them (ADR-0052):
// one controller per page, shared through context by the Sync button, the
// `/open` page and the New menu.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DriveSyncContext, LIBRARY_CHANGED_EVENT, libraryChanged, type DriveBusy, type DriveSync, type SharingSummary } from './drive-sync-context'
import type { ExamWorkspaceService } from '../exam-workspaces'
import type { LibraryService } from '../library'
import type { QuestionBankWorkspaceService } from '../question-bank-workspaces'
import { createBrowserLibrary } from './browser-library'
import type { DriveClient, DriveFile } from './drive-client'
import { createGoogleDrive } from './google-drive'
import { cachedToken, disconnectGoogle, driveConfigured, DriveAuthError, preloadGoogle, requestDriveToken } from './google-auth'
import { bringInDriveFiles, findDriveBackup, needsSync, resolveConflict, sharedWithCount, syncWithDrive, type ConflictChoice, type LocalRef, type LocalSide, type SyncReport } from './sync-engine'
import { afterRestore, browserSyncStateStore, disconnectedState, fileKey, onSyncStateChanged, knownFile, type Conflict, type SyncState, type SyncStateStore } from './sync-state'

export type DriveSyncServices = {
  library: LibraryService
  workspaces: ExamWorkspaceService
  bankWorkspaces: QuestionBankWorkspaceService
}

function errorText(error: unknown): string {
  if (error instanceof DriveAuthError) return error.message
  return error instanceof Error && error.message ? `Sync with Drive stopped: ${error.message}` : 'Sync with Drive stopped. Try again.'
}

export function DriveSyncProvider({
  services,
  children,
  store = browserSyncStateStore,
  makeDrive,
  makeLocal,
}: {
  services: DriveSyncServices
  children: ReactNode
  store?: SyncStateStore
  makeDrive?: (token: () => Promise<string>) => DriveClient
  makeLocal?: (services: DriveSyncServices) => LocalSide
}) {
  const configured = driveConfigured()
  const [state, setState] = useState<SyncState>(() => store.read())
  const [busy, setBusy] = useState<DriveBusy>(null)
  const [report, setReport] = useState<SyncReport | null>(null)
  const [error, setError] = useState('')
  const [dot, setDot] = useState(false)
  const [backupOffer, setBackupOffer] = useState<DriveFile | null>(null)
  const local = useMemo(() => (makeLocal ?? createBrowserLibrary)(services), [makeLocal, services])
  const stateRef = useRef(state)
  stateRef.current = state
  const drive = useMemo(() => (makeDrive ?? createGoogleDrive)(
    () => requestDriveToken(stateRef.current.account ? { loginHint: stateRef.current.account.email } : {}),
  ), [makeDrive])

  useEffect(() => {
    if (!configured) return
    preloadGoogle()
    return onSyncStateChanged(() => setState(store.read()))
  }, [configured, store])

  // The dot: worked out again whenever what it depends on may have moved.
  useEffect(() => {
    if (!configured || !state.account) {
      setDot(false)
      return
    }
    let current = true
    const check = () => {
      void local.snapshot().then(({ resources }) => {
        if (current) setDot(needsSync(store.read(), resources, new Date()))
      }).catch(() => undefined)
    }
    check()
    const timer = window.setInterval(check, 60_000)
    window.addEventListener('focus', check)
    window.addEventListener(LIBRARY_CHANGED_EVENT, check)
    return () => {
      current = false
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      window.removeEventListener(LIBRARY_CHANGED_EVENT, check)
    }
  }, [configured, local, state, store])

  const save = useCallback((next: SyncState) => {
    store.write(next)
    setState(next)
  }, [store])

  const runSync = useCallback(async () => {
    setBusy('syncing')
    setError('')
    try {
      const result = await syncWithDrive({ drive, local, store })
      setReport(result)
      setState(store.read())
      if (result.downloaded.length > 0 || result.trashed.length > 0) libraryChanged()
    } catch (caught) {
      setError(errorText(caught))
      setState(store.read())
    } finally {
      setBusy(null)
    }
  }, [drive, local, store])

  const connect = useCallback(async () => {
    setBusy('connecting')
    setError('')
    try {
      await requestDriveToken()
      const account = await drive.account()
      const next = { ...store.read(), account }
      save(next)
      const backup = next.lastSyncAt ? null : await findDriveBackup(drive)
      if (backup) {
        setBackupOffer(backup)
        setBusy(null)
        return
      }
    } catch (caught) {
      setError(errorText(caught))
      setBusy(null)
      return
    }
    await runSync()
  }, [drive, runSync, save, store])

  const restoreFromDrive = useCallback(async () => {
    setBusy('restoring')
    setError('')
    try {
      const backup = backupOffer ?? await findDriveBackup(drive)
      if (!backup) throw new Error('There is no Account Backup in your Test Parrot folder yet. Sync from your other browser first.')
      const bytes = await drive.download(backup.id)
      const { readAccountBackup, stageRestore } = await import('../account-backup')
      await readAccountBackup(new Blob([bytes as BlobPart]))
      await stageRestore({ bytes: bytes.slice().buffer })
      save(afterRestore(store.read()))
      window.location.reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The backup could not be restored. Nothing in this browser was changed.')
      setBusy(null)
    }
  }, [backupOffer, drive, save, store])

  /** Connects first when this browser has no Drive Connection yet. */
  const ensureConnected = useCallback(async () => {
    const current = store.read()
    if (current.account) return
    await requestDriveToken()
    save({ ...current, account: await drive.account() })
  }, [drive, save, store])

  const openDriveFile = useCallback(async (fileId: string): Promise<LocalRef | null> => {
    // A file this browser already syncs opens as it is, with no call to Google.
    const known = knownFile(store.read(), fileId)
    if (known) return known
    setBusy('opening')
    setError('')
    try {
      await ensureConnected()
      const file = await drive.get(fileId)
      if (!file || file.trashed) return null
      const [brought] = await bringInDriveFiles({ drive, local, store }, [fileId], null)
      setState(store.read())
      libraryChanged()
      return brought ?? null
    } catch (caught) {
      setError(errorText(caught))
      throw caught
    } finally {
      setBusy(null)
    }
  }, [drive, ensureConnected, local, store])

  const addFromDrive = useCallback(async (folderId: string | null): Promise<number> => {
    setBusy('opening')
    setError('')
    try {
      await ensureConnected()
      const { pickDriveFiles } = await import('./google-picker')
      const picked = await pickDriveFiles({ title: 'Add Test Parrot files from Google Drive' })
      if (picked.length === 0) return 0
      const brought = await bringInDriveFiles({ drive, local, store }, picked, folderId)
      setState(store.read())
      libraryChanged()
      return brought.length
    } catch (caught) {
      setError(errorText(caught))
      throw caught
    } finally {
      setBusy(null)
    }
  }, [drive, ensureConnected, local, store])

  const pickToOpen = useCallback(async (fileId: string): Promise<boolean> => {
    const { pickDriveFiles } = await import('./google-picker')
    return (await pickDriveFiles({ fileIds: [fileId], multiple: false, title: 'Choose this file to open it in Test Parrot' })).includes(fileId)
  }, [])

  const resolve = useCallback(async (conflict: Conflict, choice: ConflictChoice) => {
    setBusy('syncing')
    setError('')
    try {
      await resolveConflict({ drive, local, store }, conflict, choice)
      setState(store.read())
      libraryChanged()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(null)
    }
  }, [drive, local, store])

  const sharing = useCallback(async (refs: readonly { kind: string; id: string }[]): Promise<SharingSummary> => {
    const summary: SharingSummary = { owned: 0, people: 0, othersOwn: 0, counted: true }
    for (const ref of refs) {
      if (ref.kind !== 'bank' && ref.kind !== 'exam') continue
      const entry = store.read().files[fileKey(ref.kind as LocalRef['kind'], ref.id)]
      if (!entry || entry.trashed) continue
      if (!entry.ownedByMe) { summary.othersOwn += 1; continue }
      summary.owned += 1
      // Counting asks Drive, which needs a token this click may not give.
      if (!cachedToken()) { summary.counted = false; continue }
      const counted = await sharedWithCount({ drive, store }, ref as LocalRef).catch(() => null)
      summary.people += counted?.people ?? 0
    }
    return summary
  }, [drive, store])

  const value = useMemo<DriveSync>(() => ({
    configured,
    state,
    connected: Boolean(state.account),
    dot,
    busy,
    report,
    error,
    backupOffer,
    connect,
    sync: async () => {
      setBackupOffer(null)
      if (!stateRef.current.account) await connect()
      else await runSync()
    },
    disconnect: () => {
      disconnectGoogle()
      setReport(null)
      setBackupOffer(null)
      save(disconnectedState())
    },
    restoreFromDrive,
    dismissBackupOffer: () => setBackupOffer(null),
    openDriveFile,
    pickToOpen,
    addFromDrive,
    resolve,
    sharing,
    clearReport: () => setReport(null),
  }), [addFromDrive, backupOffer, busy, configured, connect, dot, error, openDriveFile, pickToOpen, report, resolve, restoreFromDrive, runSync, save, sharing, state])

  return <DriveSyncContext.Provider value={value}>{children}</DriveSyncContext.Provider>
}
