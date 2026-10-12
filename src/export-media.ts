import type { LayoutPlan } from './export-plan'
import { keptPixels, pictureCropOf, pictureKey, type CropBox } from './picture-geometry'
import type { ProseMirrorJSON } from './question-doc'

/** One decoded image, ready for an Export Adapter to embed. */
export type ExportImage = {
  data: Uint8Array
  /** The shared browser loader normalizes unsupported package formats to PNG,
   *  and a camera JPEG stored turned to upright pixels. */
  type: 'png' | 'jpg'
  width: number
  height: number
}

/** Resolves a Media Asset reference into printable image bytes: the part of
 *  it a Picture Crop keeps, when there is one, and nothing else of it. */
export type MediaLoader = (src: string, crop?: CropBox) => Promise<ExportImage | null>

export class RequiredMediaError extends Error {
  constructor(questionNumber: number | null) {
    super(
      `Required media for question ${questionNumber ?? 'unknown'} could not be resolved. `
      + 'Re-add the image and try again.',
    )
    this.name = 'RequiredMediaError'
  }
}

export function isRequiredMediaError(error: unknown): error is RequiredMediaError {
  return error instanceof RequiredMediaError
}

const IMAGE_TYPES: Record<string, ExportImage['type']> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
}

/** A bitmap's pixels — or the part of them `kept` names — as a file. */
export async function encoded(
  bitmap: ImageBitmap,
  mime: 'image/png' | 'image/jpeg',
  kept = { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
): Promise<Uint8Array | null> {
  const canvas = document.createElement('canvas')
  canvas.width = kept.width
  canvas.height = kept.height
  canvas.getContext('2d')?.drawImage(bitmap, kept.x, kept.y, kept.width, kept.height, 0, 0, kept.width, kept.height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, 0.92),
  )
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

// A camera JPEG's EXIF Orientation: 1 (as stored) through 8, per the EXIF
// standard's TIFF tag 0x0112. A phone held upright usually stores its pixels
// sideways and says 6, "turn a quarter clockwise to view". A browser honours
// that, both when it draws the picture and when `createImageBitmap` measures
// it, but PDF and Word embed the stored pixels as they are.
export function jpegOrientation(data: Uint8Array): number {
  if (data[0] !== 0xff || data[1] !== 0xd8) return 1
  let offset = 2
  while (offset + 4 <= data.length && data[offset] === 0xff) {
    const marker = data[offset + 1]!
    // Metadata segments all come before the scan.
    if (marker === 0xda || marker === 0xd9) return 1
    const length = (data[offset + 2]! << 8) | data[offset + 3]!
    const body = data.subarray(offset + 4, offset + 2 + length)
    const isExif = marker === 0xe1 && body.length >= 14
      && String.fromCharCode(body[0]!, body[1]!, body[2]!, body[3]!, body[4]!, body[5]!) === 'Exif\0\0'
    if (isExif) return tiffOrientation(body.subarray(6))
    offset += 2 + length
  }
  return 1
}

function tiffOrientation(tiff: Uint8Array): number {
  const order = String.fromCharCode(tiff[0]!, tiff[1]!)
  if (order !== 'II' && order !== 'MM') return 1
  const little = order === 'II'
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const ifd = view.getUint32(4, little)
  if (ifd + 2 > tiff.length) return 1
  const entries = view.getUint16(ifd, little)
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > tiff.length) return 1
    if (view.getUint16(entry, little) !== 0x0112) continue
    const value = view.getUint16(entry + 8, little)
    return value >= 1 && value <= 8 ? value : 1
  }
  return 1
}

export const browserMedia: MediaLoader = async (src, crop) => {
  try {
    const response = await fetch(src)
    if (!response.ok) return null
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const type = IMAGE_TYPES[blob.type.toLowerCase()]
    const bytes = new Uint8Array(await blob.arrayBuffer())
    // The bitmap is already turned upright and measured that way; a JPEG that
    // is stored turned is re-encoded from it, so the pixels an adapter embeds
    // are the ones these dimensions describe. A crop is cut from it too: what
    // a crop hides never reaches the student's copy.
    const kept = crop ? keptPixels(crop, bitmap.width, bitmap.height) : null
    const turned = type === 'jpg' && jpegOrientation(bytes) !== 1
    const data = kept
      ? await encoded(bitmap, type === 'jpg' ? 'image/jpeg' : 'image/png', kept)
      : !type
        ? await encoded(bitmap, 'image/png')
        : turned
          ? await encoded(bitmap, 'image/jpeg')
          : bytes
    const image = data
      ? {
          data,
          type: type ?? ('png' as const),
          width: kept?.width ?? bitmap.width,
          height: kept?.height ?? bitmap.height,
        }
      : null
    bitmap.close()
    return image
  } catch {
    return null
  }
}

function attrsOf(node: ProseMirrorJSON): Record<string, unknown> {
  return typeof node.attrs === 'object' && node.attrs !== null
    ? (node.attrs as Record<string, unknown>)
    : {}
}

function childrenOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

/** A picture the plans draw: the pixels an adapter looks up by `key`. */
export type ExportPicture = { key: string; src: string; crop?: CropBox }

/** Every picture the plans draw — each crop of a Media Asset its own — in
 *  first-appearance order. */
export function picturesOf(plans: readonly LayoutPlan[]): ExportPicture[] {
  const pictures = new Map<string, ExportPicture>()
  const visit = (node: ProseMirrorJSON) => {
    if (node.type === 'image' || node.type === 'image-block') {
      const attrs = attrsOf(node)
      const src = String(attrs.src ?? '')
      const key = pictureKey(attrs)
      const crop = node.type === 'image-block' ? pictureCropOf(attrs) : null
      if (src && !pictures.has(key)) pictures.set(key, { key, src, ...(crop ? { crop } : {}) })
    }
    for (const child of childrenOf(node)) visit(child)
  }
  for (const plan of plans) {
    for (const page of plan.pages) {
      for (const item of page.items) {
        if (item.kind !== 'question') continue
        for (const block of item.stem) visit(block)
        for (const row of item.grid?.cells ?? []) {
          for (const cell of row) if (cell) visit(cell.node)
        }
        // Each piece of a Part prints the stem blocks it carries, then its
        // Subparts in order beneath it.
        for (const part of item.parts ?? []) {
          for (const shown of [part, ...part.subparts]) {
            for (const block of shown.stem) visit(block)
            for (const row of shown.grid?.cells ?? []) {
              for (const cell of row) if (cell) visit(cell.node)
            }
          }
        }
      }
    }
  }
  return [...pictures.values()]
}

/** Every Media Asset source the plans refer to, in first-appearance order. */
export function imageSourcesOf(plans: readonly LayoutPlan[]): string[] {
  return [...new Set(picturesOf(plans).map(({ src }) => src))]
}

/** The pixels of every picture the plans draw, by `pictureKey`. */
export async function loadExportImages(
  plans: readonly LayoutPlan[],
  media: MediaLoader,
): Promise<Map<string, ExportImage>> {
  const pictures = picturesOf(plans)
  const loaded = await Promise.all(pictures.map(({ src, crop }) => media(src, crop)))
  return new Map(
    pictures.flatMap(({ key }, index) => {
      const image = loaded[index]
      return image ? [[key, image] as const] : []
    }),
  )
}

/** The first picture the plans draw that has no pixels. */
export function missingPicture(
  plans: readonly LayoutPlan[],
  loaded: ReadonlyMap<string, ExportImage>,
): ExportPicture | undefined {
  return picturesOf(plans).find(({ key }) => !loaded.has(key))
}

function nodeContainsSource(node: ProseMirrorJSON, source: string): boolean {
  const attrs = attrsOf(node)
  if (
    (node.type === 'image' || node.type === 'image-block')
    && String(attrs.src ?? '') === source
  ) return true
  return childrenOf(node).some((child) => nodeContainsSource(child, source))
}

export function questionNumberForMedia(
  plans: readonly LayoutPlan[],
  source: string,
): number | null {
  for (const plan of plans) {
    for (const page of plan.pages) {
      for (const item of page.items) {
        if (
          item.kind === 'question'
          && (
            item.stem.some((node) => nodeContainsSource(node, source))
            || (item.grid?.cells.flat().some(
              (cell) => cell && nodeContainsSource(cell.node, source),
            ) ?? false)
            || (item.parts ?? []).flatMap((part) => [part, ...part.subparts]).some((part) =>
              part.stem.some((node) => nodeContainsSource(node, source))
              || (part.grid?.cells.flat().some(
                (cell) => cell && nodeContainsSource(cell.node, source),
              ) ?? false))
          )
        ) return item.question.number
      }
    }
  }
  return null
}
