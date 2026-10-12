import { describe, expect, test } from 'bun:test'
import { jpegOrientation, loadExportImages, missingPicture, type MediaLoader } from './export-media'
import type { LayoutPlan } from './export-plan'
import { pictureKey } from './picture-geometry'

describe('loading export pictures', () => {
  const src = `/local-images/${'a'.repeat(64)}`
  const crop = { left: 0.5, top: 0, right: 1, bottom: 0.5, width: 800, height: 600 }
  const planOf = (...stem: unknown[]) =>
    [{ pages: [{ items: [{ kind: 'question', stem }] }] }] as unknown as LayoutPlan[]

  test('asks for each crop of a Media Asset as its own picture, and nothing it hides', async () => {
    const asked: unknown[] = []
    const media: MediaLoader = async (source, box) => {
      asked.push([source, box])
      return { data: new Uint8Array(), type: 'png', width: box ? 400 : 800, height: box ? 300 : 600 }
    }
    const plans = planOf(
      { type: 'image-block', attrs: { src } },
      { type: 'image-block', attrs: { src, size: 0.5, crop } },
      { type: 'image-block', attrs: { src, size: 0.3, crop } },
    )
    const loaded = await loadExportImages(plans, media)
    expect(asked).toEqual([[src, undefined], [src, { left: 0.5, top: 0, right: 1, bottom: 0.5, width: 800, height: 600 }]])
    expect(loaded.get(pictureKey({ src, crop }))?.width).toBe(400)
    expect(loaded.get(src)?.width).toBe(800)
    expect(missingPicture(plans, loaded)).toBeUndefined()
  })

  test('names the first picture it could not load', async () => {
    const plans = planOf({ type: 'image-block', attrs: { src, crop } })
    expect(missingPicture(plans, await loadExportImages(plans, async () => null))?.src).toBe(src)
  })
})

// A JPEG as a phone camera writes one: start of image, an EXIF segment whose
// first IFD holds the Orientation tag, then the start of the scan.
function cameraJpeg(orientation: number | null, byteOrder: 'II' | 'MM' = 'MM', jfifFirst = false): Uint8Array {
  const little = byteOrder === 'II'
  const tiff = new DataView(new ArrayBuffer(26))
  tiff.setUint8(0, byteOrder.charCodeAt(0))
  tiff.setUint8(1, byteOrder.charCodeAt(1))
  tiff.setUint16(2, 42, little)
  tiff.setUint32(4, 8, little)
  tiff.setUint16(8, 1, little)
  // One IFD entry: Orientation, or an unrelated tag (ImageWidth) when none.
  tiff.setUint16(10, orientation === null ? 0x0100 : 0x0112, little)
  tiff.setUint16(12, 3, little)
  tiff.setUint32(14, 1, little)
  tiff.setUint16(18, orientation ?? 640, little)
  tiff.setUint32(22, 0, little)
  const exif = [...new TextEncoder().encode('Exif'), 0, 0, ...new Uint8Array(tiff.buffer)]
  const app1 = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif]
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new TextEncoder().encode('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  return Uint8Array.from([0xff, 0xd8, ...(jfifFirst ? app0 : []), ...app1, 0xff, 0xda, 0x00, 0x02])
}

describe('jpegOrientation', () => {
  // A browser draws and measures a camera JPEG turned the way its Orientation
  // tag says; PDF and Word embed the stored pixels as they are. A portrait
  // photo stored sideways came out of the PDF turned a quarter and stretched.
  test('reads a camera’s Orientation tag in either byte order', () => {
    expect(jpegOrientation(cameraJpeg(6, 'MM'))).toBe(6)
    expect(jpegOrientation(cameraJpeg(8, 'II'))).toBe(8)
    expect(jpegOrientation(cameraJpeg(3, 'MM', true))).toBe(3)
  })

  test('is upright for a JPEG with no Orientation tag, or none at all', () => {
    expect(jpegOrientation(cameraJpeg(1))).toBe(1)
    expect(jpegOrientation(cameraJpeg(null))).toBe(1)
    expect(jpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBe(1)
  })

  test('is upright for bytes that are not a JPEG, or are cut short', () => {
    expect(jpegOrientation(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(1)
    expect(jpegOrientation(cameraJpeg(6).subarray(0, 12))).toBe(1)
    expect(jpegOrientation(new Uint8Array())).toBe(1)
  })
})
