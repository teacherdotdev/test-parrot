import { describe, expect, test } from 'bun:test'
import {
  accountBackupBlob,
  decodeValue,
  encodeValue,
  readAccountBackup,
  type AccountManifest,
  type AccountSnapshot,
} from './account-backup'
import { STORAGE_NAME, STORAGE_VERSION } from './storage-schema'

function roundTrip(value: unknown) {
  const binaries = new Map<string, Uint8Array>()
  const encoded = encodeValue(value, (bytes) => {
    const path = `binary/${binaries.size}.bin`
    binaries.set(path, bytes)
    return path
  })
  // The encoded form is plain JSON.
  const json = JSON.parse(JSON.stringify(encoded))
  return { decoded: decodeValue(json, (file) => binaries.get(file)!), binaries }
}

describe('account backup values', () => {
  test('round-trip the structured-clone values IndexedDB stores', () => {
    const bytes = new Uint8Array([1, 2, 3, 250]).buffer
    const value = {
      id: 'q1',
      nested: { list: [1, 'two', null, true], empty: {} },
      bytes,
      typed: new Uint16Array([7, 65535]),
      when: new Date('2026-09-24T10:00:00.000Z'),
      missing: undefined,
      infinite: Number.POSITIVE_INFINITY,
      map: new Map([['a', 1]]),
      set: new Set(['x']),
      $tp: 'a field that merely looks like a marker',
    }
    const { decoded, binaries } = roundTrip(value)
    expect(binaries.size).toBe(2)
    const out = decoded as typeof value
    expect(new Uint8Array(out.bytes)).toEqual(new Uint8Array(bytes))
    expect(out.typed).toBeInstanceOf(Uint16Array)
    expect([...out.typed]).toEqual([7, 65535])
    expect(out.when).toEqual(value.when)
    expect('missing' in out && out.missing === undefined).toBe(true)
    expect(out.infinite).toBe(Number.POSITIVE_INFINITY)
    expect(out.map.get('a')).toBe(1)
    expect(out.set.has('x')).toBe(true)
    expect(out.$tp).toBe(value.$tp)
    expect(out.nested).toEqual(value.nested)
  })
})

function snapshot(records: { exam: object; image: Uint8Array; lastOpenedAt: string; active: string }): AccountSnapshot {
  const binaries = new Map<string, Uint8Array>([['binary/00000.bin', records.image]])
  const manifest: AccountManifest = {
    format: 'test-parrot-account',
    version: 1,
    createdAt: new Date().toISOString(),
    storageVersion: STORAGE_VERSION,
    localStorage: { 'test-parrot:welcomed': 'true' },
    databases: [{
      name: STORAGE_NAME,
      version: STORAGE_VERSION,
      stores: [
        {
          name: 'exams', keyPath: 'id', autoIncrement: false, indexes: [],
          entries: [{ key: 'e1', value: { id: 'e1', createdAt: '2026-01-01', lastOpenedAt: records.lastOpenedAt, ...records.exam } }],
        },
        {
          name: 'exam-workspace', keyPath: 'key', autoIncrement: false, indexes: [],
          entries: [{ key: 'active', value: { key: 'active', examId: records.active } }],
        },
        {
          name: 'media-assets', keyPath: 'hash', autoIncrement: false, indexes: [],
          entries: [{ key: 'h', value: { hash: 'h', bytes: { $tp: 'bytes', file: 'binary/00000.bin' } } }],
        },
      ],
    }],
  }
  return { manifest, binaries }
}

describe('account backup file', () => {
  test('reads back what it wrote, binaries included', async () => {
    const original = snapshot({ exam: { title: 'Unit 3' }, image: new Uint8Array([9, 8, 7]), lastOpenedAt: 'x', active: 'e1' })
    const read = await readAccountBackup(await accountBackupBlob(original))
    expect(read.manifest.databases).toEqual(original.manifest.databases)
    expect(read.manifest.localStorage).toEqual(original.manifest.localStorage)
    expect([...read.binaries.get('binary/00000.bin')!]).toEqual([9, 8, 7])
  })

  test('refuses files that are not account backups', async () => {
    await expect(readAccountBackup(new Blob(['not a zip']))).rejects.toThrow('not a Test Parrot account backup')
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('account.json', JSON.stringify({ format: 'something-else' }))
    await expect(readAccountBackup(await zip.generateAsync({ type: 'blob' }))).rejects.toThrow('not a Test Parrot account backup')
  })

  test('refuses backups whose storage this version cannot read', async () => {
    const older = snapshot({ ...{ exam: {}, image: new Uint8Array([1]), lastOpenedAt: '', active: '' } })
    older.manifest.storageVersion = STORAGE_VERSION - 1
    older.manifest.databases[0]!.version = STORAGE_VERSION - 1
    await expect(readAccountBackup(await accountBackupBlob(older))).rejects.toThrow('older Test Parrot')
    const newer = snapshot({ exam: {}, image: new Uint8Array([1]), lastOpenedAt: '', active: '' })
    newer.manifest.storageVersion = STORAGE_VERSION + 1
    await expect(readAccountBackup(await accountBackupBlob(newer))).rejects.toThrow('newer Test Parrot')
  })

  test('refuses a backup with a missing image rather than restoring part of it', async () => {
    const damaged = snapshot({ exam: {}, image: new Uint8Array([1]), lastOpenedAt: '', active: '' })
    damaged.binaries = new Map()
    await expect(readAccountBackup(await accountBackupBlob(damaged))).rejects.toThrow('an image is missing')
  })
})
