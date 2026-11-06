// Sync with Drive (ADR-0052): one pass that brings this browser and the
// teacher's Drive into agreement, Resource by Resource. The browser is the
// working copy. A Resource changed only here goes up, one changed only in
// Drive comes down, and one changed on both sides since this browser last
// synced it is skipped and listed. Nothing is merged.
//
// The sync talks to Drive through `DriveClient` and to the browser's Library
// through `LocalSide`, so it is tested with fakes of both.

import { FOLDER_MIME, PDF_MIME, ZIP_MIME, type DriveClient, type DriveFile, type DriveKind } from './drive-client'
import { fileKey, type Conflict, type FileEntry, type ResourceKind, type SyncState, type SyncStateStore } from './sync-state'

export const ROOT_FOLDER_NAME = 'Test Parrot'
export const BACKUP_FILE_NAME = 'Test Parrot account backup.zip'
export const DAY_MS = 24 * 60 * 60 * 1000

export type LocalRef = { kind: ResourceKind; id: string }

export type LocalResource = LocalRef & {
  name: string
  parentId: string | null
  modifiedAt: string
  /** In Trash itself, or inside a Folder that is. */
  trashed: boolean
  trashedAt?: string
  /** Nothing to put in a file yet: no Question. */
  empty: boolean
}

export type LocalFolder = { id: string; name: string; parentId: string | null; trashed: boolean }

/** A Drive Copy coming down. */
export type Incoming = {
  kind: ResourceKind
  /** The local Resource it replaces; absent for one new to this browser. */
  id?: string
  parentId: string | null
  bytes: Uint8Array
  memo?: Record<string, unknown>
  /** Whether a local bank is itself a Drive Copy, so an Exam may link to its
   *  Questions (ADR-0052). */
  isDriveCopy: (bankId: string) => boolean
}

export type Applied = { id: string; name: string; modifiedAt: string; memo?: Record<string, unknown> }

/** The browser's Library, as the sync sees it. */
export interface LocalSide {
  snapshot(): Promise<{ resources: LocalResource[]; folders: LocalFolder[] }>
  /** The Resource's Drive Copy: its PDF, with its banner linking to `fileId`. */
  render(ref: LocalRef, fileId: string): Promise<Uint8Array>
  /** Writes an incoming Drive Copy into the Library, replacing the Resource
   *  it names or making a new one. */
  apply(incoming: Incoming): Promise<Applied>
  createFolder(name: string, parentId: string | null): Promise<string>
  /** Sends a Resource to Trash here, because its Drive Copy went. */
  trash(ref: LocalRef): Promise<void>
  /** A copy of the Resource under a new name, with new identities: what
   *  Keep both keeps. */
  duplicate(ref: LocalRef, name: string): Promise<LocalResource>
  /** The whole account, as an Account Backup file. */
  backup(): Promise<Uint8Array>
}

export type SyncReport = {
  uploaded: string[]
  downloaded: string[]
  trashed: string[]
  conflicts: Conflict[]
  /** Changed here, but shared with this teacher to view only. */
  readOnly: string[]
  failed: { name: string; message: string }[]
}

export type SyncContext = {
  drive: DriveClient
  local: LocalSide
  store: SyncStateStore
  now?: () => Date
}

const props = (kind: DriveKind, extra: Record<string, string> = {}) => ({ tpApp: '1', tpKind: kind, ...extra })

export function driveFileName(resource: Pick<LocalResource, 'name'>) {
  return `${resource.name.replace(/[\\/]/g, '-')}.pdf`
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Parents before children, so each Folder's parent exists first. */
function byDepth<T extends { id: string; parentId: string | null }>(items: readonly T[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const depth = (item: T) => {
    let count = 0
    const seen = new Set<string>()
    let parent = item.parentId
    while (parent && byId.has(parent) && !seen.has(parent)) {
      seen.add(parent)
      count += 1
      parent = byId.get(parent)!.parentId
    }
    return count
  }
  return [...items].sort((left, right) => depth(left) - depth(right))
}

/**
 * One whole sync. State is written after every file, so a sync cut short
 * keeps what it did and the next one carries on.
 */
export async function syncWithDrive(context: SyncContext): Promise<SyncReport> {
  const { drive, local, store } = context
  const now = context.now ?? (() => new Date())
  const state = store.read()
  const save = () => store.write(state)
  const report: SyncReport = { uploaded: [], downloaded: [], trashed: [], conflicts: [], readOnly: [], failed: [] }

  const listed = await drive.list()
  const remote = new Map(listed.map((file) => [file.id, file]))
  /** A known file, looked up even when the listing leaves it out (trashed,
   *  or gone). */
  const remoteFile = async (id: string): Promise<DriveFile | null> => remote.get(id) ?? drive.get(id)

  // ---- The Test Parrot folder.
  let rootId = state.rootId
  if (rootId) {
    const root = await remoteFile(rootId)
    if (!root || root.trashed) rootId = undefined
  }
  rootId ??= listed.find((file) => file.appProperties.tpKind === 'root' && file.ownedByMe)?.id
  rootId ??= (await drive.create({ name: ROOT_FOLDER_NAME, parent: null, mimeType: FOLDER_MIME, appProperties: props('root') })).id
  state.rootId = rootId
  const root = rootId
  save()

  let { resources, folders } = await local.snapshot()

  // ---- Folders, mirrored as Drive folders.
  const localFolderIds = new Set(folders.map((folder) => folder.id))
  // A Drive folder another browser made is adopted, or made here.
  const driveFolders = listed.filter((file) => file.appProperties.tpKind === 'folder' && file.ownedByMe)
  const mappedDriveFolders = new Set(Object.values(state.folders))
  const pending = driveFolders.filter((file) => !mappedDriveFolders.has(file.id))
  for (let progress = true; progress && pending.length > 0;) {
    progress = false
    for (const file of [...pending]) {
      const parentDriveId = file.parents[0]
      const parentLocal = parentDriveId === root
        ? null
        : Object.entries(state.folders).find(([, driveId]) => driveId === parentDriveId)?.[0]
      if (parentLocal === undefined) continue
      const tpId = file.appProperties.tpId
      const localId = tpId && localFolderIds.has(tpId) ? tpId : await local.createFolder(file.name, parentLocal)
      state.folders[localId] = file.id
      localFolderIds.add(localId)
      pending.splice(pending.indexOf(file), 1)
      progress = true
    }
  }
  save()
  if (pending.length > 0 || driveFolders.length > 0) ({ resources, folders } = await local.snapshot())

  const driveFolderOf = (folderId: string | null): string => (folderId && state.folders[folderId]) || root
  for (const folder of byDepth(folders)) {
    const mapped = state.folders[folder.id]
    const file = mapped ? await remoteFile(mapped) : null
    try {
      if (folder.trashed) {
        if (file && !file.trashed) await drive.update(file.id, { trashed: true })
        continue
      }
      const parent = driveFolderOf(folder.parentId)
      if (!file) {
        const created = await drive.create({ name: folder.name, parent, mimeType: FOLDER_MIME, appProperties: props('folder', { tpId: folder.id }) })
        state.folders[folder.id] = created.id
      } else if (file.trashed || file.name !== folder.name || file.parents[0] !== parent) {
        await drive.update(file.id, { name: folder.name, parent, trashed: false })
      }
      save()
    } catch (error) {
      report.failed.push({ name: folder.name, message: message(error) })
    }
  }

  // ---- Resources.
  const props$ = (resource: LocalResource) => props(resource.kind, { tpId: resource.id, tpMod: resource.modifiedAt })
  const localByKey = new Map(resources.map((resource) => [fileKey(resource.kind, resource.id), resource]))

  const upload = async (resource: LocalResource, entry: FileEntry | undefined) => {
    let fileId = entry?.fileId
    const parent = driveFolderOf(resource.parentId)
    if (!fileId) {
      const created = await drive.create({ name: driveFileName(resource), parent, mimeType: PDF_MIME, appProperties: props$(resource) })
      fileId = created.id
      state.files[fileKey(resource.kind, resource.id)] = { kind: resource.kind, fileId, localModifiedAt: '', md5: created.md5Checksum ?? '', ownedByMe: true }
      save()
    }
    const bytes = await local.render(resource, fileId)
    const owned = entry?.ownedByMe ?? true
    const sent = await drive.upload(fileId, bytes, PDF_MIME, owned
      ? { name: driveFileName(resource), parent, appProperties: props$(resource) }
      : { appProperties: props$(resource) })
    state.files[fileKey(resource.kind, resource.id)] = {
      ...(entry?.memo ? { memo: entry.memo } : {}),
      kind: resource.kind,
      fileId,
      localModifiedAt: resource.modifiedAt,
      md5: sent.md5Checksum ?? '',
      ownedByMe: sent.ownedByMe,
    }
    save()
    report.uploaded.push(resource.name)
  }

  const bringDown = async (file: DriveFile, entry: FileEntry | undefined, into: { id?: string; parentId: string | null }) => {
    const kind = file.appProperties.tpKind as ResourceKind
    const bytes = await drive.download(file.id)
    const applied = await local.apply({
      kind,
      ...(into.id ? { id: into.id } : {}),
      parentId: into.parentId,
      bytes,
      ...(entry?.memo ? { memo: entry.memo } : {}),
      isDriveCopy: (bankId) => Boolean(state.files[fileKey('bank', bankId)]),
    })
    // A file brought down under a new id is no longer known by the old one.
    if (into.id && into.id !== applied.id) delete state.files[fileKey(kind, into.id)]
    state.files[fileKey(kind, applied.id)] = {
      kind,
      fileId: file.id,
      localModifiedAt: applied.modifiedAt,
      md5: file.md5Checksum ?? '',
      ownedByMe: file.ownedByMe,
      ...(applied.memo ? { memo: applied.memo } : {}),
    }
    save()
    report.downloaded.push(applied.name)
  }

  // A Resource this browser has never synced may already have a Drive Copy:
  // a browser restored from Drive's Account Backup. Its id says so, and its
  // sent modified time says whether it is the same as what is here.
  const known = new Set(Object.values(state.files).map((entry) => entry.fileId))
  for (const file of listed) {
    const kind = file.appProperties.tpKind
    if ((kind !== 'bank' && kind !== 'exam') || known.has(file.id) || !file.appProperties.tpId) continue
    const resource = localByKey.get(fileKey(kind, file.appProperties.tpId))
    if (!resource || state.files[fileKey(kind, resource.id)]) continue
    state.files[fileKey(kind, resource.id)] = {
      kind,
      fileId: file.id,
      // The same modified time means the same content; anything else is a
      // change on both sides, which the pass below lists as a conflict.
      localModifiedAt: file.appProperties.tpMod === resource.modifiedAt ? resource.modifiedAt : '',
      md5: file.appProperties.tpMod === resource.modifiedAt ? file.md5Checksum ?? '' : '',
      ownedByMe: file.ownedByMe,
    }
    known.add(file.id)
  }
  save()

  state.conflicts = []
  // Banks before Exams, so an Exam coming down can link to its bank's Questions.
  const ordered = [...resources].sort((left, right) => (left.kind === right.kind ? 0 : left.kind === 'bank' ? -1 : 1))
  for (const resource of ordered) {
    const key = fileKey(resource.kind, resource.id)
    const entry = state.files[key]
    try {
      if (resource.trashed) {
        if (!entry || entry.trashed) continue
        const file = await remoteFile(entry.fileId)
        if (entry.ownedByMe) {
          if (file && !file.trashed) await drive.update(entry.fileId, { trashed: true })
          state.files[key] = { ...entry, trashed: true }
        } else {
          // Someone else's file only leaves this teacher's Library, and is
          // not brought back by the next sync.
          delete state.files[key]
          state.ignored = [...new Set([...(state.ignored ?? []), entry.fileId])]
        }
        save()
        report.trashed.push(resource.name)
        continue
      }
      if (!entry) {
        if (!resource.empty) await upload(resource, undefined)
        continue
      }
      let file = await remoteFile(entry.fileId)
      if (entry.trashed && file?.trashed && entry.ownedByMe) {
        // Restored from Trash here: so is its Drive Copy.
        file = await drive.update(entry.fileId, { trashed: false })
        delete entry.trashed
        state.files[key] = entry
        save()
      }
      const localChanged = entry.localModifiedAt !== resource.modifiedAt
      if (!file || file.trashed) {
        // Its Drive Copy went: the owner trashed it, or this account lost it.
        delete state.files[key]
        if (localChanged && !resource.empty) {
          await upload(resource, undefined)
        } else {
          await local.trash(resource)
          report.trashed.push(resource.name)
        }
        save()
        continue
      }
      const remoteChanged = entry.md5 !== (file.md5Checksum ?? '')
      if (localChanged && remoteChanged) {
        report.conflicts.push({ kind: resource.kind, id: resource.id, name: resource.name, fileId: file.id })
      } else if (localChanged) {
        if (resource.empty) continue
        if (!file.canEdit) report.readOnly.push(resource.name)
        else await upload(resource, entry)
      } else if (remoteChanged) {
        await bringDown(file, entry, { id: resource.id, parentId: resource.parentId })
      } else if (file.ownedByMe && (file.parents[0] !== driveFolderOf(resource.parentId) || file.name !== driveFileName(resource))) {
        // Moved or renamed with nothing else changed: only the place follows.
        await drive.update(file.id, { name: driveFileName(resource), parent: driveFolderOf(resource.parentId) })
      }
    } catch (error) {
      report.failed.push({ name: resource.name, message: message(error) })
    }
  }

  // Drive Copies this browser does not have yet: the teacher's other
  // browser's, or a teammate's handed over before.
  const mapped = new Set([...Object.values(state.files).map((entry) => entry.fileId), ...(state.ignored ?? [])])
  const incoming = listed
    .filter((file) => (file.appProperties.tpKind === 'bank' || file.appProperties.tpKind === 'exam') && !mapped.has(file.id))
    .sort((left, right) => (left.appProperties.tpKind === right.appProperties.tpKind ? 0 : left.appProperties.tpKind === 'bank' ? -1 : 1))
  for (const file of incoming) {
    const parentId = Object.entries(state.folders).find(([, driveId]) => driveId === file.parents[0])?.[0] ?? null
    try {
      await bringDown(file, undefined, { parentId })
    } catch (error) {
      report.failed.push({ name: file.name, message: message(error) })
    }
  }

  // ---- The Account Backup, replaced every time.
  try {
    const bytes = await local.backup()
    let backupId = state.backupId && remote.has(state.backupId) ? state.backupId : undefined
    backupId ??= listed.find((file) => file.appProperties.tpKind === 'backup' && file.ownedByMe)?.id
    backupId ??= (await drive.create({ name: BACKUP_FILE_NAME, parent: root, mimeType: ZIP_MIME, appProperties: props('backup') })).id
    await drive.upload(backupId, bytes, ZIP_MIME)
    state.backupId = backupId
  } catch (error) {
    report.failed.push({ name: BACKUP_FILE_NAME, message: message(error) })
  }

  state.conflicts = report.conflicts
  state.lastSyncAt = now().toISOString()
  save()
  return report
}

/** The Account Backup in the teacher's Test Parrot folder, for Restore from
 *  Drive on a new browser; null when there is none. */
export async function findDriveBackup(drive: DriveClient): Promise<DriveFile | null> {
  const files = await drive.list()
  return files.find((file) => file.appProperties.tpKind === 'backup' && file.ownedByMe) ?? null
}

// ---------------------------------------------------------------------------
// The dot on the Sync button.

/** Whether the Sync button wears its dot: connected, and either this browser
 *  has never synced, or a change it has not synced is more than a day old. */
export function needsSync(state: SyncState, resources: readonly LocalResource[], now: Date): boolean {
  if (!state.account) return false
  if (!state.lastSyncAt) return true
  const oldest = oldestUnsyncedChange(state, resources)
  return oldest !== null && now.getTime() - new Date(oldest).getTime() > DAY_MS
}

/** When the oldest change this browser has not synced was made, or null. */
export function oldestUnsyncedChange(state: SyncState, resources: readonly LocalResource[]): string | null {
  const times = resources.flatMap((resource) => {
    const entry = state.files[fileKey(resource.kind, resource.id)]
    if (resource.trashed) return entry && !entry.trashed ? [resource.trashedAt ?? resource.modifiedAt] : []
    if (resource.empty) return []
    if (!entry || entry.trashed) return [resource.modifiedAt]
    return entry.localModifiedAt === resource.modifiedAt ? [] : [resource.modifiedAt]
  })
  return times.length === 0 ? null : times.reduce((left, right) => (left < right ? left : right))
}

// ---------------------------------------------------------------------------
// Sharing (ADR-0052).

function entryFor(file: DriveFile, applied: Applied): FileEntry {
  return {
    kind: file.appProperties.tpKind as ResourceKind,
    fileId: file.id,
    localModifiedAt: applied.modifiedAt,
    md5: file.md5Checksum ?? '',
    ownedByMe: file.ownedByMe,
    ...(applied.memo ? { memo: applied.memo } : {}),
  }
}

/**
 * Brings in Drive files the teacher handed over (Add from Google Drive, or a
 * teammate's banner link), each into `parentId`. One already in the Library
 * is left as it is and named. Banks come first, so an Exam among them can
 * link to their Questions.
 */
export async function bringInDriveFiles(context: SyncContext, fileIds: readonly string[], parentId: string | null): Promise<(LocalRef & { name: string })[]> {
  const { drive, local, store } = context
  const state = store.read()
  const files = (await Promise.all(fileIds.map((id) => drive.get(id))))
    .filter((file): file is DriveFile => file !== null && !file.trashed)
  const kinds = files.filter((file) => file.appProperties.tpKind === 'bank' || file.appProperties.tpKind === 'exam')
  if (kinds.length < files.length) throw new Error('Only files Test Parrot keeps in Drive can be added. A PDF exported for students is not one.')
  kinds.sort((left, right) => (left.appProperties.tpKind === right.appProperties.tpKind ? 0 : left.appProperties.tpKind === 'bank' ? -1 : 1))
  const brought: (LocalRef & { name: string })[] = []
  for (const file of kinds) {
    const kind = file.appProperties.tpKind as ResourceKind
    const known = Object.entries(state.files).find(([, entry]) => entry.fileId === file.id)
    if (known) {
      brought.push({ kind, id: known[0].slice(kind.length + 1), name: file.name.replace(/\.pdf$/i, '') })
      continue
    }
    const applied = await local.apply({
      kind,
      parentId,
      bytes: await drive.download(file.id),
      isDriveCopy: (bankId) => Boolean(state.files[fileKey('bank', bankId)]),
    })
    state.files[fileKey(kind, applied.id)] = entryFor(file, applied)
    state.ignored = (state.ignored ?? []).filter((id) => id !== file.id)
    store.write(state)
    brought.push({ kind, id: applied.id, name: applied.name })
  }
  return brought
}

export type ConflictChoice = 'theirs' | 'both'

/**
 * Settles one file the last sync skipped. Use theirs replaces the browser's
 * copy with Drive's. Keep both first keeps the browser's version as a new
 * Resource, "<name> (your copy)", sent to Drive as a new file, then takes
 * theirs. Nothing is merged.
 */
export async function resolveConflict(context: SyncContext, conflict: Conflict, choice: ConflictChoice): Promise<void> {
  const { drive, local, store } = context
  const state = store.read()
  const key = fileKey(conflict.kind, conflict.id)
  const entry = state.files[key]
  const file = await drive.get(conflict.fileId)
  if (!entry || !file || file.trashed) throw new Error(`${conflict.name} is no longer in Drive. Sync again.`)
  const { resources } = await local.snapshot()
  const resource = resources.find((candidate) => candidate.kind === conflict.kind && candidate.id === conflict.id)
  if (!resource) throw new Error(`${conflict.name} is no longer in this browser. Sync again.`)

  if (choice === 'both') {
    const copy = await local.duplicate(resource, `${resource.name} (your copy)`)
    const parent = (copy.parentId && state.folders[copy.parentId]) || state.rootId
    const created = await drive.create({
      name: driveFileName(copy),
      parent: parent ?? null,
      mimeType: PDF_MIME,
      appProperties: props(copy.kind, { tpId: copy.id, tpMod: copy.modifiedAt }),
    })
    const sent = await drive.upload(created.id, await local.render(copy, created.id), PDF_MIME)
    state.files[fileKey(copy.kind, copy.id)] = { kind: copy.kind, fileId: created.id, localModifiedAt: copy.modifiedAt, md5: sent.md5Checksum ?? '', ownedByMe: true }
    store.write(state)
  }

  const applied = await local.apply({
    kind: conflict.kind,
    id: conflict.id,
    parentId: resource.parentId,
    bytes: await drive.download(file.id),
    ...(entry.memo ? { memo: entry.memo } : {}),
    isDriveCopy: (bankId) => Boolean(state.files[fileKey('bank', bankId)]),
  })
  state.files[key] = entryFor(file, applied)
  state.conflicts = state.conflicts.filter((candidate) => candidate.fileId !== conflict.fileId)
  store.write(state)
}

/** How many people besides its owner a Resource's Drive Copy is shared
 *  with, for the Trash warning; null when it has none or someone else owns
 *  it (then Trash only takes it out of this Library). */
export async function sharedWithCount(context: Pick<SyncContext, 'drive' | 'store'>, ref: LocalRef): Promise<{ owned: boolean; people: number } | null> {
  const entry = context.store.read().files[fileKey(ref.kind, ref.id)]
  if (!entry || entry.trashed) return null
  if (!entry.ownedByMe) return { owned: false, people: 0 }
  return { owned: true, people: await context.drive.sharedWith(entry.fileId) }
}
