// A tab still running the older Test Parrot holds the database at the old
// version and never lets go. Opening it in the new version must wait for that
// tab, say so while it waits, and carry on by itself once the tab is closed.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, expect, test } from 'bun:test'
import { createExamWorkspaceService } from './exam-workspaces'
import { createLibraryService } from './library'
import { createQuestionBankWorkspaceService } from './question-bank-workspaces'
import { EXAM_STORE, onUpgradeBlocked, STORAGE_NAME, STORAGE_VERSION } from './storage-schema'

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

function openOldVersion(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STORAGE_NAME, STORAGE_VERSION - 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(EXAM_STORE, { keyPath: 'id' })
      store.put({ id: 'old-exam', title: 'Kept exam', createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-02T00:00:00.000Z' })
    }
    // Like the older Test Parrot: no onversionchange, so it never closes.
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

test('opening waits for an older tab, says so, and carries on once it closes', async () => {
  const oldTab = await openOldVersion()
  const heard: boolean[] = []
  const stop = onUpgradeBlocked((blocked) => heard.push(blocked))
  const workspaces = createExamWorkspaceService()
  const bankWorkspaces = createQuestionBankWorkspaceService()
  const library = createLibraryService({ workspaces, bankWorkspaces })
  let done = false
  const snapshot = library.snapshot().then((value) => { done = true; return value })

  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(done).toBe(false)
  expect(heard).toContain(true)

  oldTab.close()
  const { entries } = await snapshot
  expect(entries.map((entry) => entry.id)).toContain('old-exam')
  expect(heard.at(-1)).toBe(false)
  stop()
})
