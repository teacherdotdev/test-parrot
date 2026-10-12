/**
 * How big a block picture is and which part of it shows — the one statement
 * every surface that draws a picture follows: the editor, print and its
 * pagination, the PDF and DOCX adapters, Copy and the Question Bank Record.
 *
 * A picture's Authored Image Size is `size`, the width of what it shows as a
 * share of its container, 0.05–1. A picture no one has sized fits its
 * container at its own width, or the container's when that is narrower.
 * Before `size` there was Crepe's `ratio`: the size a drag of its handle left
 * the picture at, over the size it fit at. A picture that has only a `ratio`
 * still draws by that rule until it is resized or cropped.
 *
 * A Picture Crop is `crop`, the kept part as fractions of the upright picture
 * (a camera photo's EXIF turn applied), with that picture's own pixel size so
 * markup can reserve the kept part's shape without loading it. The Media Asset
 * itself is never cut. A cropped picture always has a `size`.
 */

export type PictureCrop = {
  left: number
  top: number
  right: number
  bottom: number
  /** The whole upright picture's pixel size. */
  width: number
  height: number
}

/** The part of a picture a crop keeps, without the picture's size. */
export type CropBox = Pick<PictureCrop, 'left' | 'top' | 'right' | 'bottom'>

export type PixelRect = { x: number; y: number; width: number; height: number }

export const MIN_SIZE = 0.05
/** The smallest share of a picture's width or height a crop keeps. */
export const MIN_CROP = 0.02

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places

/** An Authored Image Size in its range, to two places. */
export const clampSize = (size: number) => clamp(round(size, 2), MIN_SIZE, 1)

type Attrs = Record<string, unknown>

/** The picture's Authored Image Size, or null when no one has sized it. */
export function pictureSizeOf(attrs: Attrs): number | null {
  const size = Number(attrs.size)
  return attrs.size !== null && attrs.size !== undefined && Number.isFinite(size) && size > 0 ? clamp(size, MIN_SIZE, 1) : null
}

/** Crepe's legacy drag ratio, 1 when there is none. */
export function legacyRatioOf(attrs: Attrs): number {
  const ratio = Number(attrs.ratio)
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

/** The picture's Picture Crop, or null when it shows all of itself. */
export function pictureCropOf(attrs: Attrs): PictureCrop | null {
  const crop = attrs.crop
  if (typeof crop !== 'object' || crop === null) return null
  const { left, top, right, bottom, width, height } = crop as Record<string, unknown>
  const numbers = [left, top, right, bottom, width, height].map(Number)
  if (numbers.some((value) => !Number.isFinite(value))) return null
  const [l, t, r, b, w, h] = numbers as [number, number, number, number, number, number]
  if (w < 1 || h < 1) return null
  const box = normalizedCrop({ left: l, top: t, right: r, bottom: b })
  return isWholeCrop(box) ? null : { ...box, width: w, height: h }
}

/** A crop box inside the picture, keeping at least `MIN_CROP` of each side. */
export function normalizedCrop(box: CropBox): CropBox {
  const left = clamp(Math.min(box.left, box.right), 0, 1 - MIN_CROP)
  const top = clamp(Math.min(box.top, box.bottom), 0, 1 - MIN_CROP)
  const right = clamp(Math.max(box.left, box.right), left + MIN_CROP, 1)
  const bottom = clamp(Math.max(box.top, box.bottom), top + MIN_CROP, 1)
  return { left: round(left, 4), top: round(top, 4), right: round(right, 4), bottom: round(bottom, 4) }
}

export const WHOLE_CROP: CropBox = { left: 0, top: 0, right: 1, bottom: 1 }

export const isWholeCrop = (box: CropBox) =>
  box.left <= 0 && box.top <= 0 && box.right >= 1 && box.bottom >= 1

/** The pixels a crop keeps of a picture this size, at least one each way. */
export function keptPixels(box: CropBox, width: number, height: number): PixelRect {
  const x = clamp(Math.round(box.left * width), 0, width - 1)
  const y = clamp(Math.round(box.top * height), 0, height - 1)
  const right = clamp(Math.round(box.right * width), x + 1, width)
  const bottom = clamp(Math.round(box.bottom * height), y + 1, height)
  return { x, y, width: right - x, height: bottom - y }
}

/** The kept part's width over its height. */
export function keptAspect(crop: PictureCrop): number {
  return ((crop.right - crop.left) * crop.width) / ((crop.bottom - crop.top) * crop.height)
}

/** The key a picture's pixels are loaded under: its source, and what it keeps. */
export function pictureKey(attrs: Attrs): string {
  const src = String(attrs.src ?? '')
  const crop = pictureCropOf(attrs)
  return crop ? `${src}#crop=${crop.left},${crop.top},${crop.right},${crop.bottom}` : src
}

/**
 * The width a block picture prints at in a column, given the natural width of
 * what it shows. A sized picture is its share of the column; one with only a
 * legacy ratio is the size it fit at scaled by it, never wider than the column.
 */
export function printedPictureWidth(naturalWidth: number, columnWidth: number, attrs: Attrs): number {
  const size = pictureSizeOf(attrs)
  if (size !== null) return columnWidth * size
  const ratio = legacyRatioOf(attrs)
  return Math.min(naturalWidth * ratio, columnWidth * Math.min(1, ratio))
}

/**
 * The Authored Image Size after a crop, keeping what it shows at the scale it
 * printed at: a picture shown `width` wide keeping `before` of its picture's
 * width shows `after` of it at the same scale.
 */
export function sizeAfterCrop(width: number, columnWidth: number, before: CropBox, after: CropBox): number {
  const scale = width / (before.right - before.left)
  return clampSize((scale * (after.right - after.left)) / columnWidth)
}

/**
 * A document with an Exam's own picture sizes put in place of the authored
 * ones: each block picture whose `pictureKey` the Exam sized is laid out at
 * that size. The document is not changed; nothing else in it is.
 */
export function withPictureSizes<T extends { type?: unknown; attrs?: unknown; content?: unknown }>(
  doc: T,
  sizes: Readonly<Record<string, number>> | undefined,
): T {
  if (!sizes || Object.keys(sizes).length === 0) return doc
  const visit = (node: Record<string, unknown>): Record<string, unknown> => {
    const attrs = node.attrs as Attrs | undefined
    if (node.type === 'image-block' && attrs) {
      const size = sizes[pictureKey(attrs)]
      if (size !== undefined) return { ...node, attrs: { ...attrs, size: clampSize(size) } }
    }
    if (!Array.isArray(node.content)) return node
    return { ...node, content: (node.content as Record<string, unknown>[]).map(visit) }
  }
  return visit(doc as Record<string, unknown>) as T
}
