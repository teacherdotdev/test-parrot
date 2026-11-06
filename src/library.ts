// The Library is everything Home shows (ADR-0051): Folders, and the Exams and
// Question Banks (Resources) kept in them. It owns the Folder records and
// changes where things sit, their Stars and their Trash state; what an Exam or
// a bank contains stays with their own services.

import type { ExamWorkspaceService, RecentExam } from './exam-workspaces'
import type { QuestionBankSummary, QuestionBankWorkspaceService } from './question-bank-workspaces'
import {
  expiredTrash,
  folderMap,
  folderPath,
  inTrash,
  isWithin,
  restoredParent,
  UNTITLED_FOLDER,
  type FolderRecord,
} from './resource-places'
import { FOLDER_STORE, releasedOnVersionChange, STORAGE_NAME, STORAGE_VERSION, upgradeRegistry, waitWhileBlocked } from './storage-schema'

export type EntryKind = 'folder' | 'exam' | 'bank'
export type EntryRef = { kind: EntryKind; id: string }

type EntryBase = {
  id: string
  name: string
  parentId: string | null
  starred: boolean
  trashedAt?: string
  lastModifiedAt: string
  lastOpenedAt?: string
}

export type FolderEntry = EntryBase & { kind: 'folder' }
export type ExamEntry = EntryBase & { kind: 'exam'; exam: RecentExam }
export type BankEntry = EntryBase & { kind: 'bank'; bank: QuestionBankSummary }
export type LibraryEntry = FolderEntry | ExamEntry | BankEntry

/** Everything in the Library, read at one moment. */
export type LibrarySnapshot = {
  entries: LibraryEntry[]
  folders: Map<string, FolderRecord>
}

export const refOf = (entry: { kind: EntryKind; id: string }): EntryRef => ({ kind: entry.kind, id: entry.id })
export const refKey = (ref: EntryRef) => `${ref.kind}:${ref.id}`

/** What deleting some things is about to send to Trash, said before it
 *  happens: how much, by kind, including everything inside Folders, and the
 *  Exams outside it using Questions from any bank among it. */
export type DeletionWarning = {
  folders: number
  exams: number
  banks: number
  affectedExams: { id: string; title: string }[]
}

function requestOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function completionOf(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function openRegistry(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = waitWhileBlocked(indexedDB.open(STORAGE_NAME, STORAGE_VERSION))
    request.onupgradeneeded = (event) => upgradeRegistry(request.result, request.transaction, event.oldVersion)
    request.onsuccess = () => resolve(releasedOnVersionChange(request.result))
    request.onerror = () => reject(request.error)
  })
}

export function examEntry(exam: RecentExam): ExamEntry {
  return {
    kind: 'exam',
    id: exam.id,
    name: exam.title,
    parentId: exam.parentId ?? null,
    starred: Boolean(exam.starred),
    ...(exam.trashedAt ? { trashedAt: exam.trashedAt } : {}),
    lastModifiedAt: exam.lastModifiedAt ?? exam.lastOpenedAt,
    lastOpenedAt: exam.lastOpenedAt,
    exam,
  }
}

export function bankEntry(bank: QuestionBankSummary): BankEntry {
  return {
    kind: 'bank',
    id: bank.id,
    name: bank.name,
    parentId: bank.parentId ?? null,
    starred: Boolean(bank.starred),
    ...(bank.trashedAt ? { trashedAt: bank.trashedAt } : {}),
    lastModifiedAt: bank.lastUpdatedAt,
    ...(bank.lastOpenedAt ? { lastOpenedAt: bank.lastOpenedAt } : {}),
    bank,
  }
}

export function folderEntry(folder: FolderRecord): FolderEntry {
  return {
    kind: 'folder',
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId ?? null,
    starred: Boolean(folder.starred),
    ...(folder.trashedAt ? { trashedAt: folder.trashedAt } : {}),
    lastModifiedAt: folder.lastModifiedAt,
    ...(folder.lastOpenedAt ? { lastOpenedAt: folder.lastOpenedAt } : {}),
  }
}

/** The entries `refs` name and everything inside any Folder among them,
 *  except what was sent to Trash on its own: that keeps its own 30 days. */
export function withContents(entries: readonly LibraryEntry[], refs: readonly EntryRef[], folders: ReadonlyMap<string, FolderRecord>): LibraryEntry[] {
  const keys = new Set(refs.map(refKey))
  const included = new Set<string>()
  const includes = (entry: LibraryEntry): boolean => {
    const key = refKey(entry)
    if (keys.has(key)) return true
    if (entry.trashedAt || !entry.parentId) return false
    const parent = folders.get(entry.parentId)
    return parent ? included.has(refKey({ kind: 'folder', id: parent.id })) : false
  }
  // Parents before children, so each Folder is decided before what it holds.
  const depth = (entry: LibraryEntry) => folderPathLength(entry.parentId, folders)
  for (const entry of [...entries].sort((left, right) => depth(left) - depth(right))) {
    if (includes(entry)) included.add(refKey(entry))
  }
  return entries.filter((entry) => included.has(refKey(entry)))
}

function folderPathLength(parentId: string | null, folders: ReadonlyMap<string, FolderRecord>) {
  return folderPath(parentId, folders).length
}

export function createLibraryService({
  workspaces,
  bankWorkspaces,
  now = () => new Date(),
  createId = () => crypto.randomUUID(),
}: {
  workspaces: ExamWorkspaceService
  bankWorkspaces: QuestionBankWorkspaceService
  now?: () => Date
  createId?: () => string
}) {
  const registry = openRegistry()
  const transact = async <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => Promise<T> | T) => {
    const transaction = (await registry).transaction(FOLDER_STORE, mode)
    const completed = completionOf(transaction)
    try {
      const result = await operation(transaction.objectStore(FOLDER_STORE))
      await completed
      return result
    } catch (error) {
      try { transaction.abort() } catch { /* already settled */ }
      await completed.catch(() => undefined)
      throw error
    }
  }
  const readFolders = () => transact('readonly', (store) => requestOf(store.getAll()) as Promise<FolderRecord[]>)
  const patchFolder = (id: string, change: Partial<FolderRecord>, { modified = false } = {}) =>
    transact('readwrite', async (store) => {
      const folder = await requestOf(store.get(id)) as FolderRecord | undefined
      if (!folder) return
      const next: FolderRecord = { ...folder, ...change, ...(modified ? { lastModifiedAt: now().toISOString() } : {}) }
      if (next.trashedAt === undefined) delete next.trashedAt
      store.put(next)
    })
  /** Changes one thing's place record, whatever kind it is. */
  const place = (ref: EntryRef, change: { parentId?: string | null; starred?: boolean; trashedAt?: string | undefined }, options: { modified?: boolean } = {}) => {
    if (ref.kind === 'folder') return patchFolder(ref.id, change, options)
    if (ref.kind === 'exam') return workspaces.place(ref.id, change, options)
    return bankWorkspaces.place(ref.id, change, options)
  }

  const service = {
    async snapshot(): Promise<LibrarySnapshot> {
      const [exams, banks, folders] = await Promise.all([workspaces.recent(), bankWorkspaces.recent(), readFolders()])
      return {
        entries: [...folders.map(folderEntry), ...exams.map(examEntry), ...banks.map(bankEntry)],
        folders: folderMap(folders),
      }
    },
    async folders(): Promise<Map<string, FolderRecord>> {
      return folderMap(await readFolders())
    },
    /** Where one Resource or Folder sits, without reading every Exam. */
    async placeOf(ref: EntryRef): Promise<string | null> {
      if (ref.kind === 'folder') return (await service.folder(ref.id))?.parentId ?? null
      if (ref.kind === 'exam') return (await workspaces.summary(ref.id))?.parentId ?? null
      return bankWorkspaces.summaryPlace(ref.id)
    },
    async folder(id: string): Promise<FolderRecord | null> {
      return (await transact('readonly', (store) => requestOf(store.get(id)) as Promise<FolderRecord | undefined>)) ?? null
    },
    async createFolder(name: string, parentId: string | null): Promise<FolderRecord> {
      const timestamp = now().toISOString()
      const folder: FolderRecord = {
        id: createId(),
        name: name.trim() || UNTITLED_FOLDER,
        parentId,
        createdAt: timestamp,
        lastModifiedAt: timestamp,
      }
      await transact('readwrite', (store) => { store.add(folder) })
      return folder
    },
    async openedFolder(id: string): Promise<void> {
      await patchFolder(id, { lastOpenedAt: now().toISOString() })
    },
    async rename(ref: EntryRef, name: string): Promise<void> {
      const trimmed = name.trim()
      if (!trimmed) return
      if (ref.kind === 'folder') await patchFolder(ref.id, { name: trimmed }, { modified: true })
      else if (ref.kind === 'exam') await workspaces.rename(ref.id, trimmed)
      else await bankWorkspaces.commit(ref.id, { kind: 'rename', name: trimmed })
    },
    /** Moves each into `parentId` (null for the top level). A Folder cannot go
     *  inside itself; asking that of one leaves it where it is. */
    async move(refs: readonly EntryRef[], parentId: string | null): Promise<void> {
      const folders = folderMap(await readFolders())
      for (const ref of refs) {
        if (ref.kind === 'folder' && isWithin(parentId, ref.id, folders)) continue
        await place(ref, { parentId }, { modified: true })
      }
    },
    async setStarred(refs: readonly EntryRef[], starred: boolean): Promise<void> {
      for (const ref of refs) await place(ref, { starred })
    },
    async deletionWarning(refs: readonly EntryRef[]): Promise<DeletionWarning> {
      const { entries, folders } = await service.snapshot()
      const going = withContents(entries, refs, folders)
      const goingExams = new Set(going.filter((entry) => entry.kind === 'exam').map((entry) => entry.id))
      const questionIds = (await Promise.all(going
        .filter((entry) => entry.kind === 'bank')
        .map(async (entry) => (await bankWorkspaces.read(entry.id))?.questions.map(({ id }) => id) ?? [])))
        .flat()
      const usage = questionIds.length > 0 ? await workspaces.resourceUsage(questionIds) : []
      return {
        folders: going.filter((entry) => entry.kind === 'folder').length,
        exams: goingExams.size,
        banks: going.filter((entry) => entry.kind === 'bank').length,
        affectedExams: usage
          .filter((item) => !goingExams.has(item.examId))
          .map((item) => ({ id: item.examId, title: item.title })),
      }
    },
    /** Sends each to Trash, with whatever it holds (ADR-0051). */
    async trash(refs: readonly EntryRef[]): Promise<void> {
      const trashedAt = now().toISOString()
      for (const ref of refs) await place(ref, { trashedAt })
    },
    async restore(refs: readonly EntryRef[]): Promise<void> {
      const { entries } = await service.snapshot()
      for (const ref of refs) {
        const entry = entries.find((candidate) => refKey(candidate) === refKey(ref))
        if (!entry) continue
        // Read afresh: its own Folder may be one restored just before it.
        const parentId = restoredParent(entry, folderMap(await readFolders()))
        await place(ref, { trashedAt: undefined, parentId })
      }
    },
    /** Deletes each for good, with everything inside it. Exams take their
     *  Export History with them; a bank's Questions leave every Exam that
     *  used them. */
    async deleteForever(refs: readonly EntryRef[]): Promise<void> {
      const { entries, folders } = await service.snapshot()
      const going = withContents(entries, refs, folders)
      for (const entry of going) {
        if (entry.kind === 'exam') await workspaces.deleteExam(entry.id)
      }
      for (const entry of going) {
        if (entry.kind === 'bank') {
          await bankWorkspaces.permanentlyDeleteBank(entry.id, (ids) => workspaces.forceDeleteQuestions(ids))
        }
      }
      const folderIds = going.filter((entry) => entry.kind === 'folder').map((entry) => entry.id)
      if (folderIds.length > 0) await transact('readwrite', (store) => { for (const id of folderIds) store.delete(id) })
    },
    /** What is in Trash: only the things deleted, not what they hold. */
    trashed(snapshot: LibrarySnapshot): LibraryEntry[] {
      return snapshot.entries.filter((entry) => entry.trashedAt)
    },
    async emptyTrash(): Promise<void> {
      await service.deleteForever(service.trashed(await service.snapshot()).map(refOf))
    },
    /** Deletes for good whatever has been in Trash for 30 days. Run whenever
     *  the app starts, which is the "next time the app is open". */
    async expireTrash(): Promise<number> {
      const expired = expiredTrash(service.trashed(await service.snapshot()), now())
      if (expired.length > 0) await service.deleteForever(expired.map(refOf))
      return expired.length
    },
    inTrash(entry: LibraryEntry, folders: ReadonlyMap<string, FolderRecord>) {
      return inTrash(entry, folders)
    },
  }
  return service
}

export type LibraryService = ReturnType<typeof createLibraryService>
