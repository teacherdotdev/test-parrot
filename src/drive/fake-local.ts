// An in-memory Library for the sync's tests. A Resource's content is a
// string, and its Drive Copy is that content as JSON: what the real Library
// does with PDFs is the browser adapter's business, not the sync's.

import type { Applied, Incoming, LocalFolder, LocalRef, LocalResource, LocalSide } from './sync-engine'

type Item = LocalResource & { body: string }

function withoutBody(item: Item): LocalResource {
  const resource: Partial<Item> = { ...item }
  delete resource.body
  return resource as LocalResource
}

export class FakeLocal implements LocalSide {
  items = new Map<string, Item>()
  folders = new Map<string, LocalFolder>()
  private clock = Date.parse('2026-11-01T09:00:00Z')
  private next = 1
  backups = 0
  applied: Incoming[] = []

  tick() { this.clock += 1000; return new Date(this.clock).toISOString() }
  private key(ref: LocalRef) { return `${ref.kind}:${ref.id}` }

  add(kind: LocalRef['kind'], name: string, body: string, parentId: string | null = null): Item {
    const item: Item = { kind, id: `${kind}-${this.next++}`, name, parentId, modifiedAt: this.tick(), trashed: false, empty: body === '', body }
    this.items.set(this.key(item), item)
    return item
  }

  edit(ref: LocalRef, body: string) {
    const item = this.items.get(this.key(ref))!
    Object.assign(item, { body, empty: body === '', modifiedAt: this.tick() })
  }

  get(ref: LocalRef) { return this.items.get(this.key(ref)) }
  byName(name: string) { return [...this.items.values()].find((item) => item.name === name) }

  sendToTrash(ref: LocalRef) {
    Object.assign(this.items.get(this.key(ref))!, { trashed: true, trashedAt: this.tick() })
  }

  restore(ref: LocalRef) {
    const item = this.items.get(this.key(ref))!
    item.trashed = false
    delete item.trashedAt
  }

  addFolder(name: string, parentId: string | null = null) {
    const folder: LocalFolder = { id: `folder-${this.next++}`, name, parentId, trashed: false }
    this.folders.set(folder.id, folder)
    return folder
  }

  async snapshot() {
    return {
      resources: [...this.items.values()].map((item) => withoutBody(item)),
      folders: [...this.folders.values()].map((folder) => ({ ...folder })),
    }
  }

  async render(ref: LocalRef, fileId: string) {
    const item = this.items.get(this.key(ref))!
    return new TextEncoder().encode(JSON.stringify({ kind: item.kind, id: item.id, name: item.name, body: item.body, banner: fileId }))
  }

  async apply(incoming: Incoming): Promise<Applied> {
    this.applied.push(incoming)
    const copy = JSON.parse(new TextDecoder().decode(incoming.bytes)) as { kind: LocalRef['kind']; id: string; name: string; body: string }
    const id = incoming.id ?? copy.id
    const item: Item = {
      kind: incoming.kind,
      id,
      name: copy.name,
      parentId: incoming.parentId,
      modifiedAt: this.tick(),
      trashed: false,
      empty: copy.body === '',
      body: copy.body,
    }
    this.items.set(this.key(item), item)
    return { id, name: item.name, modifiedAt: item.modifiedAt }
  }

  async createFolder(name: string, parentId: string | null) {
    return this.addFolder(name, parentId).id
  }

  async trash(ref: LocalRef) { this.sendToTrash(ref) }

  async duplicate(ref: LocalRef, name: string) {
    const source = this.items.get(this.key(ref))!
    const copy = this.add(source.kind, name, source.body, source.parentId)
    return withoutBody(copy)
  }

  async backup() {
    this.backups += 1
    return new TextEncoder().encode(`backup ${this.backups}`)
  }
}
