import { EXAM_STORE } from './storage-schema'
import {
  MEDIA_ASSET_STORE,
  STORAGE_NAME,
  STORAGE_VERSION,
} from './storage-schema'
import { pendingImageOf, type ProseMirrorJSON } from './question-doc'

const imagePath = '/local-images/'
const ownedReference = /^\/local-images\/[a-f0-9]{64}$/

export type MediaAsset = {
  hash: string
  mimeType: string
  bytes: ArrayBuffer
  width: number
  height: number
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function imageMetadata(blob: Blob): Promise<Pick<MediaAsset, 'width' | 'height'>> {
  const bitmap = await createImageBitmap(blob)
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error('Image has no intrinsic size.')
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

async function openMediaDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Media is global: a canonical Question can be used by several Exams and
    // immutable Export Records must survive deletion of their current source.
    const request = indexedDB.open(STORAGE_NAME, STORAGE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MEDIA_ASSET_STORE)) {
        request.result.createObjectStore(MEDIA_ASSET_STORE, { keyPath: 'hash' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open Media Store.'))
    request.onblocked = () => reject(new Error('Could not open Media Store.'))
  })
}

function requestOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Media Store request failed.'))
  })
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('Media Store transaction aborted.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('Media Store transaction failed.'))
  })
}

/** Ingests image bytes as an immutable, content-addressed Media Asset. */
export async function saveImage(file: Blob): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.')

  let bytes: ArrayBuffer
  let metadata: Pick<MediaAsset, 'width' | 'height'>
  try {
    ;[bytes, metadata] = await Promise.all([file.arrayBuffer(), imageMetadata(file)])
  } catch {
    throw new Error('This image could not be captured.')
  }
  const hash = hex(await crypto.subtle.digest('SHA-256', bytes))
  const database = await openMediaDatabase()
  try {
    const transaction = database.transaction(MEDIA_ASSET_STORE, 'readwrite')
    const store = transaction.objectStore(MEDIA_ASSET_STORE)
    const existing = await requestOf(store.get(hash) as IDBRequest<MediaAsset | undefined>)
    if (!existing) store.put({ hash, mimeType: file.type.toLowerCase(), bytes, ...metadata })
    await completed(transaction)
  } finally {
    database.close()
  }
  return `${imagePath}${hash}`
}

async function hasMediaAsset(source: string): Promise<boolean> {
  const hash = source.slice(imagePath.length)
  const database = await openMediaDatabase()
  try {
    const transaction = database.transaction(MEDIA_ASSET_STORE, 'readonly')
    const asset = await requestOf(
      transaction.objectStore(MEDIA_ASSET_STORE).get(hash) as IDBRequest<MediaAsset | undefined>,
    )
    await completed(transaction)
    return asset !== undefined
  } finally {
    database.close()
  }
}

/** Copies a source into the Media Store, never returning the source itself. */
export async function captureImageSource(source: string): Promise<string> {
  if (ownedReference.test(source)) {
    if (await hasMediaAsset(source)) return source
    throw new Error('This image could not be captured.')
  }
  let response: Response
  try {
    response = await fetch(source)
  } catch {
    throw new Error('This image could not be captured.')
  }
  if (!response.ok) throw new Error('This image could not be captured.')
  const image = await response.blob()
  if (!image.type.startsWith('image/')) throw new Error('This image could not be captured.')
  return saveImage(image)
}

/** Ensures no mutable image source survives when Question Content is stored.
 *  A Pending Image has no source to own yet, and is stored as it is. */
export async function ownDocumentMedia(document: ProseMirrorJSON): Promise<ProseMirrorJSON> {
  const own = async (node: ProseMirrorJSON): Promise<ProseMirrorJSON> => {
    const attrs = node.attrs as Record<string, unknown> | undefined
    if (pendingImageOf(node)) return node
    if ((node.type === 'image' || node.type === 'image-block') && typeof attrs?.src === 'string') {
      try {
        return { ...node, attrs: { ...attrs, src: await captureImageSource(attrs.src) } }
      } catch {
        return {
          type: 'paragraph',
          content: [{ type: 'text', text: '[Image could not be captured.]' }],
        }
      }
    }
    if (!Array.isArray(node.content)) return node
    return {
      ...node,
      content: await Promise.all(node.content.map((child) => own(child as ProseMirrorJSON))),
    }
  }
  return own(document)
}

async function examDatabaseNames(): Promise<{ name: string }[]> {
  const database = await openMediaDatabase()
  try {
    if (!database.objectStoreNames.contains(EXAM_STORE)) return []
    const transaction = database.transaction(EXAM_STORE, 'readonly')
    const records = await requestOf(transaction.objectStore(EXAM_STORE).getAll()) as { id?: unknown }[]
    await completed(transaction)
    return records.flatMap(({ id }) => typeof id === 'string'
      ? [{ name: `${STORAGE_NAME}-exam-${id}` }]
      : [])
  } finally {
    database.close()
  }
}

/** Collect every immutable asset not referenced by current resources or
 * historical Export Records. This deliberately scans all Exam databases so
 * history remains self-contained after current Questions are deleted. */
export async function collectUnusedMediaAssets(): Promise<string[]> {
  const referenced = new Set<string>()
  const owned = /^\/local-images\/([a-f0-9]{64})$/
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      const match = owned.exec(value)
      if (match) referenced.add(match[1])
      return
    }
    if (Array.isArray(value)) for (const item of value) visit(item)
    else if (value && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) visit(item)
    }
  }

  const databases = typeof indexedDB.databases === 'function'
    ? await indexedDB.databases()
    : [
        { name: STORAGE_NAME },
        ...await examDatabaseNames(),
      ]
  for (const info of databases) {
    const name = info.name
    if (!name?.startsWith(STORAGE_NAME)) continue
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, STORAGE_VERSION)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      for (const storeName of [
        'question-bank', 'authoring-state', 'saved-authoring-state',
        'export-records', 'canonical-questions',
      ]) {
        if (!database.objectStoreNames.contains(storeName)) continue
        const transaction = database.transaction(storeName, 'readonly')
        visit(await requestOf(transaction.objectStore(storeName).getAll()))
        await completed(transaction)
      }
    } finally {
      database.close()
    }
  }

  const database = await openMediaDatabase()
  try {
    const transaction = database.transaction(MEDIA_ASSET_STORE, 'readwrite')
    const store = transaction.objectStore(MEDIA_ASSET_STORE)
    const keys = await requestOf(store.getAllKeys())
    const removed: string[] = []
    for (const key of keys) {
      const hash = String(key)
      if (!referenced.has(hash)) {
        store.delete(key)
        removed.push(hash)
      }
    }
    await completed(transaction)
    return removed
  } finally {
    database.close()
  }
}
