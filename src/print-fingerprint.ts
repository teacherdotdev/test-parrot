// The print side of the comparison.
//
// Renders a Layout Plan through the print Export Adapter's own components — the
// same ones `exam-page.tsx` draws and `dom-measure.ts` measures — and reduces
// the result to the content lines `export-fingerprint.ts` defines. Print is the
// authoritative presentation, so this is the side a DOCX has to match, and it
// is read out of the adapter's real markup rather than restated by hand.
//
// The normalizer knows each adapter's presentation contract, which is the point:
// a `.section-instructions` paragraph is italic in print by stylesheet and
// italic in Word by run property, and both mean the same emphasis. Class names
// are read only where the intent lives in the stylesheet rather than the markup.
//
// Test and diagnostic code only. Nothing in the application imports it.

import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  line,
  normalizeSpace,
  renderInline,
  type ContentLine,
  type ExportFingerprint,
  type PageFingerprint,
  type PageMarginsPx,
  type Segment,
  workSpaceLine,
} from './export-fingerprint'
import type { LayoutPlan, PlannedPage } from './export-plan'
import { arrangementRange } from './export-preparation'
import { PageFooterContent, PageHeaderContent, PageItemMeasureView } from './page-item-view'
import { parseXml, type XmlNode } from './xml'

// The tags print uses for each inline mark, which is how the intent is read
// back off the adapter's own markup.
const TAG_MARKS: Record<string, string> = {
  strong: 'strong',
  b: 'strong',
  em: 'emphasis',
  i: 'emphasis',
  code: 'inlineCode',
  s: 'strike_through',
  del: 'strike_through',
  sub: 'subscript',
  sup: 'superscript',
}

// React hoists resource hints — `<link rel="preload">` for an image it is about
// to draw — to the front of the markup. They are loading instructions, not
// content, and never reach the printed page.
const HOISTED = new Set(['link', 'meta', 'title', 'script', 'style'])

// Editing chrome, hidden by the `@media print` rule in styles.css. It is on the
// page a teacher clicks, never on the page a printer prints, so it is not part
// of the printed document either.
const PRINT_HIDDEN = [
  'document-bar',
  'question-handles',
  'work-space-handle',
  'context-menu',
  'measure-host',
  'dialog-backdrop',
]

function isHoisted(node: XmlNode): boolean {
  return (
    HOISTED.has(node.name)
    || PRINT_HIDDEN.some((className) => has(node, className))
  )
}

function classes(node: XmlNode): string[] {
  return (node.attrs.class ?? '').split(/\s+/).filter(Boolean)
}

function has(node: XmlNode, className: string): boolean {
  return classes(node).includes(className)
}

function find(node: XmlNode, className: string): XmlNode | undefined {
  for (const child of node.children) {
    if (has(child, className)) return child
    const nested = find(child, className)
    if (nested) return nested
  }
  return undefined
}

function textOf(node: XmlNode): string {
  return node.text + node.children.map(textOf).join('')
}

// KaTeX keeps the expression it was handed in a MathML annotation, which is the
// only part of its output that is content rather than typesetting.
function texOf(node: XmlNode): string {
  const annotation = (function search(current: XmlNode): XmlNode | undefined {
    for (const child of current.children) {
      if (child.name === 'annotation') return child
      const nested = search(child)
      if (nested) return nested
    }
    return undefined
  })(node)
  return annotation ? textOf(annotation) : textOf(node)
}

type Reader = { nextImage: () => number }

function inlineSegments(
  node: XmlNode,
  marks: readonly string[],
  reader: Reader,
): Segment[] {
  const segments: Segment[] = []
  if (node.text) segments.push({ kind: 'text', text: node.text, marks: [...marks] })
  for (const child of node.children) {
    if (has(child, 'doc-math')) {
      segments.push({ kind: 'math', source: texOf(child) })
    } else if (child.name === 'br') {
      segments.push({ kind: 'break' })
    } else if (child.name === 'img') {
      segments.push({ kind: 'image', ordinal: reader.nextImage() })
    } else if (child.name === 'a') {
      segments.push(
        ...inlineSegments(child, [...marks, `link:${child.attrs.href ?? ''}`], reader),
      )
    } else {
      const mark = TAG_MARKS[child.name]
      segments.push(
        ...inlineSegments(child, mark ? [...marks, mark] : marks, reader),
      )
    }
    if (child.text === undefined) continue
  }
  // Text that follows a child element is held on that child in this parser, so
  // it has already been collected above.
  return segments
}

/** A paragraph ProseMirror gave a trailing break so it still occupies a line:
 *  the break is the renderer's, not the author's. */
function isBlankParagraph(node: XmlNode): boolean {
  return (
    node.children.length === 1
    && node.children[0]!.name === 'br'
    && textOf(node).trim() === ''
  )
}

const HEADING_CLASSES: Record<string, string> = {
  'exam-title': 'heading:title',
  'section-title': 'heading:1',
  'answer-key-heading': 'heading:1',
  'answer-key-section': 'heading:2',
}

/** The `[n]` an Answer Key line prints after its answer, read as text. */
function pointsText(node: XmlNode | undefined): Segment[] {
  const text = node ? normalizeSpace(textOf(node)).trim() : ''
  return text ? [{ kind: 'text', text: ` ${text}`, marks: [] }] : []
}

/** A line's kind, marked `:center` where print centres the block. */
function alignedKind(kind: string, node: XmlNode): string {
  return node.attrs['data-align'] === 'center' ? `${kind}:center` : kind
}

function blockLines(
  node: XmlNode,
  reader: Reader,
  opener: Segment[] = [],
): ContentLine[] {
  // A work space is drawn, not written: the rules are what it says.
  if (has(node, 'work-space')) {
    const rules = node.children.filter((child) => has(child, 'work-space-line')).length
    // An answer's `[n]` on its last rule is the rule's own text.
    const points = find(node, 'work-space-points')
    return [workSpaceLine(
      node.attrs['data-style'] ?? 'blank',
      rules,
      node.attrs['data-ruling'],
      points ? normalizeSpace(textOf(points)).trim() : undefined,
    )]
  }
  const headingClass = classes(node).find((name) => HEADING_CLASSES[name])
  if (headingClass) {
    return [
      line(HEADING_CLASSES[headingClass]!, renderInline(inlineSegments(node, [], reader))),
    ]
  }
  // Italic by stylesheet rather than by markup, so the intent has to be read
  // from the rule that carries it.
  if (has(node, 'section-instructions')) {
    return [line('para', `«emphasis»${normalizeSpace(textOf(node)).trim()}«/»`)]
  }
  // The key's line is a number and, for multiple choice, the letter it earned —
  // bold in print by stylesheet, bold in Word by run property.
  if (has(node, 'answer-key-entry')) {
    // A Multipart question's Part lines are read on their own, after the entry's own
    // line, so nothing below looks inside them for the entry's answer.
    const partsBlock = node.children.find((child) => has(child, 'answer-key-parts'))
    if (partsBlock) {
      return [
        ...blockLines(
          { ...node, children: node.children.filter((child) => child !== partsBlock) },
          reader,
          opener,
        ),
        ...partsBlock.children.flatMap((part) => {
          const answer = find(part, 'answer-key-answer')
          const letter = find(part, 'answer-key-part-letter')
          const suggested = find(part, 'answer-key-suggested')
          const partPoints = find(part, 'answer-key-points')
          const text = answer ? normalizeSpace(textOf(answer)).trim() : ''
          return [
            line(
              'para',
              renderInline([
                {
                  kind: 'text',
                  text: `${letter ? normalizeSpace(textOf(letter)).trim() : ''} `,
                  marks: [],
                },
                ...(text ? [{ kind: 'text' as const, text, marks: ['strong'] }] : []),
                ...pointsText(partPoints),
              ]),
            ),
            ...(suggested ? childBlocks(suggested, reader) : []),
          ]
        }),
      ]
    }
    const answer = find(node, 'answer-key-answer')
    const metadata = find(node, 'answer-key-metadata')
    const suggested = find(node, 'answer-key-suggested')
    const entryPoints = find(node, 'answer-key-points')
    const number = node.children.find(
      (child) => child !== answer && child !== metadata && child !== suggested && child !== entryPoints,
    )
    const letter = answer ? normalizeSpace(textOf(answer)).trim() : ''
    const metadataText = metadata
      ? metadata.children
          .map((child) => normalizeSpace(textOf(child)).trim())
          .filter(Boolean)
          .join(' ')
      : ''
    return [
      line(
        'para',
        renderInline([
          {
            kind: 'text',
            text: `${number ? normalizeSpace(textOf(number)).trim() : ''} `,
            marks: [],
          },
          ...(letter ? [{ kind: 'text' as const, text: letter, marks: ['strong'] }] : []),
          ...pointsText(entryPoints),
          ...(metadataText
            ? [{ kind: 'text' as const, text: ` ${metadataText}`, marks: [] }]
            : []),
        ]),
      ),
      // A Suggested Answer is ordinary content on the lines below.
      ...(suggested ? childBlocks(suggested, reader) : []),
    ]
  }
  // A matching set's prompt opens with its blank and number, and a Word Bank
  // answer with its letter — beside the content rather than inside it, as a
  // choice cell keeps its letter, and exactly as the DOCX adapter opens each.
  if (has(node, 'matching-prompt') || has(node, 'matching-answer')) {
    const body = find(node, 'matching-body')
    const blank = find(node, 'matching-blank')
    const label = find(node, 'matching-count') ?? find(node, 'matching-letter')
    const text = [blank ? '_______' : '', label ? normalizeSpace(textOf(label)).trim() : '']
      .filter(Boolean)
      .join(' ')
    const cellOpener: Segment[] = text
      ? [...opener, { kind: 'text', text: `${text} `, marks: [] }]
      : opener
    return body ? childBlocks(body, reader, cellOpener) : []
  }
  // A Multipart question's Part opens with its blank and letter, from its own letter
  // column, as a question opens with its number — then its stem, then its
  // choice grid or work space, or the Subparts it holds, each read the same
  // way. A Part continued from an earlier page prints neither letter nor
  // lead-in, so only its Subparts are read.
  //
  // Parts that open on the question's number line, and Subparts that open on
  // their Part's letter line, say so by their stylesheet class: the number,
  // or the letter, then opens their first line rather than a line of its own.
  if (has(node, 'multipart-parts-print') || has(node, 'multipart-subparts-print')) {
    const opening = has(node, 'multipart-parts-print--opening') || has(node, 'multipart-subparts-print--opening')
    return [
      ...(!opening && opener.length > 0 ? [line('para', renderInline(opener))] : []),
      ...childBlocks(node, reader, opening ? opener : []),
    ]
  }
  if (has(node, 'multipart-part-print')) {
    if (node.attrs['data-continued'] !== undefined) {
      const body = find(node, 'part-body')
      return body ? childBlocks(body, reader) : []
    }
    const letter = find(node, 'part-letter')
    const body = find(node, 'part-body')
    const text = letter
      ? [
          find(letter, 'answer-blank') ? '_______' : '',
          normalizeSpace(textOf(letter)).trim(),
        ].filter(Boolean).join(' ')
      : ''
    const partOpener: Segment[] = [...opener, ...(text ? [{ kind: 'text' as const, text: `${text} `, marks: [] }] : [])]
    const stem = body?.children.find((child) => has(child, 'question-stem'))
    const stemLines = stem ? childBlocks(stem, reader, partOpener) : []
    const rest = body ? { ...body, children: body.children.filter((child) => child !== stem) } : undefined
    if (stemLines.length > 0) return [...stemLines, ...(rest ? childBlocks(rest, reader) : [])]
    // No stem: the letter is handed to the Subparts, which open on its line
    // or not, or takes a line of its own above its answers.
    const next = rest?.children.find((child) => !isHoisted(child))
    if (rest && next && has(next, 'multipart-subparts-print')) return childBlocks(rest, reader, partOpener)
    return [line('para', renderInline(partOpener)), ...(rest ? childBlocks(rest, reader) : [])]
  }
  if (has(node, 'doc-figure')) {
    const lines: ContentLine[] = []
    const img = node.children.find((child) => child.name === 'img')
    lines.push(
      line(
        alignedKind('para', node),
        renderInline([
          ...opener,
          { kind: 'image', ordinal: img ? reader.nextImage() : 0 },
        ]),
      ),
    )
    const caption = node.children.find((child) => child.name === 'figcaption')
    if (caption) {
      lines.push(
        line(alignedKind('para', node), `«emphasis»${normalizeSpace(textOf(caption)).trim()}«/»`),
      )
    }
    return lines
  }

  // A Side-by-Side is a grid of Panels, read Panel by Panel. Like a table it
  // cannot carry the opening run, so that takes a line of its own.
  if (has(node, 'doc-side-by-side')) {
    const panels = node.children.filter((child) => has(child, 'doc-panel'))
    return [
      ...(opener.length > 0 ? [line('para', renderInline(opener))] : []),
      `side:${panels.length}`,
      ...panels.flatMap((panel, index) => {
        const content = childBlocks(panel, reader)
        return [`panel:${index}`, ...(content.length > 0 ? content : ['para'])]
      }),
      '/side',
    ]
  }

  // Display mathematics is a block of its own: KaTeX draws it into a span, so
  // the tag says nothing and the class is what carries the intent.
  if (has(node, 'doc-math')) {
    return [line('para', renderInline([...opener, { kind: 'math', source: texOf(node) }]))]
  }

  switch (node.name) {
    case 'p':
      return [
        line(
          alignedKind('para', node),
          isBlankParagraph(node)
            ? renderInline(opener)
            : renderInline([...opener, ...inlineSegments(node, [], reader)]),
        ),
      ]
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return [
        line(
          `heading:${node.name[1]}`,
          renderInline([...opener, ...inlineSegments(node, [], reader)]),
        ),
      ]
    case 'blockquote':
      return [
        ...(opener.length > 0 ? [line('para', renderInline(opener))] : []),
        'box',
        ...childBlocks(node, reader),
        '/box',
      ]
    case 'ul':
    case 'ol': {
      let opening = opener
      return node.children.flatMap((item) => {
        const produced = listLines(item, reader, node.name === 'ol', 0, opening)
        if (produced.length > 0) opening = []
        return produced
      })
    }
    case 'pre': {
      const source = textOf(node)
      return [
        line(
          'code',
          renderInline([
            ...opener,
            ...source.split('\n').flatMap((text, index): Segment[] => [
              ...(index > 0 ? [{ kind: 'break' as const }] : []),
              { kind: 'text' as const, text, marks: ['inlineCode'] },
            ]),
          ]),
        ),
      ]
    }
    case 'hr':
      return [line('rule', renderInline(opener))]
    case 'img':
      return [
        line(
          'para',
          renderInline([...opener, { kind: 'image', ordinal: reader.nextImage() }]),
        ),
      ]
    case 'table':
      return [
        ...(opener.length > 0 ? [line('para', renderInline(opener))] : []),
        ...tableLines(node, reader),
      ]
    default:
      return childBlocks(node, reader, opener)
  }
}

function listLines(
  item: XmlNode,
  reader: Reader,
  ordered: boolean,
  level: number,
  opener: Segment[] = [],
): ContentLine[] {
  const lines: ContentLine[] = []
  let opening = opener
  for (const child of item.children) {
    if (child.name === 'ul' || child.name === 'ol') {
      for (const nested of child.children) {
        const produced = listLines(
          nested,
          reader,
          child.name === 'ol',
          level + 1,
          opening,
        )
        if (produced.length > 0) opening = []
        lines.push(...produced)
      }
      continue
    }
    lines.push(
      line(
        `list:${ordered ? 'ordered' : 'bullet'}:${level}`,
        renderInline([...opening, ...inlineSegments(child, [], reader)]),
      ),
    )
    opening = []
  }
  return lines
}

function childBlocks(
  node: XmlNode,
  reader: Reader,
  opener: Segment[] = [],
): ContentLine[] {
  const lines: ContentLine[] = []
  let remaining = opener
  for (const child of node.children) {
    if (isHoisted(child)) continue
    const produced = blockLines(child, reader, remaining)
    lines.push(...produced)
    if (produced.length > 0) remaining = []
  }
  return lines
}

function tableLines(table: XmlNode, reader: Reader): ContentLine[] {
  const body = table.children.find((child) => child.name === 'tbody') ?? table
  const rows = body.children.filter((child) => child.name === 'tr')
  const columns = rows.reduce(
    (widest, row) =>
      Math.max(
        widest,
        row.children.filter((cell) => cell.name === 'td' || cell.name === 'th').length,
      ),
    1,
  )
  const lines: ContentLine[] = [alignedKind(`table:${rows.length}x${columns}`, table)]
  rows.forEach((row, rowIndex) => {
    const cells = row.children.filter(
      (cell) => cell.name === 'td' || cell.name === 'th',
    )
    for (let column = 0; column < columns; column += 1) {
      lines.push(`cell:${rowIndex},${column}`)
      const cell = cells[column]
      if (!cell) {
        lines.push('para')
        continue
      }
      // A choice cell puts its letter beside the answer rather than inside it.
      const letter = cell.children.find((child) => has(child, 'choice-letter'))
      const opener: Segment[] = letter
        ? [{ kind: 'text', text: `${normalizeSpace(textOf(letter)).trim()} `, marks: [] }]
        : []
      const content = childBlocks(
        { ...cell, children: cell.children.filter((child) => child !== letter) },
        reader,
        opener,
      )
      lines.push(...(content.length > 0 ? content : ['para']))
    }
  })
  lines.push('/table')
  return lines
}

// A question's number column is furniture on the page, not a block of its own:
// the answer blank and the number open the question's first paragraph, exactly
// as the DOCX adapter opens it. A matching set follows the body as a block of
// its own, spanning the number column: a table of two columns, or a bank grid
// over a run of numbered prompts.
function questionLines(node: XmlNode, reader: Reader): ContentLine[] {
  const number = find(node, 'question-number')
  const body = find(node, 'question-body')
  const set = find(node, 'matching-set')
  const closing = find(node, 'question-closing')
  const opener: Segment[] = []
  if (number) {
    const marks = find(number, 'question-marks')
    const count = find(number, 'question-count')
    const text = [
      ...(marks?.children ?? []).map((mark) => normalizeSpace(textOf(mark)).trim()),
      count ? normalizeSpace(textOf(count)).trim() : '',
    ]
      .filter(Boolean)
      .join(' ')
    if (text) opener.push({ kind: 'text', text: `${text} `, marks: [] })
  }
  return [
    ...(body ? childBlocks(body, reader, opener) : []),
    ...(set ? childBlocks(set, reader) : []),
    ...(closing ? childBlocks(closing, reader) : []),
  ]
}

/** A page's foot as one line: what each of its parts says, in order. */
function footLine(footer: XmlNode): ContentLine {
  const parts = footer.children.length > 0
    ? footer.children.map((child) => normalizeSpace(textOf(child)).trim())
    : [normalizeSpace(footer.text).trim()]
  return line('para', parts.filter(Boolean).join(' '))
}

function elementLines(element: XmlNode, reader: Reader): ContentLine[] {
  if (has(element, 'exam-question')) return questionLines(element, reader)
  return blockLines(element, reader)
}

function itemLines(markup: string, reader: Reader): ContentLine[] {
  const element = parseXml(markup).children.find((child) => !isHoisted(child))
  return element ? elementLines(element, reader) : []
}

function furnitureLines(header: XmlNode | string, reader: Reader): ContentLine[] {
  const root =
    typeof header === 'string'
      ? parseXml(header).children.find((child) => !isHoisted(child))
      : header
  if (!root) return []
  const identity = find(root, 'page-identity')
  const lines: ContentLine[] = []
  // A page number printed at the top is a row of its own, above the line.
  const head = find(root, 'page-running-head')
  if (head) lines.push(line('para', normalizeSpace(textOf(head)).trim()))
  if (identity) {
    const fields = identity.children.map((child) =>
      normalizeSpace(textOf(child)).trim(),
    )
    lines.push(line('para', fields.filter(Boolean).join(' ')))
  }
  const title = find(root, 'exam-title')
  if (title) lines.push(...blockLines(title, reader))
  return lines
}

function pageFingerprint(
  page: PlannedPage,
  plan: LayoutPlan,
  reader: Reader,
): PageFingerprint {
  return {
    number: page.furniture.pageNumber,
    width: plan.pageSize.width,
    height: plan.pageSize.height,
    margins: { ...plan.pageSize.margins },
    header: furnitureLines(
      renderToStaticMarkup(
        createElement(PageHeaderContent, {
          header: page.header,
          furniture: page.furniture,
        }),
      ),
      reader,
    ),
    footer: (() => {
      const root = parseXml(
        renderToStaticMarkup(createElement(PageFooterContent, { furniture: page.furniture })),
      ).children.find((child) => !isHoisted(child))
      return root ? [footLine(root)] : []
    })(),
    content: page.items.flatMap((item) =>
      itemLines(
        renderToStaticMarkup(
          createElement(Fragment, null, createElement(PageItemMeasureView, { item })),
        ),
        reader,
      ),
    ),
  }
}

/** The print Export Adapter's own output, reduced to the shared vocabulary —
 *  every prepared document's pages, in the order print mounts them. */
export function printFingerprint(
  plans: readonly LayoutPlan[],
): ExportFingerprint {
  let images = 0
  const reader: Reader = { nextImage: () => (images += 1) }
  const pages = plans.flatMap((plan) =>
    plan.pages.map((page) => pageFingerprint(page, plan, reader)),
  )
  return {
    title: plans[0]?.title ?? '',
    arrangement: arrangementRange([...new Set(plans.map((plan) => plan.arrangement.letter))]),
    pages,
    media: Array.from({ length: images }, () => 'image'),
  }
}

// ---------------------------------------------------------------------------
// The printed document as the browser actually laid it out
//
// `printFingerprint` renders a plan the diagnostic built for itself. The
// out-of-band comparison needs the other thing: the document the running
// application produced, with real browser measurement deciding where the pages
// fell. That comes out of the print output's own markup.

function findAll(node: XmlNode, className: string, found: XmlNode[] = []): XmlNode[] {
  for (const child of node.children) {
    if (has(child, className)) found.push(child)
    else findAll(child, className, found)
  }
  return found
}

export type PrintedDocument = {
  title: string
  arrangement: string
  width: number
  height: number
  margins: PageMarginsPx
}

/**
 * The print output's markup, reduced to the shared vocabulary — one entry per
 * sheet the browser actually produced. Compare it with `docxFingerprint` and a
 * difference is a real difference between the printed paper and the Word file.
 */
export function printDocumentFingerprint(
  markup: string,
  document: PrintedDocument,
): ExportFingerprint {
  let images = 0
  const reader: Reader = { nextImage: () => (images += 1) }
  const root = parseXml(markup)
  const pages = findAll(root, 'exam-page').map((page, index) => {
    const header = findAll(page, 'page-header')[0]
    const footer = findAll(page, 'page-footer')[0]
    const content = findAll(page, 'page-content')[0]
    return {
      number: index + 1,
      width: document.width,
      height: document.height,
      margins: document.margins,
      header: header ? furnitureLines(header, reader) : [],
      footer: footer ? [footLine(footer)] : [],
      content: content
        ? content.children
            .filter((item) => !isHoisted(item))
            .flatMap((item) => elementLines(item, reader))
        : [],
    }
  })
  return {
    title: document.title,
    arrangement: document.arrangement,
    pages,
    media: Array.from({ length: images }, () => 'image'),
  }
}
