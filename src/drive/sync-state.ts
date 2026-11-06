// What this browser remembers about its Drive Connection (ADR-0052): which
// account, where its Test Parrot folder is, and for each Resource and Folder
// the Drive file it was last synced with and what both sides looked like
// then. It is the browser's own bookkeeping, not the teacher's work, so it is
// kept outside the account: its key is not one an Account Backup carries.

export type ResourceKind = 'bank' | 'exam'

export type FileEntry = {
  kind: ResourceKind
  fileId: string
  /** The Resource's last modified time when this browser last synced it. */
  localModifiedAt: string
  /** The Drive file's content checksum then. */
  md5: string
  ownedByMe: boolean
  /** Sent to Drive's trash because the Resource went to Trash here. */
  trashed?: boolean
  /** Whatever the local side asked to be handed back next time it applies
   *  this file (an Exam's own bank, say). Opaque to the sync. */
  memo?: Record<string, unknown>
}

/** A file both sides changed since this browser last synced it. */
export type Conflict = {
  kind: ResourceKind
  id: string
  name: string
  fileId: string
}

export type SyncState = {
  account?: { email: string; name?: string }
  rootId?: string
  backupId?: string
  /** When this browser last finished a sync while connected. */
  lastSyncAt?: string
  /** Local Folder id → Drive folder id. */
  folders: Record<string, string>
  /** `kind:id` → its Drive Copy. */
  files: Record<string, FileEntry>
  /** Drive files someone else owns that the teacher took out of their
   *  Library: never brought down again unless handed over again. */
  ignored?: string[]
  /** What the last sync skipped, until the teacher chooses. */
  conflicts: Conflict[]
}

export const emptySyncState = (): SyncState => ({ folders: {}, files: {}, conflicts: [] })

export const fileKey = (kind: ResourceKind, id: string) => `${kind}:${id}`

export type SyncStateStore = {
  read(): SyncState
  write(state: SyncState): void
}

export function memorySyncStateStore(initial: SyncState = emptySyncState()): SyncStateStore & { state: SyncState } {
  const store = {
    state: structuredClone(initial),
    read: () => structuredClone(store.state),
    write: (state: SyncState) => { store.state = structuredClone(state) },
  }
  return store
}

/** Deliberately outside the `test-parrot:` keys an Account Backup carries. */
export const SYNC_STATE_KEY = 'drive-sync-state'
const CHANGED_EVENT = 'testparrot:drive-sync-state'

export const browserSyncStateStore: SyncStateStore = {
  read() {
    try {
      const raw = localStorage.getItem(SYNC_STATE_KEY)
      if (!raw) return emptySyncState()
      return { ...emptySyncState(), ...JSON.parse(raw) as Partial<SyncState> }
    } catch {
      return emptySyncState()
    }
  },
  write(state) {
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state))
    window.dispatchEvent(new Event(CHANGED_EVENT))
  },
}

export function onSyncStateChanged(listener: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, listener)
  const onStorage = (event: StorageEvent) => { if (event.key === SYNC_STATE_KEY) listener() }
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGED_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** What Disconnect leaves: nothing about the account or its files. */
export function disconnectedState(): SyncState {
  return emptySyncState()
}

/** After a restore, the Resources are the backup's: what this browser knew
 *  about its own no longer applies. The account and folder stay. */
export function afterRestore(state: SyncState): SyncState {
  return {
    ...emptySyncState(),
    ...(state.account ? { account: state.account } : {}),
    ...(state.rootId ? { rootId: state.rootId } : {}),
    ...(state.backupId ? { backupId: state.backupId } : {}),
  }
}

/** The Resource a Drive file already is in this browser, or null. */
export function knownFile(state: SyncState, fileId: string): { kind: ResourceKind; id: string } | null {
  const found = Object.entries(state.files).find(([, entry]) => entry.fileId === fileId && !entry.trashed)
  if (!found) return null
  const [key, entry] = found
  return { kind: entry.kind, id: key.slice(entry.kind.length + 1) }
}
