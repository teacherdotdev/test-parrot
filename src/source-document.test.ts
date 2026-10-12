import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts, type PDFPage } from 'pdf-lib'
import {
  analyzeSourceDocument,
  cropSourcePage,
  labelSourceDocument,
  labeledFilename,
  photoSourceDocument,
  pictureForTag,
  type PageBox,
  type Raster,
  type SourceDocumentAnalysis,
} from './source-document'

const raster: Raster = {
  createCanvas: (width, height) => createCanvas(width, height) as unknown as ReturnType<Raster['createCanvas']>,
  async encodePng({ width, height, data }) {
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    const image = context.createImageData(width, height)
    image.data.set(data)
    context.putImageData(image, 0, 0)
    return new Uint8Array(canvas.toBuffer('image/png'))
  },
}

const fonts = async () =>
  Bun.file(join(import.meta.dir, '..', 'public', 'fonts', 'FreeSerifBold.ttf')).bytes()

/** A distinct, opaque picture: a gradient keyed by `seed`, so every pixel of
 *  a returned picture can be compared with what was embedded. */
function picture(width: number, height: number, seed: number) {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  const image = context.createImageData(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      image.data[at] = (x * 7 + seed * 40) % 256
      image.data[at + 1] = (y * 5 + seed * 90) % 256
      image.data[at + 2] = (seed * 60) % 256
      image.data[at + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  return { png: new Uint8Array(canvas.toBuffer('image/png')), pixels: image.data, width, height }
}

const W = 612
const H = 792
/** Where pdf-lib draws, given a top-left box in points. */
const draw = (page: PDFPage, image: Parameters<PDFPage['drawImage']>[0], left: number, top: number, width: number, height: number) =>
  page.drawImage(image, { x: left, y: H - top - height, width, height })
const boxOf = (left: number, top: number, width: number, height: number): PageBox => ({
  left: (left / W) * 1000,
  top: (top / H) * 1000,
  right: ((left + width) / W) * 1000,
  bottom: ((top + height) / H) * 1000,
})

const near = (actual: PageBox, expected: PageBox) => {
  for (const side of ['left', 'top', 'right', 'bottom'] as const) expect(actual[side]).toBeCloseTo(expected[side], 0)
}

const QUESTION = 'Which graph shows a function that is increasing everywhere?'
const grid = picture(40, 30, 1)
let source: Uint8Array
let analysis: SourceDocumentAnalysis

beforeAll(async () => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const images = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map((seed) => pdf.embedPng(seed === 1 ? grid.png : picture(40, 30, seed).png)))

  // 1: a question with a 2×2 grid of graphs below it.
  const first = pdf.addPage([W, H])
  first.drawText(`1. ${QUESTION}`, { x: 72, y: H - 80, size: 12, font })
  draw(first, images[0]!, 72, 120, 200, 150)
  draw(first, images[1]!, 320, 120, 200, 150)
  draw(first, images[2]!, 72, 300, 200, 150)
  draw(first, images[3]!, 320, 300, 200, 150)
  first.drawText('2. Which graph is periodic?', { x: 72, y: H - 500, size: 12, font })

  // 2: two pictures side by side, the left one set slightly lower.
  const second = pdf.addPage([W, H])
  draw(second, images[4]!, 72, 112, 200, 150)
  draw(second, images[5]!, 320, 100, 200, 150)

  // 3: an equation stored as a picture, and a full-page scan.
  const third = pdf.addPage([W, H])
  draw(third, images[6]!, 72, 72, 30, 14)
  draw(third, images[7]!, 0, 0, W, H)

  // 4: one embedded image painted twice.
  const fourth = pdf.addPage([W, H])
  draw(fourth, images[8]!, 72, 100, 200, 150)
  draw(fourth, images[8]!, 72, 400, 200, 150)

  // 5: no pictures at all.
  pdf.addPage([W, H]).drawText('Answer every question.', { x: 72, y: H - 80, size: 12, font })

  // 6: a graph drawn with lines, as a browser saves an SVG, above a table
  // ruled with straight lines, and a rule across the foot of the page.
  const sixth = pdf.addPage([W, H])
  sixth.drawLine({ start: { x: 100, y: H - 300 }, end: { x: 300, y: H - 300 } })
  sixth.drawLine({ start: { x: 100, y: H - 300 }, end: { x: 100, y: H - 150 } })
  for (let dot = 0; dot < 5; dot += 1)
    sixth.drawEllipse({ x: 130 + dot * 35, y: H - 280 + dot * 25, xScale: 6, yScale: 6, borderWidth: 1 })
  for (let row = 0; row < 3; row += 1)
    for (let column = 0; column < 3; column += 1)
      sixth.drawRectangle({ x: 100 + column * 80, y: H - 500 - row * 30, width: 80, height: 30, borderWidth: 1 })
  sixth.drawLine({ start: { x: 72, y: H - 700 }, end: { x: 400, y: H - 700 } })

  // 7: structures drawn with straight bonds, their atoms as text, as a
  // chemistry program saves them.
  const seventh = pdf.addPage([W, H])
  const bonds = (left: number, top: number, count: number) => {
    for (let at = 0; at < count; at += 1)
      seventh.drawLine({
        start: { x: left + at * 17, y: H - top - (at % 2 ? 0 : 10) },
        end: { x: left + (at + 1) * 17, y: H - top - (at % 2 ? 10 : 0) },
      })
  }
  const label = (text: string, left: number, baseline: number) =>
    seventh.drawText(text, { x: left, y: H - baseline, size: 10, font })
  // An ester: a chain, its oxygen, and the chain beyond the oxygen.
  bonds(100, 100, 3)
  label('O', 153, 106)
  bonds(163, 100, 2)
  // A reaction: a structure, a plus sign, a structure, an arrow and a
  // question mark for its product.
  bonds(100, 250, 3)
  label('+', 175, 259)
  bonds(200, 250, 3)
  seventh.drawLine({ start: { x: 275, y: H - 255 }, end: { x: 325, y: H - 255 } })
  seventh.drawLine({ start: { x: 325, y: H - 255 }, end: { x: 319, y: H - 252 } })
  seventh.drawLine({ start: { x: 325, y: H - 255 }, end: { x: 319, y: H - 258 } })
  label('?', 345, 259)
  // Two structures to compare, which are two answer choices.
  bonds(100, 400, 4)
  label('vs.', 190, 409)
  bonds(240, 400, 4)
  // An empty answer box with rounded corners, and a formula that is only
  // typed.
  seventh.drawSvgPath(
    'M 10 0 H 190 A 10 10 0 0 1 200 10 V 70 A 10 10 0 0 1 190 80 H 10 A 10 10 0 0 1 0 70 V 10 A 10 10 0 0 1 10 0 Z',
    { x: 100, y: H - 500, borderWidth: 1 },
  )
  label('pH', 110, 575)
  label('H2O', 100, 650)

  source = await pdf.save()
  analysis = await analyzeSourceDocument(source)
})

describe('analyzing a Source Document', () => {
  test('tags every picture across the document, page by page, in reading order', () => {
    expect(analysis.pageCount).toBe(7)
    expect(analysis.tags.map(({ tag, page }) => [tag, page])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 2],
      [6, 2],
      [7, 4],
      [8, 4],
      [9, 6],
      [10, 6],
      [11, 7],
      [12, 7],
      [13, 7],
      [14, 7],
    ])
    near(analysis.tags[0]!.box, boxOf(72, 120, 200, 150))
    near(analysis.tags[1]!.box, boxOf(320, 120, 200, 150))
    near(analysis.tags[2]!.box, boxOf(72, 300, 200, 150))
    near(analysis.tags[3]!.box, boxOf(320, 300, 200, 150))
    // Tops 12pt apart share a row, so left reads before right.
    near(analysis.tags[4]!.box, boxOf(72, 112, 200, 150))
    near(analysis.tags[5]!.box, boxOf(320, 100, 200, 150))
    expect(analysis.tags[0]).toMatchObject({ width: 40, height: 30 })
  })

  test('tags a figure drawn with lines, and a table ruled with them, but not a rule', () => {
    const drawn = analysis.tags.filter((tag) => tag.drawn && tag.page === 6)
    expect(drawn.map((tag) => tag.tag)).toEqual([9, 10])
    // From the axes' corner to the top of the highest dot.
    const box = drawn[0]!.box
    expect(box.left).toBeCloseTo((100 / W) * 1000, -1)
    expect(box.right).toBeCloseTo((300 / W) * 1000, -1)
    expect(box.top).toBeCloseTo((150 / H) * 1000, -1)
    expect(box.bottom).toBeCloseTo((300 / H) * 1000, -1)
    near(drawn[1]!.box, boxOf(100, 470, 240, 90))
  })

  test('tags each structure drawn with straight bonds, and a reaction as one, but not an empty box', () => {
    const tags = analysis.tags.filter((tag) => tag.page === 7)
    expect(tags.every((tag) => tag.drawn)).toBe(true)
    // The ester whole, joined through its oxygen.
    expect(tags[0]!.box.left).toBeCloseTo((100 / W) * 1000, 0)
    expect(tags[0]!.box.right).toBeCloseTo((197 / W) * 1000, 0)
    // The reaction, from its first structure to its product.
    expect(tags[1]!.box.left).toBeCloseTo((100 / W) * 1000, 0)
    expect(tags[1]!.box.right).toBeGreaterThan((345 / W) * 1000)
    // The structures on either side of “vs.”, each its own.
    near(tags[2]!.box, boxOf(100, 400, 68, 10))
    near(tags[3]!.box, boxOf(240, 400, 68, 10))
    // Nothing reaches the answer box or the typed formula.
    expect(tags.every((tag) => tag.box.bottom < (500 / H) * 1000)).toBe(true)
  })

  test('gives no tag to an equation-sized image or a full-page scan', () => {
    expect(analysis.tags.some((tag) => tag.page === 3)).toBe(false)
  })

  test('analyzing the same PDF twice gives the same tags', async () => {
    expect(await analyzeSourceDocument(source)).toEqual(analysis)
  })

  test('reads each page’s text for checking a record against it', () => {
    expect(analysis.pageText[0]).toContain(QUESTION)
    expect(analysis.pageText[4]).toBe('Answer every question.')
  })

  test('reads a PDF where streams cannot be iterated with for await, as in Safari', async () => {
    // WebKit has no ReadableStream async iterator, which pdf.js's own
    // getTextContent relies on: every PDF failed there with “undefined is not
    // a function”. Bun's streams have one, so it is taken away here.
    class WebKitReadableStream<R> extends ReadableStream<R> {}
    Object.defineProperty(WebKitReadableStream.prototype, Symbol.asyncIterator, { value: undefined })
    Object.defineProperty(WebKitReadableStream.prototype, 'values', { value: undefined })
    const original = globalThis.ReadableStream
    globalThis.ReadableStream = WebKitReadableStream as typeof ReadableStream
    try {
      expect(await analyzeSourceDocument(source)).toEqual(analysis)
    } finally {
      globalThis.ReadableStream = original
    }
  })

  test('refuses a file that is not a PDF', async () => {
    await expect(analyzeSourceDocument(new TextEncoder().encode('{"not":"a pdf"}'))).rejects.toThrow(
      'not a PDF',
    )
  })
})

describe('a tag’s picture', () => {
  test('is the embedded image at its own size and pixels, as PNG', async () => {
    const png = await pictureForTag(source, analysis.tags[0]!, raster)
    const image = await loadImage(Buffer.from(png))
    expect([image.width, image.height]).toEqual([40, 30])
    const canvas = createCanvas(40, 30)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    expect([...context.getImageData(0, 0, 40, 30).data]).toEqual([...grid.pixels])
  })

  test('is the same picture for both paints of one image, and differs from its neighbours', async () => {
    const [seventh, eighth, first] = await Promise.all([
      pictureForTag(source, analysis.tags[6]!, raster),
      pictureForTag(source, analysis.tags[7]!, raster),
      pictureForTag(source, analysis.tags[1]!, raster),
    ])
    expect(seventh).toEqual(eighth)
    expect(first).not.toEqual(seventh)
  })

  test('is a drawn figure rendered at print resolution, its lines on white', async () => {
    const tag = analysis.tags.find((tag) => tag.drawn)!
    const image = await loadImage(Buffer.from(await pictureForTag(source, tag, raster)))
    expect([image.width, image.height]).toEqual([tag.width, tag.height])
    expect(tag.width).toBe(Math.round(((tag.box.right - tag.box.left) / 1000) * W * (300 / 72)))
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    let ink = 0
    for (let at = 0; at < pixels.length; at += 4) if (pixels[at]! < 128) ink += 1
    expect(ink).toBeGreaterThan(0)
    expect(ink).toBeLessThan(pixels.length / 4 / 2)
  })
})

describe('the labeled copy', () => {
  test('draws each tag inside its own picture and nothing over the text', async () => {
    const labeled = await labelSourceDocument(source, analysis.tags, fonts)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: labeled.slice(), verbosity: 0 })
    const document = await task.promise
    const labels: { text: string; page: number; x: number; y: number }[] = []
    const words: { page: number; box: PageBox }[] = []
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number)
      for (const item of (await page.getTextContent()).items) {
        if (!('str' in item) || !item.str.trim()) continue
        const x = (item.transform[4] / W) * 1000
        const y = ((H - item.transform[5]) / H) * 1000
        if (item.str.startsWith('IMG ')) labels.push({ text: item.str, page: number, x, y })
        else
          words.push({
            page: number,
            box: { left: x, top: y - (item.height / H) * 1000, right: x + (item.width / W) * 1000, bottom: y },
          })
      }
    }
    await task.destroy()

    expect(labels.map((label) => label.text)).toEqual(analysis.tags.map((tag) => `IMG ${tag.tag}`))
    for (const [index, label] of labels.entries()) {
      const { page, box } = analysis.tags[index]!
      expect(label.page).toBe(page)
      expect(label.x).toBeGreaterThan(box.left)
      expect(label.x).toBeLessThan(box.left + (box.right - box.left) / 2)
      expect(label.y).toBeGreaterThan(box.top)
      // A label shrinks to fit a short figure, so it may fill its height.
      expect(label.y).toBeLessThan(Math.max(box.top + (box.bottom - box.top) / 2, box.bottom - 1))
    }
    const overlaps = (a: PageBox, b: PageBox) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const within = (a: PageBox, b: PageBox) =>
      a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1
    expect(words.length).toBeGreaterThan(0)
    for (const word of words)
      for (const tag of analysis.tags.filter((tag) => tag.page === word.page)) {
        // A drawn figure's own words, such as its atoms, are part of it.
        if (tag.drawn && within(word.box, tag.box)) continue
        expect(overlaps(word.box, tag.box)).toBe(false)
      }
    // The labels are drawn, not embedded: the copy tags the same pictures.
    expect((await analyzeSourceDocument(labeled)).tags).toEqual(analysis.tags)
  })

  test('says it is labeled in its file name', () => {
    expect(labeledFilename('Unit 3 Test.pdf')).toBe('Unit 3 Test (labeled).pdf')
  })
})

describe('cropping a page', () => {
  test('renders the requested region at print resolution', async () => {
    const png = await cropSourcePage(source, 1, { left: 0, top: 0, right: 500, bottom: 250 }, raster)
    const image = await loadImage(Buffer.from(png))
    expect([image.width, image.height]).toEqual([Math.round((W / 2) * (300 / 72)), Math.round((H / 4) * (300 / 72))])
  })
})

describe('a photo of a test', () => {
  test('becomes a one-page Source Document with nothing to tag, that crops like any page', async () => {
    const photo = picture(300, 400, 4)
    const document = await photoSourceDocument(photo.png, 'image/png')
    const analysis = await analyzeSourceDocument(document)
    expect(analysis).toMatchObject({ pageCount: 1, tags: [] })
    const png = await cropSourcePage(document, 1, { left: 0, top: 0, right: 1000, bottom: 500 }, raster)
    const image = await loadImage(Buffer.from(png))
    // Letter's longest side, at print resolution.
    expect([image.width, image.height]).toEqual([Math.round(594 * (300 / 72)), Math.round(396 * (300 / 72))])
  })
})
