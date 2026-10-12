import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { accountDatabaseNames } from './account-backup'
import { PIXEL_PNG } from './export-fixtures'
import { initialSelection } from './import-selection'
import { inspectImportRecord } from './package-import'
import { mediaAssetOf, pendingImagesOf } from './pending-images'
import { createQuestionBankWorkspaceService } from './question-bank-workspaces'
import { MEDIA_ASSET_STORE, STORAGE_NAME } from './storage-schema'
import {
  IMPORT_HISTORY_DATABASE,
  discardWaitingImport,
  expireWaitingImports,
  listImports,
  readWaitingImport,
  recordImport,
  saveWaitingImport,
  waitingImports,
  type WaitingImport,
} from './import-history'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const waiting = (fileName: string, createdAt = new Date().toISOString()): Omit<WaitingImport, 'id'> => ({
  fileName,
  bytes: new Uint8Array([37, 80, 68, 70, 1, 2, 3]),
  pageCount: 2,
  tags: [{ tag: 1, page: 1, box: { left: 100, top: 100, right: 500, bottom: 400 }, width: 40, height: 30 }],
  pageText: ['Use the map.', ''],
  createdAt,
})

describe('the import history', () => {
  test('keeps a waiting import’s Source Document until it is discarded', async () => {
    const saved = await saveWaitingImport(waiting('unit-test.pdf'))
    expect(saved.id).toBeTruthy()

    const resumed = await readWaitingImport(saved.id)
    expect(resumed).toMatchObject({ id: saved.id, fileName: 'unit-test.pdf', pageCount: 2, pageText: ['Use the map.', ''] })
    expect([...resumed!.bytes]).toEqual([37, 80, 68, 70, 1, 2, 3])
    expect(resumed!.tags[0]).toMatchObject({ tag: 1, page: 1 })

    await discardWaitingImport(saved.id)
    expect(await readWaitingImport(saved.id)).toBeNull()
    expect(await listImports()).toEqual([])
  })

  test('a new import never replaces one that is waiting', async () => {
    const first = await saveWaitingImport(waiting('first.pdf', '2026-09-20T09:00:00Z'))
    const second = await saveWaitingImport(waiting('second.pdf', '2026-09-21T09:00:00Z'))
    const now = new Date('2026-09-22T09:00:00Z')

    expect((await waitingImports(now)).map(({ fileName }) => fileName)).toEqual(['second.pdf', 'first.pdf'])
    expect((await readWaitingImport(first.id, now))!.fileName).toBe('first.pdf')
    expect((await readWaitingImport(second.id, now))!.fileName).toBe('second.pdf')
  })

  test('a waiting import expires after seven days, and its history says so', async () => {
    const created = new Date('2026-09-01T09:00:00Z')
    const saved = await saveWaitingImport(waiting('old.pdf', created.toISOString()))

    await expireWaitingImports(new Date('2026-09-07T09:00:00Z'))
    expect(await readWaitingImport(saved.id, new Date('2026-09-07T09:00:00Z'))).not.toBeNull()

    await expireWaitingImports(new Date('2026-09-08T09:00:01Z'))
    expect(await readWaitingImport(saved.id, new Date('2026-09-01T09:00:00Z'))).toBeNull()
    expect(await listImports(new Date('2026-09-08T09:00:01Z'))).toEqual([
      { id: saved.id, kind: 'pdf', fileName: 'old.pdf', createdAt: created.toISOString(), stage: 'expired' },
    ])
  })

  test('a finished import keeps what it brought in and drops its file', async () => {
    const saved = await saveWaitingImport(waiting('unit-test.pdf', '2026-09-20T09:00:00Z'))
    const imported = { banks: [{ id: 'b1', name: 'Unit 4' }], exams: [{ id: 'e1', name: 'Unit 4 Test' }], questions: 5, picturesNeeded: 1 }

    await recordImport({ waitingImportId: saved.id, fileName: 'unit-4.parrot.json', kind: 'record' }, imported, new Date('2026-09-21T09:00:00Z'))
    await recordImport({ fileName: 'shared-bank.pdf', kind: 'record' }, { ...imported, exams: [], picturesNeeded: 0 }, new Date('2026-09-22T09:00:00Z'))

    expect(await readWaitingImport(saved.id)).toBeNull()
    const [shared, finished] = await listImports(new Date('2026-09-22T10:00:00Z'))
    // The conversion keeps the name of the test it started from.
    expect(finished).toEqual({
      id: saved.id,
      kind: 'pdf',
      fileName: 'unit-test.pdf',
      createdAt: '2026-09-20T09:00:00Z',
      stage: 'imported',
      importedAt: '2026-09-21T09:00:00.000Z',
      imported,
    })
    expect(shared).toMatchObject({ kind: 'record', fileName: 'shared-bank.pdf', stage: 'imported' })
  })

  test('the one import that waited before there was a history becomes its first entry', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(IMPORT_HISTORY_DATABASE, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('waiting-import', { keyPath: 'key' })
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('waiting-import', 'readwrite')
        transaction.objectStore('waiting-import').put({
          ...waiting('before.pdf', '2026-09-20T09:00:00Z'),
          key: 'current',
          bytes: new Uint8Array([1, 2, 3]).buffer,
        })
        transaction.oncomplete = () => { database.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
      }
      request.onerror = () => reject(request.error)
    })

    const [migrated] = await waitingImports(new Date('2026-09-21T09:00:00Z'))
    expect(migrated).toMatchObject({ kind: 'pdf', fileName: 'before.pdf', pageCount: 2 })
    expect([...migrated!.bytes]).toEqual([1, 2, 3])
  })

  test('is left out of Account Backups', async () => {
    const banks = createQuestionBankWorkspaceService()
    await banks.create()
    await saveWaitingImport(waiting('unit-test.pdf'))

    const names = await accountDatabaseNames()
    expect(names).toContain(STORAGE_NAME)
    expect(names).not.toContain(IMPORT_HISTORY_DATABASE)
  })
})

const example = join(import.meta.dir, '..', 'public', 'formats', 'question-bank', '0.7.0', 'examples', 'pending-images.json')

async function storedMediaHashes(): Promise<string[]> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(STORAGE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve) => {
      const request = database.transaction(MEDIA_ASSET_STORE, 'readonly').objectStore(MEDIA_ASSET_STORE).getAllKeys()
      request.onsuccess = () => resolve(request.result.map(String))
    })
  } finally {
    database.close()
  }
}

const imagesOf = (value: unknown): Record<string, unknown>[] => {
  const found: Record<string, unknown>[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(visit)
    else if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if (record.type === 'image' || record.type === 'image-block') found.push(record.attrs as Record<string, unknown>)
      Object.values(record).forEach(visit)
    }
  }
  visit(value)
  return found
}

describe('committing an import with Pending Images', () => {
  test('resolved ones become stored images, a shared tag is one asset, and the rest stay pending', async () => {
    const banks = createQuestionBankWorkspaceService()
    const proposal = await inspectImportRecord(await Bun.file(example).bytes())
    const occurrences = pendingImagesOf(proposal)
    expect(occurrences.map(({ questionNumber, where, pending }) => [questionNumber, where, pending])).toEqual([
      [1, 'Question', { image: 1 }],
      [2, 'Answer A', { image: 2 }],
      [2, 'Answer B', { image: 3 }],
      [2, 'Answer C', { image: 4 }],
      [3, 'Question', { image: 1 }],
      [4, 'Question', { page: 4 }],
      // A Multipart question's shared picture, and one in a Part.
      [5, 'Question', { image: 5 }],
      [5, 'Part b', { page: 4 }],
    ])
    const map = await mediaAssetOf(PIXEL_PNG.data, 'image/png')
    // IMG 1 is resolved everywhere it is used; IMG 2–4 and the page are left.
    const resolution = new Map(
      occurrences.filter(({ pending }) => 'image' in pending && pending.image === 1).map(({ key }) => [key, { asset: map }]),
    )
    const started = await saveWaitingImport(waiting('history.pdf'))

    const result = await banks.commitImport(proposal, initialSelection(proposal), {
      resolution,
      history: { fileName: 'history.parrot.json', kind: 'record', waitingImportId: started.id },
    })

    const bank = (await banks.read(result.createdBankIds[0]!))!
    const images = bank.questions.map((question) => imagesOf(question.doc))
    const hash = map.id.slice('sha256:'.length)
    expect(images[0]).toEqual([
      expect.objectContaining({ src: `/local-images/${hash}`, caption: 'Riverton Bus Routes, 2020' }),
    ])
    expect(images[0]![0]!.pending).toBeUndefined()
    expect(images[2]![0]).toMatchObject({ src: `/local-images/${hash}` })
    expect(images[1]!.map((attrs) => attrs.pending)).toEqual([{ image: 2 }, { image: 3 }, { image: 4 }])
    expect(images[3]![0]).toMatchObject({ src: '', pending: { page: 4 } })
    expect(await storedMediaHashes()).toEqual([hash])
    expect(await readWaitingImport(started.id)).toBeNull()
    // Its history names what came in, and the pictures it left needed.
    const [entry] = await listImports()
    expect(entry).toMatchObject({
      id: started.id,
      fileName: 'history.pdf',
      stage: 'imported',
      imported: {
        banks: [{ id: result.createdBankIds[0], name: proposal.banks[0]!.record.bank.name }],
        exams: [],
        questions: 5,
        picturesNeeded: 6,
      },
    })
  })

  test('an import not paired with the waiting one leaves it waiting', async () => {
    const banks = createQuestionBankWorkspaceService()
    const proposal = await inspectImportRecord(await Bun.file(example).bytes())
    const started = await saveWaitingImport(waiting('history.pdf'))

    await banks.commitImport(proposal, initialSelection(proposal), {
      history: { fileName: 'bank.parrot.json', kind: 'record' },
    })

    expect(await readWaitingImport(started.id)).not.toBeNull()
    expect((await listImports()).map(({ fileName, stage }) => [fileName, stage])).toEqual(
      expect.arrayContaining([['history.pdf', 'waiting'], ['bank.parrot.json', 'imported']]),
    )
  })
})
