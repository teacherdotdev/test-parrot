// The DOCX Export Adapter.
//
// The second translator from a Layout Plan into a real output format, beside
// the print adapter in `exam-page.tsx`. It accepts prepared plans and nothing
// else: there is no `Exam` or mutable authoring state in this file, so it cannot
// rediscover document semantics or pagination of its own. What a plan says is
// on page three, in what order, under which number and letter, is what that
// page of the Word document says.
//
// An export is the selected canonical documents for one recorded output:
// the student test before its answer key when both are selected. They are
// packaged in exactly the order `export-preparation.ts` prepared them. Nothing
// here reorders them, resolves identity, or decides Content Selection.
//
// The plans' pages are serialized explicitly. Each planned page becomes one
// Word section that starts on a new page and carries the header variant, footer
// number and items the plan assigned it, rather than handing Word a flat stream
// of paragraphs and hoping it repaginates the same way. A standalone document's
// first page is a section like any other, so it starts on a new sheet and its
// footer restarts at the number its own plan gave it.
//
// This module is loaded dynamically by App so the DOCX writer and its ZIP
// machinery do not become part of the application's initial bundle. Image bytes
// are output-specific packaging and are resolved here, through an injected
// `MediaLoader`, so the shared plan can stay format-neutral and testable.

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LeaderType,
  LevelFormat,
  LineRuleType,
  Math as OfficeMath,
  MathRun,
  Packer,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlignTable,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ISectionOptions,
  type ParagraphChild,
  type TabStopDefinition,
} from 'docx'
import { isCentred } from './centring'
import { arrangementRange } from './export-preparation'
import {
  BODY_LINE_HEIGHT,
  bodyHalfPoints,
  bodyPoints,
  EXAM_FONT,
  HEADING_LINE_HEIGHT,
  LIST_ITEM_GAP_EM,
  PARAGRAPH_GAP_EM,
  TABLE_CELL_PADDING_PX,
  TITLE_LINE_HEIGHT,
  halfPointsOf,
  sectionHeadingHalfPoints,
  titleHalfPoints,
} from './export-typography'
import {
  browserMedia,
  loadExportImages,
  missingPicture,
  questionNumberForMedia,
  RequiredMediaError,
  type ExportImage,
  type MediaLoader,
} from './export-media'
import {
  answerKeyPointsText,
  answerKeyTotalText,
  CHOICE_INDENT,
  printedLabel,
  printedNumberOf,
  type PaperTotalItem,
  choiceAreaWidth,
  matchingAreaWidth,
  MATCHING_INDENT,
  questionIndentOf,
  MATCHING_BANK_WIDTH,
  partsOpenNumberLine,
  pointsOnLastRule,
  printsNumberLine,
  subpartsOpenLabelLine,
  PART_INDENT,
  type AnswerKeyEntryItem,
  type AnswerKeySectionItem,
  type ChoiceGrid,
  type IdentityField,
  US_LETTER,
  type LayoutPlan,
  type MatchingSet,
  type PageFurniture,
  type PageItem,
  type PlannedBankAnswer,
  type PlannedPage,
  type PlannedPart,
  type PlannedWorkSpace,
  type QuestionItem,
  rowsOfPlanned,
} from './export-plan'
import { DIFFICULTY_LABELS } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import { BLANK_LINE } from './blank'
import { pictureKey, printedPictureWidth } from './picture-geometry'

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// ---------------------------------------------------------------------------
// Units
//
// The plan is in CSS pixels at 96dpi, the same as the sheet the print adapter
// lays out. Word measures in twips — 1440 to the inch, so exactly 15 to the
// pixel — and images in half-points or pixels depending on where they sit.

const TWIPS_PER_PX = 15

function twips(px: number): number {
  return Math.round(px * TWIPS_PER_PX)
}

/** A table's grid, in twips: the widths its cells are, column by column. Left
 *  out, the writer emits a 100-twip column per cell, and every reader that lays
 *  a table out from its grid rather than its cells squeezes each column to a
 *  sliver — one letter to a line. */
function gridOf(columns: readonly number[]): number[] {
  return columns.map(twips)
}

/** Where the key's answer column starts: past `.answer-key-entry`'s 42px
 *  number column and its 8px gap. */
const ANSWER_KEY_ANSWER_INDENT = twips(42 + 8)

export {
  browserMedia,
  imageSourcesOf,
  isRequiredMediaError,
  RequiredMediaError,
  type ExportImage,
  type MediaLoader,
} from './export-media'

// ---------------------------------------------------------------------------
// Document node helpers

type MutableRunOptions = {
  -readonly [Key in keyof IRunOptions]: IRunOptions[Key]
}

function attrsOf(node: ProseMirrorJSON): Record<string, unknown> {
  return typeof node.attrs === 'object' && node.attrs !== null
    ? (node.attrs as Record<string, unknown>)
    : {}
}

function childrenOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

function stringOf(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

// ---------------------------------------------------------------------------
// Numbering
//
// A list is structural content, not a paragraph with a bullet typed in front of
// it. Every list in the document gets its own numbering instance so an ordered
// list restarts at the number it was authored to start at, and so two lists in
// one question cannot continue each other's count.

const BULLET_GLYPHS = ['•', '◦', '▪', '•', '◦']
const ORDERED_FORMATS = [
  LevelFormat.DECIMAL,
  LevelFormat.LOWER_LETTER,
  LevelFormat.LOWER_ROMAN,
  LevelFormat.DECIMAL,
  LevelFormat.LOWER_LETTER,
]
const LIST_LEVELS = 5

type NumberingConfig = NonNullable<
  ConstructorParameters<typeof Document>[0]['numbering']
>['config']

type MutableNumberingConfig = NumberingConfig[number][]

// Levels are indented like the print view's own nesting: each step in by half an
// inch, with the marker hanging back out of the text block.
function levelsOf(ordered: boolean, start: number) {
  return Array.from({ length: LIST_LEVELS }, (_unused, level) => ({
    level,
    format: ordered ? ORDERED_FORMATS[level]! : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : BULLET_GLYPHS[level]!,
    alignment: AlignmentType.LEFT,
    start: level === 0 ? start : 1,
    style: {
      paragraph: {
        indent: { left: 720 * (level + 1), hanging: 360 },
      },
    },
  }))
}

// One registry per document build. It hands out a reference per list occurrence
// and remembers the configuration each one needs, which is why the `Document` is
// constructed after its children rather than before them.
class Numbering {
  readonly config: MutableNumberingConfig = []

  reference(ordered: boolean, start: number): string {
    const reference = `exam-list-${this.config.length}`
    this.config.push({ reference, levels: levelsOf(ordered, start) })
    return reference
  }
}

// ---------------------------------------------------------------------------
// Inline content

function markedText(node: ProseMirrorJSON): ParagraphChild {
  const marks = Array.isArray(node.marks) ? (node.marks as ProseMirrorJSON[]) : []
  const options: MutableRunOptions = { text: stringOf(node.text) }
  let href = ''

  for (const mark of marks) {
    switch (mark.type) {
      case 'strong':
        options.bold = true
        break
      case 'emphasis':
        options.italics = true
        break
      case 'inlineCode':
        options.font = 'Courier New'
        break
      case 'strike_through':
        options.strike = true
        break
      case 'subscript':
        options.subScript = true
        break
      case 'superscript':
        options.superScript = true
        break
      case 'link':
        href = stringOf(attrsOf(mark).href)
        options.style = 'Hyperlink'
        break
    }
  }

  const run = new TextRun(options)
  // A link is a relationship in the package, not a blue run: the destination
  // has to survive export for the linked material to remain usable.
  return href ? new ExternalHyperlink({ link: href, children: [run] }) : run
}

// Mathematics stays mathematics: a real Office Math object, so Word treats it as
// an equation and a reader can edit it as one, rather than a paragraph of text
// that happens to look like a formula.
//
// The equation's content is the authored LaTeX. Translating LaTeX into OMML's
// own structure — fractions, radicals, scripts as elements — needs a LaTeX
// parser this codebase does not have, so `\frac{a}{b}` appears inside the
// equation as it was written rather than typeset as a fraction. That is a known
// limit of this adapter, not of the plan: the source is preserved, the object is
// native, and `docs/export-testing.md` records it.
function mathRun(source: string): ParagraphChild {
  return new OfficeMath({ children: [new MathRun(source)] })
}

/** An image at its planned size: its Authored Image Size against the width
 *  the plan gives its column, or as it fits there when no one sized it, so a
 *  large upload cannot run off the sheet. */
function imageRun(image: ExportImage, maxWidth: number, attrs: Record<string, unknown> = {}): ParagraphChild {
  const width = printedPictureWidth(image.width, maxWidth, attrs)
  const scale = width / image.width
  return new ImageRun({
    data: image.data,
    type: image.type,
    transformation: {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(image.height * scale)),
    },
  })
}

type BuildContext = {
  numbering: Numbering
  images: ReadonlyMap<string, ExportImage>
  /** The width the surrounding block gives content, in px. */
  contentWidth: number
  /** The width the page's margins leave, in px, however deep a block sits:
   *  what a choice grid or a matching set is laid out across. */
  pageWidth: number
}

function inlineChildren(
  node: ProseMirrorJSON,
  context: BuildContext,
): ParagraphChild[] {
  const result: ParagraphChild[] = []
  for (const child of childrenOf(node)) {
    switch (child.type) {
      case 'text':
        result.push(markedText(child))
        break
      case 'hardbreak':
        // An authored line break is content, not renderer-chosen wrapping.
        result.push(new TextRun({ break: 1 }))
        break
      case 'math_inline':
        result.push(mathRun(stringOf(attrsOf(child).value)))
        break
      // A Blank prints its line, and its answer only in the Answer Key.
      case 'blank':
        result.push(new TextRun({ text: BLANK_LINE }))
        break
      case 'image': {
        const attrs = attrsOf(child)
        const image = context.images.get(stringOf(attrs.src))
        result.push(
          image
            ? imageRun(image, context.contentWidth)
            : new TextRun({
                text: `[Image: ${stringOf(attrs.alt, 'embedded image')}]`,
                italics: true,
              }),
        )
        break
      }
      default:
        result.push(...inlineChildren(child, context))
        break
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Block content

/** What a block inherits from the item it sits in: the run of text that must
 *  open it, how far it is indented, and which list it belongs to. */
type BlockContext = {
  /** Prepended to the first paragraph produced — the question's number line. */
  prefix?: ParagraphChild[]
  /** A hanging indent applied with that prefix, so the body aligns under itself. */
  hanging?: number
  indent: number
  list?: { reference: string; level: number }
  keepNext?: boolean
  /** Inside a Panel: pictures and tables are centred across it. */
  centred?: boolean
  /** Extra room above the first paragraph produced, in twips: the gap a new
   *  paragraph or list opens below the block before it. Used up like `prefix`. */
  before?: number
  /** Blocks that sit close, as a choice's or a list item's do in print: no
   *  paragraph gap opens between them. */
  tight?: boolean
  /** Tab stops the prefix steps through, in twips: where a Part's letter and
   *  a Subpart's label stand when they open on the number's line. */
  tabStops?: number[]
  /** Where the column the blocks stand in ends, in twips from the margin,
   *  when it is not `contentWidth`: what a Centred block opening on a
   *  question's or a Part's line is centred against. */
  right?: number
}

// Body text's spacing, from the one table in `export-typography.ts`, at the
// Exam's text size. Lines are at least `BODY_LINE_HEIGHT` apart, so a line
// holding a picture or an equation still grows to fit it; a list's items are
// `LIST_ITEM_GAP_EM` apart, and a paragraph or list opens `PARAGRAPH_GAP_EM`
// below what is before it. Set for each document in `createExamDocxDocument`,
// whose build is synchronous, so no other export can see it.
type BodySpacing = { line: number; paragraphGap: number; listItemGap: number }

function bodySpacingOf(textSize: LayoutPlan['textSize']): BodySpacing {
  const pointsToTwips = (points: number) => Math.round(points * 20)
  const size = bodyPoints(textSize)
  return {
    line: pointsToTwips(size * BODY_LINE_HEIGHT),
    paragraphGap: pointsToTwips(size * PARAGRAPH_GAP_EM),
    listItemGap: pointsToTwips(size * LIST_ITEM_GAP_EM),
  }
}

let BODY_SPACING: BodySpacing = bodySpacingOf(undefined)
/** What any other block leaves below itself: a little room between a choice
 *  and the next, a stem and its grid, one question and the next. */
const BLOCK_AFTER = 80
/** The blocks that open a paragraph gap below the block before them, as
 *  `:is(p, ul, ol)` does in print. */
const GAP_BLOCKS = new Set(['paragraph', 'bullet_list', 'ordered_list'])

function paragraphOptions(
  context: BlockContext,
  extra: IParagraphOptions = {},
): IParagraphOptions {
  const indent = context.list
    ? undefined
    : {
        left: context.indent || undefined,
        hanging: context.hanging || undefined,
      }
  return {
    keepLines: true,
    keepNext: context.keepNext,
    spacing: {
      line: BODY_SPACING.line,
      lineRule: LineRuleType.AT_LEAST,
      after: context.list ? BODY_SPACING.listItemGap : BLOCK_AFTER,
      ...(context.before ? { before: context.before } : {}),
    },
    indent: indent?.left || indent?.hanging ? indent : undefined,
    ...(context.prefix && context.tabStops?.length
      ? { tabStops: context.tabStops.map((position) => ({ type: TabStopType.LEFT, position })) }
      : {}),
    numbering: context.list
      ? { reference: context.list.reference, level: context.list.level }
      : undefined,
    ...extra,
  }
}

function inlineParagraph(
  node: ProseMirrorJSON,
  context: BlockContext,
  build: BuildContext,
  extra: IParagraphOptions = {},
): Paragraph {
  const children = [
    ...(context.prefix ?? []),
    ...inlineChildren(node, build),
  ]
  return new Paragraph(
    paragraphOptions(context, { children, includeIfEmpty: true, ...extra }),
  )
}

/** The paragraph and table styles that mark a Centred block, so a reader of
 *  the package — the DOCX fingerprint among them — can tell an authored centre
 *  from a Panel's, which centres its pictures and tables by itself. */
export const CENTRED_PARAGRAPH_STYLE = 'Centred'
export const CENTRED_TABLE_STYLE = 'CentredTable'

/**
 * A Centred block's paragraph: centred in its column. One that opens with a
 * question's number or a Part's letter keeps that at the left, as print's
 * number column does, and steps to a centre tab in the middle of the column
 * to its right — Word would otherwise centre the number with the line.
 */
function centredParagraph(
  context: BlockContext,
  build: BuildContext,
): { context: BlockContext; options: IParagraphOptions } {
  if (!context.prefix) {
    return { context, options: { style: CENTRED_PARAGRAPH_STYLE, alignment: AlignmentType.CENTER } }
  }
  const right = context.right ?? twips(build.contentWidth)
  const centre = Math.round((context.indent + right) / 2)
  return {
    context: { ...context, prefix: [...context.prefix, new TextRun({ text: '\t' })] },
    options: {
      style: CENTRED_PARAGRAPH_STYLE,
      alignment: AlignmentType.LEFT,
      tabStops: [
        ...(context.tabStops ?? []).map((position) => ({ type: TabStopType.LEFT, position })),
        { type: TabStopType.CENTER, position: centre },
      ],
    },
  }
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
]

/** Blocks in order, with the opening prefix used up by the first one that
 *  actually produces something. */
function blocks(
  nodes: readonly ProseMirrorJSON[],
  context: BlockContext,
  build: BuildContext,
): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = []
  let prefix = context.prefix
  let hanging = context.hanging
  let before = context.before
  let previous: string | undefined
  for (const node of nodes) {
    // A paragraph or list below another block opens the paragraph gap, less
    // what that block already left below itself.
    if (previous !== undefined && !context.tight && GAP_BLOCKS.has(node.type as string)) {
      const left = previous === 'bullet_list' || previous === 'ordered_list'
        ? BODY_SPACING.listItemGap
        : BLOCK_AFTER
      before = Math.max(0, BODY_SPACING.paragraphGap - left)
    }
    const produced = blockOf(node, { ...context, prefix, hanging, before }, build)
    result.push(...produced)
    if (produced.length > 0) {
      prefix = undefined
      hanging = undefined
      before = undefined
      previous = node.type as string
    }
  }
  return result
}

// Every node kind the read-only document view draws has a structural
// counterpart here. `doc-view.tsx` and this switch are the two adapter mappings
// a newly supported editor node needs before its export coverage can pass;
// anything still unrecognised falls back to its children rather than vanishing.
function blockOf(
  node: ProseMirrorJSON,
  context: BlockContext,
  build: BuildContext,
): (Paragraph | Table)[] {
  const attrs = attrsOf(node)
  switch (node.type) {
    case 'paragraph': {
      if (context.list || !isCentred(node)) return [inlineParagraph(node, context, build)]
      const centred = centredParagraph(context, build)
      return [inlineParagraph(node, centred.context, build, centred.options)]
    }

    case 'heading': {
      const level = Math.min(Math.max(Number(attrs.level) || 1, 1), 6)
      return [
        inlineParagraph(node, context, build, { heading: HEADINGS[level - 1] }),
      ]
    }

    // A Blockquote prints boxed. A box of paragraphs in Word is a table of one
    // cell: paragraph borders only join into one box while every paragraph
    // shares its indents, and a boxed passage often holds a list.
    case 'blockquote':
      return [...prefixLine(context), boxTable(node, context, build)]

    case 'sideBySide':
      return [...prefixLine(context), sideBySideTable(node, context, build)]

    case 'bullet_list':
    case 'ordered_list': {
      const ordered = node.type === 'ordered_list'
      const reference = build.numbering.reference(
        ordered,
        ordered ? Number(attrs.order) || 1 : 1,
      )
      const level = context.list ? context.list.level + 1 : 0
      // The opening prefix belongs to the first item that prints, not to every
      // item in the list.
      let prefix = context.prefix
      let hanging = context.hanging
      let before = context.before
      return childrenOf(node).flatMap((child) => {
        const produced = blockOf(
          child,
          { ...context, prefix, hanging, before, list: { reference, level } },
          build,
        )
        if (produced.length > 0) {
          prefix = undefined
          hanging = undefined
          before = undefined
        }
        return produced
      })
    }

    // An item's own paragraphs sit together, as `li > p` does in print.
    case 'list_item':
      return blocks(childrenOf(node), { ...context, tight: true }, build)

    case 'code_block': {
      const source = childrenOf(node)
        .map((child) => stringOf(child.text))
        .join('')
      // Crepe stores display mathematics as a latex code block, exactly as the
      // read-only view reads it.
      if (stringOf(attrs.language).toLowerCase() === 'latex') {
        return [
          new Paragraph(
            paragraphOptions(context, {
              children: [...(context.prefix ?? []), mathRun(source)],
              alignment: AlignmentType.CENTER,
            }),
          ),
        ]
      }
      // Authored newlines inside a code block are content: keep them as breaks
      // rather than letting the lines run together.
      const lines = source.split('\n')
      return [
        new Paragraph(
          paragraphOptions(context, {
            children: [
              ...(context.prefix ?? []),
              ...lines.flatMap((line, index) => [
                ...(index > 0 ? [new TextRun({ break: 1 })] : []),
                new TextRun({ text: line, font: 'Courier New' }),
              ]),
            ],
            shading: { fill: 'F4F4F5' },
          }),
        ),
      ]
    }

    case 'image': {
      // An inline image standing alone as a block still prints on its own line.
      const image = build.images.get(stringOf(attrs.src))
      return [
        new Paragraph(
          paragraphOptions(context, {
            alignment: context.centred ? AlignmentType.CENTER : undefined,
            children: [
              ...(context.prefix ?? []),
              image
                ? imageRun(image, build.contentWidth)
                : new TextRun({
                    text: `[Image: ${stringOf(attrs.alt, 'embedded image')}]`,
                    italics: true,
                  }),
            ],
          }),
        ),
      ]
    }

    case 'image-block': {
      const caption = stringOf(attrs.caption)
      const image = build.images.get(pictureKey(attrs))
      const centred = isCentred(node) && !context.list ? centredParagraph(context, build) : undefined
      const figureContext = centred?.context ?? context
      const figure = new Paragraph(
        paragraphOptions(figureContext, {
          alignment: context.centred ? AlignmentType.CENTER : undefined,
          ...centred?.options,
          children: [
            ...(figureContext.prefix ?? []),
            image
              ? imageRun(image, build.contentWidth, attrs)
              : new TextRun({
                  text: `[Image: ${caption || 'embedded image'}]`,
                  italics: true,
                }),
          ],
        }),
      )
      if (!caption) return [figure]
      return [
        figure,
        new Paragraph(
          paragraphOptions(
            { ...context, prefix: undefined, hanging: undefined },
            {
              alignment: context.centred ? AlignmentType.CENTER : undefined,
              ...(centred ? { style: CENTRED_PARAGRAPH_STYLE, alignment: AlignmentType.CENTER } : {}),
              children: [new TextRun({ text: caption, italics: true, size: halfPointsOf('small') })],
            },
          ),
        ),
      ]
    }

    case 'hr':
      return [
        new Paragraph(
          paragraphOptions(context, {
            children: context.prefix ?? [],
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' },
            },
          }),
        ),
      ]

    case 'table':
      return [...prefixLine(context), documentTable(node, context, build)]

    // A row outside a table is malformed; render its cells rather than lose them.
    case 'table_header_row':
    case 'table_row':
      return blocks(childrenOf(node), context, build)

    default: {
      const children = childrenOf(node)
      return children.length > 0
        ? blocks(children, context, build)
        : [inlineParagraph(node, context, build)]
    }
  }
}

// A table cannot hold a run, so an opening prefix — a question's number line,
// a choice's letter — takes a line of its own above a table-shaped block and
// is kept with it.
function prefixLine(context: BlockContext): Paragraph[] {
  return context.prefix
    ? [new Paragraph(paragraphOptions(context, { children: context.prefix, keepNext: true }))]
    : []
}

/** The table styles that say what a table-shaped block is, so a reader of the
 *  package — the DOCX fingerprint among them — can tell a boxed passage and a
 *  row of Panels from a table the teacher wrote. */
export const BLOCKQUOTE_TABLE_STYLE = 'Blockquote'
export const SIDE_BY_SIDE_TABLE_STYLE = 'SideBySide'

const BOX_BORDER = { style: BorderStyle.SINGLE, size: 6, color: '000000' }
// Print's `.doc-content blockquote` padding: 6px above and below, 10px aside.
const BOX_PADDING_X = 10
const BOX_PADDING_Y = 6

function boxTable(
  node: ProseMirrorJSON,
  context: BlockContext,
  build: BuildContext,
): Table {
  const indent = context.indent / TWIPS_PER_PX
  const width = Math.max(1, build.contentWidth - indent)
  const content = blocks(
    childrenOf(node),
    { indent: 0, keepNext: context.keepNext, centred: context.centred },
    { ...build, contentWidth: width - BOX_PADDING_X * 2 },
  )
  return new Table({
    style: BLOCKQUOTE_TABLE_STYLE,
    width: { size: twips(width), type: WidthType.DXA },
    columnWidths: gridOf([width]),
    indent: context.indent ? { size: context.indent, type: WidthType.DXA } : undefined,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: twips(width), type: WidthType.DXA },
            margins: {
              top: twips(BOX_PADDING_Y),
              bottom: twips(BOX_PADDING_Y),
              left: twips(BOX_PADDING_X),
              right: twips(BOX_PADDING_X),
            },
            borders: { top: BOX_BORDER, bottom: BOX_BORDER, left: BOX_BORDER, right: BOX_BORDER },
            children: content.length > 0 ? content : [new Paragraph({})],
          }),
        ],
      }),
    ],
  })
}

// Print's `.doc-side-by-side` column gap.
const PANEL_GAP = 16

// A Side-by-Side is a borderless table of one row: its Panels equal, their
// content centred against one another, and the row never split across a page.
function sideBySideTable(
  node: ProseMirrorJSON,
  context: BlockContext,
  build: BuildContext,
): Table {
  const panels = childrenOf(node)
  const count = Math.max(1, panels.length)
  const indent = context.indent / TWIPS_PER_PX
  const width = Math.max(1, build.contentWidth - indent)
  const panelWidth = width / count
  return new Table({
    style: SIDE_BY_SIDE_TABLE_STYLE,
    width: { size: twips(width), type: WidthType.DXA },
    columnWidths: gridOf(Array.from({ length: count }, () => panelWidth)),
    indent: context.indent ? { size: context.indent, type: WidthType.DXA } : undefined,
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        cantSplit: true,
        children: panels.map((panel, index) => {
          const content = blocks(
            childrenOf(panel),
            { indent: 0, keepNext: context.keepNext, centred: true },
            { ...build, contentWidth: panelWidth - PANEL_GAP },
          )
          return new TableCell({
            width: { size: twips(panelWidth), type: WidthType.DXA },
            verticalAlign: VerticalAlignTable.CENTER,
            margins: {
              left: index === 0 ? 0 : twips(PANEL_GAP / 2),
              right: index === count - 1 ? 0 : twips(PANEL_GAP / 2),
            },
            borders: NO_BORDERS,
            children: content.length > 0 ? content : [new Paragraph({})],
          })
        }),
      }),
    ],
  })
}

const CELL_BORDER = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: '999999',
}

// A table stays a table: the same rows, the same cells, header cells still
// marked. Flattening one into tab-separated paragraphs loses the topology that
// made the question readable.
function documentTable(
  node: ProseMirrorJSON,
  context: BlockContext,
  build: BuildContext,
): Table {
  const rows = childrenOf(node).filter(
    (row) => row.type === 'table_row' || row.type === 'table_header_row',
  )
  const columns = rows.reduce(
    (widest, row) => Math.max(widest, childrenOf(row).length),
    1,
  )
  const cellWidth = build.contentWidth / columns
  return new Table({
    ...(isCentred(node) ? { style: CENTRED_TABLE_STYLE } : {}),
    alignment: context.centred || isCentred(node) ? AlignmentType.CENTER : undefined,
    width: { size: twips(build.contentWidth), type: WidthType.DXA },
    columnWidths: gridOf(Array.from({ length: columns }, () => cellWidth)),
    indent: context.indent
      ? { size: context.indent, type: WidthType.DXA }
      : undefined,
    rows: rows.map(
      (row) =>
        new TableRow({
          tableHeader: row.type === 'table_header_row',
          children: Array.from({ length: columns }, (_unused, column) => {
            const cell = childrenOf(row)[column]
            const header =
              row.type === 'table_header_row' || cell?.type === 'table_header'
            const content = cell
              ? blocks(
                  childrenOf(cell),
                  { indent: 0, keepNext: context.keepNext },
                  { ...build, contentWidth: cellWidth },
                )
              : []
            return new TableCell({
              width: { size: twips(cellWidth), type: WidthType.DXA },
              // Print's cell padding; below the last line, the room its
              // paragraph already leaves is that padding.
              margins: {
                top: twips(TABLE_CELL_PADDING_PX.y),
                bottom: Math.max(0, twips(TABLE_CELL_PADDING_PX.y) - BLOCK_AFTER),
                left: twips(TABLE_CELL_PADDING_PX.x),
                right: twips(TABLE_CELL_PADDING_PX.x),
              },
              shading: header ? { fill: 'F1F1F1' } : undefined,
              borders: {
                top: CELL_BORDER,
                bottom: CELL_BORDER,
                left: CELL_BORDER,
                right: CELL_BORDER,
              },
              children: content.length > 0 ? content : [new Paragraph({})],
            })
          }),
        }),
    ),
  })
}

// ---------------------------------------------------------------------------
// Page items

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const NO_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
}

// The grid is a real borderless table with the plan's own topology: the plan's
// column count, the plan's rows, the plan's cells — including the empty ones
// where the last column runs out of answers. On paper this is a layout, not a
// table, which is why every border is off.
function choiceGridTable(
  grid: ChoiceGrid,
  build: BuildContext,
  areaWidth: number,
  indentPx: number,
): Table {
  const cellWidth = areaWidth / grid.columns
  return new Table({
    width: { size: twips(areaWidth), type: WidthType.DXA },
    columnWidths: gridOf(Array.from({ length: grid.columns }, () => cellWidth)),
    indent: { size: twips(indentPx), type: WidthType.DXA },
    borders: NO_BORDERS,
    rows: grid.cells.map(
      (row) =>
        new TableRow({
          children: row.map((choice) => {
            const content = choice
              ? blocks(
                  childrenOf(choice.node),
                  {
                    indent: 288,
                    prefix: [new TextRun({ text: `${printedLabel(choice.letter, choice.printed)}\t` })],
                    hanging: 288,
                    tight: true,
                  },
                  { ...build, contentWidth: cellWidth },
                )
              : []
            return new TableCell({
              width: { size: twips(cellWidth), type: WidthType.DXA },
              borders: NO_BORDERS,
              children: content.length > 0 ? content : [new Paragraph({})],
            })
          }),
        }),
    ),
  })
}

// A matching set, with the plan's own layout. The prompts are paragraphs
// opened by their blank and number, hanging off the page's own number column
// so they line up with the questions around them; each Word Bank answer is
// opened by its letter. A short bank is the right cell of a borderless one-row
// table spanning the full content width, the prompts stacked in its left cell;
// a long bank is a borderless grid above the prompts with the plan's own
// topology, drawn the way a choice grid is.
function matchingContent(
  set: MatchingSet,
  build: BuildContext,
): (Paragraph | Table)[] {
  const cell = (width: number, content: (Paragraph | Table)[]) =>
    new TableCell({
      width: { size: twips(width), type: WidthType.DXA },
      borders: NO_BORDERS,
      children: content.length > 0 ? content : [new Paragraph({})],
    })
  const prompts = (contentWidth: number) =>
    set.prompts.flatMap((prompt) =>
      blocks(
        childrenOf(prompt.node),
        {
          indent: twips(MATCHING_INDENT),
          hanging: twips(MATCHING_INDENT),
          prefix: [new TextRun({ text: `_______  ${printedLabel(prompt.number, prompt.printed)}\t` })],
          tight: true,
        },
        { ...build, contentWidth },
      ),
    )
  const answer = (item: PlannedBankAnswer, contentWidth: number) =>
    blocks(
      childrenOf(item.node),
      { indent: 288, prefix: [new TextRun({ text: `${printedLabel(item.letter, item.printed)}\t` })], hanging: 288, tight: true },
      { ...build, contentWidth },
    )

  if (set.bankGrid) {
    const areaWidth = matchingAreaWidth(build.pageWidth)
    const cellWidth = areaWidth / set.bankGrid.columns
    const grid = new Table({
      width: { size: twips(areaWidth), type: WidthType.DXA },
      columnWidths: gridOf(Array.from({ length: set.bankGrid.columns }, () => cellWidth)),
      indent: { size: twips(MATCHING_INDENT), type: WidthType.DXA },
      borders: NO_BORDERS,
      rows: set.bankGrid.cells.map(
        (row) =>
          new TableRow({
            children: row.map((item) =>
              cell(cellWidth, item ? answer(item, cellWidth) : []),
            ),
          }),
      ),
    })
    return [grid, ...prompts(build.pageWidth - MATCHING_INDENT)]
  }

  const bankWidth = set.bankWidth ?? MATCHING_BANK_WIDTH
  const itemsWidth = build.pageWidth - bankWidth
  return [
    new Table({
      width: { size: twips(build.pageWidth), type: WidthType.DXA },
      columnWidths: gridOf([itemsWidth, bankWidth]),
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            cell(itemsWidth, prompts(itemsWidth - MATCHING_INDENT)),
            cell(
              bankWidth,
              set.bank.flatMap((item) => answer(item, bankWidth)),
            ),
          ],
        }),
      ],
    }),
  ]
}

/** A heading's lines at least `multiple` times its size apart, given in
 *  half-points as Word sizes type: print's heading line heights, so a heading
 *  that wraps takes the room the plan measured it at. */
function headingLine(halfPoints: number, multiple: number): { line: number; lineRule: typeof LineRuleType.AT_LEAST } {
  return { line: Math.round(halfPoints * 10 * multiple), lineRule: LineRuleType.AT_LEAST }
}

// A Short Answer question's work space, at the plan's own height. Word has no
// empty box of a given height, so a blank space is one empty paragraph whose
// exact line height is that height, and a lined space is one empty paragraph
// per rule, each exactly one pitch tall with its rule as a bottom border —
// the border's own half point taken out of the line so twenty rules still add
// up to the planned height. Anything left under the last rule, which only a
// space filling its page can have, is a blank paragraph of that remainder.
// Both carry a paragraph style of their own, which is what lets the package be
// read back as a work space rather than as a run of empty paragraphs.
export const WORK_SPACE_STYLES = {
  blank: 'WorkSpace',
  lines: 'WorkSpaceLines',
} as const

const WORK_SPACE_RULE_TWIPS = 10

// Points on the last rule (`pointsOnLastRule`) are that row's own text, set
// against `rightTwips` by a right tab whose leader is the rule — dots under a
// dotted ruling — so the rule stops short of them, as exam papers set
// `……………… [3]`.
function workSpaceParagraphs(
  space: PlannedWorkSpace,
  indentTwips: number,
  points?: { text: string; rightTwips: number },
): Paragraph[] {
  if (space.height <= 0) return []
  const style = WORK_SPACE_STYLES[space.style]
  const exactly = (heightTwips: number) => ({
    before: 0,
    after: 0,
    line: Math.max(1, heightTwips),
    lineRule: LineRuleType.EXACT,
  })
  const indent = { left: indentTwips }
  const ruled = space.style === 'lines' ? space.lines : 0
  const rows = rowsOfPlanned(space)
  const paragraphs = Array.from({ length: ruled }, (_unused, index) =>
    points && index === ruled - 1
      ? new Paragraph({
          style,
          indent,
          spacing: exactly(twips(index === 0 ? rows.first : rows.pitch)),
          tabStops: [{
            type: TabStopType.RIGHT,
            position: points.rightTwips,
            leader: space.ruling === 'dotted' ? LeaderType.DOT : LeaderType.UNDERSCORE,
          }],
          children: [new TextRun({ text: `\t${points.text}` })],
        })
      : new Paragraph({
      style,
      indent,
      spacing: exactly(twips(index === 0 ? rows.first : rows.pitch) - WORK_SPACE_RULE_TWIPS),
      border: {
        // Dotted under a Paper Style that rules dotted lines (ADR-0045).
        bottom: space.ruling === 'dotted'
          ? { style: BorderStyle.DOTTED, size: 8, color: '4A4038', space: 0 }
          : { style: BorderStyle.SINGLE, size: 4, color: '8F847A', space: 0 },
      },
    }),
  )
  const remainder = space.height - (ruled > 0 ? rows.first + (ruled - 1) * rows.pitch : 0)
  if (remainder >= 1) {
    paragraphs.push(new Paragraph({ style, indent, spacing: exactly(twips(remainder)) }))
  }
  return paragraphs
}

// A question, or the piece of one this page carries. Only the first piece prints
// the number line and the answer blank — the same rule the print adapter draws
// by, taken from the same planned item rather than decided again here.
function questionContent(
  item: QuestionItem,
  build: BuildContext,
): (Paragraph | Table)[] {
  const numbered = printsNumberLine(item)
  const indentPx = questionIndentOf(item.question)
  const indent = twips(indentPx)
  const prefix: ParagraphChild[] = numbered
    ? [
        new TextRun({
          text: `${[...item.question.marks, printedNumberOf(item.question)].join('  ')}\t`,
        }),
      ]
    : []
  const context: BlockContext = {
    indent,
    hanging: numbered ? indent : undefined,
    prefix: numbered ? prefix : undefined,
    right: twips(build.pageWidth),
  }

  // A Multipart question with no stem opens with Part (a) on its number's
  // line: the number leads the Part's first paragraph instead.
  const opening = partsOpenNumberLine(item)
  const stem =
    item.stem.length > 0
      ? blocks(item.stem, context, build)
      : numbered && !opening
        ? [new Paragraph(paragraphOptions(context, { children: prefix }))]
        : []

  return [
    ...stem,
    // The grid hangs off the question's own number column, which an answer
    // blank before the number widens, and is set in from the stem by the
    // answers' indent, as `.choice-grid` is in print.
    ...(item.grid
      ? [choiceGridTable(
          item.grid,
          build,
          choiceAreaWidth(build.pageWidth, item.question),
          indentPx + CHOICE_INDENT,
        )]
      : []),
    ...(item.matching ? matchingContent(item.matching, build) : []),
    ...answerSpaceContent(item.workSpace, item.pointsAfter, indent, build),
    ...(item.parts ?? []).flatMap((part, index) =>
      partContent(part, indentPx, build, opening && index === 0 ? { prefix, start: 0, stops: [indent] } : undefined),
    ),
    ...(item.closingPoints ?? []).map(pointsAfterParagraph),
  ]
}

/** An answer's room and its Points: on the room's last rule where it has
 *  one, otherwise a paragraph of their own below it. */
function answerSpaceContent(
  space: PlannedWorkSpace | null,
  pointsAfter: string | undefined,
  indentTwips: number,
  build: BuildContext,
): Paragraph[] {
  const onRule = pointsAfter !== undefined && pointsOnLastRule(space)
  return [
    ...(space
      ? workSpaceParagraphs(
          space,
          indentTwips,
          onRule ? { text: pointsAfter, rightTwips: twips(build.pageWidth) } : undefined,
        )
      : []),
    ...(pointsAfter && !onRule ? [pointsAfterParagraph(pointsAfter)] : []),
  ]
}

/** Points a Paper Style prints after an answer or a question: a paragraph of
 *  their own against the right margin, as print sets them. */
function pointsAfterParagraph(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    keepLines: true,
    spacing: { before: 60, after: 0 },
    children: [new TextRun({ text })],
  })
}

// A Multipart question's Part, one level in: its letter hanging off its own letter column inside the Multipart question's body,
// then its choice grid or its work space, as a question of its kind prints —
// or, for a Part that holds Subparts, each Subpart the same way one level
// further in. A piece continued from an earlier page carries only Subparts.
// What opens a Part's or Subpart's first line before its own label, when it
// prints on a line above it: the question's number, or a Part's letter. Its
// runs, where the line starts in px, and the tab stops (twips) it steps
// through to reach the label.
type LineLead = { prefix: ParagraphChild[]; start: number; stops: number[] }

// A Part with no lead-in opens its first Subpart on its own letter's line,
// handing its letter, after any lead of its own, to that Subpart.
function partContent(
  part: PlannedPart,
  multipartIndentPx: number,
  build: BuildContext,
  lead?: LineLead,
): (Paragraph | Table)[] {
  const label = printedLabel(part.letter, part.printed)
  const opening = subpartsOpenLabelLine(part)
  const letterLead: LineLead = {
    prefix: [...(lead?.prefix ?? []), new TextRun({ text: `${label}\t` })],
    start: lead?.start ?? multipartIndentPx,
    stops: [...(lead?.stops ?? []), twips(multipartIndentPx + PART_INDENT)],
  }
  return [
    ...(opening
      ? []
      : answeringContent(part.continued ? null : label, part, multipartIndentPx, build, lead)),
    ...part.subparts.flatMap((subpart, index) =>
      answeringContent(
        subpart.continued ? null : printedLabel(subpart.label, subpart.printed),
        subpart,
        multipartIndentPx + PART_INDENT,
        build,
        opening && index === 0 ? letterLead : undefined,
      ),
    ),
  ]
}

// `label` is `null` on a piece continued from an earlier page (ADR-0048): it
// prints no label, only the stem blocks it carries and what follows them.
function answeringContent(
  label: string | null,
  part: Pick<PlannedPart, 'stem' | 'grid' | 'workSpace' | 'pointsAfter'>,
  outerIndentPx: number,
  build: BuildContext,
  lead?: LineLead,
): (Paragraph | Table)[] {
  const indentPx = outerIndentPx + PART_INDENT
  const indent = twips(indentPx)
  const prefix: ParagraphChild[] | undefined = label === null
    ? undefined
    : [...(lead?.prefix ?? []), new TextRun({ text: `${label}\t` })]
  const context: BlockContext = prefix
    ? {
        indent,
        // A lead starts the first line further out, at the number or letter.
        hanging: lead ? twips(indentPx - lead.start) : twips(PART_INDENT),
        prefix,
        ...(lead ? { tabStops: lead.stops } : {}),
        right: twips(build.pageWidth),
      }
    : { indent, right: twips(build.pageWidth) }
  const stem = blocks(part.stem, context, { ...build, contentWidth: build.pageWidth - indentPx })
  return [
    ...(stem.length > 0 || !prefix ? stem : [new Paragraph(paragraphOptions(context, { children: prefix }))]),
    // Set in from the Part's stem as a question's answers are from its own.
    ...(part.grid
      ? [choiceGridTable(part.grid, build, build.pageWidth - indentPx - CHOICE_INDENT, indentPx + CHOICE_INDENT)]
      : []),
    ...answerSpaceContent(part.workSpace, part.pointsAfter, indent, build),
  ]
}

// The paper's total beneath the title (ADR-0045), as print sets
// `.paper-total`: a line of body text and its 12px below.
function paperTotalParagraph(item: PaperTotalItem): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: item.text })], spacing: { after: twips(12) } })
}

// The answer key, in Word.
//
// The key's own heading and its per-section groupings are headings the same way
// the test's section headings are, and one entry is one line: the question's
// number, then the letter this arrangement earned — in bold, as print
// draws it. The plan decided every one of those; nothing here reads a choice.

const ANSWER_KEY_TITLE = 'Answer Section'

function answerKeySection(item: AnswerKeySectionItem): Paragraph {
  return new Paragraph({
    text: item.title,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 100, after: 40, ...headingLine(halfPointsOf('sectionTitle'), HEADING_LINE_HEIGHT) },
  })
}

/** An Answer Key line's `[n]`, after its answer, when it has points. */
function pointsRuns(points: number | undefined): TextRun[] {
  return points === undefined ? [] : [new TextRun({ text: ` ${answerKeyPointsText(points)}` })]
}

function answerKeyEntry(item: AnswerKeyEntryItem, build: BuildContext): (Paragraph | Table)[] {
  const metadata = [
    ...(item.difficulty ? [{ label: DIFFICULTY_LABELS[item.difficulty], fill: 'E6F0E3' }] : []),
    ...(item.topics ?? []).map((topic) => ({ label: topic, fill: 'F2E6D8' })),
  ]
  const entry = new Paragraph({
    children: [
      new TextRun({ text: `${item.number}. ` }),
      // A free-response question still takes a line, so the key's numbering
      // matches the paper's; it simply has no letter to print.
      ...(item.letter ? [new TextRun({ text: item.letter, bold: true })] : []),
      ...pointsRuns(item.points),
      ...metadata.map(({ label, fill }) =>
        new TextRun({ text: ` ${label} `, size: 18, shading: { fill } }),
      ),
    ],
  })
  // A Suggested Answer starts under the blank, on the lines below the entry.
  const suggested = item.suggestedAnswer
    ? blocks(item.suggestedAnswer, { indent: ANSWER_KEY_ANSWER_INDENT }, build)
    : []
  // A Multipart question's Parts each take a line under its number: the Part's letter,
  // then its answer in bold, then any Suggested Answer beneath.
  const parts = (item.parts ?? []).flatMap((part) => [
    new Paragraph({
      indent: { left: ANSWER_KEY_ANSWER_INDENT },
      children: [
        new TextRun({ text: `${part.letter}. ` }),
        ...(part.answer ? [new TextRun({ text: part.answer, bold: true })] : []),
        ...pointsRuns(part.points),
      ],
    }),
    ...(part.suggestedAnswer
      ? blocks(part.suggestedAnswer, { indent: ANSWER_KEY_ANSWER_INDENT + twips(32) }, build)
      : []),
  ])
  return [entry, ...suggested, ...parts]
}

function itemContent(
  item: PageItem,
  build: BuildContext,
): (Paragraph | Table)[] {
  switch (item.kind) {
    case 'paper-total':
      return [paperTotalParagraph(item)]
    case 'section-heading': {
      // Heading 1 already is `'normal'`; any other size is stated on the runs,
      // from the same table print reads. The directions always state theirs:
      // the body style follows the Exam's text size, and they do not.
      const sized = item.size && item.size !== 'normal'
        ? sectionHeadingHalfPoints(item.size)
        : null
      // A cleared part prints no paragraph, not an empty one.
      return [
        ...(item.title
          ? [new Paragraph({
              ...(sized
                ? { children: [new TextRun({ text: item.title, size: sized.title })] }
                : { text: item.title }),
              heading: HeadingLevel.HEADING_1,
              // The plan's own keep decision, not a second guess at one.
              keepNext: item.keepWithNext,
              spacing: {
                before: 120,
                after: 60,
                ...headingLine(sized ? sized.title : halfPointsOf('sectionTitle'), HEADING_LINE_HEIGHT),
              },
            })]
          : []),
        ...(item.instructions
          ? [new Paragraph({
              children: [new TextRun({
                text: item.instructions,
                italics: true,
                size: sized ? sized.instructions : halfPointsOf('body'),
              })],
              keepNext: item.keepWithNext,
              spacing: {
                after: 160,
                ...headingLine(sized ? sized.instructions : halfPointsOf('body'), BODY_LINE_HEIGHT),
              },
            })]
          : []),
      ]
    }
    case 'question':
      return questionContent(item, build)
    case 'answer-key-heading':
      return [
        new Paragraph({
          // Larger than a section title in print, so larger than Heading 1.
          children: [
            new TextRun({ text: ANSWER_KEY_TITLE, size: halfPointsOf('answerKeyHeading') }),
            // The paper's total, on the heading's own line against the right
            // margin in body type, as print sets it.
            ...(item.totalPoints !== undefined
              ? [new TextRun({
                  children: [new Tab(), answerKeyTotalText(item.totalPoints)],
                  size: halfPointsOf('body'),
                  bold: false,
                })]
              : []),
          ],
          ...(item.totalPoints !== undefined
            ? { tabStops: [{ type: TabStopType.RIGHT, position: twips(build.contentWidth) }] }
            : {}),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 120, after: 60, ...headingLine(halfPointsOf('answerKeyHeading'), HEADING_LINE_HEIGHT) },
        }),
      ]
    case 'answer-key-section':
      return [answerKeySection(item)]
    case 'answer-key-entry':
      return answerKeyEntry(item, build)
    default: {
      const unreachable: never = item
      return unreachable
    }
  }
}

// ---------------------------------------------------------------------------
// Page furniture
//
// Read straight off the plan, the same as the print adapter reads it: the
// identity fields the page offers, whether it repeats the title, which output ID
// it names, and what its footer prints. Nothing here decides what a header
// variant means.

// `.page-identity` spans the content width: each field takes an equal share of
// what the output ID leaves, its blank ruled to the end of that share, the
// fields 20px apart, and the ID in bold against the right margin. Word draws the
// same thing with tab stops: an underscore leader rules each blank to its stop,
// and a right stop at the content width holds the ID.
const IDENTITY_GAP = 20
const OUTPUT_ID_STYLE = 'OutputId'
/** Bold by style, as print sets these by class: a Paper Style's running page
 *  number and "Turn over" — page furniture, not an authored strong mark. */
const FURNITURE_BOLD_STYLE = 'FurnitureBold'
/** Room kept for the bold output ID and the gap before it. */
const IDENTITY_ID_RESERVE = 64

function identityLine(furniture: PageFurniture, contentWidth: number): Paragraph {
  // Bold by style, as `.page-id` is bold by class: page furniture, not an
  // authored strong mark.
  const id = new TextRun({
    text: furniture.arrangementLabel,
    style: OUTPUT_ID_STYLE,
    size: halfPointsOf('body'),
  })
  if (furniture.identityLine !== undefined) {
    // An Exam's own line: its text, then the ID against a right stop.
    return new Paragraph({
      children: [
        new TextRun({ text: furniture.identityLine, size: halfPointsOf('body') }),
        new TextRun({ children: [new Tab()] }),
        id,
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: twips(contentWidth) }],
      spacing: { after: 60 },
    })
  }
  const fields = furniture.identityFields
  if (fields.length === 0) {
    return new Paragraph({ children: [id], alignment: AlignmentType.RIGHT, spacing: { after: 60 } })
  }
  const share =
    (contentWidth - IDENTITY_ID_RESERVE - IDENTITY_GAP * (fields.length - 1)) / fields.length
  const tabStops: TabStopDefinition[] = []
  const children: ParagraphChild[] = []
  fields.forEach((field: IdentityField, index) => {
    const start = index * (share + IDENTITY_GAP)
    if (index > 0) {
      tabStops.push({ type: TabStopType.LEFT, position: twips(start) })
      children.push(new TextRun({ children: [new Tab()] }))
    }
    tabStops.push({ type: TabStopType.LEFT, position: twips(start + share), leader: LeaderType.UNDERSCORE })
    children.push(new TextRun({ children: [`${field}: `, new Tab()] }))
  })
  tabStops.push({ type: TabStopType.RIGHT, position: twips(contentWidth) })
  return new Paragraph({
    children: [...children, new TextRun({ children: [new Tab()] }), id],
    tabStops,
    spacing: { after: 60 },
  })
}

function headerParagraphs(furniture: PageFurniture, contentWidth: number): Paragraph[] {
  return [
    // The page number, centred on a row of its own above the header line,
    // under a style that prints it at the top (ADR-0045).
    ...(furniture.pageNumberAt === 'top'
      ? [new Paragraph({
          children: [
            new TextRun({ text: String(furniture.pageNumber), style: FURNITURE_BOLD_STYLE, size: halfPointsOf('body') }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        })]
      : []),
    identityLine(furniture, contentWidth),
    ...(furniture.title === null
      ? []
      : [
          // Print sets the title flush left, as it does every heading.
          new Paragraph({
            ...(furniture.titleSize
              ? {
                  children: [
                    new TextRun({ text: furniture.title, size: titleHalfPoints(furniture.titleSize) }),
                  ],
                }
              : { text: furniture.title }),
            heading: HeadingLevel.TITLE,
            // A long title wraps in the header, its lines at print's title
            // line height, and Word grows the header to hold it as the plan
            // grew its own.
            spacing: { after: 120, ...headingLine(titleHalfPoints(furniture.titleSize), TITLE_LINE_HEIGHT) },
          }),
        ]),
  ]
}

// The plan already numbered the page — including restarting at 1 for the answer
// key — so the footer prints that number rather than asking Word for a field
// whose count would be the whole document's.
function footerParagraph(furniture: PageFurniture, contentWidth: number): Paragraph {
  if (furniture.footRight === undefined) {
    return new Paragraph({
      children: furniture.pageNumberAt === undefined
        ? [new TextRun({ text: String(furniture.pageNumber), size: halfPointsOf('small') })]
        : [],
      alignment: AlignmentType.CENTER,
    })
  }
  // A running foot (ADR-0045): "Turn over" against a right stop, in body
  // type, as print sets it.
  return new Paragraph({
    children: [
      ...(furniture.pageNumberAt === undefined
        ? [new TextRun({ text: `${furniture.pageNumber} `, size: halfPointsOf('body') })]
        : []),
      ...(furniture.footRight
        ? [
            new TextRun({ children: [new Tab()] }),
            new TextRun({ text: furniture.footRight, style: FURNITURE_BOLD_STYLE, size: halfPointsOf('body') }),
          ]
        : []),
    ],
    tabStops: [{ type: TabStopType.RIGHT, position: twips(contentWidth) }],
  })
}

/** A4 exactly, in twips: 210×297mm. */
const A4_TWIPS = { width: 11906, height: 16838 }

// ---------------------------------------------------------------------------
// The document

/** One Word section per planned page. Sections default to starting on a new
 *  page, which is what serializes the plan's pagination instead of leaving Word
 *  to discover one of its own. */
function sectionOf(
  page: PlannedPage,
  plan: LayoutPlan,
  build: BuildContext,
): ISectionOptions {
  return {
    properties: {
      page: {
        // An A4 plan is cut to A4 exactly, not to the whole pixels it packed in.
        size: plan.pageSize.paper === 'a4'
          ? A4_TWIPS
          : { width: twips(plan.pageSize.width), height: twips(plan.pageSize.height) },
        margin: {
          top: twips(plan.pageSize.margins.top),
          right: twips(plan.pageSize.margins.right),
          bottom: twips(plan.pageSize.margins.bottom),
          left: twips(plan.pageSize.margins.left),
        },
      },
    },
    headers: { default: new Header({ children: headerParagraphs(page.furniture, plan.pageSize.contentWidth) }) },
    footers: { default: new Footer({ children: [footerParagraph(page.furniture, plan.pageSize.contentWidth)] }) },
    children: page.items.flatMap((item) => itemContent(item, build)),
  }
}

/**
 * The prepared plans as one Word document: every standalone student test and
 * answer key, in the order preparation put them in, packaged together.
 *
 * Synchronous and pure — every image the plans refer to has already been
 * resolved into `images`, so this can be asserted against in an ordinary test.
 */
export function createExamDocxDocument(
  plans: readonly LayoutPlan[],
  images: ReadonlyMap<string, ExportImage> = new Map(),
): Document {
  const numbering = new Numbering()
  const first = plans[0]
  const contentWidth = first?.pageSize.contentWidth ?? US_LETTER.contentWidth
  const build: BuildContext = { numbering, images, contentWidth, pageWidth: contentWidth }
  // Sections first: the list configurations only exist once the content that
  // uses them has been built.
  BODY_SPACING = bodySpacingOf(first?.textSize)
  let sections: ISectionOptions[]
  try {
    sections = plans.flatMap((plan) =>
      plan.pages.map((page) => sectionOf(page, plan, build)),
    )
  } finally {
    BODY_SPACING = bodySpacingOf(undefined)
  }
  // Which papers the file holds, from the plans themselves rather than from a
  // second count of the output IDs someone asked for.
  const labels = [...new Set(plans.map((plan) => plan.arrangement.letter))]
  return new Document({
    title: first?.title ?? '',
    description: `Output ID ${arrangementRange(labels)}`,
    creator: 'Test Parrot',
    numbering: { config: numbering.config },
    // Print's type, not Word's: with no document defaults Word falls back to
    // 10pt Times New Roman and a 28pt Title, and the exam reads a size smaller
    // than the sheet it was planned on.
    styles: {
      default: {
        // The Exam's text size is its body type; the header line and the
        // directions state the sheet's own.
        document: { run: { font: EXAM_FONT, size: bodyHalfPoints(first?.textSize) } },
        title: { run: { font: EXAM_FONT, size: halfPointsOf('title'), bold: true } },
        heading1: { run: { font: EXAM_FONT, size: halfPointsOf('sectionTitle'), bold: true } },
        heading2: { run: { font: EXAM_FONT, size: halfPointsOf('sectionTitle'), bold: true } },
      },
      characterStyles: [
        { id: OUTPUT_ID_STYLE, name: 'Output ID', run: { bold: true } },
        { id: FURNITURE_BOLD_STYLE, name: 'Furniture Bold', run: { bold: true } },
      ],
      paragraphStyles: [
        { id: WORK_SPACE_STYLES.blank, name: 'Work Space', basedOn: 'Normal' },
        { id: WORK_SPACE_STYLES.lines, name: 'Work Space Lines', basedOn: 'Normal' },
        {
          id: CENTRED_PARAGRAPH_STYLE,
          name: 'Centred',
          basedOn: 'Normal',
          paragraph: { alignment: AlignmentType.CENTER },
        },
      ],
    },
    sections: sections.length > 0 ? sections : [{ children: [] }],
  })
}

export async function createExamDocx(
  plans: readonly LayoutPlan[],
  media: MediaLoader = browserMedia,
): Promise<Blob> {
  const images = await loadExportImages(plans, media)
  const blob = await Packer.toBlob(createExamDocxDocument(plans, images))
  return blob.type === DOCX_MIME ? blob : new Blob([blob], { type: DOCX_MIME })
}

/** Publication packaging is strict: an Export Record may never be created
 * with a text fallback standing in for media it promises to preserve. The
 * lower-level adapter remains tolerant for parity diagnostics and callers that
 * explicitly want its visible fallback behavior. */
export async function createPublicationDocx(
  plans: readonly LayoutPlan[],
  media: MediaLoader = browserMedia,
): Promise<Blob> {
  const images = await loadExportImages(plans, media)
  const missing = missingPicture(plans, images)
  if (missing) {
    throw new RequiredMediaError(questionNumberForMedia(plans, missing.src))
  }
  const blob = await Packer.toBlob(createExamDocxDocument(plans, images))
  return blob.type === DOCX_MIME ? blob : new Blob([blob], { type: DOCX_MIME })
}

/** Hands the finished package to the browser as a download. Separate from
 *  building it so the application can package while its export dialog is still
 *  up, and start the download only once the dialog has closed. */
export function saveDocxFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
