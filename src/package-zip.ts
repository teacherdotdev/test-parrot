import JSZip from 'jszip'
import { isZip, readZip, ZipLimitError } from './question-formats/zip'
import type { ZipFiles } from './question-formats/types'

/**
 * The zip a Test Parrot Package travels in (ADR-0036): `parrot.json` at its
 * root, an ordinary package, and each picture it needs as a file of its own
 * under `media/`, named by its hash. Nothing about the zip is in the package:
 * a Media Asset of Question Bank Record 0.8.0 or later names its `file`, and the zip is
 * only where that file is found.
 *
 * The same zip is attached to every Question Bank File and to every Exam PDF
 * carrying its answer key, and imports on its own as a `.parrot.zip`.
 */

export const PACKAGE_ZIP_ROOT = 'parrot.json'
export const PACKAGE_ZIP_ATTACHMENT_NAME = 'parrot.zip'
export const PACKAGE_ZIP_EXTENSION = '.parrot.zip'
export const PACKAGE_ZIP_MIME_TYPE = 'application/zip'

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/** Where a Media Asset's bytes live in the zip. */
export function mediaFilePath(id: string, mimeType: string): string {
  return `media/${id.replace(':', '-')}.${EXTENSIONS[mimeType] ?? 'bin'}`
}

// Every entry is dated alike, so the same package always zips to the same
// bytes, and a re-export attaches exactly what the first export did.
const ZIP_DATE = new Date(2000, 0, 1)

export async function writePackageZip(
  json: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(PACKAGE_ZIP_ROOT, json, { date: ZIP_DATE, compression: 'DEFLATE' })
  // Pictures are compressed already; storing them keeps export quick.
  for (const path of [...files.keys()].sort()) {
    zip.file(path, files.get(path)!, { date: ZIP_DATE, compression: 'STORE' })
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export class PackageZipError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid-zip' | 'missing-package' | 'unsafe-archive',
  ) {
    super(message)
    this.name = 'PackageZipError'
  }
}

export const isPackageZip = isZip

/** A package zip's `parrot.json` bytes and every other file in it, read with
 *  the limits any archive a teacher hands over is read with. */
export async function readPackageZip(
  bytes: Uint8Array,
): Promise<{ json: Uint8Array; files: ZipFiles }> {
  let files: ZipFiles | null
  try {
    files = await readZip(bytes)
  } catch (reason) {
    if (reason instanceof ZipLimitError) throw new PackageZipError(reason.message, 'unsafe-archive')
    throw reason
  }
  if (!files) throw new PackageZipError('This zip file could not be opened.', 'invalid-zip')
  const json = files.get(PACKAGE_ZIP_ROOT)
  if (!json) {
    throw new PackageZipError(
      `This zip file has no ${PACKAGE_ZIP_ROOT}, so it is not a Test Parrot file.`,
      'missing-package',
    )
  }
  files.delete(PACKAGE_ZIP_ROOT)
  return { json, files }
}
