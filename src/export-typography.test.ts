// One type scale, three presentations.
//
// Parity compares what an export says, not how large it says it, so a DOCX that
// fell back to Word's own 10pt defaults passed every parity fixture while
// reading a size smaller than print. These tests hold print's stylesheet, the
// DOCX package and the PDF's drawn text to the single table in
// `export-typography.ts`.

import { DEFAULT_HEADER } from './page-header'
import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createExamDocx } from './docx-export'
import { EMPTY_EXPORT_HISTORY, plansOf, prepareExport } from './export-preparation'
import { FIXTURES } from './export-fixtures'
import { CHOICE_INDENT, PAGE_CONTENT_WIDTH, RUNNING_HEAD_HEIGHT, questionIndentOf } from './export-plan'
import { ANSWER_BLANK, PAPER_STYLE_RULES } from './paper-style'
import {
  BODY_LINE_HEIGHT,
  EXAM_FONT,
  EXAM_TYPE_PX,
  HEADING_LINE_HEIGHT,
  LIST_ITEM_GAP_EM,
  PARAGRAPH_GAP_EM,
  TABLE_CELL_PADDING_PX,
  TITLE_LINE_HEIGHT,
  halfPointsOf,
  pointsOf,
} from './export-typography'
import { createPublicationPdf, type PdfFontLoader } from './pdf-export'

const fontFile = {
  regular: 'FreeSerif.ttf',
  bold: 'FreeSerifBold.ttf',
  italic: 'FreeSerifItalic.ttf',
  boldItalic: 'FreeSerifBoldItalic.ttf',
  mono: 'FreeMono.ttf',
} as const
const fonts: PdfFontLoader = async (style) =>
  Bun.file(new URL(`../public/fonts/${fontFile[style]}`, import.meta.url).pathname).arrayBuffer()

function plansOfFixture(name: string) {
  const fixture = FIXTURES.find((candidate) => candidate.name === name)!
  return plansOf(
    prepareExport({
      examId: 'fixture-exam',
      exam: fixture.exam,
      arrangement: fixture.arrangement,
      configuration: { selection: { test: true, answerKey: true } },
      history: EMPTY_EXPORT_HISTORY,
      measure: fixture.measure,
      createdAt: '2026-09-04T12:00:00.000Z',
    }),
  )
}

const FIXTURE = 'all four sections on one paper'

describe('print’s stylesheet is the table', () => {
  const css = Bun.file(new URL('./styles.css', import.meta.url).pathname).text()

  // The declaration block of a selector exactly as styles.css spells it.
  async function rule(selector: string): Promise<string> {
    const source = await css
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(source)
    if (!match) throw new Error(`styles.css has no rule for ${selector}`)
    return match[1]!
  }
  const sizeIn = (block: string) => Number(/font(?:-size)?:[^;]*?(\d+)px/.exec(block)?.[1])

  test.each([
    ['.exam-page', 'body'],
    ['.section-title', 'sectionTitle'],
    ['.answer-key-section', 'sectionTitle'],
    ['.answer-key-heading', 'answerKeyHeading'],
    ['.page-footer', 'small'],
    ['.doc-figure figcaption', 'small'],
  ] as const)('%s is set at the %s size', async (selector, role) => {
    expect(sizeIn(await rule(selector))).toBe(EXAM_TYPE_PX[role])
  })

  test('the title is set at the title size', async () => {
    expect(sizeIn(await rule('.page-header--first .exam-title,\n.page-header--answer-key .exam-title'))).toBe(
      EXAM_TYPE_PX.title,
    )
  })

  test('the sheet is set in the exam font', async () => {
    expect(await rule('.exam-page')).toContain(`font-family: ${EXAM_FONT}`)
  })

  test('the lines of a paragraph sit at the body line height', async () => {
    expect(await rule('.exam-page')).toContain(`line-height: ${BODY_LINE_HEIGHT};`)
  })

  test('headings sit at the heading line height, and the title a step tighter', async () => {
    for (const selector of ['.section-title', '.answer-key-heading', '.answer-key-section']) {
      expect(await rule(selector)).toContain(`px/${HEADING_LINE_HEIGHT} `)
    }
    expect(await rule('.page-header--first .exam-title,\n.page-header--answer-key .exam-title'))
      .toContain(`px/${TITLE_LINE_HEIGHT} `)
    // Tighter than they were, and a heading never looser than its body.
    expect(BODY_LINE_HEIGHT).toBeLessThan(1.3)
    expect(TITLE_LINE_HEIGHT).toBeLessThanOrEqual(HEADING_LINE_HEIGHT)
  })

  test('a page number printed at the top takes the row the plan packs around', async () => {
    expect(await rule('.page-running-head')).toContain(`height: ${RUNNING_HEAD_HEIGHT}px;`)
  })

  test('“Answer Section” is never broken across lines', async () => {
    expect(await rule('.answer-key-heading')).toContain('white-space: nowrap;')
  })

  test('a paragraph or list opens the paragraph gap, and a list’s items sit the list gap apart', async () => {
    expect(await rule(':where(.exam-page .doc-content) :is(p, ul, ol)')).toContain(`margin: ${PARAGRAPH_GAP_EM}em 0;`)
    expect(await rule(':where(.exam-page .doc-content) li > p')).toContain('margin: 0;')
    expect(await rule(':where(.exam-page .doc-content) li + li')).toContain(`margin-top: ${LIST_ITEM_GAP_EM}em;`)
    expect(await rule(':where(.exam-page .doc-content) li > :is(ul, ol)')).toContain(`margin: ${LIST_ITEM_GAP_EM}em 0 0;`)
    // Far enough apart that a paragraph break never reads as one more line.
    expect(PARAGRAPH_GAP_EM).toBeGreaterThanOrEqual(3 * (BODY_LINE_HEIGHT - 1))
    expect(LIST_ITEM_GAP_EM).toBeLessThan(PARAGRAPH_GAP_EM / 4)
  })

  test('a table’s cells hold their paragraphs with no paragraph gap at their top or foot', async () => {
    expect(await rule(':where(.exam-page .doc-content) :is(td, th) > :first-child')).toContain('margin-top: 0;')
    expect(await rule(':where(.exam-page .doc-content) :is(td, th) > :last-child')).toContain('margin-bottom: 0;')
    expect(await rule('.exam-page .doc-table :is(td, th)'))
      .toContain(`padding: ${TABLE_CELL_PADDING_PX.y}px ${TABLE_CELL_PADDING_PX.x}px;`)
  })

  test('a Multiple Choice question’s answers are set in from its stem', async () => {
    const grid = await rule('.choice-grid')
    expect(grid).toContain(`width: calc(100% - ${CHOICE_INDENT}px);`)
    expect(grid).toContain(`margin: 8px 0 0 ${CHOICE_INDENT}px;`)
  })

  // Not type, but the same promise: packing measured these, so print must
  // draw them at the plan's own numbers.
  const pxIn = (block: string, property: string) =>
    Number(new RegExp(`${property}:\\s*(\\d+)px`).exec(block)?.[1])

  test('each Paper Style stands its questions as far apart as its rules say', async () => {
    expect(pxIn(await rule('.exam-question'), 'margin-bottom')).toBe(PAPER_STYLE_RULES.standard.questionGap)
    expect(pxIn(await rule("[data-paper-style='condensed'] .exam-question"), 'margin-bottom'))
      .toBe(PAPER_STYLE_RULES.condensed.questionGap)
    expect(PAPER_STYLE_RULES.classic.questionGap).toBe(PAPER_STYLE_RULES.standard.questionGap)
  })

  test.each([
    ['marks', ['T', 'F']],
    ['blank', [ANSWER_BLANK]],
  ] as const)('the %s number column is the width the adapters indent by', async (column, marks) => {
    const block = await rule(`.exam-question:has(> .question-number--${column})`)
    const width = Number(/grid-template-columns:\s*(\d+)px/.exec(block)?.[1])
    expect(width + 6).toBe(questionIndentOf({ type: 'multiple-choice', marks }))
  })
})

describe('DOCX sets print’s type rather than Word’s defaults', () => {
  async function packaged() {
    const blob = await createExamDocx(plansOfFixture(FIXTURE), async () => null)
    return JSZip.loadAsync(await blob.arrayBuffer())
  }
  const styleOf = (styles: string, id: string) =>
    new RegExp(`<w:style\\b[^>]*w:styleId="${id}".*?</w:style>`, 's').exec(styles)?.[0] ?? ''
  const sizeOf = (xml: string) => Number(/<w:sz w:val="(\d+)"/.exec(xml)?.[1])

  test('body text defaults to the exam font at the body size', async () => {
    const styles = await (await packaged()).file('word/styles.xml')!.async('string')
    const defaults = /<w:docDefaults>.*?<\/w:docDefaults>/s.exec(styles)![0]
    expect(defaults).toContain(`w:ascii="${EXAM_FONT}"`)
    expect(sizeOf(defaults)).toBe(halfPointsOf('body'))
  })

  test('the title and section headings are print’s sizes', async () => {
    const styles = await (await packaged()).file('word/styles.xml')!.async('string')
    expect(sizeOf(styleOf(styles, 'Title'))).toBe(halfPointsOf('title'))
    expect(sizeOf(styleOf(styles, 'Heading1'))).toBe(halfPointsOf('sectionTitle'))
    expect(sizeOf(styleOf(styles, 'Heading2'))).toBe(halfPointsOf('sectionTitle'))
  })

  test('each Word size is within a quarter point of print and never larger', () => {
    for (const role of Object.keys(EXAM_TYPE_PX) as (keyof typeof EXAM_TYPE_PX)[]) {
      const word = halfPointsOf(role) / 2
      expect(word).toBeLessThanOrEqual(pointsOf(role))
      expect(pointsOf(role) - word).toBeLessThanOrEqual(0.25)
    }
  })

  test('headings and the title are spaced by the same table', async () => {
    const zip = await packaged()
    const document = await zip.file('word/document.xml')!.async('string')
    const header = await zip.file('word/header1.xml')!.async('string')
    const lineOf = (xml: string, style: string) =>
      new RegExp(`<w:pStyle w:val="${style}"/>.*?<w:spacing [^>]*w:line="(\\d+)" w:lineRule="atLeast"`, 's').exec(xml)?.[1]
    expect(Number(lineOf(header, 'Title'))).toBe(Math.round(halfPointsOf('title') * 10 * TITLE_LINE_HEIGHT))
    expect(Number(lineOf(document, 'Heading1'))).toBe(Math.round(halfPointsOf('sectionTitle') * 10 * HEADING_LINE_HEIGHT))
  })

  test('body paragraphs are spaced by the same table', async () => {
    const zip = await JSZip.loadAsync(
      await (await createExamDocx(plansOfFixture('a multipart with a multiple-choice part and a short-answer part'), async () => null)).arrayBuffer(),
    )
    const document = await zip.file('word/document.xml')!.async('string')
    const paragraph = (text: string) =>
      [...document.matchAll(/<w:p>.*?<\/w:p>|<w:p [^>]*>.*?<\/w:p>/gs)].map(([xml]) => xml).find((xml) => xml.includes(text))!
    const spacing = (xml: string) => {
      const attrs = /<w:spacing ([^>]*)\/>/.exec(xml)?.[1] ?? ''
      return Object.fromEntries([...attrs.matchAll(/w:(\w+)="(\w+)"/g)].map(([, key, value]) => [key, value]))
    }
    const twipsOf = (em: number) => String(Math.round(pointsOf('body') * em * 20))
    const first = spacing(paragraph('Competition from newer ports'))
    // Lines at least the body line height apart, so a picture still fits.
    expect(first.line).toBe(twipsOf(BODY_LINE_HEIGHT))
    expect(first.lineRule).toBe('atLeast')
    // A list's items sit the list gap apart.
    expect(first.after).toBe(twipsOf(LIST_ITEM_GAP_EM))
    expect(spacing(paragraph('Development of other trade routes')).before).toBeUndefined()
    // A paragraph after a paragraph opens the paragraph gap, counting what the
    // one above left below itself.
    const second = spacing(paragraph('Several other factors'))
    const above = spacing(paragraph('The power of the Kingdom'))
    expect(Number(second.before) + Number(above.after)).toBe(Number(twipsOf(PARAGRAPH_GAP_EM)))
    // And after a list, the gap counts the list gap the last item left.
    const afterList = spacing(paragraph('Source: '))
    expect(Number(afterList.before) + Number(twipsOf(LIST_ITEM_GAP_EM))).toBe(Number(twipsOf(PARAGRAPH_GAP_EM)))
  })

  test('a table’s cells are padded as print pads them, the last paragraph’s own room counted below', async () => {
    const zip = await JSZip.loadAsync(
      await (await createExamDocx(plansOfFixture('a table with a header row'), async () => null)).arrayBuffer(),
    )
    const document = await zip.file('word/document.xml')!.async('string')
    const margins = /<w:tcMar>(.*?)<\/w:tcMar>/s.exec(document)![1]!
    const side = (name: string) => Number(new RegExp(`<w:${name} w:type="dxa" w:w="(\\d+)"/>`).exec(margins)?.[1])
    expect(side('top')).toBe(TABLE_CELL_PADDING_PX.y * 15)
    expect(side('left')).toBe(TABLE_CELL_PADDING_PX.x * 15)
    expect(side('right')).toBe(TABLE_CELL_PADDING_PX.x * 15)
    // A cell's paragraph leaves 4pt below itself, about the padding already.
    expect(side('bottom') + 80).toBeGreaterThanOrEqual(TABLE_CELL_PADDING_PX.y * 15)
  })

  test('the identity line spans the content width, its output ID against the right margin', async () => {
    const zip = await packaged()
    const header = await zip.file('word/header1.xml')!.async('string')
    const stops = [...header.matchAll(/<w:tab w:val="(\w+)" w:pos="(\d+)"(?: w:leader="(\w+)")?\/>/g)]
    const last = stops.at(-1)!
    expect([last[1], Number(last[2])]).toEqual(['right', PAGE_CONTENT_WIDTH * 15])
    // The line is its own text, blanks and all, as print sets it.
    expect(header).toContain(`<w:t xml:space="preserve">${DEFAULT_HEADER.first}</w:t>`)
    // Real tab elements, which Word advances to a stop; a literal tab
    // character inside the text is not one.
    expect(header).not.toMatch(/<w:t[^>]*>[^<]*\t/)
  })
})

describe('the PDF draws print’s type', () => {
  test('stems at the body size and the title at the title size', async () => {
    const { bytes } = await createPublicationPdf(plansOfFixture(FIXTURE), async () => null, fonts)
    const page = await (await getDocument({ data: bytes }).promise).getPage(1)
    const items = (await page.getTextContent()).items as { str: string; transform: number[] }[]
    const sizeOfText = (text: string) => items.find((item) => item.str.includes(text))?.transform[0]
    expect(sizeOfText('Which particle is neutral?')).toBeCloseTo(pointsOf('body'), 2)
    expect(sizeOfText('Mixed sections')).toBeCloseTo(pointsOf('title'), 2)
  })

  test('a table row of one line at a line and the cell’s padding, as print sets it', async () => {
    const { bytes } = await createPublicationPdf(plansOfFixture('a table with a header row'), async () => null, fonts)
    const page = await (await getDocument({ data: bytes }).promise).getPage(1)
    const items = (await page.getTextContent()).items as { str: string; transform: number[] }[]
    const baseline = (text: string) => items.find((item) => item.str.includes(text))!.transform[5]!
    // A line, the padding above and below it, and the 1px rule between rows.
    const row = pointsOf('body') * BODY_LINE_HEIGHT + (2 * TABLE_CELL_PADDING_PX.y + 1) * 0.75
    expect(baseline('Sodium') - baseline('Chlorine')).toBeCloseTo(row, 1)
    expect(baseline('Element') - baseline('Sodium')).toBeCloseTo(row, 1)
  })

  test('lines, list items and paragraphs at print’s spacing', async () => {
    const { bytes } = await createPublicationPdf(
      plansOfFixture('a multipart with a multiple-choice part and a short-answer part'),
      async () => null,
      fonts,
    )
    const page = await (await getDocument({ data: bytes }).promise).getPage(1)
    const items = (await page.getTextContent()).items as { str: string; transform: number[] }[]
    const baseline = (text: string) => items.find((item) => item.str.includes(text))!.transform[5]!
    const line = pointsOf('body') * BODY_LINE_HEIGHT
    expect(baseline('Competition') - baseline('Development')).toBeCloseTo(line + pointsOf('body') * LIST_ITEM_GAP_EM, 1)
    expect(baseline('Several other factors') - baseline('Competition')).toBeCloseTo(line + pointsOf('body') * PARAGRAPH_GAP_EM, 1)
  })
})
