import JSZip from 'jszip'
import type { ZipFiles } from './types'

/**
 * A ZIP's files, read with limits a hostile file cannot get past: no more
 * than 5,000 entries or 200 MB uncompressed, no entry over 50 MB or
 * compressed more than 100 to 1, and no entry whose name climbs out of the
 * archive. Nothing is ever written to disk under an entry's name.
 */

export const ZIP_LIMITS = Object.freeze({
  entries: 5_000,
  totalBytes: 200 * 1024 * 1024,
  entryBytes: 50 * 1024 * 1024,
  ratio: 100,
})

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipLimitError'
  }
}

export const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04

/** A path inside an archive, `/`-separated with no `.` or `..` parts, or
 *  `null` for one that climbs out or is absolute. */
export function safeEntryPath(name: string): string | null {
  const path = name.replace(/\\/g, '/')
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return null
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') return null
    parts.push(part)
  }
  return parts.join('/')
}

export async function readZip(bytes: Uint8Array): Promise<ZipFiles | null> {
  if (!isZip(bytes)) return null
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    return null
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  if (entries.length > ZIP_LIMITS.entries) throw new ZipLimitError('This archive has too many files to open safely.')
  const files: ZipFiles = new Map()
  let total = 0
  for (const entry of entries) {
    const path = safeEntryPath(entry.name)
    if (path === null) throw new ZipLimitError(`This archive has a file whose name points outside it (“${entry.name}”), so it was not opened.`)
    // JSZip keeps the sizes the archive declares; checked before inflating.
    const declared = (entry as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number } })._data
    const size = declared?.uncompressedSize ?? 0
    const compressed = declared?.compressedSize ?? 0
    if (size > ZIP_LIMITS.entryBytes) throw new ZipLimitError('A file in this archive is too large to open safely.')
    if (compressed > 0 && size / compressed > ZIP_LIMITS.ratio && size > 1024 * 1024) {
      throw new ZipLimitError('A file in this archive is compressed too far to open safely.')
    }
    total += size
    if (total > ZIP_LIMITS.totalBytes) throw new ZipLimitError('This archive is too large to open safely.')
    const content = await entry.async('uint8array')
    if (content.byteLength > ZIP_LIMITS.entryBytes) throw new ZipLimitError('A file in this archive is too large to open safely.')
    files.set(path, content)
  }
  return files
}

/** A file in an archive by path, ignoring case — Windows tools differ. */
export function zipFile(files: ZipFiles, path: string): Uint8Array | undefined {
  const exact = files.get(path)
  if (exact) return exact
  const lower = path.toLowerCase()
  for (const [name, bytes] of files) if (name.toLowerCase() === lower) return bytes
  return undefined
}

/** Resolve `relative` against the folder of `from`, inside an archive. */
export function resolveEntryPath(from: string, relative: string): string | null {
  let decoded = relative
  try {
    decoded = decodeURIComponent(relative)
  } catch {
    // Kept as written.
  }
  const folder = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : ''
  return safeEntryPath(decoded.startsWith('/') ? decoded.slice(1) : folder + decoded)
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
}

/** A picture's type from its bytes, or from its name when they do not say. */
export function imageMimeType(bytes: Uint8Array, name = ''): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  return extension ? IMAGE_TYPES[extension] ?? null : null
}
