// An Account Backup is everything Test Parrot keeps in this browser, taken
// whole: every object store of the registry database and of each Exam's own
// database, plus the app's preferences. It reads the databases generically
// rather than through the workspace services, so a schema change can never
// leave a store out of the backup.
//
// The file is a zip: `account.json` holds the records, and every binary value
// (Media Asset bytes) is lifted out into its own entry so the JSON stays
// readable and images are not inflated by base64.

import { STORAGE_NAME, STORAGE_VERSION, EXAM_STORE } from './storage-schema'

export const ACCOUNT_BACKUP_FORMAT = 'test-parrot-account'
export const ACCOUNT_BACKUP_VERSION = 1
const MANIFEST_PATH = 'account.json'

const LOCAL_STORAGE_KEYS = (key: string) => key.startsWith('test-parrot:') || key.startsWith('test-parrot-')

type Encoded =
  | null | boolean | number | string
  | Encoded[]
  | { [key: string]: Encoded }

export type StoreSchema = {
  name: string
  keyPath: string | string[] | null
  autoIncrement: boolean
  indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[]
}

export type StoreSnapshot = StoreSchema & { entries: { key: Encoded; value: Encoded }[] }

export type DatabaseSnapshot = { name: string; version: number; stores: StoreSnapshot[] }

export type AccountManifest = {
  format: typeof ACCOUNT_BACKUP_FORMAT
  version: typeof ACCOUNT_BACKUP_VERSION
  createdAt: string
  storageVersion: number
  databases: DatabaseSnapshot[]
  localStorage: Record<string, string>
}

export type AccountSnapshot = {
  manifest: AccountManifest
  /** Binary values by their path in the zip. */
  binaries: Map<string, Uint8Array>
}

// ---------------------------------------------------------------------------
// Value encoding. Structured-clone values become JSON, with binary values
// replaced by a reference to a zip entry. `$tp` marks every non-JSON value.

const TYPED_ARRAYS = {
  Uint8Array, Int8Array, Uint8ClampedArray, Uint16Array, Int16Array,
  Uint32Array, Int32Array, Float32Array, Float64Array,
} as const
type TypedArrayName = keyof typeof TYPED_ARRAYS

export function encodeValue(
  value: unknown,
  addBinary: (bytes: Uint8Array) => string,
): Encoded {
  if (value === undefined) return { $tp: 'undefined' }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : { $tp: 'number', value: String(value) }
  }
  if (value instanceof Date) return { $tp: 'date', value: value.toISOString() }
  if (value instanceof ArrayBuffer) {
    return { $tp: 'bytes', file: addBinary(new Uint8Array(value.slice(0))) }
  }
  if (ArrayBuffer.isView(value)) {
    const kind = value.constructor.name
    if (!(kind in TYPED_ARRAYS)) throw new Error(`Cannot back up a ${kind}.`)
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
    return { $tp: 'typed', kind, file: addBinary(bytes) }
  }
  if (Array.isArray(value)) return value.map((item) => encodeValue(item, addBinary))
  if (value instanceof Map) {
    return { $tp: 'map', entries: [...value].map(([k, v]) => [encodeValue(k, addBinary), encodeValue(v, addBinary)]) }
  }
  if (value instanceof Set) return { $tp: 'set', values: [...value].map((v) => encodeValue(v, addBinary)) }
  if (typeof value === 'object') {
    if (value instanceof Blob) throw new Error('Blobs must be read before encoding.')
    const out: Record<string, Encoded> = {}
    for (const [key, item] of Object.entries(value)) out[key] = encodeValue(item, addBinary)
    // A record that happens to own a `$tp` field is wrapped, so decoding can
    // never mistake it for one of the markers above.
    return '$tp' in out ? { $tp: 'object', value: out } : out
  }
  throw new Error(`Cannot back up a ${typeof value}.`)
}

export function decodeValue(
  value: Encoded,
  binary: (file: string) => Uint8Array,
): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => decodeValue(item, binary))
  if (typeof value.$tp === 'string') {
    const marker = value as Record<string, Encoded>
    switch (marker.$tp) {
      case 'undefined': return undefined
      case 'number': return Number(marker.value)
      case 'date': return new Date(marker.value as string)
      case 'bytes': return binary(marker.file as string).slice().buffer
      case 'typed': {
        const Kind = TYPED_ARRAYS[marker.kind as TypedArrayName]
        if (!Kind) throw new Error(`Unknown array type ${String(marker.kind)}.`)
        const bytes = binary(marker.file as string).slice()
        return new Kind(bytes.buffer, 0, bytes.byteLength / Kind.BYTES_PER_ELEMENT)
      }
      case 'map': return new Map((marker.entries as Encoded[][]).map(([k, v]) => [decodeValue(k!, binary), decodeValue(v!, binary)]))
      case 'set': return new Set((marker.values as Encoded[]).map((v) => decodeValue(v, binary)))
      case 'object': return decodePlain(marker.value as Record<string, Encoded>, binary)
      default: throw new Error(`Unknown backup value ${String(marker.$tp)}.`)
    }
  }
  return decodePlain(value, binary)
}

function decodePlain(value: Record<string, Encoded>, binary: (file: string) => Uint8Array) {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) out[key] = decodeValue(item, binary)
  return out
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing.

function requestOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

function openExisting(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // No version: open whatever is there. A database that did not exist is
    // created empty at version 1, which `accountDatabaseNames` never asks for.
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(`Could not open ${name}.`))
  })
}

export function isAccountDatabase(name: string) {
  return name === STORAGE_NAME || name.startsWith(`${STORAGE_NAME}-exam-`)
}

/** Every database this account owns in this browser. */
export async function accountDatabaseNames(): Promise<string[]> {
  if (typeof indexedDB.databases === 'function') {
    const names = (await indexedDB.databases())
      .flatMap(({ name }) => (name && isAccountDatabase(name) ? [name] : []))
    return names.sort((a, b) => (a === STORAGE_NAME ? -1 : b === STORAGE_NAME ? 1 : a.localeCompare(b)))
  }
  // Without enumeration, the Exam registry names each Exam's database.
  const registry = await openExisting(STORAGE_NAME)
  try {
    if (!registry.objectStoreNames.contains(EXAM_STORE)) return [STORAGE_NAME]
    const transaction = registry.transaction(EXAM_STORE, 'readonly')
    const ids = await requestOf(transaction.objectStore(EXAM_STORE).getAllKeys())
    return [STORAGE_NAME, ...ids.map((id) => `${STORAGE_NAME}-exam-${String(id)}`)]
  } finally {
    registry.close()
  }
}

function schemaOf(store: IDBObjectStore): StoreSchema {
  return {
    name: store.name,
    keyPath: store.keyPath as string | string[] | null,
    autoIncrement: store.autoIncrement,
    indexes: [...store.indexNames].map((name) => {
      const index = store.index(name)
      return { name, keyPath: index.keyPath as string | string[], unique: index.unique, multiEntry: index.multiEntry }
    }),
  }
}

async function readDatabase(
  name: string,
  addBinary: (bytes: Uint8Array) => string,
): Promise<DatabaseSnapshot> {
  const database = await openExisting(name)
  try {
    const storeNames = [...database.objectStoreNames].sort()
    if (storeNames.length === 0) return { name, version: database.version, stores: [] }
    // One read transaction across every store, so the snapshot is coherent.
    const transaction = database.transaction(storeNames, 'readonly')
    const done = completion(transaction)
    const reads = storeNames.map(async (storeName) => {
      const store = transaction.objectStore(storeName)
      const [keys, values] = await Promise.all([
        requestOf(store.getAllKeys()),
        requestOf(store.getAll()),
      ])
      return { schema: schemaOf(store), keys, values }
    })
    const results = await Promise.all(reads)
    await done
    const stores = results.map(({ schema, keys, values }) => ({
      ...schema,
      entries: keys.map((key, index) => ({
        key: encodeValue(key, addBinary),
        value: encodeValue(values[index], addBinary),
      })),
    }))
    return { name, version: database.version, stores }
  } finally {
    database.close()
  }
}

/** Reads the whole account out of this browser. */
export async function captureAccount(now = new Date()): Promise<AccountSnapshot> {
  const binaries = new Map<string, Uint8Array>()
  const addBinary = (bytes: Uint8Array) => {
    const path = `binary/${String(binaries.size).padStart(5, '0')}.bin`
    binaries.set(path, bytes)
    return path
  }
  const databases: DatabaseSnapshot[] = []
  for (const name of await accountDatabaseNames()) databases.push(await readDatabase(name, addBinary))
  const localStorageEntries: Record<string, string> = {}
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key && LOCAL_STORAGE_KEYS(key)) localStorageEntries[key] = localStorage.getItem(key) ?? ''
  }
  return {
    manifest: {
      format: ACCOUNT_BACKUP_FORMAT,
      version: ACCOUNT_BACKUP_VERSION,
      createdAt: now.toISOString(),
      storageVersion: STORAGE_VERSION,
      databases,
      localStorage: localStorageEntries,
    },
    binaries,
  }
}

// ---------------------------------------------------------------------------
// The file.

async function zipLibrary() {
  return (await import('jszip')).default
}

export async function accountBackupBlob(snapshot: AccountSnapshot): Promise<Blob> {
  const JSZip = await zipLibrary()
  const zip = new JSZip()
  zip.file(MANIFEST_PATH, JSON.stringify(snapshot.manifest, null, 2))
  for (const [path, bytes] of snapshot.binaries) zip.file(path, bytes, { compression: 'STORE' })
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE' })
}

export class AccountBackupError extends Error {}

/** Parses a backup file and checks it can be restored by this app. */
export async function readAccountBackup(file: Blob): Promise<AccountSnapshot> {
  const JSZip = await zipLibrary()
  let zip: InstanceType<typeof JSZip>
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer())
  } catch {
    throw new AccountBackupError('This file is not a Test Parrot account backup.')
  }
  const manifestFile = zip.file(MANIFEST_PATH)
  if (!manifestFile) throw new AccountBackupError('This file is not a Test Parrot account backup.')
  let manifest: AccountManifest
  try {
    manifest = JSON.parse(await manifestFile.async('string')) as AccountManifest
  } catch {
    throw new AccountBackupError('This account backup is damaged and cannot be read.')
  }
  if (manifest.format !== ACCOUNT_BACKUP_FORMAT || !Array.isArray(manifest.databases)) {
    throw new AccountBackupError('This file is not a Test Parrot account backup.')
  }
  if (manifest.version > ACCOUNT_BACKUP_VERSION || manifest.storageVersion > STORAGE_VERSION) {
    throw new AccountBackupError('This backup was made by a newer Test Parrot. Reload the page to update, then try again.')
  }
  if (manifest.storageVersion !== STORAGE_VERSION
    || manifest.databases.some((database) => database.version !== STORAGE_VERSION)) {
    throw new AccountBackupError('This backup was made by an older Test Parrot whose storage this version cannot read.')
  }
  if (manifest.databases.some((database) => !isAccountDatabase(database.name))) {
    throw new AccountBackupError('This account backup is damaged and cannot be read.')
  }
  const binaries = new Map<string, Uint8Array>()
  const reads: Promise<void>[] = []
  zip.forEach((path, entry) => {
    if (path === MANIFEST_PATH || entry.dir) return
    reads.push(entry.async('uint8array').then((bytes) => { binaries.set(path, bytes) }))
  })
  await Promise.all(reads)
  // Decode once now, so a damaged file fails here rather than mid-restore.
  const binary = binaryReader(binaries)
  for (const database of manifest.databases) {
    for (const store of database.stores) {
      for (const entry of store.entries) { decodeValue(entry.key, binary); decodeValue(entry.value, binary) }
    }
  }
  return { manifest, binaries }
}

function binaryReader(binaries: Map<string, Uint8Array>) {
  return (file: string) => {
    const bytes = binaries.get(file)
    if (!bytes) throw new AccountBackupError('This account backup is damaged: an image is missing.')
    return bytes
  }
}

// ---------------------------------------------------------------------------
// Replacing the account. This runs only at startup, before any part of the app
// has opened a database, so deleting a database is never blocked by a
// connection this page holds.

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(`${name} is still open in another tab.`))
  })
}

function createDatabase(snapshot: DatabaseSnapshot): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(snapshot.name, snapshot.version)
    request.onupgradeneeded = () => {
      for (const store of snapshot.stores) {
        const created = request.result.createObjectStore(store.name, {
          keyPath: store.keyPath ?? undefined,
          autoIncrement: store.autoIncrement,
        })
        for (const index of store.indexes) {
          created.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry })
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(`${snapshot.name} is still open in another tab.`))
  })
}

export async function replaceAccount(snapshot: AccountSnapshot): Promise<void> {
  const binary = binaryReader(snapshot.binaries)
  for (const name of await accountDatabaseNames()) await deleteDatabase(name)
  for (const databaseSnapshot of snapshot.manifest.databases) {
    const database = await createDatabase(databaseSnapshot)
    try {
      const storeNames = databaseSnapshot.stores.map((store) => store.name)
      if (storeNames.length === 0) continue
      const transaction = database.transaction(storeNames, 'readwrite')
      const done = completion(transaction)
      for (const store of databaseSnapshot.stores) {
        const target = transaction.objectStore(store.name)
        for (const entry of store.entries) {
          const value = decodeValue(entry.value, binary)
          if (store.keyPath === null) target.put(value, decodeValue(entry.key, binary) as IDBValidKey)
          else target.put(value)
        }
      }
      await done
    } finally {
      database.close()
    }
  }
  for (const key of Object.keys({ ...localStorage })) {
    if (LOCAL_STORAGE_KEYS(key)) localStorage.removeItem(key)
  }
  for (const [key, value] of Object.entries(snapshot.manifest.localStorage)) {
    if (LOCAL_STORAGE_KEYS(key)) localStorage.setItem(key, value)
  }
}

// ---------------------------------------------------------------------------
// Staging. Restoring from a file happens while the app holds
// open connections, so the snapshot is parked in its own database and applied
// by `applyStagedRestore` on the next load.

const STAGING_DATABASE = 'test-parrot-staged-restore'
const STAGING_STORE = 'staged'
const STAGING_KEY = 'account'

function openStaging(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STAGING_DATABASE, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore(STAGING_STORE) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export type StagedRestore = {
  /** The backup file itself, as bytes. */
  bytes: ArrayBuffer
}

export type StagedRestoreOutcome =
  | { applied: true; staged: StagedRestore }
  | { applied: false; staged: StagedRestore; error: unknown }

export async function stageRestore(staged: StagedRestore): Promise<void> {
  const database = await openStaging()
  try {
    const transaction = database.transaction(STAGING_STORE, 'readwrite')
    transaction.objectStore(STAGING_STORE).put(staged, STAGING_KEY)
    await completion(transaction)
  } finally {
    database.close()
  }
}

async function takeStaged(): Promise<StagedRestore | null> {
  const database = await openStaging()
  try {
    const transaction = database.transaction(STAGING_STORE, 'readonly')
    const staged = await requestOf(transaction.objectStore(STAGING_STORE).get(STAGING_KEY)) as StagedRestore | undefined
    await completion(transaction)
    return staged ?? null
  } finally {
    database.close()
  }
}

async function clearStaged(): Promise<void> {
  const database = await openStaging()
  try {
    const transaction = database.transaction(STAGING_STORE, 'readwrite')
    transaction.objectStore(STAGING_STORE).delete(STAGING_KEY)
    await completion(transaction)
  } finally {
    database.close()
  }
}

/** Call first thing at startup, before anything opens a database. */
export async function applyStagedRestore(): Promise<StagedRestoreOutcome | null> {
  let staged: StagedRestore | null
  try {
    staged = await takeStaged()
  } catch {
    return null
  }
  if (!staged) return null
  try {
    await replaceAccount(await readAccountBackup(new Blob([staged.bytes])))
    return { applied: true, staged }
  } catch (error) {
    return { applied: false, staged, error }
  } finally {
    // A restore that fails is not retried on every load; the file it came
    // from is still there to try again.
    await clearStaged()
  }
}

export function accountBackupFileName(now = new Date()) {
  const date = now.toISOString().slice(0, 10)
  return `test-parrot-account-${date}.zip`
}
