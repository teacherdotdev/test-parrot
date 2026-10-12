import type { ImageTag } from './source-document'

/**
 * Every import this browser has started, newest first: the tests still
 * waiting for the file an assistant makes, and what each finished import
 * brought in. Each import is its own entry, so starting another never
 * replaces one that is part-way through.
 *
 * A waiting import holds its Source Document itself, because that is where
 * every Pending Image's picture will come from. The Source Document is kept
 * only while its import waits: it is dropped when the import finishes, when
 * the teacher discards it, or once it is older than seven days — checked
 * when the app starts — and the entry then says the import expired. Finished
 * imports keep only what they brought in, never the file.
 *
 * It lives in a browser database of its own, outside the databases an Account
 * Backup captures (they are all named for `STORAGE_NAME`): a backup holds a
 * teacher's work, not temporary copies of their tests or a log of how that
 * work arrived.
 */

export const IMPORT_HISTORY_DATABASE = 'test-parrot-waiting-import'
const STORE = 'imports'
/** Where the one waiting import lived before imports had a history. */
const LEGACY_STORE = 'waiting-import'
const LEGACY_KEY = 'current'
export const WAITING_IMPORT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

/** The file an import started from: a test to convert — a PDF, a photo of
 *  one kept as a one-page PDF, or a Word document — a Test Parrot file, or a
 *  question file from another tool, read without an AI. */
export type ImportFileKind = 'pdf' | 'photo' | 'word' | 'record' | 'questions'

/** A test waiting for the file its assistant makes. */
export type WaitingImport = {
  id: string
  /** Absent means PDF. */
  kind?: 'pdf' | 'photo' | 'word'
  fileName: string
  bytes: Uint8Array
  pageCount: number
  tags: ImageTag[]
  pageText: string[]
  /** ISO time the Source Document was dropped. */
  createdAt: string
  /** A small PNG of its first page, for recognising it in Imports. */
  thumbnail?: Uint8Array
}

/** What a finished import brought in. */
export type ImportedItems = {
  banks: { id: string; name: string }[]
  exams: { id: string; name: string }[]
  questions: number
  /** Pending Images it left unresolved. */
  picturesNeeded: number
}

/** One import as its history lists it — never with its file's bytes. */
export type ImportEntry = {
  id: string
  kind: ImportFileKind
  fileName: string
  createdAt: string
  /** Its first page, kept after its file is gone. */
  thumbnail?: Uint8Array
} & (
  | { stage: 'waiting'; tags: number }
  | { stage: 'imported'; importedAt: string; imported: ImportedItems }
  | { stage: 'expired' }
)

type Stored = {
  id: string
  kind: ImportFileKind
  fileName: string
  createdAt: string
  stage: ImportEntry['stage']
  bytes?: ArrayBuffer
  pageCount?: number
  tags?: ImageTag[]
  pageText?: string[]
  importedAt?: string
  imported?: ImportedItems
  thumbnail?: ArrayBuffer
}

const newId = () => crypto.randomUUID()

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMPORT_HISTORY_DATABASE, 2)
    request.onupgradeneeded = () => {
      const database = request.result
      const imports = database.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : database.createObjectStore(STORE, { keyPath: 'id' })
      // The one import that waited before there was a history becomes the
      // history's first entry.
      if (database.objectStoreNames.contains(LEGACY_STORE)) {
        const legacy = request.transaction!.objectStore(LEGACY_STORE)
        const read = legacy.get(LEGACY_KEY)
        read.onsuccess = () => {
          const found = read.result as (Omit<Stored, 'id' | 'stage' | 'kind'> & { key: string; kind?: Stored['kind'] }) | undefined
          if (found) {
            const { key: _key, ...rest } = found
            void _key
            imports.put({ ...rest, id: newId(), kind: rest.kind ?? 'pdf', stage: 'waiting' } satisfies Stored)
          }
          database.deleteObjectStore(LEGACY_STORE)
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The import history could not be opened.'))
    request.onblocked = () => reject(new Error('The import history could not be opened.'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const database = await open()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode)
      const request = use(transaction.objectStore(STORE))
      let result: T | undefined
      if (request) request.onsuccess = () => { result = request.result }
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error ?? new Error('The import history could not be saved.'))
    })
  } finally {
    database.close()
  }
}

const tooOld = (entry: Pick<Stored, 'createdAt'>, now: Date) =>
  now.getTime() - new Date(entry.createdAt).getTime() > WAITING_IMPORT_LIFETIME_MS

/** An entry past its seven days, with its Source Document dropped. */
function expiredEntry({ id, kind, fileName, createdAt, thumbnail }: Stored): Stored {
  return { id, kind, fileName, createdAt, stage: 'expired', ...(thumbnail ? { thumbnail } : {}) }
}

/** Every entry, expiring any waiting import that has run out of time. */
async function allEntries(now: Date): Promise<Stored[]> {
  const entries = (await withStore<Stored[]>('readonly', (store) => store.getAll())) ?? []
  const stale = entries.filter((entry) => entry.stage === 'waiting' && tooOld(entry, now))
  if (stale.length > 0) {
    await withStore('readwrite', (store) => { for (const entry of stale) store.put(expiredEntry(entry)) })
  }
  return entries.map((entry) => (stale.includes(entry) ? expiredEntry(entry) : entry))
}

function waitingOf(entry: Stored): WaitingImport {
  return {
    id: entry.id,
    ...(entry.kind !== 'record' && entry.kind !== 'questions' ? { kind: entry.kind } : {}),
    fileName: entry.fileName,
    bytes: new Uint8Array(entry.bytes!),
    pageCount: entry.pageCount ?? 1,
    tags: entry.tags ?? [],
    pageText: entry.pageText ?? [],
    createdAt: entry.createdAt,
    ...(entry.thumbnail ? { thumbnail: new Uint8Array(entry.thumbnail) } : {}),
  }
}

const newestFirst = (a: Pick<Stored, 'createdAt'>, b: Pick<Stored, 'createdAt'>) => b.createdAt.localeCompare(a.createdAt)

/** One waiting import, unless it has finished, expired or gone. */
export async function readWaitingImport(id: string, now = new Date()): Promise<WaitingImport | null> {
  const entry = (await allEntries(now)).find((candidate) => candidate.id === id)
  return entry?.stage === 'waiting' ? waitingOf(entry) : null
}

/** Every import still waiting, newest first. */
export async function waitingImports(now = new Date()): Promise<WaitingImport[]> {
  return (await allEntries(now)).filter(({ stage }) => stage === 'waiting').sort(newestFirst).map(waitingOf)
}

/** The whole history, newest first, without any file's bytes. */
export async function listImports(now = new Date()): Promise<ImportEntry[]> {
  return (await allEntries(now)).sort(newestFirst).map((entry): ImportEntry => {
    const base = {
      id: entry.id,
      kind: entry.kind,
      fileName: entry.fileName,
      createdAt: entry.createdAt,
      ...(entry.thumbnail ? { thumbnail: new Uint8Array(entry.thumbnail) } : {}),
    }
    if (entry.stage === 'waiting') return { ...base, stage: 'waiting', tags: entry.tags?.length ?? 0 }
    if (entry.stage === 'imported') return { ...base, stage: 'imported', importedAt: entry.importedAt!, imported: entry.imported! }
    return { ...base, stage: 'expired' }
  })
}

/** Start a new import waiting on a Source Document. Any others keep waiting. */
export async function saveWaitingImport(waiting: Omit<WaitingImport, 'id'> & { id?: string }): Promise<WaitingImport> {
  const saved: WaitingImport = { ...waiting, id: waiting.id ?? newId() }
  const stored: Stored = {
    id: saved.id,
    kind: saved.kind ?? 'pdf',
    fileName: saved.fileName,
    createdAt: saved.createdAt,
    stage: 'waiting',
    bytes: saved.bytes.slice().buffer as ArrayBuffer,
    pageCount: saved.pageCount,
    tags: saved.tags.map((tag) => ({ ...tag, box: { ...tag.box } })),
    pageText: [...saved.pageText],
    ...(saved.thumbnail ? { thumbnail: saved.thumbnail.slice().buffer as ArrayBuffer } : {}),
  }
  await withStore('readwrite', (store) => { store.put(stored) })
  return saved
}

/** Forget a waiting import and its Source Document, as if never started. */
export async function discardWaitingImport(id: string): Promise<void> {
  await withStore('readwrite', (store) => { store.delete(id) })
}

/**
 * Record a finished import. One that finishes a waiting import becomes that
 * entry, its Source Document dropped; any other — a Question Bank File, a
 * package — is added as an entry of its own.
 */
export async function recordImport(
  { waitingImportId, fileName, kind }: { waitingImportId?: string; fileName: string; kind: ImportFileKind },
  imported: ImportedItems,
  now = new Date(),
): Promise<void> {
  const importedAt = now.toISOString()
  const waiting = waitingImportId
    ? (await withStore<Stored | undefined>('readonly', (store) => store.get(waitingImportId)))
    : undefined
  const entry: Stored = waiting
    ? {
        id: waiting.id,
        kind: waiting.kind,
        fileName: waiting.fileName,
        createdAt: waiting.createdAt,
        stage: 'imported',
        importedAt,
        imported,
        ...(waiting.thumbnail ? { thumbnail: waiting.thumbnail } : {}),
      }
    : { id: newId(), kind, fileName, createdAt: importedAt, stage: 'imported', importedAt, imported }
  await withStore('readwrite', (store) => { store.put(entry) })
}

/** Run when the app starts: a waiting import older than seven days expires. */
export async function expireWaitingImports(now = new Date()): Promise<void> {
  await allEntries(now)
}
