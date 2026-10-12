import { describe, expect, test } from 'bun:test'
import { BODY_LINE_HEIGHT, bodyPoints, pointsOf, sectionHeadingPoints, titlePoints } from './export-typography'
import { PDFDocument } from 'pdf-lib'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  createPublicationPdf,
  isPdfUnsupportedCharacterError,
  pastMarginWarning,
  type PdfFontLoader,
} from './pdf-export'
import { FIXTURES, PIXEL_PNG } from './export-fixtures'
import { SECTION_INSTRUCTIONS, planExport, questionIndentOf, unmeasured } from './export-plan'
import {
  DEFAULT_EXPORT_CONFIGURATION,
  EMPTY_EXPORT_HISTORY,
  prepareExport,
} from './export-preparation'

const fontFiles = {
  regular: new URL('../public/fonts/FreeSerif.ttf', import.meta.url).pathname,
  bold: new URL('../public/fonts/FreeSerifBold.ttf', import.meta.url).pathname,
  italic: new URL('../public/fonts/FreeSerifItalic.ttf', import.meta.url).pathname,
  boldItalic: new URL('../public/fonts/FreeSerifBoldItalic.ttf', import.meta.url).pathname,
  mono: new URL('../public/fonts/FreeMono.ttf', import.meta.url).pathname,
} as const

const fonts: PdfFontLoader = async (style) => Bun.file(fontFiles[style]).arrayBuffer()
const noImages = async () => null
const pixel = async () => PIXEL_PNG

/** A fixture's test and key as one shuffled Version would print them. */
function versionPlansOf(fixtureName: string, version: string) {
  const fixture = FIXTURES.find((candidate) => candidate.name === fixtureName)!
  return [
    { test: true, answerKey: false },
    { test: false, answerKey: true },
  ].map((selection) => planExport({
    exam: fixture.exam,
    arrangement: fixture.arrangement,
    selection,
    measure: fixture.measure,
    version,
  }))
}

function plansOf(fixtureName: string) {
  const fixture = FIXTURES.find((candidate) => candidate.name === fixtureName)!
  return {
    fixture,
    plans: prepareExport({
      examId: 'fixture-exam',
      exam: fixture.exam,
      arrangement: fixture.arrangement,
      configuration: DEFAULT_EXPORT_CONFIGURATION,
      history: EMPTY_EXPORT_HISTORY,
      measure: fixture.measure,
      createdAt: '2026-09-04T12:00:00.000Z',
    }).documents,
  }
}

describe('PDF Export Adapter', () => {
  test('creates one PDF with planned pages, metadata, selectable text, and independent stream numbering', async () => {
    const { fixture, plans } = plansOf('both sections with the answer key')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await PDFDocument.load(bytes)

    expect(document.getPageCount()).toBe(plans.reduce((sum, plan) => sum + plan.pages.length, 0))
    expect(document.getTitle()).toBe(fixture.exam.title)
    expect(document.getCreator()).toBe('Test Parrot')
    expect(document.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
    // pdf-lib writes real text operators. Whole-page rasterization would have
    // image XObjects but no text-showing operators in the content streams.
    const source = new TextDecoder('latin1').decode(bytes)
    expect(source).toMatch(/\/Type\s*\/Font/)
    expect(source).toMatch(/\/FontFile2\s+\d+\s+0\s+R/)
    expect(source).toMatch(/\/ToUnicode\s+\d+\s+0\s+R/)
    expect(document.getCreator()).toBe('Test Parrot')
  })

  test('prints Difficulty and Topic tags beside Answer Key entries', async () => {
    const { plans } = plansOf('both sections with the answer key')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const text = (await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) =>
        (await (await document.getPage(index + 1)).getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      ),
    )).join(' ')

    expect(text).toContain('Easy')
    expect(text).toContain('Acids')
    expect(text).toContain('Hard')
    expect(text).toContain('Titration')
  })

  test('prints the Answer Key’s Points and total, and no Points on the test', async () => {
    const { plans } = plansOf('a paper with points')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const pages = await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) =>
        (await (await document.getPage(index + 1)).getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      ),
    )
    const testPages = pages.slice(0, plans[0]!.pages.length).join(' ')
    const keyPages = pages.slice(plans[0]!.pages.length).join(' ')
    expect(testPages).not.toMatch(/\[\d+\]|Total/)
    expect(keyPages).toContain('Total: 9 points')
    for (const points of ['[1]', '[2]', '[3]']) expect(keyPages).toContain(points)
  })

  test('writes authored hyperlinks as PDF link annotations', async () => {
    const { plans } = plansOf('a link and its destination')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const source = new TextDecoder('latin1').decode(bytes)

    expect(source).toContain('/Subtype /Link')
    expect(source).toContain('https://example.test/notes')
  })

  test('embeds inline and block image bytes', async () => {
    const { plans } = plansOf('inline and block images')
    const { bytes } = await createPublicationPdf(plans, pixel, fonts)
    const source = new TextDecoder('latin1').decode(bytes)

    // The fixture references one inline image and one block image. Both are
    // embedded as image XObjects rather than replaced by alt text.
    expect(source.match(/\/Subtype\s*\/Image/g)?.length).toBeGreaterThanOrEqual(2)
    expect(source).not.toContain('[Image:')
  })

  // A picture on a line of its own was drawn at the page's left margin, under
  // the question's blank and number, instead of in the column its block is in.
  test('draws a picture in the column of the block that holds it', async () => {
    const { plans } = plansOf('pictures in a multiple-choice stem and choice')
    const { bytes } = await createPublicationPdf(plans, pixel, fonts)
    const page = await (await getDocument({ data: bytes, disableWorker: true }).promise).getPage(1)
    const operators = await page.getOperatorList()
    // pdf-lib draws an image as save, translate to its corner, scale, paint;
    // the translation is the last non-identity unit matrix before the paint.
    const lefts: number[] = []
    let translate = 0
    for (const [index, op] of operators.fnArray.entries()) {
      const args = operators.argsArray[index] as number[]
      const moves = args?.[0] === 1 && args[3] === 1 && (args[4] !== 0 || args[5] !== 0)
      if (op === OPS.transform && moves) translate = args[4]!
      if (op === OPS.paintImageXObject) lefts.push(translate)
    }
    const margin = 72 * 0.75
    const body = margin + questionIndentOf({ type: 'multiple-choice' }) * 0.75
    // The stem's block picture, its inline one, and the first choice's.
    expect(lefts).toHaveLength(3)
    for (const left of lefts) expect(left).toBeGreaterThanOrEqual(body - 0.5)
    // The choice's picture sits past its letter, not on it.
    expect(Math.max(...lefts)).toBeGreaterThanOrEqual(body + 17)
  })

  // Equations are drawn from MathJax's outlines and written over themselves,
  // invisibly, so the PDF's text still holds them for search and copying.
  test('keeps inline and display math searchable, never as LaTeX commands', async () => {
    const { plans } = plansOf('inline and display mathematics')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const pages = await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) =>
        (await (await document.getPage(index + 1)).getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      ),
    )
    const text = pages.join(' ')

    expect(text).toContain('E = mc')
    expect(text).toContain('a⁄b = √c')
    expect(text).not.toContain('\\frac')
    expect(text).not.toContain('\\sqrt')
  })

  // A converted math test printed `dfrac{2x + 1}{x - 3}` and
  // `-1 le x le 5`: every command the typesetter did not know lost its
  // backslash and printed as a word. The written equation is now the
  // searchable text over the drawn one.
  test('writes school notation as notation, never as LaTeX command names', async () => {
    const { plans } = plansOf('school mathematics notation')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const text = (await (await document.getPage(1)).getTextContent()).items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    const compact = text.replace(/\s+/g, '')

    expect(compact).toContain('f(x)=(2x+1)⁄(x−3)')
    expect(compact).toContain('−1≤x≤5')
    expect(compact).toContain('h(x)=2f(x⁄3)−4')
    expect(compact).toContain('(f∘g)(x)')
    expect(compact).toContain('[−1⁄2,1⁄3]')
    expect(compact).toContain('[−2,6]')
    expect(compact).toContain('≠g(x)')
    expect(compact).toContain('undefined')
    expect(compact).toContain('√(x+1)⁄2≥0')
    for (const leak of ['frac', 'left', 'right', 'circ', 'text', 'geq', '\\', '{', '}']) {
      expect(compact).not.toContain(leak)
    }
  })

  // Written on the line, a PDF printed `3⁄5+4⁄15` where print stacks the
  // fractions; the PDF now fills the same outlines print's typesetting draws.
  test('draws equations as typeset outlines rather than as text', async () => {
    const { plans } = plansOf('school mathematics notation')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const page = await (await getDocument({ data: bytes, disableWorker: true }).promise).getPage(1)
    const operators = await page.getOperatorList()
    const paths = operators.fnArray.filter((op) => op === OPS.constructPath).length
    // A glyph or a rule is a path of its own: `f(x)=(2x+1)⁄(x−3)` alone has
    // more than a dozen, where the page's own rules are a handful.
    expect(paths).toBeGreaterThan(40)
  })

  test('draws Subparts numbered beneath their Part’s lead-in, one level further in, and keys each', async () => {
    const { plans } = plansOf('a multipart whose part holds subparts')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const items = async (page: number) =>
      (await (await document.getPage(page)).getTextContent()).items.flatMap((item) =>
        'str' in item && item.str.trim() ? [{ text: item.str.trim(), x: item.transform[4] as number }] : [])
    const test = await items(1)
    const x = (text: string) => test.find((item) => item.text === text)?.x
    expect(x('b.')).toBeDefined()
    expect(x('i.')).toBeGreaterThan(x('b.')!)
    expect(x('ii.')).toBe(x('i.')!)
    expect(test.map((item) => item.text).join(' ')).toContain('The count was highest in April.')

    // A Subpart's label is drawn whole, never wrapped in a Part's narrow column.
    const key = (await items(document.numPages)).map((item) => item.text)
    expect(key).toContain('b (i).')
    expect(key).toContain('b (ii).')
  })

  test('draws a stemless Multipart question’s Part (a) on its number’s line, and a lead-in-less Part’s Subpart (i) on its letter’s', async () => {
    const { plans } = plansOf('a multipart with no stem, and a part with no lead-in')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    // The question opens page 1, under its header.
    const items = (await (await document.getPage(1)).getTextContent()).items.flatMap((item) =>
      'str' in item && item.str.trim() ? [{ text: item.str.trim(), x: item.transform[4] as number, y: item.transform[5] as number }] : [])
    // The page number at the top is a `1` too; the question's is the last.
    const at = (text: string) =>
      text === '1' ? items.filter((item) => item.text === '1').at(-1)! : items.find((item) => item.text.startsWith(text))!
    expect(at('(a)').y).toBeCloseTo(at('1').y, 1)
    expect(at('Fig. 1.1').y).toBeCloseTo(at('1').y, 1)
    expect(at('(a)').x).toBeGreaterThan(at('1').x)
    expect(at('(i)').y).toBeCloseTo(at('(b)').y, 1)
    expect(at('Name the force').y).toBeCloseTo(at('(b)').y, 1)
    expect(at('(i)').x).toBeGreaterThan(at('(b)').x)
    // (ii) stands under (i), on a line of its own.
    expect(at('(ii)').x).toBeCloseTo(at('(i)').x, 1)
    expect(at('(ii)').y).toBeLessThan(at('(i)').y)
  })

  test('draws an Exam Board paper on A4: its paper total, labels, Points at the right margin and running furniture', async () => {
    const { plans } = plansOf('a paper with points in the exam board paper style')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const pdf = await PDFDocument.load(bytes)
    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize()
      expect(width).toBeCloseTo(595.28, 2)
      expect(height).toBeCloseTo(841.89, 2)
    }
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const items = async (page: number) =>
      (await (await document.getPage(page)).getTextContent()).items.flatMap((item) =>
        'str' in item && item.str.trim() ? [{ text: item.str.trim(), x: item.transform[4] as number }] : [])
    const testPageCount = plans[0]!.pages.length
    const pages = await Promise.all(Array.from({ length: document.numPages }, (_, index) => items(index + 1)))
    const textOf = (page: number) => pages[page]!.map((item) => item.text).join(' ')

    // Page 1: its number at the top, the header line, the title, and the
    // paper's total beneath it, then the first question. No cover.
    const first = pages[0]!.map((item) => item.text)
    expect(first.slice(0, 2)).toEqual(['1', 'Name: __________________ Class: ___________ Date: ___________'])
    expect(first.indexOf('Plant Biology')).toBeLessThan(first.indexOf('The total mark for this paper is 16.'))
    expect(first.indexOf('The total mark for this paper is 16.')).toBeLessThan(first.indexOf('Multiple Choice'))
    // Labels and Points on the question pages, each `[n]` at the right margin.
    const test = pages.slice(0, testPageCount).flat()
    const texts = test.map((item) => item.text)
    for (const text of ['(a)', '(b)', '(i)', '(ii)', '[1]', '[2]', '[3]', '[6]', '[Total: 9]']) expect(texts).toContain(text)
    const right = test.find((item) => item.text === '[Total: 9]')!.x
    const left = test.find((item) => item.text === '(a)')!.x
    expect(right).toBeGreaterThan(left + 300)
    // "Turn over" on every test page but the last, and the page number at
    // the top of every one, above its header line.
    for (let page = 0; page < testPageCount; page += 1) {
      expect(textOf(page).includes('Turn over')).toBe(page < testPageCount - 1)
    }
    expect(pages[1]!.slice(0, 2).map((item) => item.text)).toEqual(['2', 'Name: __________________'])
    // The Answer Key keeps the sheet's own: no Turn over, and no total but
    // its own.
    const key = pages.slice(testPageCount).map((page) => page.map((item) => item.text).join(' ')).join(' ')
    expect(key).not.toContain('Turn over')
    expect(key).not.toContain('The total mark for this paper')
  })

  test('draws a boxed passage inside a black border around its text', async () => {
    const { plans } = plansOf('a boxed passage that opens its question')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const page = await (await getDocument({ data: bytes, disableWorker: true }).promise).getPage(1)
    const text = (await page.getTextContent()).items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    expect(text).toContain('Competition from newer ports')
    expect(text).toContain('Source: A Short History of Aldmere')

    // pdf-lib strokes a bordered rectangle in the colour it is given: the box
    // is the one black stroke on the page.
    const operators = await page.getOperatorList()
    const blackStrokes = operators.fnArray.filter((op, index) => {
      const args = operators.argsArray[index] as unknown[]
      return op === OPS.setStrokeRGBColor
        && (args.join(',') === '0,0,0' || String(args[0]).toLowerCase() === '#000000')
    })
    expect(blackStrokes.length).toBeGreaterThanOrEqual(1)
  })

  test('draws a Side-by-Side’s pictures beside one another, each centred in its Panel', async () => {
    const { plans } = plansOf('side-by-side panels of pictures, tables and text')
    const { bytes } = await createPublicationPdf(plans, pixel, fonts)
    const page = await (await getDocument({ data: bytes, disableWorker: true }).promise).getPage(1)
    const operators = await page.getOperatorList()
    // pdf-lib draws an image as save, translate to its corner, scale to its
    // size, paint.
    const images: { left: number; bottom: number; width: number }[] = []
    let corner = [0, 0]
    let width = 0
    for (const [index, op] of operators.fnArray.entries()) {
      const args = operators.argsArray[index] as number[]
      if (op === OPS.transform) {
        const unit = args[0] === 1 && args[3] === 1
        if (unit && (args[4] !== 0 || args[5] !== 0)) corner = [args[4]!, args[5]!]
        else if (!unit && args[4] === 0 && args[5] === 0) width = args[0]!
      }
      if (op === OPS.paintImageXObject) {
        images.push({ left: corner[0]!, bottom: corner[1]!, width })
      }
    }
    // The two graphs of the first question.
    const [f, g] = images
    expect(f).toBeDefined()
    expect(g).toBeDefined()
    const margin = 72 * 0.75
    const body = margin + questionIndentOf({ type: 'multiple-choice' }) * 0.75
    const lane = 816 * 0.75 - margin - body
    const panel = lane / 2
    // Side by side: g in the right Panel, level with f rather than below it.
    expect(g!.left).toBeGreaterThanOrEqual(body + panel - 0.5)
    expect(f!.left + f!.width).toBeLessThanOrEqual(body + panel + 0.5)
    // Each centred across its Panel.
    expect(Math.abs(f!.left + f!.width / 2 - (body + panel / 2))).toBeLessThan(9)
    expect(Math.abs(g!.left + g!.width / 2 - (body + panel * 1.5))).toBeLessThan(9)
    // g is drawn smaller (its Authored Image Size), so centring it against f
    // puts its bottom above f's.
    expect(g!.bottom).toBeGreaterThan(f!.bottom)
  })

  test('draws a Centred picture and its caption in the middle of the question’s column, and a left paragraph at its left', async () => {
    const { plans } = plansOf('a centred figure, caption and table')
    const { bytes } = await createPublicationPdf(plans, pixel, fonts)
    const page = await (await getDocument({ data: bytes, disableWorker: true }).promise).getPage(1)
    const operators = await page.getOperatorList()
    const images: { left: number; width: number }[] = []
    let left = 0
    let width = 0
    for (const [index, op] of operators.fnArray.entries()) {
      const args = operators.argsArray[index] as number[]
      if (op === OPS.transform) {
        const unit = args[0] === 1 && args[3] === 1
        if (unit && (args[4] !== 0 || args[5] !== 0)) left = args[4]!
        else if (!unit && args[4] === 0 && args[5] === 0) width = args[0]!
      }
      if (op === OPS.paintImageXObject) images.push({ left, width })
    }
    const margin = 72 * 0.75
    const body = margin + questionIndentOf({ type: 'open' }) * 0.75
    const lane = 816 * 0.75 - margin - body
    const middle = body + lane / 2
    // The figure, half the lane wide, and its centre the lane's.
    expect(images[0]!.width).toBeCloseTo(lane / 2, 0)
    expect(Math.abs(images[0]!.left + images[0]!.width / 2 - middle)).toBeLessThan(1)
    const text = (await page.getTextContent()).items as { str: string; transform: number[]; width: number }[]
    const at = (words: string) => text.find((item) => item.str.includes(words))!
    for (const centred of ['Fig. 1.1', 'Table 1.1']) {
      const item = text.find((candidate) => candidate.str.trim() === centred)!
      expect(Math.abs(item.transform[4]! + item.width / 2 - middle), centred).toBeLessThan(1)
    }
    expect(at('Describe the leaf.').transform[4]).toBeCloseTo(body, 0)
    // A Centred paragraph that opens a question leaves its number at the left.
    expect(text.find((item) => item.str.trim() === '2.')!.transform[4]).toBeLessThan(body)
    const opening = text.find((item) => item.str.trim() === 'Table 2.1')!
    expect(Math.abs(opening.transform[4]! + opening.width / 2 - middle)).toBeLessThan(1)
  })

  test('requires the font variants used by authored formatting', async () => {
    const { plans } = plansOf('every inline mark')
    const requested: string[] = []
    await createPublicationPdf(plans, noImages, async (style) => {
      requested.push(style)
      return fonts(style)
    })

    expect(new Set(requested)).toEqual(
      new Set(['regular', 'bold', 'italic', 'boldItalic', 'mono']),
    )
  })

  test('fails actionably when a character is absent from the bundled fonts', async () => {
    const { plans } = plansOf('a plain short-answer question')
    const changed = structuredClone(plans)
    const item = changed[0]!.pages[0]!.items.find((candidate) => candidate.kind === 'question')!
    if (item.kind !== 'question') throw new Error('fixture has no question')
    item.stem = [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsupported \u0378' }] }]

    try {
      await createPublicationPdf(changed, noImages, fonts)
      throw new Error('expected unsupported character failure')
    } catch (error) {
      expect(isPdfUnsupportedCharacterError(error)).toBe(true)
      expect((error as Error).message).toContain('\u0378')
      expect((error as Error).message).toContain('Remove or replace')
    }
  })

  test('rules a lined work space and lets a filled one reach the foot of its page', async () => {
    const { plans } = plansOf('Short Answer work space, lined, blank and filling its page')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await PDFDocument.load(bytes)

    // The fill moves the last question on; nothing overflows the test's pages.
    expect(document.getPageCount()).toBe(plans.reduce((sum, plan) => sum + plan.pages.length, 0))
    const firstPage = (await getDocument({ data: bytes.slice() }).promise).getPage(1)
    const operators = await (await firstPage).getOperatorList()
    // Each rule is its own stroked path: five for the first question and the
    // filled question's many more, so well over five on the page.
    const rules = operators.fnArray.filter((fn: number) => fn === OPS.constructPath).length
    expect(rules).toBeGreaterThan(5)
  })

  test('sets an answer’s [n] on the last of its ruled lines, at the right margin', async () => {
    const { plans } = plansOf('a paper with points in the exam board paper style')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const pages = await Promise.all(Array.from({ length: plans[0]!.pages.length }, async (_, index) =>
      (await (await document.getPage(index + 1)).getTextContent()).items.flatMap((item) =>
        'str' in item && item.str.trim()
          ? [{ text: item.str.trim(), x: item.transform[4] as number, y: item.transform[5] as number, width: item.width as number }]
          : [])))
    const page = pages.find((items) => items.some((item) => item.text.startsWith('Explain why a plant')))!
    const stem = page.find((item) => item.text.startsWith('Explain why a plant'))!
    const points = page.find((item) => item.text === '[3]')!
    // Its three dotted rows, as planned: [3] stands in the last of them —
    // below the second rule and above the third — not on a line under it.
    const space = plans[0]!.pages.flatMap((planned) => planned.items)
      .find((item) => item.kind === 'question' && item.question.id === 'eb-sa')
    const rows = space?.kind === 'question' ? space.workSpace! : null
    const below = stem.y - points.y
    const pt = (px: number) => px * 0.75
    expect(below).toBeGreaterThan(pt(rows!.firstRow! + rows!.pitch!))
    expect(below).toBeLessThan(pt(rows!.firstRow! + 2 * rows!.pitch!) + pt(20))
    // Against the right margin, as print sets it.
    expect(points.x + points.width).toBeCloseTo(595.28 - pt(72), 0)
  })

  // Content the plan put on a page is drawn there even when it runs past
  // the foot of the page (ADR-0046): the export goes ahead, and the pages it
  // ran past are named, counted across the whole file.
  test('still draws content that runs past its planned page, and names the page', async () => {
    const { plans } = plansOf('a plain short-answer question')
    const changed = structuredClone(plans)
    const item = changed[0]!.pages[0]!.items.find((candidate) => candidate.kind === 'question')!
    if (item.kind !== 'question') throw new Error('fixture has no question')
    item.stem = Array.from({ length: 24 }, (_unused, index) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: `Line ${index + 1} was not in the measured Layout Plan.` }],
    }))

    const { bytes, pagesPastMargin } = await createPublicationPdf(changed, noImages, fonts)

    expect(pagesPastMargin).toEqual([1])
    const document = await getDocument({ data: bytes.slice(), disableWorker: true }).promise
    expect(document.numPages).toBe(changed.reduce((sum, plan) => sum + plan.pages.length, 0))
    const drawn = (await (await document.getPage(1)).getTextContent()).items
      .map((item) => ('str' in item ? item.str : '')).join(' ')
    // Every line is drawn where the plan put it, the last ones in the margin.
    expect(drawn).toContain('Line 24 was')
    expect(pastMarginWarning(pagesPastMargin)).toBe(
      'Page 1 of the PDF runs past its bottom margin. Check it before printing.',
    )
  })

  test('draws a Part taller than a page across the pages it broke onto, none past its margin', async () => {
    const { plans } = plansOf('a part taller than a page, broken between its stem’s blocks')
    const { bytes, pagesPastMargin } = await createPublicationPdf(plans, pixel, fonts)
    expect(pagesPastMargin).toEqual([])
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const textOf = async (page: number) =>
      (await (await document.getPage(page)).getTextContent()).items
        .map((item) => ('str' in item ? item.str : '')).join(' ')
    // Part (a) from its letter to Fig. 1.2, then on from Fig. 1.3 without its
    // letter again, ending with its room and [4].
    const [second, third] = [await textOf(1), await textOf(2)]
    expect(second).toContain('(a)')
    expect(second).toContain('Fig. 1.2')
    expect(third).toContain('Fig. 1.3')
    expect(third).toContain('[4]')
    expect(third).not.toContain('(a)')
  })

  test('names every page that runs past its margin, and says nothing when none does', async () => {
    expect(pastMarginWarning([])).toBeNull()
    expect(pastMarginWarning([2, 5])).toBe(
      'Pages 2 and 5 of the PDF run past their bottom margin. Check them before printing.',
    )
    expect(pastMarginWarning([1, 3, 4])).toBe(
      'Pages 1, 3 and 4 of the PDF run past their bottom margin. Check them before printing.',
    )
    const { plans } = plansOf('both sections with the answer key')
    expect((await createPublicationPdf(plans, noImages, fonts)).pagesPastMargin).toEqual([])
  })

  // A paragraph that wraps takes one line of the page per line it wraps
  // onto. Each line once asked for room for every line above it as well, so
  // a cell wrapping over many lines, well inside its planned page, was taken
  // to run past it.
  test('draws a table cell that wraps over many lines on the page planned for it', async () => {
    const { plans } = plansOf('a wrapping table under a picture in an exam board part')
    const test = plans[0]!
    expect(test.pageSize.paper).toBe('a4')
    // The paper's total, then the question with its table, on page 1.
    expect(test.pages.map((page) => page.items.map((item) => item.kind)))
      .toEqual([['paper-total', 'section-heading', 'question']])

    const { bytes, pagesPastMargin } = await createPublicationPdf(plans, pixel, fonts)

    expect(pagesPastMargin).toEqual([])
    const document = await getDocument({ data: bytes.slice(), disableWorker: true }).promise
    expect(document.numPages).toBe(plans.reduce((sum, plan) => sum + plan.pages.length, 0))
    const page = await document.getPage(1)
    const lines = new Set((await page.getTextContent()).items
      .filter((item) => 'str' in item && /tenth|second|Record|nearest/.test(item.str))
      .map((item) => ('transform' in item ? Math.round(item.transform[5] as number) : 0)))
    // The notes cell wraps over many lines of its own.
    expect(lines.size).toBeGreaterThan(10)
  })

  // Print opens 4px above a Section's Directions, once, and sets their lines
  // at the body line height. The PDF opened the 4px above every line they
  // wrapped onto, so long Directions came out taller than they were packed.
  test('sets wrapped Section Directions at one line height apart', async () => {
    const plan = planExport({
      exam: {
        title: 'Directions',
        questions: [{ id: 'o1', type: 'open', columns: 2, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name a planet.' }] }] } }],
        sectionHeadings: {
          open: {
            title: 'Short Answer',
            instructions: 'Read every question carefully before you begin, write your answers in the spaces provided, show all of your working, and check each answer when you have finished the paper.',
          },
        },
      },
      arrangement: { id: 'a', letter: 'A', questionOrder: ['o1'], choiceOrder: {} },
      selection: { test: true, answerKey: false },
      measure: unmeasured,
    })
    const { bytes } = await createPublicationPdf([plan], noImages, fonts)
    const page = await (await getDocument({ data: bytes.slice(), disableWorker: true }).promise).getPage(1)
    const directions = /Read|question|carefully|spaces|working|finished|paper/
    const baselines = [...new Set((await page.getTextContent()).items
      .filter((item) => 'str' in item && directions.test(item.str))
      .map((item) => ('transform' in item ? Math.round((item.transform[5] as number) * 100) / 100 : 0)))]
      .sort((a, b) => b - a)
    expect(baselines.length).toBeGreaterThan(1)
    const pitch = sectionHeadingPoints('normal').instructions * BODY_LINE_HEIGHT
    for (let index = 1; index < baselines.length; index += 1) {
      expect(baselines[index - 1]! - baselines[index]!).toBeCloseTo(pitch, 1)
    }
  })

  // An Exam's own section wording reaches the PDF, and a part it cleared does
  // not — neither the words nor the default they replaced.
  test('draws reworded section headings and nothing for a cleared one', async () => {
    const { plans } = plansOf('reworded, cleared and large section headings')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    let drawn = ''
    for (let index = 1; index <= document.numPages; index += 1) {
      drawn += ' ' + (await (await document.getPage(index)).getTextContent()).items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
    }
    drawn = drawn.replace(/\s+/g, ' ')
    expect(drawn).toContain('Choose One')
    expect(drawn).toContain('Write the letter of the matching definition.')
    expect(drawn).not.toContain(SECTION_INSTRUCTIONS['multiple-choice'])
    expect(drawn).not.toContain(SECTION_INSTRUCTIONS.open)
    // Cleared from the test, the group is still named in the key, by its place.
    expect(drawn).toContain('Section 1')
  })

  // An Exam's own header line replaces the blanks, and a Version's name
  // still prints beside it.
  test('draws a reworded header line beside the Version name', async () => {
    const plans = versionPlansOf('a reworded header line', 'Curly Fox')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const drawn = (await (await document.getPage(1)).getTextContent()).items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
    expect(drawn).toContain('Student: __________ Period: ____')
    expect(drawn).not.toContain('Class:')
    expect(drawn).toContain('Curly Fox')
  })

  test('prints no label on the Working Copy’s own arrangement', async () => {
    const { plans } = plansOf('a reworded header line')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const drawn = (await (await document.getPage(1)).getTextContent()).items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    expect(drawn).toContain('Student:')
    expect(drawn).not.toContain('ID:')
  })

  // The text size scales the questions, the heading size the title, and the
  // header line stays at the sheet's own type.
  test('draws the Exam’s text and title at the sizes it chose', async () => {
    const plans = versionPlansOf('large text under small headings', 'Brave Otter')
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const items = (await (await document.getPage(1)).getTextContent()).items as {
      str: string
      transform: number[]
    }[]
    const sizeOf = (text: string) => items.find((item) => item.str.includes(text))?.transform[0]
    expect(sizeOf('Which particle is neutral?')).toBeCloseTo(bodyPoints('large'), 2)
    expect(sizeOf('Sized type')).toBeCloseTo(titlePoints('small'), 2)
    expect(sizeOf('Brave Otter')).toBeCloseTo(pointsOf('body'), 2)
  })

  // A Paper Style's blanks and letters reach the page as the plan resolved
  // them, and the Answer Key keeps its capitals.
  test.each([
    ['classic', '_______ 1.', 'b. Carbon dioxide'],
    ['condensed', 'T F 2.', 'B. Carbon dioxide'],
  ] as const)('draws the %s paper style’s blanks and letters', async (style, blank, answer) => {
    const { plans } = plansOf(`every question type in the ${style} paper style`)
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    let drawn = ''
    for (let index = 1; index <= document.numPages; index += 1) {
      drawn += ' ' + (await (await document.getPage(index)).getTextContent()).items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
    }
    drawn = drawn.replace(/\s+/g, ' ')
    expect(drawn).toContain(blank)
    expect(drawn).toContain(answer)
    // The key's letter for Multiple Choice is a capital whatever the test prints.
    expect(drawn).toMatch(/1\. B\b/)
  })

  // A matching question once printed its stem and nothing else: no prompts, no
  // Word Bank. Every prompt's number and text, and every answer's letter and
  // text, must reach the page the plan put them on.
  test.each([
    'a matching set with a shuffled word bank and an unmatched item',
    'a matching set whose long word bank prints above its items',
    'a matching set too long for one page, its word bank on every piece',
  ])('draws every prompt and Word Bank answer of %s', async (name) => {
    const { plans } = plansOf(name)
    const { bytes } = await createPublicationPdf(plans, noImages, fonts)
    const document = await getDocument({ data: bytes, disableWorker: true }).promise
    const plainText = (node: { text?: string; content?: unknown[] }): string =>
      node.text ?? (node.content ?? []).map((child) => plainText(child as typeof node)).join('')
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()

    for (const [index, page] of plans.flatMap((plan) => plan.pages).entries()) {
      const drawn = normalize(
        (await (await document.getPage(index + 1)).getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      )
      for (const item of page.items) {
        if (item.kind !== 'question' || !item.matching) continue
        for (const prompt of item.matching.prompts) {
          expect(drawn).toContain(normalize(`${prompt.number}. ${plainText(prompt.node)}`))
        }
        for (const answer of item.matching.bank) {
          expect(drawn).toContain(normalize(`${answer.letter}. ${plainText(answer.node)}`))
        }
        // The set's numbers print on its prompts; its directions print unnumbered.
        const [directions] = item.stem
        if (directions) expect(drawn).not.toContain(normalize(`1. ${plainText(directions)}`))
      }
    }
  })
})
