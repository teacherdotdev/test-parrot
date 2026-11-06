// An in-memory Google Drive for tests: several accounts share one world of
// files, so a teammate's browser is another client on the same world. It
// follows the `drive.file` rule that an account sees only what it made or
// was handed (`handOver`).

import { DriveError, type DriveChange, type DriveClient, type DriveFile } from './drive-client'

type StoredFile = {
  id: string
  name: string
  mimeType: string
  parent: string | null
  owner: string
  bytes: Uint8Array
  trashed: boolean
  appProperties: Record<string, string>
  sharedWith: Map<string, 'reader' | 'writer'>
  /** Accounts this app may see the file for. */
  granted: Set<string>
}

function checksum(bytes: Uint8Array) {
  let hash = 2166136261
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0
  return `${bytes.length}-${hash.toString(16)}`
}

export class FakeDriveWorld {
  files = new Map<string, StoredFile>()
  private next = 1
  calls: string[] = []

  client(email: string): FakeDriveClient {
    return new FakeDriveClient(this, email)
  }

  newId() { return `file-${this.next++}` }

  /** The owner shares a file with someone, through Drive's own sharing. */
  share(id: string, email: string, role: 'reader' | 'writer' = 'writer') {
    this.files.get(id)!.sharedWith.set(email, role)
  }

  /** The teammate picks the file in Google Picker: the app may now see it. */
  handOver(id: string, email: string) {
    const file = this.files.get(id)!
    if (file.owner !== email && !file.sharedWith.has(email)) throw new Error('Not shared with that account.')
    file.granted.add(email)
  }

  /** Someone edits a file outside this browser. */
  touch(id: string, bytes: Uint8Array) {
    this.files.get(id)!.bytes = bytes
  }

  byName(name: string) {
    return [...this.files.values()].find((file) => file.name === name && !file.trashed)
  }
}

export class FakeDriveClient implements DriveClient {
  constructor(private readonly world: FakeDriveWorld, readonly email: string) {}

  private view(file: StoredFile): DriveFile {
    const role = file.owner === this.email ? 'owner' : file.sharedWith.get(this.email)
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      parents: file.parent ? [file.parent] : ['my-drive'],
      ...(file.mimeType.includes('folder') ? {} : { md5Checksum: checksum(file.bytes) }),
      trashed: file.trashed,
      ownedByMe: file.owner === this.email,
      canEdit: role === 'owner' || role === 'writer',
      ...(file.owner !== this.email ? { owner: file.owner } : {}),
      appProperties: { ...file.appProperties },
    }
  }

  private reachable(id: string): StoredFile {
    const file = this.world.files.get(id)
    const allowed = file && file.granted.has(this.email) && (file.owner === this.email || file.sharedWith.has(this.email))
    if (!file || !allowed) throw new DriveError('File not found.', 404)
    return file
  }

  async account() { return { email: this.email } }

  async list() {
    this.world.calls.push(`${this.email} list`)
    return [...this.world.files.values()]
      .filter((file) => !file.trashed && file.appProperties.tpApp === '1')
      .filter((file) => file.granted.has(this.email) && (file.owner === this.email || file.sharedWith.has(this.email)))
      .map((file) => this.view(file))
  }

  async get(id: string) {
    try {
      return this.view(this.reachable(id))
    } catch {
      return null
    }
  }

  async create(file: { name: string; parent: string | null; mimeType: string; appProperties: Record<string, string> }) {
    const id = this.world.newId()
    this.world.calls.push(`${this.email} create ${file.name}`)
    const stored: StoredFile = {
      id,
      name: file.name,
      mimeType: file.mimeType,
      parent: file.parent,
      owner: this.email,
      bytes: new Uint8Array(),
      trashed: false,
      appProperties: { ...file.appProperties },
      sharedWith: new Map(),
      granted: new Set([this.email]),
    }
    this.world.files.set(id, stored)
    return this.view(stored)
  }

  private change(file: StoredFile, change: DriveChange) {
    const owner = file.owner === this.email
    if ((change.parent !== undefined || change.trashed !== undefined) && !owner) throw new DriveError('Only the owner may do that.', 403)
    if (change.name !== undefined) file.name = change.name
    if (change.parent !== undefined) file.parent = change.parent
    if (change.trashed !== undefined) file.trashed = change.trashed
    if (change.appProperties) file.appProperties = { ...file.appProperties, ...change.appProperties }
  }

  async upload(id: string, bytes: Uint8Array, _mimeType: string, change: DriveChange = {}) {
    const file = this.reachable(id)
    if (!this.view(file).canEdit) throw new DriveError('Read only.', 403)
    this.world.calls.push(`${this.email} upload ${file.name}`)
    file.bytes = bytes.slice()
    this.change(file, change)
    return this.view(file)
  }

  async update(id: string, change: DriveChange) {
    const file = this.reachable(id)
    this.world.calls.push(`${this.email} update ${file.name} ${JSON.stringify(change)}`)
    this.change(file, change)
    return this.view(file)
  }

  async download(id: string) {
    return this.reachable(id).bytes.slice()
  }

  async sharedWith(id: string) {
    return this.reachable(id).sharedWith.size
  }
}
