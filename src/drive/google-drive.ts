// `DriveClient` over Google Drive's REST API (v3), called straight from the
// browser with the teacher's own token (ADR-0052). Nothing passes through a
// Test Parrot server.

import { DriveError, type DriveChange, type DriveClient, type DriveFile } from './drive-client'
import { forgetToken } from './google-auth'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FILE_FIELDS = 'id,name,mimeType,parents,md5Checksum,trashed,ownedByMe,capabilities(canEdit),owners(emailAddress),appProperties'

type ApiFile = {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  md5Checksum?: string
  trashed?: boolean
  ownedByMe?: boolean
  capabilities?: { canEdit?: boolean }
  owners?: { emailAddress?: string }[]
  appProperties?: Record<string, string>
}

function fileOf(file: ApiFile): DriveFile {
  const owner = file.owners?.[0]?.emailAddress
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents ?? [],
    ...(file.md5Checksum ? { md5Checksum: file.md5Checksum } : {}),
    trashed: Boolean(file.trashed),
    ownedByMe: Boolean(file.ownedByMe),
    canEdit: Boolean(file.capabilities?.canEdit),
    ...(!file.ownedByMe && owner ? { owner } : {}),
    appProperties: file.appProperties ?? {},
  }
}

export function createGoogleDrive(token: () => Promise<string>, fetcher: typeof fetch = (...args) => fetch(...args)): DriveClient {
  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetcher(url, {
      ...init,
      headers: { Authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) },
    })
    if (response.status === 401) forgetToken()
    if (!response.ok) {
      let detail = ''
      try { detail = ((await response.json()) as { error?: { message?: string } }).error?.message ?? '' } catch { /* not JSON */ }
      throw new DriveError(detail || `Google Drive answered ${response.status}.`, response.status)
    }
    return response
  }
  const json = async <T>(url: string, init?: RequestInit) => (await call(url, init)).json() as Promise<T>

  async function parentsChange(id: string, change: DriveChange): Promise<string> {
    if (change.parent === undefined) return ''
    const current = await json<ApiFile>(`${API}/files/${encodeURIComponent(id)}?fields=parents&supportsAllDrives=true`)
    const remove = (current.parents ?? []).filter((parent) => parent !== change.parent)
    if ((current.parents ?? []).includes(change.parent) && remove.length === 0) return ''
    return `&addParents=${encodeURIComponent(change.parent)}${remove.length > 0 ? `&removeParents=${encodeURIComponent(remove.join(','))}` : ''}`
  }
  const metadataOf = (change: DriveChange) => ({
    ...(change.name !== undefined ? { name: change.name } : {}),
    ...(change.trashed !== undefined ? { trashed: change.trashed } : {}),
    ...(change.appProperties ? { appProperties: change.appProperties } : {}),
  })

  return {
    async account() {
      const about = await json<{ user?: { emailAddress?: string; displayName?: string } }>(`${API}/about?fields=user(emailAddress,displayName)`)
      return { email: about.user?.emailAddress ?? '', ...(about.user?.displayName ? { name: about.user.displayName } : {}) }
    },
    async list() {
      const files: DriveFile[] = []
      const q = encodeURIComponent("appProperties has { key='tpApp' and value='1' } and trashed=false")
      let page = ''
      do {
        const result = await json<{ files?: ApiFile[]; nextPageToken?: string }>(
          `${API}/files?q=${q}&fields=nextPageToken,files(${FILE_FIELDS})&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`,
        )
        files.push(...(result.files ?? []).map(fileOf))
        page = result.nextPageToken ?? ''
      } while (page)
      return files
    },
    async get(id) {
      try {
        return fileOf(await json<ApiFile>(`${API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}&supportsAllDrives=true`))
      } catch (error) {
        if (error instanceof DriveError && (error.status === 404 || error.status === 403)) return null
        throw error
      }
    },
    async create(file) {
      return fileOf(await json<ApiFile>(`${API}/files?fields=${FILE_FIELDS}&supportsAllDrives=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, mimeType: file.mimeType, parents: [file.parent ?? 'root'], appProperties: file.appProperties }),
      }))
    },
    async upload(id, bytes, mimeType, change = {}) {
      const boundary = `testparrot${Math.random().toString(36).slice(2)}`
      const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadataOf(change))}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
      const body = new Blob([head, bytes as BlobPart, `\r\n--${boundary}--`])
      return fileOf(await json<ApiFile>(
        `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=${FILE_FIELDS}&supportsAllDrives=true${await parentsChange(id, change)}`,
        { method: 'PATCH', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
      ))
    },
    async update(id, change) {
      return fileOf(await json<ApiFile>(
        `${API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}&supportsAllDrives=true${await parentsChange(id, change)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadataOf(change)) },
      ))
    },
    async download(id) {
      return new Uint8Array(await (await call(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)).arrayBuffer())
    },
    async sharedWith(id) {
      try {
        const result = await json<{ permissions?: { role?: string; type?: string }[] }>(
          `${API}/files/${encodeURIComponent(id)}/permissions?fields=permissions(role,type)&supportsAllDrives=true`,
        )
        return (result.permissions ?? []).filter((permission) => permission.role !== 'owner').length
      } catch {
        return 0
      }
    },
  }
}
