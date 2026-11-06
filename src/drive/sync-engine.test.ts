import { describe, expect, test } from 'bun:test'
import { FakeDriveWorld } from './fake-drive'
import { FakeLocal } from './fake-local'
import { BACKUP_FILE_NAME, bringInDriveFiles, needsSync, resolveConflict, sharedWithCount, syncWithDrive, type SyncContext } from './sync-engine'
import { fileKey, memorySyncStateStore } from './sync-state'

const DAY = 24 * 60 * 60 * 1000

function browser(world: FakeDriveWorld, email = 'teacher@school.org') {
  const local = new FakeLocal()
  const store = memorySyncStateStore({ folders: {}, files: {}, conflicts: [], account: { email } })
  const context: SyncContext = { drive: world.client(email), local, store }
  return { local, store, context, sync: () => syncWithDrive(context) }
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const bodyOf = (world: FakeDriveWorld, name: string) => JSON.parse(text(world.byName(name)!.bytes)).body as string
const copy = (body: string, name: string, id: string, kind = 'bank') => new TextEncoder().encode(JSON.stringify({ kind, id, name, body }))

describe('Sync with Drive', () => {
  test('a first sync makes the Test Parrot folder and uploads each Resource, its Folder mirrored', async () => {
    const world = new FakeDriveWorld()
    const { local, sync } = browser(world)
    const unit = local.addFolder('Unit 1')
    local.add('bank', 'Fractions', 'q1', unit.id)
    local.add('exam', 'Quiz', 'e1')
    const report = await sync()
    expect(report.uploaded.sort()).toEqual(['Fractions', 'Quiz'])
    const root = world.byName('Test Parrot')!
    const folder = world.byName('Unit 1')!
    expect(folder.parent).toBe(root.id)
    expect(world.byName('Fractions.pdf')!.parent).toBe(folder.id)
    expect(world.byName('Quiz.pdf')!.parent).toBe(root.id)
    // The banner links to the file itself, so it was created before it was filled.
    const fractions = world.byName('Fractions.pdf')!
    expect(JSON.parse(text(fractions.bytes)).banner).toBe(fractions.id)
    expect(fractions.appProperties).toMatchObject({ tpApp: '1', tpKind: 'bank' })
    expect(world.byName(BACKUP_FILE_NAME)!.parent).toBe(root.id)
  })

  test('an empty Resource is not uploaded', async () => {
    const world = new FakeDriveWorld()
    const { local, sync } = browser(world)
    local.add('bank', 'Untitled Question Bank', '')
    expect((await sync()).uploaded).toEqual([])
  })

  test('only a local change uploads; an unchanged Resource is left alone', async () => {
    const world = new FakeDriveWorld()
    const { local, sync } = browser(world)
    const bank = local.add('bank', 'Fractions', 'v1')
    await sync()
    expect((await sync()).uploaded).toEqual([])
    local.edit(bank, 'v2')
    expect((await sync()).uploaded).toEqual(['Fractions'])
    expect(bodyOf(world, 'Fractions.pdf')).toBe('v2')
  })

  test('only a Drive change comes down', async () => {
    const world = new FakeDriveWorld()
    const { local, sync } = browser(world)
    const bank = local.add('bank', 'Fractions', 'v1')
    await sync()
    const file = world.byName('Fractions.pdf')!
    world.touch(file.id, copy('from the other browser', 'Fractions', bank.id))
    const report = await sync()
    expect(report.downloaded).toEqual(['Fractions'])
    expect(report.uploaded).toEqual([])
    expect(local.get(bank)!.body).toBe('from the other browser')
    // What came down is now synced: the next sync does nothing.
    const again = await sync()
    expect([...again.uploaded, ...again.downloaded]).toEqual([])
  })

  test('a file changed on both sides is skipped and listed, and neither side changes', async () => {
    const world = new FakeDriveWorld()
    const { local, store, sync } = browser(world)
    const bank = local.add('bank', 'Fractions', 'v1')
    await sync()
    const file = world.byName('Fractions.pdf')!
    world.touch(file.id, copy('theirs', 'Fractions', bank.id))
    local.edit(bank, 'mine')
    const report = await sync()
    expect(report.conflicts).toEqual([{ kind: 'bank', id: bank.id, name: 'Fractions', fileId: file.id }])
    expect(report.uploaded).toEqual([])
    expect(report.downloaded).toEqual([])
    expect(local.get(bank)!.body).toBe('mine')
    expect(bodyOf(world, 'Fractions.pdf')).toBe('theirs')
    expect(store.state.conflicts).toHaveLength(1)
  })

  test('Trash is mirrored: the Drive Copy goes to Drive trash, and comes back with Restore', async () => {
    const world = new FakeDriveWorld()
    const { local, sync } = browser(world)
    const bank = local.add('bank', 'Fractions', 'v1')
    await sync()
    const file = world.byName('Fractions.pdf')!
    local.sendToTrash(bank)
    expect((await sync()).trashed).toEqual(['Fractions'])
    expect(world.files.get(file.id)!.trashed).toBe(true)
    expect((await sync()).trashed).toEqual([])
    local.restore(bank)
    await sync()
    expect(world.files.get(file.id)!.trashed).toBe(false)
  })

  test('a Drive Copy trashed elsewhere sends the unchanged Resource to Trash here', async () => {
    const world = new FakeDriveWorld()
    const { local, sync } = browser(world)
    const bank = local.add('bank', 'Fractions', 'v1')
    await sync()
    world.byName('Fractions.pdf')!.trashed = true
    expect((await sync()).trashed).toEqual(['Fractions'])
    expect(local.get(bank)!.trashed).toBe(true)
  })

  test('a new browser brings every Drive Copy down, in its Folder', async () => {
    const world = new FakeDriveWorld()
    const first = browser(world)
    const unit = first.local.addFolder('Unit 1')
    first.local.add('bank', 'Fractions', 'q1', unit.id)
    await first.sync()
    const second = browser(world)
    const report = await second.sync()
    expect(report.downloaded).toEqual(['Fractions'])
    const bank = second.local.byName('Fractions')!
    expect(second.local.folders.get(bank.parentId!)!.name).toBe('Unit 1')
    expect((await second.sync()).uploaded).toEqual([])
  })

  test('a browser restored from the Account Backup matches its Resources to their Drive Copies', async () => {
    const world = new FakeDriveWorld()
    const first = browser(world)
    const bank = first.local.add('bank', 'Fractions', 'q1')
    await first.sync()
    // Restoring copies the Resource with its id and modified time.
    const restored = browser(world)
    restored.local.items.set(fileKey('bank', bank.id), { ...first.local.get(bank)! })
    const report = await restored.sync()
    expect([...report.uploaded, ...report.downloaded, ...report.conflicts.map(({ name }) => name)]).toEqual([])
    expect(restored.store.state.files[fileKey('bank', bank.id)]!.fileId).toBe(world.byName('Fractions.pdf')!.id)
  })

  test('the Account Backup is replaced, not added, on every sync', async () => {
    const world = new FakeDriveWorld()
    const { local, sync } = browser(world)
    local.add('bank', 'Fractions', 'q1')
    await sync()
    await sync()
    const backups = [...world.files.values()].filter((file) => file.name === BACKUP_FILE_NAME)
    expect(backups).toHaveLength(1)
    expect(text(backups[0]!.bytes)).toBe('backup 2')
  })
})

describe('the Sync button dot', () => {
  const now = new Date('2026-11-06T12:00:00Z')
  const resource = (modifiedAt: string, extra = {}) => ({ kind: 'bank' as const, id: 'b', name: 'B', parentId: null, modifiedAt, trashed: false, empty: false, ...extra })
  const synced = (localModifiedAt: string) => ({
    account: { email: 'a@b.c' },
    lastSyncAt: '2026-11-05T00:00:00Z',
    folders: {},
    conflicts: [],
    files: { 'bank:b': { kind: 'bank' as const, fileId: 'f', localModifiedAt, md5: 'x', ownedByMe: true } },
  })

  test('never shows without a Drive Connection', () => {
    expect(needsSync({ folders: {}, files: {}, conflicts: [] }, [resource('2020-01-01T00:00:00Z')], now)).toBe(false)
  })

  test('shows when a connected browser has never synced', () => {
    expect(needsSync({ folders: {}, files: {}, conflicts: [], account: { email: 'a@b.c' } }, [], now)).toBe(true)
  })

  test('shows only once the oldest unsynced change is more than a day old', () => {
    const changedRecently = new Date(now.getTime() - DAY + 60_000).toISOString()
    const changedLongAgo = new Date(now.getTime() - DAY - 60_000).toISOString()
    expect(needsSync(synced('old'), [resource(changedRecently)], now)).toBe(false)
    expect(needsSync(synced('old'), [resource(changedLongAgo)], now)).toBe(true)
    expect(needsSync(synced(changedLongAgo), [resource(changedLongAgo)], now)).toBe(false)
  })

  test('counts a Resource sent to Trash and not yet mirrored', () => {
    const trashedAt = new Date(now.getTime() - 2 * DAY).toISOString()
    expect(needsSync(synced('2020-01-01T00:00:00Z'), [resource('2020-01-01T00:00:00Z', { trashed: true, trashedAt })], now)).toBe(true)
  })
})

describe('conflicts', () => {
  async function conflicted() {
    const world = new FakeDriveWorld()
    const teacher = browser(world)
    const bank = teacher.local.add('bank', 'Fractions', 'v1')
    await teacher.sync()
    const file = world.byName('Fractions.pdf')!
    world.touch(file.id, copy('theirs', 'Fractions', bank.id))
    teacher.local.edit(bank, 'mine')
    const [conflict] = (await teacher.sync()).conflicts
    return { world, teacher, bank, file, conflict: conflict! }
  }

  test('Use theirs replaces the browser\'s copy, and the file is in sync again', async () => {
    const { teacher, bank, conflict } = await conflicted()
    await resolveConflict(teacher.context, conflict, 'theirs')
    expect(teacher.local.get(bank)!.body).toBe('theirs')
    expect(teacher.store.state.conflicts).toEqual([])
    const after = await teacher.sync()
    expect([...after.uploaded, ...after.downloaded, ...after.conflicts.map(({ name }) => name)]).toEqual([])
  })

  test('Keep both sends the browser\'s version up as "(your copy)" and takes theirs', async () => {
    const { world, teacher, bank, conflict } = await conflicted()
    await resolveConflict(teacher.context, conflict, 'both')
    expect(teacher.local.get(bank)!.body).toBe('theirs')
    const mine = teacher.local.byName('Fractions (your copy)')!
    expect(mine.body).toBe('mine')
    expect(bodyOf(world, 'Fractions (your copy).pdf')).toBe('mine')
    expect(bodyOf(world, 'Fractions.pdf')).toBe('theirs')
    const after = await teacher.sync()
    expect([...after.uploaded, ...after.downloaded]).toEqual([])
  })
})

describe('Shared Resources', () => {
  async function sharedBank() {
    const world = new FakeDriveWorld()
    const owner = browser(world, 'owner@school.org')
    const bank = owner.local.add('bank', 'Fractions', 'v1')
    await owner.sync()
    const file = world.byName('Fractions.pdf')!
    world.share(file.id, 'mate@school.org')
    world.handOver(file.id, 'mate@school.org')
    const mate = browser(world, 'mate@school.org')
    return { world, owner, mate, bank, file }
  }

  test('a teammate adds a handed-over file, and each one\'s changes reach the other', async () => {
    const { owner, mate, bank, file } = await sharedBank()
    const [added] = await bringInDriveFiles(mate.context, [file.id], null)
    expect(mate.local.get(added!)!.body).toBe('v1')
    // The teammate's sync neither duplicates it nor makes their own copy.
    expect((await mate.sync()).uploaded).toEqual([])
    mate.local.edit(added!, 'from the teammate')
    expect((await mate.sync()).uploaded).toEqual(['Fractions'])
    expect((await owner.sync()).downloaded).toEqual(['Fractions'])
    expect(owner.local.get(bank)!.body).toBe('from the teammate')
  })

  test('a teammate\'s Trash only takes the file out of their Library, and it stays out', async () => {
    const { world, mate, file } = await sharedBank()
    const [added] = await bringInDriveFiles(mate.context, [file.id], null)
    mate.local.sendToTrash(added!)
    await mate.sync()
    expect(world.files.get(file.id)!.trashed).toBe(false)
    const again = await mate.sync()
    expect(again.downloaded).toEqual([])
    expect(await sharedWithCount(mate.context, added!)).toBeNull()
  })

  test('the owner\'s Trash sends the file to Drive\'s trash for everyone, and the warning counts them', async () => {
    const { owner, mate, bank, file } = await sharedBank()
    const [added] = await bringInDriveFiles(mate.context, [file.id], null)
    expect(await sharedWithCount(owner.context, bank)).toEqual({ owned: true, people: 1 })
    expect(await sharedWithCount(mate.context, added!)).toEqual({ owned: false, people: 0 })
    owner.local.sendToTrash(bank)
    await owner.sync()
    expect((await mate.sync()).trashed).toEqual(['Fractions'])
    expect(mate.local.get(added!)!.trashed).toBe(true)
  })

  test('a teammate who may only view keeps their changes in the browser', async () => {
    const { world, mate, file } = await sharedBank()
    world.share(file.id, 'mate@school.org', 'reader')
    const [added] = await bringInDriveFiles(mate.context, [file.id], null)
    mate.local.edit(added!, 'mine')
    expect((await mate.sync()).readOnly).toEqual(['Fractions'])
  })

  test('an Exam coming down is told which banks are Drive Copies, so it can link to them', async () => {
    const { world, mate, file } = await sharedBank()
    await bringInDriveFiles(mate.context, [file.id], null)
    const bankId = Object.values(mate.store.state.files)[0]!
    expect(bankId.fileId).toBe(file.id)
    const examFile = await world.client('owner@school.org').create({ name: 'Quiz.pdf', parent: null, mimeType: 'application/pdf', appProperties: { tpApp: '1', tpKind: 'exam', tpId: 'exam-x' } })
    world.touch(examFile.id, copy('quiz', 'Quiz', 'exam-x', 'exam'))
    world.share(examFile.id, 'mate@school.org')
    world.handOver(examFile.id, 'mate@school.org')
    await bringInDriveFiles(mate.context, [examFile.id], null)
    const incoming = mate.local.applied.at(-1)!
    const localBank = Object.keys(mate.store.state.files).find((key) => key.startsWith('bank:'))!.slice('bank:'.length)
    expect(incoming.isDriveCopy(localBank)).toBe(true)
    expect(incoming.isDriveCopy('some-other-bank')).toBe(false)
  })

  test('only Test Parrot files can be added', async () => {
    const world = new FakeDriveWorld()
    const mate = browser(world, 'mate@school.org')
    const other = await world.client('mate@school.org').create({ name: 'Notes.pdf', parent: null, mimeType: 'application/pdf', appProperties: {} })
    await expect(bringInDriveFiles(mate.context, [other.id], null)).rejects.toThrow('Only files Test Parrot keeps in Drive')
  })
})
