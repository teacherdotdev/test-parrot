// The Drive Connection's context, apart from its provider so pages can use
// it without importing the provider's machinery.

import { createContext, useContext } from 'react'
import type { DriveFile } from './drive-client'
import { navigate } from '../use-route'
import type { ConflictChoice, LocalRef, SyncReport } from './sync-engine'
import type { Conflict, SyncState } from './sync-state'

/** What deleting some Resources means in Drive. */
export type SharingSummary = {
  /** Drive Copies this teacher owns among them. */
  owned: number
  /** People those are shared with, when `counted`. */
  people: number
  /** Shared Resources someone else owns: Trash only takes them out of this
   *  Library. */
  othersOwn: number
  counted: boolean
}

export const LIBRARY_CHANGED_EVENT = 'testparrot:library-changed'

export type DriveBusy = 'connecting' | 'syncing' | 'restoring' | 'opening' | null

export type DriveSync = {
  configured: boolean
  state: SyncState
  connected: boolean
  dot: boolean
  busy: DriveBusy
  report: SyncReport | null
  error: string
  /** Set after connecting when Drive already holds an Account Backup and
   *  this browser has never synced: the teacher chooses what happens. */
  backupOffer: DriveFile | null
  connect(): Promise<void>
  sync(): Promise<void>
  disconnect(): void
  restoreFromDrive(): Promise<void>
  dismissBackupOffer(): void
  /** Opens a Drive Copy by its file id: the Resource it already is here, or
   *  brought down first. Null when this account cannot read it yet. */
  openDriveFile(fileId: string): Promise<LocalRef | null>
  /** Shows the Google Picker with this one file preselected, so a teammate
   *  hands it to Test Parrot; true once it was picked. */
  pickToOpen(fileId: string): Promise<boolean>
  /** Add from Google Drive: the Picker, then each file picked into
   *  `folderId`. Resolves with how many came in. */
  addFromDrive(folderId: string | null): Promise<number>
  /** Use theirs, or Keep both, for one file the last sync skipped. */
  resolve(conflict: Conflict, choice: ConflictChoice): Promise<void>
  /** What sending these to Trash does in Drive, for its warning. */
  sharing(refs: readonly { kind: string; id: string }[]): Promise<SharingSummary>
  clearReport(): void
}

export const DriveSyncContext = createContext<DriveSync | null>(null)

export function useDriveSync(): DriveSync | null {
  return useContext(DriveSyncContext)
}


export function libraryChanged() {
  window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT))
}

/** Opens a Resource where it lives: an Exam in the editor, a bank on its page. */
export function openResource(target: LocalRef) {
  if (target.kind === 'exam') window.location.assign(`/editor?exam=${encodeURIComponent(target.id)}`)
  else navigate(`/question-bank?id=${encodeURIComponent(target.id)}`)
}
