import fontkit from '@pdf-lib/fontkit'
import {
  AFRelationship,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type PDFRef,
  type RGB,
} from 'pdf-lib'
import {
  QUESTION_BANK_ATTACHMENT_DESCRIPTION,
  QUESTION_BANK_FORMAT_VERSION,
  RECORD_PART_TYPE_LABELS,
  RECORD_TYPE_LABELS,
  SUPPORTED_BLANK_NODE_TYPE,
  holdsSubparts,
  partLetter,
  recordBlankAnswers,
  wordBankLettersOf,
  type PreparedQuestionBankExport,
  type QuestionBankRecordPart,
  type QuestionBankRecordQuestion,
  type SemanticDocument,
  type SemanticNode,
} from './question-bank-export'
import {
  IMPORT_URL,
  NO_TOPIC_LABEL,
  questionBankFileOutline,
  sectionKey,
  topicKey,
  type QuestionBankFileOutline,
} from './question-bank-file-outline'
import { subpartLabelAt } from './export-plan'
import { BLANK_LINE } from './blank'
import { PACKAGE_FORMAT, PACKAGE_FORMAT_VERSION, type TestParrotPackage } from './package-import'
import {
  PACKAGE_ZIP_ATTACHMENT_NAME,
  PACKAGE_ZIP_MIME_TYPE,
  writePackageZip,
} from './package-zip'
import { topicTint } from './topic-tint'
import { mathPieces, type TypesetMath } from './pdf-math'
import { MATH_SIZE, drawTypesetMath, mathTypesetter, type MathTypesetter } from './pdf-math-draw'

/** Whether any Question holds an equation, so MathJax loads only for one. */
const holdsMath = (questions: readonly QuestionBankRecordQuestion[]) =>
  /"type":"(?:inline|display)-math"/.test(JSON.stringify(questions))

export type QuestionBankPdfFontStyle =
  'regular' | 'bold' | 'italic' | 'boldItalic' | 'mono'
export type QuestionBankPdfFontLoader = (
  style: QuestionBankPdfFontStyle,
) => Promise<ArrayBuffer | Uint8Array>

export const browserQuestionBankPdfFonts: QuestionBankPdfFontLoader = async (
  style,
) => {
  // Sans, as the app is: a Question Bank File is Test Parrot's own document,
  // where an Exam's prints and exports are set in serif.
  const files: Record<QuestionBankPdfFontStyle, string> = {
    regular: '/fonts/FreeSans.ttf',
    bold: '/fonts/FreeSansBold.ttf',
    italic: '/fonts/FreeSansOblique.ttf',
    boldItalic: '/fonts/FreeSansBoldOblique.ttf',
    mono: '/fonts/FreeMono.ttf',
  }
  const response = await fetch(files[style])
  if (!response.ok)
    throw new Error(
      `The bundled PDF font (${style}) could not be loaded. Try again.`,
    )
  return response.arrayBuffer()
}

type Fonts = Record<QuestionBankPdfFontStyle, PDFFont>
type Context = {
  document: PDFDocument
  page: PDFPage
  fonts: Fonts
  y: number
  pageNumber: number
  /** Each Media Asset embedded, with the size of the upright picture it shows. */
  images: Map<string, { image: PDFImage; width: number; height: number }>
  /** Test Parrot's logo, for the front matter; drawn without if it would
   *  not load, since nothing about the bank depends on it. */
  logo?: PDFImage
  /** teacher.dev's logo, beside the line saying who makes Test Parrot. */
  teacherDevLogo?: PDFImage
  /** Word widths already measured, by font, size and word: a bank repeats
   *  its words far more often than it has new ones. */
  widths: Map<string, number>
  /** An equation typeset, or null when MathJax cannot typeset it. */
  typeset: MathTypesetter
  /** Where each outline entry starts, for its links and bookmark. */
  destinations: Map<string, { page: PDFPage; y: number }>
  /** Links drawn before the place they point to exists. */
  internalLinks: { annotation: PDFDict; key: string }[]
}

type Piece = {
  text: string
  font: QuestionBankPdfFontStyle
  size: number
  href?: string
  rise?: number
  strike?: boolean
  color?: RGB
  /** The source of an inline equation, typeset where it is laid out. */
  math?: string
}

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 54
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const BODY_SIZE = 10.5
/** A picture's pixels as points, as print and the Exam PDF measure them. */
const POINTS_PER_PX = 0.75
const BODY_LINE = 15
const INK = rgb(0.18, 0.15, 0.13)
const MUTED = rgb(0.38, 0.34, 0.3)
const RULE = rgb(0.72, 0.68, 0.62)
const LINK = rgb(0.08, 0.3, 0.7)
// Test Parrot's own paper colours (styles.css), so the file reads as ours.
const ACCENT = rgb(0x9f / 255, 0x50 / 255, 0x37 / 255)
const ACCENT_WASH = rgb(0xf4 / 255, 0xe0 / 255, 0xcf / 255)
const PAPER_LINE = rgb(0xe0 / 255, 0xd3 / 255, 0xc2 / 255)
const hex = (value: string) =>
  rgb(parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255)
/** The six Topic tints (styles.css `--tint-N-*`): ink, wash, line. */
const TINTS = [
  ['#9f5037', '#f4e0cf', '#ecd0bb'],
  ['#4b6b52', '#e6efe4', '#cfe0cd'],
  ['#4a627f', '#e4ecf5', '#cbdaea'],
  ['#7a4a6b', '#f2e4ee', '#e3cdda'],
  ['#866321', '#f6ecd4', '#e9d9af'],
  ['#3d6a68', '#e0efed', '#c6e0dd'],
].map(([ink, wash, line]) => ({ ink: hex(ink!), wash: hex(wash!), line: hex(line!) }))
const NO_TOPIC_TINT = { ink: MUTED, wash: rgb(0.96, 0.94, 0.91), line: PAPER_LINE }
const BRAND_LINE = 'Test Parrot · Question Bank File'

function addPage(context: Context): void {
  context.page = context.document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  context.pageNumber += 1
  context.y = PAGE_HEIGHT - MARGIN
  drawFooter(context)
}

function drawFooter(context: Context): void {
  const footer = `Page ${context.pageNumber}`
  const width = measure(context, 'regular', footer, 8)
  context.page.drawText(footer, {
    x: PAGE_WIDTH - MARGIN - width,
    y: 28,
    font: context.fonts.regular,
    size: 8,
    color: MUTED,
  })
  context.page.drawText(BRAND_LINE, { x: MARGIN, y: 28, font: context.fonts.regular, size: 8, color: MUTED })
}

function ensure(context: Context, height: number): void {
  if (context.y - height < MARGIN) addPage(context)
}

function measure(context: Context, font: QuestionBankPdfFontStyle, text: string, size: number): number {
  const key = `${font}\u0000${size}\u0000${text}`
  let width = context.widths.get(key)
  if (width === undefined) {
    width = context.fonts[font].widthOfTextAtSize(text, size)
    context.widths.set(key, width)
  }
  return width
}

/**
 * Let a font encode a line from the words in it. pdf-lib lays out every line
 * it draws with the whole font machinery, which was most of a large bank's
 * drawing time; a line's glyphs are its words' glyphs one after another, so
 * each word is laid out once, the first time, and reused. That first time
 * still goes through pdf-lib, which is what adds the glyph to the subset.
 */
function encodeByWord(font: PDFFont): void {
  const encode = font.encodeText.bind(font)
  const encoded = new Map<string, string>()
  font.encodeText = (text: string) => {
    let hexCodes = ''
    for (const word of text.split(/(\s+)/)) {
      if (!word) continue
      let codes = encoded.get(word)
      if (codes === undefined) {
        codes = encode(word).asString()
        encoded.set(word, codes)
      }
      hexCodes += codes
    }
    return PDFHexString.of(hexCodes)
  }
}

function splitWords(text: string): string[] {
  return text.split(/(\s+|\n)/).filter(Boolean)
}

function annotate(context: Context, fields: Record<string, unknown>, x: number, y: number, width: number, height: number): PDFDict {
  const annotation = context.document.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    ...fields,
  })
  const reference = context.document.context.register(annotation)
  let annotations = context.page.node.lookupMaybe(
    PDFName.of('Annots'),
    PDFArray,
  )
  if (!annotations) {
    annotations = context.document.context.obj([])
    context.page.node.set(PDFName.of('Annots'), annotations)
  }
  annotations.push(reference)
  return annotation
}

function addLink(
  context: Context,
  href: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  annotate(context, { A: { Type: 'Action', S: 'URI', URI: PDFString.of(href) } }, x, y, width, height)
}

/** A link to an outline entry, pointed at it once the whole file is drawn. */
function addInternalLink(context: Context, key: string, x: number, y: number, width: number, height: number): void {
  context.internalLinks.push({ annotation: annotate(context, {}, x, y, width, height), key })
}

/** Remember that an outline entry starts here, at the top of what is drawn next. */
function markDestination(context: Context, key: string): void {
  context.destinations.set(key, { page: context.page, y: context.y + 6 })
}

/** One line of laid-out text: runs of one style each, placed from its left,
 *  and each equation a run of its own, typeset. */
type LaidOutLine = { runs: { text: string; x: number; width: number; piece: Piece; typeset?: TypesetMath }[] }

/** An equation MathJax cannot typeset, written on the line as the Exam PDF
 *  writes one: scripts raised and lowered, symbols as themselves. */
function writtenMath(piece: Piece): Piece[] {
  return mathPieces(piece.math!).map((written) => ({
    text: written.text,
    font: 'regular',
    size: piece.size * written.scale,
    rise: piece.size * written.rise,
  }))
}

/**
 * Break pieces into lines no wider than `maxWidth`, joining the words of one
 * piece on one line into a single run. A run is one text operation in the
 * file, where a word each made a large bank's PDF slow to draw and heavy.
 */
function layoutPieces(context: Context, pieces: readonly Piece[], maxWidth: number): LaidOutLine[] {
  const lines: LaidOutLine[] = [{ runs: [] }]
  let x = 0
  const newLine = () => {
    lines.push({ runs: [] })
    x = 0
  }
  for (const outer of pieces) {
    const typeset = outer.math !== undefined ? context.typeset(outer.math, false) : null
    if (typeset) {
      const width = typeset.width * outer.size * MATH_SIZE
      if (x > 0 && x + width > maxWidth) newLine()
      lines[lines.length - 1]!.runs.push({ text: outer.math!, x, width, piece: outer, typeset })
      x += width
      continue
    }
    for (const piece of outer.math !== undefined ? writtenMath(outer) : [outer])
    for (const token of splitWords(piece.text)) {
      if (token === '\n') {
        newLine()
        continue
      }
      const width = measure(context, piece.font, token, piece.size)
      if (x > 0 && x + width > maxWidth && token.trim()) newLine()
      if (x === 0 && /^\s+$/.test(token)) continue
      const runs = lines[lines.length - 1]!.runs
      const last = runs[runs.length - 1]
      if (last && last.piece === piece) {
        last.text += token
        last.width += width
      } else {
        runs.push({ text: token, x, width, piece })
      }
      x += width
    }
  }
  return lines
}

function drawPieces(
  context: Context,
  pieces: readonly Piece[],
  options: { x?: number; width?: number; line?: number; centred?: boolean } = {},
): void {
  const x0 = options.x ?? MARGIN
  const line = options.line ?? BODY_LINE
  const maxWidth = options.width ?? CONTENT_WIDTH
  for (const laidOut of layoutPieces(context, pieces, maxWidth)) {
    // A Centred paragraph's line stands in the middle of its column, by what
    // it shows: a space it ends on is not part of it.
    const end = Math.max(0, ...laidOut.runs.map((run) => run.typeset
      ? run.x + run.width
      : run.x + measure(context, run.piece.font, run.text.trimEnd(), run.piece.size)))
    const shift = options.centred ? Math.max(0, (maxWidth - end) / 2) : 0
    // A line is as tall as its tallest equation needs: a stacked fraction
    // pushes the lines around it apart rather than over them.
    const textSize = Math.max(0, ...laidOut.runs.filter((run) => !run.typeset).map((run) => run.piece.size))
    let ascent = textSize
    let below = line - textSize
    for (const run of laidOut.runs) {
      if (!run.typeset) continue
      const scale = run.piece.size * MATH_SIZE
      ascent = Math.max(ascent, run.typeset.ascent * scale)
      below = Math.max(below, run.typeset.descent * scale + 2)
    }
    const height = Math.max(line, ascent + below)
    ensure(context, height)
    for (const run of laidOut.runs) {
      const { piece } = run
      const x = x0 + shift + run.x
      if (run.typeset) {
        drawTypesetMath(context.page, context.fonts.regular, run.typeset, run.text, x, context.y - ascent, piece.size, { ink: INK })
        continue
      }
      const y = context.y - (ascent - textSize) - piece.size + (piece.rise ?? 0)
      context.page.drawText(run.text, {
        x,
        y,
        font: context.fonts[piece.font],
        size: piece.size,
        color: piece.color ?? (piece.href ? LINK : INK),
      })
      if (piece.href) addLink(context, piece.href, x, y, run.width, piece.size + 2)
      if (piece.strike)
        context.page.drawLine({
          start: { x, y: y + piece.size * 0.45 },
          end: { x: x + run.width, y: y + piece.size * 0.45 },
          thickness: 0.6,
          color: INK,
        })
    }
    context.y -= height
  }
}

function drawText(
  context: Context,
  value: string,
  options: Partial<Piece> & { x?: number; width?: number; line?: number; centred?: boolean } = {},
): void {
  drawPieces(
    context,
    [
      {
        text: value,
        font: options.font ?? 'regular',
        size: options.size ?? BODY_SIZE,
        href: options.href,
        rise: options.rise,
        strike: options.strike,
        color: options.color,
      },
    ],
    options,
  )
}

function inlinePieces(nodes: readonly SemanticNode[]): Piece[] {
  const pieces: Piece[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      let bold = false
      let italic = false
      let font: QuestionBankPdfFontStyle = 'regular'
      let size = BODY_SIZE
      let rise = 0
      let href: string | undefined
      let strike = false
      for (const mark of node.marks ?? []) {
        if (mark.type === 'strong') bold = true
        if (mark.type === 'emphasis') italic = true
        if (mark.type === 'inline-code') font = 'mono'
        if (mark.type === 'subscript') {
          size *= 0.75
          rise = -2
        }
        if (mark.type === 'superscript') {
          size *= 0.75
          rise = 4
        }
        if (mark.type === 'strike') strike = true
        if (mark.type === 'link') href = mark.href
      }
      if (font !== 'mono')
        font =
          bold && italic
            ? 'boldItalic'
            : bold
              ? 'bold'
              : italic
                ? 'italic'
                : 'regular'
      pieces.push({ text: node.text ?? '', font, size, rise, href, strike })
    } else if (node.type === 'hard-break') {
      pieces.push({ text: '\n', font: 'regular', size: BODY_SIZE })
    } else if (node.type === 'inline-math') {
      pieces.push({ text: node.source ?? '', font: 'italic', size: BODY_SIZE, math: node.source ?? '' })
    } else if (node.type === SUPPORTED_BLANK_NODE_TYPE) {
      // A Blank prints its line; its answer prints under Answers.
      pieces.push({ text: BLANK_LINE, font: 'regular', size: BODY_SIZE })
    } else if (node.content) {
      pieces.push(...inlinePieces(node.content))
    }
  }
  return pieces
}

const PICTURE_NEEDED_HEIGHT = 54

/** A Pending Image's place in the preview: a bordered box saying which
 *  picture belongs there, so a teacher reading the file sees the hole. */
function drawPictureNeeded(context: Context, node: SemanticNode, x: number, width: number): void {
  const pending = node.pending!
  const boxWidth = Math.min(width, width * (node.authoredSize ?? 1), 260)
  ensure(context, PICTURE_NEEDED_HEIGHT + (node.caption ? BODY_LINE : 0) + 8)
  const top = context.y
  context.page.drawRectangle({
    x,
    y: top - PICTURE_NEEDED_HEIGHT,
    width: boxWidth,
    height: PICTURE_NEEDED_HEIGHT,
    borderColor: MUTED,
    borderWidth: 1,
    borderDashArray: [4, 3],
  })
  const label = 'Picture needed'
  const named = 'image' in pending ? `IMG ${pending.image}` : `page ${pending.page}`
  const labelWidth = context.fonts.bold.widthOfTextAtSize(label, BODY_SIZE)
  const namedWidth = context.fonts.regular.widthOfTextAtSize(named, 9)
  context.page.drawText(label, {
    x: x + (boxWidth - labelWidth) / 2,
    y: top - PICTURE_NEEDED_HEIGHT / 2 + 2,
    size: BODY_SIZE,
    font: context.fonts.bold,
    color: INK,
  })
  context.page.drawText(named, {
    x: x + (boxWidth - namedWidth) / 2,
    y: top - PICTURE_NEEDED_HEIGHT / 2 - 11,
    size: 9,
    font: context.fonts.regular,
    color: MUTED,
  })
  context.y -= PICTURE_NEEDED_HEIGHT + 4
  if (node.caption) drawText(context, node.caption, { x, width: boxWidth, font: 'italic', size: 9 })
  context.y -= 4
}

function drawImage(context: Context, node: SemanticNode, x: number, width: number): void {
  if (node.pending) {
    drawPictureNeeded(context, node, x, width)
    return
  }
  const embedded = node.asset ? context.images.get(node.asset) : undefined
  if (!embedded) throw new Error(`Required Media Asset “${node.asset ?? 'missing'}” is unavailable for the PDF preview.`)
  // A Picture Crop shows only the part it keeps: the whole picture is drawn
  // behind a clip the kept part's size. The bank's own record carries every
  // Media Asset whole, so nothing the clip hides is kept from this file.
  const crop = node.crop ?? { left: 0, top: 0, right: 1, bottom: 1 }
  const keptWidth = crop.right - crop.left
  const keptHeight = crop.bottom - crop.top
  // A sized picture is its share of the column; one no one sized fits at its
  // own width, or the column's when that is narrower, as the editor shows it.
  const { image } = embedded
  const naturalWidth = embedded.width * keptWidth * POINTS_PER_PX
  const targetWidth = node.authoredSize !== undefined
    ? width * node.authoredSize
    : Math.min(naturalWidth, width)
  const targetHeight = targetWidth * (embedded.height * keptHeight) / (embedded.width * keptWidth)
  ensure(context, targetHeight + (node.caption ? BODY_LINE : 0))
  const wholeWidth = targetWidth / keptWidth
  const wholeHeight = targetHeight / keptHeight
  const top = context.y
  // A Centred picture stands in the middle of its column, its caption under it.
  if (node.align === 'center') x += Math.max(0, (width - targetWidth) / 2)
  context.page.pushOperators(pushGraphicsState(), rectangle(x, top - targetHeight, targetWidth, targetHeight), clip(), endPath())
  context.page.drawImage(image, {
    x: x - crop.left * wholeWidth,
    y: top + crop.top * wholeHeight - wholeHeight,
    width: wholeWidth,
    height: wholeHeight,
  })
  context.page.pushOperators(popGraphicsState())
  context.y -= targetHeight + 4
  if (node.caption) {
    drawText(context, node.caption, { x, width: targetWidth, font: 'italic', size: 9, centred: node.align === 'center' })
  }
  context.y -= 4
}

/** An equation set on its own, centred in its column, as print sets it. */
function drawDisplayMath(context: Context, source: string, x: number, width: number): void {
  const typeset = context.typeset(source, true)
  if (!typeset) {
    drawPieces(context, writtenMath({ text: source, font: 'regular', size: BODY_SIZE, math: source }), { x: x + 18, width: width - 36 })
    context.y -= 4
    return
  }
  const size = BODY_SIZE * MATH_SIZE
  const gap = BODY_SIZE / 2
  const height = gap + (typeset.ascent + typeset.descent) * size + gap
  ensure(context, height)
  const left = x + Math.max(0, (width - typeset.width * size) / 2)
  drawTypesetMath(context.page, context.fonts.regular, typeset, source, left, context.y - gap - typeset.ascent * size, BODY_SIZE, { ink: INK })
  context.y -= height
}

function drawBlocks(
  context: Context,
  nodes: readonly SemanticNode[],
  options: { x?: number; width?: number; listLevel?: number } = {},
): void {
  const x = options.x ?? MARGIN
  const width = options.width ?? CONTENT_WIDTH
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
        drawPieces(context, inlinePieces(node.content ?? []), { x, width, centred: node.align === 'center' })
        context.y -= 3
        break
      case 'heading':
        drawPieces(context, inlinePieces(node.content ?? []), {
          x,
          width,
          line: 20,
        })
        context.y -= 4
        break
      case 'blockquote':
        drawBlocks(context, node.content ?? [], {
          x: x + 18,
          width: width - 18,
        })
        break
      case 'bullet-list':
      case 'ordered-list': {
        let ordinal = node.start ?? 1
        for (const item of node.content ?? []) {
          drawText(
            context,
            node.type === 'bullet-list' ? '•' : `${ordinal++}.`,
            { x, width: 20 },
          )
          context.y += BODY_LINE
          drawBlocks(context, item.content ?? [], {
            x: x + 20,
            width: width - 20,
          })
        }
        break
      }
      case 'list-item':
        drawBlocks(context, node.content ?? [], { x, width })
        break
      case 'code-block':
        drawText(context, node.text ?? '', { x, width, font: 'mono' })
        context.y -= 4
        break
      case 'display-math':
        drawDisplayMath(context, node.source ?? '', x, width)
        break
      case 'rule':
        ensure(context, 14)
        context.page.drawLine({
          start: { x, y: context.y - 5 },
          end: { x: x + width, y: context.y - 5 },
          color: RULE,
        })
        context.y -= 14
        break
      case 'table':
        drawTable(context, node, x, width)
        break
      case 'inline-image':
      case 'block-image':
        break
      default:
        drawBlocks(context, node.content ?? [], { x, width })
    }
  }
}

function drawTable(
  context: Context,
  table: SemanticNode,
  x: number,
  width: number,
): void {
  const rows = table.content ?? []
  const columns = Math.max(1, ...rows.map((row) => row.content?.length ?? 0))
  for (const row of rows) {
    const cells = row.content ?? []
    const cellText = cells.map((cell) =>
      inlinePieces(cell.content ?? [])
        .map((piece) => piece.text)
        .join(''),
    )
    const requiredLines = Math.max(
      1,
      ...cellText.map((value) =>
        Math.ceil(value.length / Math.max(12, Math.floor(width / columns / 6))),
      ),
    )
    const height = requiredLines * BODY_LINE + 8
    ensure(context, height)
    const top = context.y
    cells.forEach((cell, column) => {
      const cellWidth = width / columns
      context.page.drawRectangle({
        x: x + column * cellWidth,
        y: top - height,
        width: cellWidth,
        height,
        borderColor: RULE,
        borderWidth: 0.6,
      })
      const copy = { ...context, y: top - 4 }
      const paragraphs = (cell.content ?? []).filter((block) => block.type === 'paragraph')
      drawPieces(copy, inlinePieces(cell.content ?? []), {
        x: x + column * cellWidth + 4,
        width: cellWidth - 8,
        // A cell's text is drawn as one run; it is centred when its
        // paragraphs are.
        centred: paragraphs.length > 0 && paragraphs.every((block) => block.align === 'center'),
      })
    })
    context.y -= height
  }
  context.y -= 5
}

function imagesIn(nodes: readonly SemanticNode[]): SemanticNode[] {
  return nodes.flatMap((node) => [
    ...(node.type === 'inline-image' || node.type === 'block-image' ? [node] : []),
    ...imagesIn(node.content ?? []),
  ])
}

function drawDocument(context: Context, document: SemanticDocument): void {
  drawBlocks(context, document.content)
  for (const image of imagesIn(document.content)) {
    drawImage(context, image, MARGIN, CONTENT_WIDTH)
  }
}

/** Lettered choices, the correct one called out, indented by `indent` past
 *  the margin — a Question's under its stem, a Part's under the Part's. */
function drawChoices(
  context: Context,
  choices: NonNullable<QuestionBankRecordQuestion['choices']>,
  indent: number,
): void {
  choices.forEach((choice, choiceIndex) => {
    drawPieces(
      context,
      [
        {
          text: `${String.fromCharCode(65 + choiceIndex)}. `,
          font: 'bold',
          size: BODY_SIZE,
        },
        ...inlinePieces(choice.content.content),
        ...(choice.correct
          ? [
              {
                text: '  (Correct answer)',
                font: 'bold' as const,
                size: BODY_SIZE,
              },
            ]
          : []),
      ],
      { x: MARGIN + indent, width: CONTENT_WIDTH - indent },
    )
    for (const image of imagesIn(choice.content.content)) {
      drawImage(context, image, MARGIN + indent, CONTENT_WIDTH - indent)
    }
  })
}

/** A document's blocks and then its images, indented by `indent`. */
function drawIndentedDocument(
  context: Context,
  document: SemanticDocument,
  indent: number,
): void {
  drawBlocks(context, document.content, { x: MARGIN + indent, width: CONTENT_WIDTH - indent })
  for (const image of imagesIn(document.content)) {
    drawImage(context, image, MARGIN + indent, CONTENT_WIDTH - indent)
  }
}

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`

/** `text`, shortened with an ellipsis until it fits `width`. */
function fitted(context: Context, font: QuestionBankPdfFontStyle, text: string, size: number, width: number): string {
  if (measure(context, font, text, size) <= width) return text
  let kept = text
  while (kept.length > 1 && measure(context, font, `${kept}…`, size) > width) kept = kept.slice(0, -1)
  return `${kept.trimEnd()}…`
}

/** A rounded, pill-shaped box, its top-left corner at (x, top). */
function drawPill(context: Context, x: number, top: number, width: number, height: number, tint: { wash: RGB; line: RGB }): void {
  const radius = height / 2
  context.page.drawSvgPath(
    `M ${radius} 0 L ${width - radius} 0 A ${radius} ${radius} 0 0 1 ${width - radius} ${height} L ${radius} ${height} A ${radius} ${radius} 0 0 1 ${radius} 0 Z`,
    { x, y: top, color: tint.wash, borderColor: tint.line, borderWidth: 0.75 },
  )
}

const BUBBLE_HEIGHT = 17
const BUBBLE_GAP = 6
const BUBBLE_PADDING = 8
const BUBBLE_SIZE = 9

/** A Question Type's Topics as bubbles, each with its count and linked to
 *  where that Topic's Questions start within the type. */
function drawBubbles(context: Context, section: QuestionBankFileOutline['sections'][number], x0: number, maxWidth: number): void {
  let x = x0
  ensure(context, BUBBLE_HEIGHT + BUBBLE_GAP)
  for (const group of section.groups) {
    const count = String(group.questions.length)
    const countWidth = measure(context, 'bold', count, BUBBLE_SIZE)
    const label = fitted(
      context,
      'regular',
      group.topic ?? NO_TOPIC_LABEL,
      BUBBLE_SIZE,
      maxWidth - BUBBLE_PADDING * 2 - 5 - countWidth,
    )
    const labelWidth = measure(context, 'regular', label, BUBBLE_SIZE)
    const width = BUBBLE_PADDING * 2 + labelWidth + 5 + countWidth
    if (x > x0 && x + width > x0 + maxWidth) {
      context.y -= BUBBLE_HEIGHT + BUBBLE_GAP
      x = x0
      ensure(context, BUBBLE_HEIGHT + BUBBLE_GAP)
    }
    const tint = group.topic === null ? NO_TOPIC_TINT : TINTS[topicTint(group.topic)]!
    const bottom = context.y - BUBBLE_HEIGHT
    drawPill(context, x, context.y, width, BUBBLE_HEIGHT, tint)
    context.page.drawText(label, { x: x + BUBBLE_PADDING, y: bottom + 5.2, size: BUBBLE_SIZE, font: context.fonts.regular, color: tint.ink })
    context.page.drawText(count, {
      x: x + BUBBLE_PADDING + labelWidth + 5,
      y: bottom + 5.2,
      size: BUBBLE_SIZE,
      font: context.fonts.bold,
      color: tint.ink,
    })
    addInternalLink(context, topicKey(section.type, group.topic), x, bottom, width, BUBBLE_HEIGHT)
    x += width + BUBBLE_GAP
  }
  context.y -= BUBBLE_HEIGHT + BUBBLE_GAP
}

const hasTopics = (section: QuestionBankFileOutline['sections'][number]) =>
  section.groups.some((group) => group.topic !== null)

const NOTICE_TITLE = 'A digital file for importing into Test Parrot'
const NOTICE =
  'It holds the whole Question Bank, answers included. Import works only from this original file: '
  + 'printing it, scanning it, or saving it again as a PDF removes the data Test Parrot reads.'

/** What a teacher opening the file sees first: whose bank it is, what it is
 *  for, and an outline of everything in it, every entry a link. */
function drawFrontMatter(context: Context, prepared: PreparedQuestionBankExport, outline: QuestionBankFileOutline): void {
  const { bank } = prepared.record
  context.page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 12, width: PAGE_WIDTH, height: 12, color: ACCENT })
  if (context.logo) {
    context.page.drawImage(context.logo, { x: MARGIN, y: context.y - 26, width: 28, height: 28 })
    context.page.drawText('TEST PARROT  ·  QUESTION BANK FILE', {
      x: MARGIN + 36,
      y: context.y - 16,
      size: 9,
      font: context.fonts.bold,
      color: ACCENT,
    })
    context.y -= 38
  } else {
    drawText(context, 'TEST PARROT  ·  QUESTION BANK FILE', { font: 'bold', size: 9, color: ACCENT, line: 18 })
  }
  drawText(context, bank.name || 'Untitled Question Bank', { font: 'bold', size: 24, line: 30 })
  context.y -= 2
  if (bank.author) {
    drawPieces(context, [
      { text: 'Declared author (unverified): ', font: 'bold', size: BODY_SIZE },
      { text: bank.author, font: 'regular', size: BODY_SIZE },
    ])
  }
  if (bank.license) {
    drawPieces(context, [
      { text: 'License: ', font: 'bold', size: BODY_SIZE },
      { text: bank.license.name, font: 'regular', size: BODY_SIZE },
      ...(bank.license.url ? [{ text: ` — ${bank.license.url}`, font: 'regular' as const, size: BODY_SIZE, href: bank.license.url }] : []),
    ])
  }
  if (bank.description) {
    context.y -= 4
    drawText(context, bank.description)
  }
  context.y -= 6
  const { difficulties } = outline
  const counts = [
    plural(bank.questions.length, 'Question'),
    ...(difficulties.easy ? [`${difficulties.easy} Easy`] : []),
    ...(difficulties.medium ? [`${difficulties.medium} Medium`] : []),
    ...(difficulties.hard ? [`${difficulties.hard} Hard`] : []),
    ...(difficulties.unrated && difficulties.unrated < bank.questions.length ? [`${difficulties.unrated} without a Difficulty`] : []),
  ]
  drawText(context, counts.join('  ·  '), { font: 'bold', size: 12, line: 18 })
  context.y -= 10

  // The notice sits in a tinted box with Test Parrot's accent down its side.
  const inset = 16
  const body = layoutPieces(context, [{ text: NOTICE, font: 'regular', size: 10 }], CONTENT_WIDTH - inset * 2)
  const height = 12 + 17 + body.length * 14 + 8
  ensure(context, height)
  const top = context.y
  context.page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT_WIDTH, height, color: ACCENT_WASH })
  context.page.drawRectangle({ x: MARGIN, y: top - height, width: 4, height, color: ACCENT })
  context.y -= 12
  drawText(context, NOTICE_TITLE, { x: MARGIN + inset, width: CONTENT_WIDTH - inset * 2, font: 'bold', size: 11, line: 17, href: IMPORT_URL })
  drawText(context, NOTICE, { x: MARGIN + inset, width: CONTENT_WIDTH - inset * 2, size: 10, line: 14 })
  context.y = top - height - 22

  drawText(context, 'Question Types', { font: 'bold', size: 15, line: 20 })
  drawText(
    context,
    outline.sections.some(hasTopics)
      ? 'Choose a type, or one of its Topics, to go straight to it.'
      : 'Choose a type to go straight to it.',
    { size: 9.5, color: MUTED, line: 16 },
  )
  context.y -= 4
  for (const section of outline.sections) {
    ensure(context, 22 + (hasTopics(section) ? BUBBLE_HEIGHT + BUBBLE_GAP : 0))
    const label = RECORD_TYPE_LABELS[section.type]
    const count = String(section.count)
    const baseline = context.y - 12
    const labelWidth = measure(context, 'bold', label, 12)
    const countWidth = measure(context, 'bold', count, 12)
    context.page.drawText(label, { x: MARGIN, y: baseline, size: 12, font: context.fonts.bold, color: INK })
    context.page.drawText(count, { x: MARGIN + CONTENT_WIDTH - countWidth, y: baseline, size: 12, font: context.fonts.bold, color: INK })
    // A dotted leader carries the eye from the type to its count.
    context.page.drawLine({
      start: { x: MARGIN + labelWidth + 8, y: baseline + 2 },
      end: { x: MARGIN + CONTENT_WIDTH - countWidth - 8, y: baseline + 2 },
      thickness: 0.8,
      color: RULE,
      dashArray: [1, 3],
    })
    addInternalLink(context, sectionKey(section.type), MARGIN, baseline - 4, CONTENT_WIDTH, 18)
    context.y -= 22
    if (hasTopics(section)) drawBubbles(context, section, MARGIN + 14, CONTENT_WIDTH - 14)
    context.y -= 6
  }
  drawCredit(context)
}

const TEACHER_DEV_URL = 'https://teacher.dev'

/** Who makes Test Parrot, closing the front matter. */
function drawCredit(context: Context): void {
  context.y -= 14
  ensure(context, 30)
  context.page.drawLine({
    start: { x: MARGIN, y: context.y },
    end: { x: MARGIN + CONTENT_WIDTH, y: context.y },
    thickness: 0.6,
    color: PAPER_LINE,
  })
  context.y -= 12
  const size = 16
  const x = MARGIN + (context.teacherDevLogo ? size + 8 : 0)
  if (context.teacherDevLogo) {
    context.page.drawImage(context.teacherDevLogo, { x: MARGIN, y: context.y - size + 2, width: size, height: size })
    addLink(context, TEACHER_DEV_URL, MARGIN, context.y - size + 2, size, size)
  }
  drawPieces(
    context,
    [
      { text: 'Test Parrot is a free exam builder by ', font: 'regular', size: 9.5, color: MUTED },
      { text: 'teacher.dev', font: 'bold', size: 9.5, href: TEACHER_DEV_URL },
      { text: '.', font: 'regular', size: 9.5, color: MUTED },
    ],
    { x, width: CONTENT_WIDTH - (x - MARGIN), line: 14 },
  )
}

/** Each Question Type starts a page, headed by its name, its count, and its
 *  Topics again, so a teacher who has jumped here can jump on. */
function drawSectionHeading(context: Context, section: QuestionBankFileOutline['sections'][number]): void {
  addPage(context)
  markDestination(context, sectionKey(section.type))
  context.page.drawRectangle({ x: MARGIN, y: context.y - 38, width: 4, height: 38, color: ACCENT })
  drawText(context, RECORD_TYPE_LABELS[section.type], { x: MARGIN + 14, font: 'bold', size: 20, line: 25 })
  drawText(context, plural(section.count, 'Question'), { x: MARGIN + 14, size: 10, color: MUTED, line: 14 })
  context.y -= 10
  if (hasTopics(section)) {
    drawBubbles(context, section, MARGIN, CONTENT_WIDTH)
    context.y -= 4
  }
}

function drawTopicHeading(
  context: Context,
  section: QuestionBankFileOutline['sections'][number],
  group: QuestionBankFileOutline['sections'][number]['groups'][number],
): void {
  if (!hasTopics(section)) {
    markDestination(context, topicKey(section.type, group.topic))
    return
  }
  ensure(context, 120)
  context.y -= 4
  markDestination(context, topicKey(section.type, group.topic))
  const tint = group.topic === null ? NO_TOPIC_TINT : TINTS[topicTint(group.topic)]!
  drawPill(context, MARGIN, context.y - 3, 10, 10, tint)
  drawPieces(
    context,
    [
      { text: group.topic ?? NO_TOPIC_LABEL, font: 'bold', size: 13, color: tint.ink },
      { text: `   ${plural(group.questions.length, 'Question')}`, font: 'regular', size: 9.5, color: MUTED },
    ],
    { x: MARGIN + 16, width: CONTENT_WIDTH - 16, line: 18 },
  )
  context.page.drawLine({
    start: { x: MARGIN, y: context.y + 3 },
    end: { x: MARGIN + CONTENT_WIDTH, y: context.y + 3 },
    thickness: 0.6,
    color: PAPER_LINE,
  })
  context.y -= 8
}

function drawQuestion(context: Context, question: QuestionBankRecordQuestion, number: number): void {
  ensure(context, 90)
  drawText(context, `Question ${number}`, {
    font: 'bold',
    size: 14,
    line: 19,
  })
  drawPieces(
    context,
    [
      { text: 'Difficulty: ', font: 'bold', size: 9.5, color: MUTED },
      {
        text: question.difficulty
          ? question.difficulty[0]!.toUpperCase() + question.difficulty.slice(1)
          : 'Unspecified',
        font: 'regular',
        size: 9.5,
        color: MUTED,
      },
      { text: '     Topics: ', font: 'bold', size: 9.5, color: MUTED },
      { text: question.topics?.join(', ') || 'None', font: 'regular', size: 9.5, color: MUTED },
    ],
    { line: 14 },
  )
  context.y -= 4
  drawDocument(context, question.stem)
  if (question.choices) drawChoices(context, question.choices, 18)
  if (question.prompts && question.wordBank) {
    // The set as its answer key reads it: each item under the letter it
    // matches, then the lettered Word Bank it was matched against.
    const letters = wordBankLettersOf(question)
    question.prompts.forEach((prompt) => {
      drawPieces(
        context,
        [
          {
            text: `${letters.get(prompt.answer ?? '') ?? '—'}  `,
            font: 'bold',
            size: BODY_SIZE,
          },
          ...inlinePieces(prompt.content.content),
        ],
        { x: MARGIN + 18, width: CONTENT_WIDTH - 18 },
      )
      for (const image of imagesIn(prompt.content.content)) {
        drawImage(context, image, MARGIN + 18, CONTENT_WIDTH - 18)
      }
    })
    context.y -= 3
    drawText(context, 'Word Bank', { font: 'bold', size: 12 })
    question.wordBank.forEach((answer) => {
      drawPieces(
        context,
        [
          { text: `${letters.get(answer.id)!}. `, font: 'bold', size: BODY_SIZE },
          ...inlinePieces(answer.content.content),
        ],
        { x: MARGIN + 18, width: CONTENT_WIDTH - 18 },
      )
      for (const image of imagesIn(answer.content.content)) {
        drawImage(context, image, MARGIN + 18, CONTENT_WIDTH - 18)
      }
    })
  }
  if (question.parts) {
    // The shared material above, then each Part lettered as the test prints it,
    // with its own choices or Suggested Answer beneath it.
    if (question.parts.length === 0) {
      drawText(context, 'No Parts yet.', { font: 'italic' })
    }
    // A Part that holds Subparts prints its lead-in, then each Subpart
    // numbered beneath it and one level further in, drawn as a Part is.
    const drawPart = (
      label: string,
      part: QuestionBankRecordPart,
      indent: number,
    ) => {
      context.y -= 3
      drawPieces(
        context,
        [
          { text: `${label}. `, font: 'bold', size: BODY_SIZE },
          {
            text: holdsSubparts(part) ? 'Subparts' : RECORD_PART_TYPE_LABELS[part.type],
            font: 'italic',
            size: BODY_SIZE,
          },
        ],
        { x: MARGIN + indent, width: CONTENT_WIDTH - indent },
      )
      drawIndentedDocument(context, part.stem, indent + 18)
      if (holdsSubparts(part)) {
        part.subparts.forEach((subpart, subpartIndex) =>
          drawPart(subpartLabelAt(subpartIndex), subpart, indent + 18))
        return
      }
      if (part.choices) drawChoices(context, part.choices, indent + 18)
      if (part.suggestedAnswer) {
        drawText(context, 'Suggested Answer', {
          x: MARGIN + indent + 18,
          width: CONTENT_WIDTH - indent - 18,
          font: 'bold',
        })
        drawIndentedDocument(context, part.suggestedAnswer, indent + 18)
      }
    }
    question.parts.forEach((part, partIndex) => drawPart(partLetter(partIndex), part, 18))
  }
  if (question.suggestedAnswer) {
    context.y -= 3
    drawText(context, 'Suggested Answer', { font: 'bold', size: 12 })
    drawDocument(context, question.suggestedAnswer)
  }
  const blankAnswers = question.type === 'fill-in-the-blank' ? recordBlankAnswers(question.stem) : null
  if (blankAnswers) {
    context.y -= 3
    drawText(context, 'Answers', { font: 'bold', size: 12 })
    drawDocument(context, blankAnswers)
  }
  context.y -= 14
}

function destinationOf(context: Context, key: string) {
  const destination = context.destinations.get(key)
  return destination
    ? context.document.context.obj([destination.page.ref, 'XYZ', null, destination.y, null])
    : undefined
}

type Bookmark = { title: string; key: string; children: Bookmark[] }

/** The same outline as the front matter, in the PDF reader's sidebar. */
function addBookmarks(context: Context, outline: QuestionBankFileOutline): void {
  const pdf = context.document.context
  const bookmarks: Bookmark[] = [
    { title: 'About this Question Bank', key: 'front', children: [] },
    ...outline.sections.map((section) => ({
      title: `${RECORD_TYPE_LABELS[section.type]} (${section.count})`,
      key: sectionKey(section.type),
      children: hasTopics(section)
        ? section.groups.map((group) => ({
            title: `${group.topic ?? NO_TOPIC_LABEL} (${group.questions.length})`,
            key: topicKey(section.type, group.topic),
            children: [],
          }))
        : [],
    })),
  ]
  const write = (items: Bookmark[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = items.map(() => pdf.nextRef())
    let count = 0
    items.forEach((item, index) => {
      const entry: Record<string, unknown> = {
        Title: PDFHexString.fromText(item.title),
        Parent: parent,
        ...(index > 0 ? { Prev: refs[index - 1] } : {}),
        ...(index < refs.length - 1 ? { Next: refs[index + 1] } : {}),
      }
      const destination = destinationOf(context, item.key)
      if (destination) entry.Dest = destination
      count += 1
      if (item.children.length > 0) {
        const children = write(item.children, refs[index]!)
        Object.assign(entry, { First: children.first, Last: children.last, Count: PDFNumber.of(children.count) })
        count += children.count
      }
      pdf.assign(refs[index]!, pdf.obj(entry as never))
    })
    return { first: refs[0]!, last: refs[refs.length - 1]!, count }
  }
  const root = pdf.nextRef()
  const top = write(bookmarks, root)
  pdf.assign(root, pdf.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }))
  context.document.catalog.set(PDFName.of('Outlines'), root)
  context.document.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
}

/** The package a Question Bank File carries: its one bank and no Exams. */
export function questionBankFilePackage(prepared: PreparedQuestionBankExport): TestParrotPackage {
  return {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_FORMAT_VERSION,
    generator: { name: 'Test Parrot', version: QUESTION_BANK_FORMAT_VERSION },
    requiredFeatures: [],
    questionBanks: [{ id: 'bank-1', record: prepared.record }],
    exams: [],
  }
}

/** Test Parrot's logo as the app shows it. */
export const browserQuestionBankLogo = async (): Promise<ArrayBuffer | null> => {
  if (typeof document === 'undefined') return null
  const response = await fetch('/logo.png')
  if (!response.ok) throw new Error('The Test Parrot logo could not be loaded.')
  return response.arrayBuffer()
}

/** teacher.dev's logo, drawn from the app's SVG into a PNG a PDF can hold. */
export const browserTeacherDevLogo = async (): Promise<Uint8Array | null> => {
  if (typeof document === 'undefined') return null
  const image = new Image()
  image.src = '/edtechathon-logo.svg'
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  canvas.getContext('2d')!.drawImage(image, 0, 0, 96, 96)
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!png) throw new Error('The teacher.dev logo could not be drawn.')
  return new Uint8Array(await png.arrayBuffer())
}

export type QuestionBankPdfOptions = {
  /** Test Parrot's logo as PNG bytes. */
  logo?: () => Promise<ArrayBuffer | Uint8Array | null>
  /** teacher.dev's logo as PNG bytes. */
  teacherDevLogo?: () => Promise<ArrayBuffer | Uint8Array | null>
  /** Told how many Questions are drawn so far, so a long bank can show how
   *  far along it is. */
  onProgress?: (drawn: number, total: number) => void
}

// How many Questions are drawn between pauses that let the page repaint.
const QUESTIONS_PER_PAUSE = 40
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function createQuestionBankPdf(
  prepared: PreparedQuestionBankExport,
  fontLoader: QuestionBankPdfFontLoader = browserQuestionBankPdfFonts,
  options: QuestionBankPdfOptions = {},
): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const [regular, bold, italic, boldItalic, mono] = await Promise.all([
    fontLoader('regular'),
    fontLoader('bold'),
    fontLoader('italic'),
    fontLoader('boldItalic'),
    fontLoader('mono'),
  ])
  const fonts: Fonts = {
    regular: await document.embedFont(regular, { subset: true }),
    bold: await document.embedFont(bold, { subset: true }),
    italic: await document.embedFont(italic, { subset: true }),
    boldItalic: await document.embedFont(boldItalic, { subset: true }),
    mono: await document.embedFont(mono, { subset: true }),
  }
  for (const font of Object.values(fonts)) encodeByWord(font)
  const images: Context['images'] = new Map()
  for (const [id, asset] of prepared.previewMedia ?? []) {
    images.set(id, {
      image: asset.type === 'jpg'
        ? await document.embedJpg(asset.data)
        : await document.embedPng(asset.data),
      width: asset.width,
      height: asset.height,
    })
  }
  const context: Context = {
    document,
    page: document.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    fonts,
    y: PAGE_HEIGHT - MARGIN,
    pageNumber: 1,
    images,
    widths: new Map(),
    destinations: new Map(),
    internalLinks: [],
    typeset: await mathTypesetter(holdsMath(prepared.record.bank.questions)),
  }
  // The logos are decoration: a file drawn without one is still complete.
  try {
    const logo = await (options.logo ?? browserQuestionBankLogo)()
    if (logo) context.logo = await document.embedPng(logo)
  } catch (error) {
    console.warn('The Question Bank File will be drawn without the Test Parrot logo', error)
  }
  try {
    const logo = await (options.teacherDevLogo ?? browserTeacherDevLogo)()
    if (logo) context.teacherDevLogo = await document.embedPng(logo)
  } catch (error) {
    console.warn('The Question Bank File will be drawn without the teacher.dev logo', error)
  }
  drawFooter(context)
  document.setTitle(prepared.record.bank.name)
  document.setSubject(
    `Teacher Question Bank containing answers; format ${prepared.record.formatVersion}`,
  )
  document.setCreator('Test Parrot')

  const outline = questionBankFileOutline(prepared.record)
  markDestination(context, 'front')
  drawFrontMatter(context, prepared, outline)
  const total = prepared.record.bank.questions.length
  let drawn = 0
  options.onProgress?.(0, total)
  for (const section of outline.sections) {
    drawSectionHeading(context, section)
    for (const group of section.groups) {
      drawTopicHeading(context, section, group)
      for (const { question, number } of group.questions) {
        drawQuestion(context, question, number)
        drawn += 1
        if (drawn % QUESTIONS_PER_PAUSE === 0) {
          options.onProgress?.(drawn, total)
          await pause()
        }
      }
    }
  }
  options.onProgress?.(total, total)
  for (const { annotation, key } of context.internalLinks) {
    const destination = destinationOf(context, key)
    if (destination) annotation.set(PDFName.of('Dest'), destination)
  }
  addBookmarks(context, outline)

  // Put attachment metadata on the file specification and the MIME type on
  // the embedded stream. pdf-lib also places this one file specification in
  // both the EmbeddedFiles name tree and the catalog AF array.
  const zip = await writePackageZip(JSON.stringify(questionBankFilePackage(prepared)), prepared.files)
  await document.attach(zip, PACKAGE_ZIP_ATTACHMENT_NAME, {
    mimeType: PACKAGE_ZIP_MIME_TYPE,
    description: QUESTION_BANK_ATTACHMENT_DESCRIPTION,
    afRelationship: AFRelationship.Source,
  })
  return document.save({ useObjectStreams: false })
}
