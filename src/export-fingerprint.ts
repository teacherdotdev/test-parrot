// Stable, readable fingerprints of an export.
//
// Parity is not "the ZIP unpacked" and it is not "the bytes matched". It is:
// the same ordered content, on the same page, with the same structure. So both
// sides of a comparison are reduced to the same small vocabulary of content
// lines — one per block, nested for tables — and those lines are what tests and
// the out-of-band diagnostic compare.
//
// Deliberately excluded: package ordering, ZIP timestamps, generated
// relationship identifiers, revision metadata, style names, indentation,
// coordinates, and renderer-selected line wrapping. Deliberately included:
// text, the formatting intent carried on it, link destinations, authored
// breaks, mathematics, media identity and order, list and table topology, page
// size, page assignment, page furniture and footer numbering.
//
// A fingerprint is human-readable on purpose: a failing comparison prints the
// first differing line, and that line says what the document says.

import {
  answerKeyPointsText,
  answerKeyTotalText,
  printedLabel,
  partsOpenNumberLine,
  pointsOnLastRule,
  printedNumberOf,
  printsNumberLine,
  runningFootOf,
  subpartsOpenLabelLine,
  type ChoiceGrid,
  type ExportDocument,
  type LayoutPlan,
  type MatchingSet,
  type PageFurniture,
  type PageItem,
  type PlannedPart,
  type PlannedWorkSpace,
  type QuestionItem,
} from './export-plan'
import { centredKind } from './centring'
import { arrangementRange } from './export-preparation'
import type { ProseMirrorJSON } from './question-doc'
import { BLANK_LINE } from './blank'
import { MARGIN_SIDES, type MarginSide } from './page-margins'

/** A page's margins in CSS px, every side. */
export type PageMarginsPx = Record<MarginSide, number>

/** One block of content, normalized. See `blockLine` for the vocabulary. */
export type ContentLine = string

export type PageFingerprint = {
  number: number
  /** US Letter in CSS px at 96dpi, the units the plan works in. */
  width: number
  height: number
  /** The page's own margins, every side. */
  margins: PageMarginsPx
  header: ContentLine[]
  footer: ContentLine[]
  content: ContentLine[]
}

export type ExportFingerprint = {
  title: string
  arrangement: string
  pages: PageFingerprint[]
  /** Media in document order — sources on the plan side, packaged parts on the
   *  DOCX side. Only how many there are is comparable; which is which is in the
   *  content lines. Never bytes. */
  media: string[]
}

// ---------------------------------------------------------------------------
// The vocabulary
//
//   heading:<1-6|title> <inline>   a heading, at its level
//   para <inline>                  an ordinary paragraph
//   para:center <inline>           …a Centred one, or a Centred figure or its caption
//   code <inline>                  a code block
//   list:<bullet|ordered>:<n> <inline>
//   rule                           a horizontal rule
//   table:<rows>x<columns>         a table or a choice grid opens
//   table:<rows>x<columns>:center  …a Centred table
//   cell:<row>,<column>            one cell opens; its own lines follow
//   /table                         the table closes
//   box                            a Blockquote's border opens; its lines follow
//   /box                           …and closes
//   side:<panels>                  a Side-by-Side opens
//   panel:<index>                  one Panel opens; its own lines follow
//   /side                          the Side-by-Side closes
//   space:blank                    a Short Answer question's empty work space
//   space:lines:<n>                …or its work space ruled with n lines
//   space:lines:<n>:dotted         …ruled with n dotted lines
//
// and inline content as:
//
//   plain text
//   «strong,emphasis»marked text«/»
//   «link:https://…»linked text«/»
//   ⟨math:E = mc^2⟩
//   ⟨image:2⟩                      the second image in document order
//   ⏎                              an authored line break

const MARK_ORDER = [
  'strong',
  'emphasis',
  'inlineCode',
  'strike_through',
  'subscript',
  'superscript',
] as const

export type Segment =
  | { kind: 'text'; text: string; marks: string[] }
  | { kind: 'math'; source: string }
  | { kind: 'image'; ordinal: number }
  | { kind: 'break' }

export function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ')
}

export function markLabel(marks: readonly string[]): string {
  const known = MARK_ORDER.filter((mark) => marks.includes(mark))
  const links = marks.filter((mark) => mark.startsWith('link:'))
  return [...known, ...links].join(',')
}

/**
 * The inline vocabulary, in one place.
 *
 * Every side of a comparison renders its segments through this: the plan, the
 * print adapter's markup, and the DOCX package. That is the whole point — two
 * different documents must reduce to the same string when they say the same
 * thing, and they cannot if each side normalizes for itself.
 *
 * Adjacent runs carrying the same formatting are one span: the three formats
 * split runs differently, and where a run boundary falls is not content.
 */
export function renderInline(segments: readonly Segment[]): string {
  const merged: Segment[] = []
  for (const segment of segments) {
    if (segment.kind === 'text') {
      if (normalizeSpace(segment.text).trim() === '') {
        // Whitespace-only runs — an identity blank, a tab, the space between
        // two fields — carry no content, only separation.
        const previous = merged.at(-1)
        if (previous?.kind === 'text') previous.text += ' '
        continue
      }
      const previous = merged.at(-1)
      if (
        previous?.kind === 'text'
        && markLabel(previous.marks) === markLabel(segment.marks)
      ) {
        previous.text += segment.text
        continue
      }
      merged.push({ ...segment })
      continue
    }
    merged.push(segment)
  }
  return merged
    .map((segment) => {
      switch (segment.kind) {
        case 'text': {
          const label = markLabel(segment.marks)
          const text = normalizeSpace(segment.text)
          return label ? `«${label}»${text.trim()}«/»` : text
        }
        case 'math':
          return `⟨math:${normalizeSpace(segment.source).trim()}⟩`
        case 'image':
          return `⟨image:${segment.ordinal}⟩`
        case 'break':
          return '⏎'
      }
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

export function line(kind: string, inline: string): ContentLine {
  return inline ? `${kind} ${inline}` : kind
}

// ---------------------------------------------------------------------------
// The Layout Plan side

// Images are identified by their position in the document, not by their source:
// a DOCX package names its media parts itself, and a relationship id is exactly
// the kind of generated identifier a fingerprint must not depend on.
class ImageOrdinals {
  private next = 1
  private readonly media: string[] = []

  take(src: string): number {
    this.media.push(mediaType(src))
    return this.next++
  }

  get list(): string[] {
    return this.media
  }
}

const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

function mediaType(src: string): string {
  const dataUrl = /^data:([^;,]+)/.exec(src)
  if (dataUrl) return dataUrl[1]!.toLowerCase()
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(src)
  return extension ? (EXTENSION_TYPES[extension[1]!.toLowerCase()] ?? 'image') : 'image'
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

function marksOf(node: ProseMirrorJSON): string[] {
  const marks = Array.isArray(node.marks) ? (node.marks as ProseMirrorJSON[]) : []
  return marks.map((mark) =>
    mark.type === 'link'
      ? `link:${stringOf(attrsOf(mark).href)}`
      : String(mark.type ?? ''),
  )
}

function inlineSegments(
  node: ProseMirrorJSON,
  images: ImageOrdinals,
): Segment[] {
  const segments: Segment[] = []
  for (const child of childrenOf(node)) {
    switch (child.type) {
      case 'text':
        segments.push({
          kind: 'text',
          text: stringOf(child.text),
          marks: marksOf(child),
        })
        break
      case 'hardbreak':
        segments.push({ kind: 'break' })
        break
      case 'math_inline':
        segments.push({ kind: 'math', source: stringOf(attrsOf(child).value) })
        break
      // A Blank prints its line, and its answer only in the Answer Key.
      case 'blank':
        segments.push({ kind: 'text', text: BLANK_LINE, marks: [] })
        break
      case 'image':
        segments.push({
          kind: 'image',
          ordinal: images.take(stringOf(attrsOf(child).src)),
        })
        break
      default:
        segments.push(...inlineSegments(child, images))
        break
    }
  }
  return segments
}

type PlanBlockContext = {
  /** The run that opens the next block produced — a question's number line, or
   *  a choice's letter. Consumed by the first block that produces a line. */
  opener?: Segment[]
  list?: { ordered: boolean; level: number }
}

function planBlocks(
  nodes: readonly ProseMirrorJSON[],
  context: PlanBlockContext,
  images: ImageOrdinals,
): ContentLine[] {
  const lines: ContentLine[] = []
  let opener = context.opener
  for (const node of nodes) {
    const produced = planBlock(node, { ...context, opener }, images)
    lines.push(...produced)
    if (produced.length > 0) opener = undefined
  }
  return lines
}

// Mirrors the DOCX adapter's own switch, one vocabulary term per node kind. The
// two must agree, and a node kind missing from either is what makes a new
// editor feature fail its export coverage rather than vanish quietly.
function planBlock(
  node: ProseMirrorJSON,
  context: PlanBlockContext,
  images: ImageOrdinals,
): ContentLine[] {
  const attrs = attrsOf(node)
  const opener = context.opener ?? []
  const kind = context.list
    ? `list:${context.list.ordered ? 'ordered' : 'bullet'}:${context.list.level}`
    : 'para'

  // A Centred block's own lines say so; a list item's never are.
  const own = context.list ? kind : centredKind(kind, node)

  switch (node.type) {
    case 'paragraph':
      return [line(own, renderInline([...opener, ...inlineSegments(node, images)]))]

    case 'heading': {
      const level = Math.min(Math.max(Number(attrs.level) || 1, 1), 6)
      return [
        line(
          `heading:${level}`,
          renderInline([...opener, ...inlineSegments(node, images)]),
        ),
      ]
    }

    // A Blockquote's border is content, not styling: a boxed passage that
    // loses its box is the whole bug. Like a table it cannot carry the opening
    // run, so that takes a line of its own.
    case 'blockquote':
      return [
        ...(opener.length > 0 ? [line(kind, renderInline(opener))] : []),
        'box',
        ...planBlocks(childrenOf(node), { list: undefined }, images),
        '/box',
      ]

    case 'sideBySide': {
      const panels = childrenOf(node)
      return [
        ...(opener.length > 0 ? [line(kind, renderInline(opener))] : []),
        `side:${panels.length}`,
        ...panels.flatMap((panel, index) => {
          const content = planBlocks(childrenOf(panel), {}, images)
          return [`panel:${index}`, ...(content.length > 0 ? content : ['para'])]
        }),
        '/side',
      ]
    }

    case 'bullet_list':
    case 'ordered_list': {
      const ordered = node.type === 'ordered_list'
      const level = context.list ? context.list.level + 1 : 0
      let opening = context.opener
      return childrenOf(node).flatMap((child) => {
        const produced = planBlock(
          child,
          { ...context, opener: opening, list: { ordered, level } },
          images,
        )
        if (produced.length > 0) opening = undefined
        return produced
      })
    }

    case 'list_item':
      return planBlocks(childrenOf(node), context, images)

    case 'code_block': {
      const source = childrenOf(node)
        .map((child) => stringOf(child.text))
        .join('')
      if (stringOf(attrs.language).toLowerCase() === 'latex') {
        return [line(kind, renderInline([...opener, { kind: 'math', source }]))]
      }
      const lines = source.split('\n')
      return [
        line(
          'code',
          renderInline([
            ...opener,
            ...lines.flatMap((text, index): Segment[] => [
              ...(index > 0 ? [{ kind: 'break' as const }] : []),
              { kind: 'text' as const, text, marks: ['inlineCode'] },
            ]),
          ]),
        ),
      ]
    }

    case 'image':
      return [
        line(
          kind,
          renderInline([
            ...opener,
            { kind: 'image', ordinal: images.take(stringOf(attrs.src)) },
          ]),
        ),
      ]

    case 'image-block': {
      const caption = stringOf(attrs.caption)
      const figure = line(
        own,
        renderInline([
          ...opener,
          { kind: 'image', ordinal: images.take(stringOf(attrs.src)) },
        ]),
      )
      return caption
        ? [
            figure,
            line(own, renderInline([{ kind: 'text', text: caption, marks: ['emphasis'] }])),
          ]
        : [figure]
    }

    case 'hr':
      return [line('rule', renderInline(opener))]

    case 'table':
      // A table cannot carry the opening run, so it takes a line of its own.
      return [
        ...(opener.length > 0 ? [line(kind, renderInline(opener))] : []),
        ...planTable(node, images),
      ]

    case 'table_header_row':
    case 'table_row':
      return planBlocks(childrenOf(node), context, images)

    default: {
      const children = childrenOf(node)
      return children.length > 0
        ? planBlocks(children, context, images)
        : [line(kind, renderInline([...opener, ...inlineSegments(node, images)]))]
    }
  }
}

function planTable(node: ProseMirrorJSON, images: ImageOrdinals): ContentLine[] {
  const rows = childrenOf(node).filter(
    (row) => row.type === 'table_row' || row.type === 'table_header_row',
  )
  const columns = rows.reduce(
    (widest, row) => Math.max(widest, childrenOf(row).length),
    1,
  )
  const lines: ContentLine[] = [centredKind(`table:${rows.length}x${columns}`, node)]
  rows.forEach((row, rowIndex) => {
    for (let column = 0; column < columns; column += 1) {
      lines.push(`cell:${rowIndex},${column}`)
      const cell = childrenOf(row)[column]
      const content = cell ? planBlocks(childrenOf(cell), {}, images) : []
      lines.push(...(content.length > 0 ? content : ['para']))
    }
  })
  lines.push('/table')
  return lines
}

// The grid is a table like any other, so a collapse into paragraphs is loud:
// the `table:` line disappears and every letter runs into the answer beside it.
function planGrid(grid: ChoiceGrid, images: ImageOrdinals): ContentLine[] {
  const lines: ContentLine[] = [`table:${grid.rows}x${grid.columns}`]
  grid.cells.forEach((row, rowIndex) => {
    row.forEach((choice, column) => {
      lines.push(`cell:${rowIndex},${column}`)
      const content = choice
        ? planBlocks(
            childrenOf(choice.node),
            {
              opener: [{ kind: 'text', text: `${printedLabel(choice.letter, choice.printed)} `, marks: [] }],
            },
            images,
          )
        : []
      lines.push(...(content.length > 0 ? content : ['para']))
    })
  })
  lines.push('/table')
  return lines
}

// A matching set is a table either way — one row of two cells with the
// prompts stacked in one and the Word Bank in the other, or a bank grid over a
// run of prompt paragraphs — so a set that came apart into a run of
// paragraphs, or lost its bank, is as loud as a collapsed choice grid. Each
// prompt opens with its blank and number, each answer with its letter.
function planMatching(set: MatchingSet, images: ImageOrdinals): ContentLine[] {
  const cellLines = (node: ProseMirrorJSON, opener: string) =>
    planBlocks(
      childrenOf(node),
      { opener: [{ kind: 'text', text: opener, marks: [] }] },
      images,
    )
  const column = (cells: { node: ProseMirrorJSON; opener: string }[]) => {
    const lines = cells.flatMap((cell) => cellLines(cell.node, cell.opener))
    return lines.length > 0 ? lines : ['para']
  }
  const prompts = set.prompts.map((prompt) => ({
    node: prompt.node,
    opener: `_______ ${printedLabel(prompt.number, prompt.printed)} `,
  }))
  if (set.bankGrid) {
    const lines: ContentLine[] = [`table:${set.bankGrid.rows}x${set.bankGrid.columns}`]
    set.bankGrid.cells.forEach((row, rowIndex) => {
      row.forEach((answer, column) => {
        lines.push(`cell:${rowIndex},${column}`)
        const content = answer ? cellLines(answer.node, `${printedLabel(answer.letter, answer.printed)} `) : []
        lines.push(...(content.length > 0 ? content : ['para']))
      })
    })
    lines.push('/table')
    return [...lines, ...prompts.flatMap((prompt) => cellLines(prompt.node, prompt.opener))]
  }
  return [
    'table:1x2',
    'cell:0,0',
    ...column(prompts),
    'cell:0,1',
    ...column(
      set.bank.map((answer) => ({ node: answer.node, opener: `${printedLabel(answer.letter, answer.printed)} ` })),
    ),
    '/table',
  ]
}

/** A work space as the vocabulary writes it. Its height is geometry and is not
 *  compared; whether it is there, blank or ruled, and how many rules it
 *  carries, is content a student writes on. */
/** A work space's line; `points` are what stands on its last rule, read as
 *  its own text: `space:lines:3:dotted [3]`. */
export function workSpaceLine(style: string, lines: number, ruling?: string, points?: string): ContentLine {
  if (style !== 'lines') return 'space:blank'
  const space = ruling === 'dotted' ? `space:lines:${lines}:dotted` : `space:lines:${lines}`
  return points ? `${space} ${normalizeSpace(points).trim()}` : space
}

/** A planned work space's line, when it takes any room, and the Points after
 *  the answer it ends — on its last rule when it has one
 *  (`pointsOnLastRule`), otherwise a paragraph of their own. */
function answerSpaceLines(space: PlannedWorkSpace | null, pointsAfter?: string): ContentLine[] {
  if (pointsAfter && pointsOnLastRule(space)) {
    return [workSpaceLine(space!.style, space!.lines, space!.ruling, pointsAfter)]
  }
  return [
    ...(space && space.height > 0 ? [workSpaceLine(space.style, space.lines, space.ruling)] : []),
    ...pointsLines(pointsAfter ? [pointsAfter] : undefined),
  ]
}

/** Points printed after an answer or a question: a paragraph of their own. */
function pointsLines(texts: readonly string[] | undefined): ContentLine[] {
  return (texts ?? []).map((text) => line('para', renderInline([{ kind: 'text', text, marks: [] }])))
}

function planQuestion(item: QuestionItem, images: ImageOrdinals): ContentLine[] {
  const opener: Segment[] = printsNumberLine(item)
    ? [
        {
          kind: 'text',
          text: `${[...item.question.marks, printedNumberOf(item.question)].join(' ')} `,
          marks: [],
        },
      ]
    : []
  // A Multipart question with no stem opens with Part (a) on its number's
  // line, so the number opens the Part's first line instead.
  const opening = partsOpenNumberLine(item)
  const stem =
    item.stem.length > 0
      ? planBlocks(item.stem, { opener }, images)
      : opener.length > 0 && !opening
        ? [line('para', renderInline(opener))]
        : []
  return [
    ...stem,
    ...(item.grid ? planGrid(item.grid, images) : []),
    ...(item.matching ? planMatching(item.matching, images) : []),
    ...answerSpaceLines(item.workSpace, item.pointsAfter),
    ...(item.parts ?? []).flatMap((part, index) =>
      planPart(part, images, opening && index === 0 ? opener : [])),
    ...pointsLines(item.closingPoints),
  ]
}

// A Multipart question's Part reads as a question of its kind does: its letter
// opens its stem, and its grid or work space follows — or, for a Part that
// holds Subparts, each Subpart read the same way under its own label. A piece
// continued from an earlier page carries no letter or label, only the stem
// blocks it carries and what follows them (ADR-0048).
// `lead` is what opens the Part's first line before its own letter: the
// question's number, when the Part prints on the number's line. A Part with
// no lead-in passes its letter on, with the lead, to its first Subpart.
function planPart(part: PlannedPart, images: ImageOrdinals, lead: Segment[] = []): ContentLine[] {
  const letter: Segment[] = [...lead, { kind: 'text', text: `${printedLabel(part.letter, part.printed)} `, marks: [] }]
  const opening = subpartsOpenLabelLine(part)
  return [
    ...(opening ? [] : planAnswering(part.continued ? [] : letter, part, images)),
    ...part.subparts.flatMap((subpart, index) =>
      planAnswering(
        subpart.continued
          ? []
          : [
              ...(opening && index === 0 ? letter : []),
              { kind: 'text', text: `${printedLabel(subpart.label, subpart.printed)} `, marks: [] },
            ],
        subpart,
        images,
      )),
  ]
}

function planAnswering(
  opener: Segment[],
  part: Pick<PlannedPart, 'stem' | 'grid' | 'workSpace' | 'pointsAfter'>,
  images: ImageOrdinals,
): ContentLine[] {
  const stem = planBlocks(part.stem, { opener }, images)
  return [
    ...(stem.length > 0 ? stem : opener.length > 0 ? [line('para', renderInline(opener))] : []),
    ...(part.grid ? planGrid(part.grid, images) : []),
    ...answerSpaceLines(part.workSpace, part.pointsAfter),
  ]
}

/** An Answer Key line's `[n]`, after its answer, when it has points. */
export function pointsSegments(points: number | undefined): Segment[] {
  return points === undefined ? [] : [{ kind: 'text', text: ` ${answerKeyPointsText(points)}`, marks: [] }]
}

export function planItemLines(
  item: PageItem,
  images: ImageOrdinals,
): ContentLine[] {
  switch (item.kind) {
    case 'paper-total':
      return [line('para', renderInline([{ kind: 'text', text: item.text, marks: [] }]))]
    case 'section-heading':
      // A cleared part says nothing in any format, so it says nothing here.
      return [
        ...(item.title ? [`heading:1 ${item.title}`] : []),
        ...(item.instructions
          ? [line(
              'para',
              renderInline([
                { kind: 'text', text: item.instructions, marks: ['emphasis'] },
              ]),
            )]
          : []),
      ]
    case 'question':
      return planQuestion(item, images)
    case 'answer-key-heading':
      // The paper's total shares the heading's line in every adapter.
      return [
        item.totalPoints !== undefined
          ? `heading:1 Answer Section ${answerKeyTotalText(item.totalPoints)}`
          : 'heading:1 Answer Section',
      ]
    case 'answer-key-section':
      return [`heading:2 ${item.title}`]
    case 'answer-key-entry': {
      const metadata = [
        ...(item.difficulty
          ? [item.difficulty[0]!.toUpperCase() + item.difficulty.slice(1)]
          : []),
        ...(item.topics ?? []),
      ]
      return [
        line(
          'para',
          renderInline([
            { kind: 'text', text: `${item.number}. `, marks: [] },
            ...(item.letter
              ? [{ kind: 'text' as const, text: item.letter, marks: ['strong'] }]
              : []),
            ...pointsSegments(item.points),
            ...(metadata.length > 0
              ? [{ kind: 'text' as const, text: ` ${metadata.join(' ')}`, marks: [] }]
              : []),
          ]),
        ),
        ...(item.suggestedAnswer ? planBlocks(item.suggestedAnswer, {}, images) : []),
        ...(item.parts ?? []).flatMap((part) => [
          line(
            'para',
            renderInline([
              { kind: 'text', text: `${part.letter}. `, marks: [] },
              ...(part.answer
                ? [{ kind: 'text' as const, text: part.answer, marks: ['strong'] }]
                : []),
              ...pointsSegments(part.points),
            ]),
          ),
          ...(part.suggestedAnswer ? planBlocks(part.suggestedAnswer, {}, images) : []),
        ]),
      ]
    }
    default: {
      const unreachable: never = item
      return unreachable
    }
  }
}

function furnitureLines(furniture: PageFurniture): {
  header: ContentLine[]
  footer: ContentLine[]
} {
  const identity = [
    ...(furniture.identityLine !== undefined
      ? [normalizeSpace(furniture.identityLine).trim()]
      : furniture.identityFields.map((field) => `${field}:`)),
    furniture.arrangementLabel,
  ].filter(Boolean).join(' ')
  return {
    header: [
      // A page number printed at the top is a row of its own, above the line.
      ...(furniture.pageNumberAt === 'top' ? [`para ${furniture.pageNumber}`] : []),
      // An unlabeled answer key page's identity line holds nothing at all.
      identity ? `para ${identity}` : 'para',
      ...(furniture.title === null ? [] : [`heading:title ${furniture.title}`]),
    ],
    footer: [line('para', runningFootOf(furniture).join(' '))],
  }
}

/**
 * The prepared Layout Plans reduced to the comparison vocabulary. This is the
 * reference side of every parity assertion: what the planned documents say,
 * page by page, in published order.
 *
 * A collection rather than one plan because an export is a collection: the
 * pages of every standalone student test and answer key run on, one after
 * another, exactly as an adapter serializes them.
 */
export function layoutFingerprint(
  plans: readonly LayoutPlan[],
): ExportFingerprint {
  const images = new ImageOrdinals()
  const pages = plans.flatMap((plan) =>
    plan.pages.map((page) => ({
      number: page.furniture.pageNumber,
      width: plan.pageSize.width,
      height: plan.pageSize.height,
      margins: { ...plan.pageSize.margins },
      ...furnitureLines(page.furniture),
      content: page.items.flatMap((item) => planItemLines(item, images)),
    })),
  )
  return {
    title: plans[0]?.title ?? '',
    arrangement: arrangementRange([...new Set(plans.map((plan) => plan.arrangement.letter))]),
    pages,
    media: images.list,
  }
}

/** The semantic stage on its own, before anything knows about pages. What the
 *  exam says, in order, with no page assignment to hide a content change behind. */
export function exportDocumentFingerprint(document: ExportDocument): {
  title: string
  arrangement: string
  test: ContentLine[]
  answerKey: ContentLine[]
} {
  return {
    title: document.title,
    arrangement: document.arrangement.letter,
    test: document.test.flatMap((item) => planItemLines(item, new ImageOrdinals())),
    answerKey: document.answerKey.flatMap((item) =>
      planItemLines(item, new ImageOrdinals()),
    ),
  }
}

// ---------------------------------------------------------------------------
// Comparison

export type ParityDifference = {
  /** 1-based page the difference is on, or `null` for a document-wide one. */
  page: number | null
  what: 'page-count' | 'page-size' | 'header' | 'footer' | 'content' | 'media' | 'metadata'
  detail: string
  expected?: string
  actual?: string
}

function compareLines(
  what: ParityDifference['what'],
  page: number | null,
  expected: readonly ContentLine[],
  actual: readonly ContentLine[],
): ParityDifference[] {
  const length = Math.max(expected.length, actual.length)
  for (let index = 0; index < length; index += 1) {
    if (expected[index] === actual[index]) continue
    return [
      {
        page,
        what,
        detail:
          actual[index] === undefined
            ? `line ${index + 1} is missing`
            : expected[index] === undefined
              ? `line ${index + 1} is additional`
              : `line ${index + 1} differs`,
        expected: expected[index] ?? '(nothing)',
        actual: actual[index] ?? '(nothing)',
      },
    ]
  }
  return []
}

/**
 * Every way `actual` fails to be the same document as `expected`, most
 * structural first, and at most one content difference per page — the first
 * one, which is the one worth reading.
 */
export function compareFingerprints(
  expected: ExportFingerprint,
  actual: ExportFingerprint,
): ParityDifference[] {
  const differences: ParityDifference[] = []
  if (expected.title !== actual.title) {
    differences.push({
      page: null,
      what: 'metadata',
      detail: 'document title differs',
      expected: expected.title,
      actual: actual.title,
    })
  }
  if (expected.pages.length !== actual.pages.length) {
    differences.push({
      page: null,
      what: 'page-count',
      detail: `expected ${expected.pages.length} pages, found ${actual.pages.length}`,
    })
  }
  const pages = Math.min(expected.pages.length, actual.pages.length)
  for (let index = 0; index < pages; index += 1) {
    const reference = expected.pages[index]!
    const candidate = actual.pages[index]!
    const number = index + 1
    if (
      reference.width !== candidate.width
      || reference.height !== candidate.height
    ) {
      differences.push({
        page: number,
        what: 'page-size',
        detail: 'page dimensions differ',
        expected: `${reference.width}x${reference.height}`,
        actual: `${candidate.width}x${candidate.height}`,
      })
    }
    // The Exam's Page Margins are part of the sheet: a page cut with other
    // margins holds its content in a different box.
    const marginsOf = (page: PageFingerprint) =>
      MARGIN_SIDES.map((side) => page.margins[side]).join(' ')
    if (marginsOf(reference) !== marginsOf(candidate)) {
      differences.push({
        page: number,
        what: 'page-size',
        detail: 'page margins differ',
        expected: marginsOf(reference),
        actual: marginsOf(candidate),
      })
    }
    differences.push(
      ...compareLines('header', number, reference.header, candidate.header),
      ...compareLines('footer', number, reference.footer, candidate.footer),
      ...compareLines('content', number, reference.content, candidate.content),
    )
  }
  // Media is checked for presence, not for count. Which image sits where is
  // already in the content lines as `⟨image:n⟩` in document order, and an image
  // that failed to package shows up there as placeholder text rather than as a
  // picture. Counts genuinely differ without meaning anything: the plan names an
  // image by its source, while a package names it by the part it wrote and is
  // free to store one part for two identical pictures.
  if (expected.media.length > 0 !== actual.media.length > 0) {
    differences.push({
      page: null,
      what: 'media',
      detail:
        actual.media.length === 0
          ? 'the document has images but the output packaged none'
          : 'the output packaged images the document does not have',
      expected: expected.media.join(', ') || '(none)',
      actual: actual.media.join(', ') || '(none)',
    })
  }
  return differences
}

/** A comparison as something a person can read in a failure message. */
export function describeDifferences(
  differences: readonly ParityDifference[],
): string {
  if (differences.length === 0) return 'no differences'
  return differences
    .map((difference) => {
      const where = difference.page === null ? 'document' : `page ${difference.page}`
      const detail = `${where}: ${difference.what} — ${difference.detail}`
      return difference.expected === undefined
        ? detail
        : `${detail}\n    expected: ${difference.expected}\n    actual:   ${difference.actual}`
    })
    .join('\n')
}
