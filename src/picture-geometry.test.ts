import { describe, expect, test } from 'bun:test'
import {
  keptAspect,
  keptPixels,
  normalizedCrop,
  pictureCropOf,
  pictureKey,
  pictureSizeOf,
  printedPictureWidth,
  sizeAfterCrop,
} from './picture-geometry'

const src = `/local-images/${'a'.repeat(64)}`

describe('Authored Image Size', () => {
  test('is a share of the column, whatever the picture’s own width', () => {
    expect(printedPictureWidth(2400, 672, { size: 0.5 })).toBe(336)
    expect(printedPictureWidth(100, 672, { size: 0.5 })).toBe(336)
  })

  test('a picture no one sized fits the column at its own width, or the column’s', () => {
    expect(printedPictureWidth(400, 672, {})).toBe(400)
    expect(printedPictureWidth(2400, 672, {})).toBe(672)
  })

  test('a picture with only Crepe’s ratio draws as it always has', () => {
    expect(printedPictureWidth(400, 672, { ratio: 0.5 })).toBe(200)
    expect(printedPictureWidth(2400, 672, { ratio: 0.5 })).toBe(336)
    // Dragged larger than it fit, it still stops at the column.
    expect(printedPictureWidth(400, 672, { ratio: 3 })).toBe(672)
  })

  test('size wins over a legacy ratio, and stays in range', () => {
    expect(printedPictureWidth(400, 600, { size: 0.25, ratio: 3 })).toBe(150)
    expect(pictureSizeOf({ size: 4 })).toBe(1)
    expect(pictureSizeOf({ size: 0.001 })).toBe(0.05)
    expect(pictureSizeOf({ size: null })).toBeNull()
    expect(pictureSizeOf({})).toBeNull()
  })
})

describe('Picture Crop', () => {
  const crop = { left: 0.25, top: 0.1, right: 0.75, bottom: 0.6, width: 1200, height: 800 }

  test('keeps the pixels inside the crop, on the picture’s own grid', () => {
    expect(keptPixels(crop, 1200, 800)).toEqual({ x: 300, y: 80, width: 600, height: 400 })
    expect(keptPixels({ left: 0.5, top: 0.5, right: 0.5, bottom: 0.5 }, 3, 3)).toEqual({ x: 2, y: 2, width: 1, height: 1 })
  })

  test('knows the kept part’s shape without loading the picture', () => {
    expect(keptAspect(crop)).toBe(1.5)
  })

  test('a crop of the whole picture, or a malformed one, is no crop', () => {
    expect(pictureCropOf({ crop: { ...crop, left: 0, top: 0, right: 1, bottom: 1 } })).toBeNull()
    expect(pictureCropOf({ crop: { left: 0.2 } })).toBeNull()
    expect(pictureCropOf({ crop: null })).toBeNull()
    expect(pictureCropOf({ crop })).toEqual(crop)
  })

  test('a dragged box is put the right way round and kept inside the picture', () => {
    expect(normalizedCrop({ left: 0.8, top: -0.2, right: 0.3, bottom: 1.4 })).toEqual({ left: 0.3, top: 0, right: 0.8, bottom: 1 })
    const thin = normalizedCrop({ left: 0.5, top: 0.5, right: 0.5, bottom: 0.5 })
    expect(thin.right - thin.left).toBeCloseTo(0.02, 5)
  })

  test('two crops of one Media Asset load as two pictures', () => {
    expect(pictureKey({ src })).toBe(src)
    expect(pictureKey({ src, crop })).not.toBe(pictureKey({ src, crop: { ...crop, left: 0.3 } }))
    expect(pictureKey({ src, crop: { ...crop, left: 0, top: 0, right: 1, bottom: 1 } })).toBe(src)
  })

  test('cropping keeps what it shows at the scale it printed at', () => {
    // A problem as wide as the column, cut down to its left third.
    expect(sizeAfterCrop(672, 672, { left: 0, top: 0, right: 1, bottom: 1 }, { left: 0, top: 0, right: 0.3, bottom: 1 })).toBe(0.3)
    // Widening a crop back out grows it, until it meets the column.
    expect(sizeAfterCrop(201.6, 672, { left: 0, top: 0, right: 0.3, bottom: 1 }, { left: 0, top: 0, right: 0.6, bottom: 1 })).toBe(0.6)
    expect(sizeAfterCrop(672, 672, { left: 0.2, top: 0, right: 0.8, bottom: 1 }, { left: 0, top: 0, right: 1, bottom: 1 })).toBe(1)
  })
})
