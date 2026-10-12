// The DOCX side of the comparison.
//
// Reads a generated package back and reduces it to the same content lines
// `export-fingerprint.ts` derives from a Layout Plan, so the two can simply be
// compared. This is what makes "the DOCX contains the planned document" an
// assertion rather than a hope, and it is deliberately built on stable package
// semantics — sections, styles, runs, relationships, numbering — rather than on
// ZIP bytes, part ordering, generated relationship ids or package timestamps.
//
// Test and diagnostic code only. Nothing in the application imports it.

import JSZip from 'jszip'
import {
  line,
  renderInline,
  type ContentLine,
  type ExportFingerprint,
  type PageFingerprint,
  type Segment,
  workSpaceLine,
} from './export-fingerprint'
import { child, descendants, parseXml, path, type XmlNode } from './xml'
import {
  BLOCKQUOTE_TABLE_STYLE,
  CENTRED_PARAGRAPH_STYLE,
  CENTRED_TABLE_STYLE,
  SIDE_BY_SIDE_TABLE_STYLE,
} from './docx-export'

// ---------------------------------------------------------------------------
// Package reading

const TWIPS_PER_PX = 15

function px(twips: string | undefined): number {
  return Math.round(Number(twips ?? 0) / TWIPS_PER_PX)
}

function exactPx(twips: string | undefined): number {
  return Math.round((Number(twips ?? 0) / TWIPS_PER_PX) * 100) / 100
}

type Package = {
  document: XmlNode
  core: XmlNode | undefined
  parts: Map<string, XmlNode>
  /** Relationship id to target, from `word/_rels/document.xml.rels`. */
  relationships: Map<string, string>
  /** Numbering instance id to whether that list is ordered. */
  ordered: Map<string, boolean>
  media: string[]
}

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

function mediaTypeOf(target: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(target)
  return extension ? (MEDIA_TYPES[extension[1]!.toLowerCase()] ?? 'image') : 'image'
}

async function readPackage(bytes: Uint8Array | ArrayBuffer): Promise<Package> {
  const zip = await JSZip.loadAsync(bytes)
  // The part's root element, not the parse's own wrapper.
  const read = async (name: string): Promise<XmlNode | undefined> => {
    const file = zip.file(name)
    return file ? parseXml(await file.async('string')).children[0] : undefined
  }

  const document = await read('word/document.xml')
  if (!document) throw new Error('The package has no word/document.xml')
  // Document metadata is a package-level part, not one the document body links.
  const core = await read('docProps/core.xml')

  const relationships = new Map<string, string>()
  const rels = await read('word/_rels/document.xml.rels')
  for (const relationship of rels ? descendants(rels, 'Relationship') : []) {
    relationships.set(relationship.attrs.Id ?? '', relationship.attrs.Target ?? '')
  }

  const parts = new Map<string, XmlNode>()
  for (const target of relationships.values()) {
    if (!target.endsWith('.xml')) continue
    const part = await read(`word/${target}`)
    if (part) parts.set(target, part)
  }

  // A list's marker format lives on level 0 of the abstract numbering the
  // instance points at. Bullet or not is the only thing a fingerprint reads.
  const ordered = new Map<string, boolean>()
  const numbering = await read('word/numbering.xml')
  if (numbering) {
    const abstract = new Map<string, boolean>()
    for (const definition of descendants(numbering, 'w:abstractNum')) {
      const level = descendants(definition, 'w:lvl').find(
        (candidate) => candidate.attrs['w:ilvl'] === '0',
      )
      const format = level ? child(level, 'w:numFmt')?.attrs['w:val'] : undefined
      abstract.set(definition.attrs['w:abstractNumId'] ?? '', format !== 'bullet')
    }
    for (const instance of descendants(numbering, 'w:num')) {
      const reference = child(instance, 'w:abstractNumId')?.attrs['w:val'] ?? ''
      ordered.set(instance.attrs['w:numId'] ?? '', abstract.get(reference) ?? true)
    }
  }

  const media = Object.entries(zip.files)
    .filter(([name, file]) => name.startsWith('word/media/') && !file.dir)
    .map(([name]) => name)
    .sort()
    .map(mediaTypeOf)

  return { document, core, parts, relationships, ordered, media }
}

// ---------------------------------------------------------------------------
// Content
//
// The same vocabulary `export-fingerprint.ts` defines, read back out of OOXML
// and rendered through that module's own `renderInline`.

type Reader = {
  package: Package
  /** Images, numbered in document order — never by relationship id. */
  nextImage: () => number
}

/** Whether a toggle property is on: present, unless its value turns it off —
 *  `0` or `false`, either of which OOXML allows. */
function isOn(property: XmlNode): boolean {
  const value = property.attrs['w:val']
  return value !== '0' && value !== 'false'
}

function runMarks(run: XmlNode, extra: readonly string[]): string[] {
  const properties = child(run, 'w:rPr')
  const marks = [...extra]
  if (!properties) return marks
  for (const property of properties.children) {
    switch (property.name) {
      case 'w:b':
        if (isOn(property)) marks.push('strong')
        break
      case 'w:i':
        if (isOn(property)) marks.push('emphasis')
        break
      case 'w:strike':
        if (isOn(property)) marks.push('strike_through')
        break
      case 'w:vertAlign':
        if (property.attrs['w:val'] === 'subscript') marks.push('subscript')
        if (property.attrs['w:val'] === 'superscript') marks.push('superscript')
        break
      case 'w:rFonts':
        if (property.attrs['w:ascii'] === 'Courier New') marks.push('inlineCode')
        break
    }
  }
  return marks
}

function runSegments(
  run: XmlNode,
  marks: readonly string[],
  reader: Reader,
): Segment[] {
  const own = runMarks(run, marks)
  const segments: Segment[] = []
  for (const item of run.children) {
    switch (item.name) {
      case 'w:t':
        segments.push({ kind: 'text', text: item.text, marks: own })
        break
      case 'w:tab':
        segments.push({ kind: 'text', text: ' ', marks: own })
        break
      case 'w:br':
        segments.push({ kind: 'break' })
        break
      case 'w:drawing':
        segments.push({ kind: 'image', ordinal: reader.nextImage() })
        break
    }
  }
  return segments
}

function inlineSegments(
  node: XmlNode,
  marks: readonly string[],
  reader: Reader,
): Segment[] {
  const segments: Segment[] = []
  for (const item of node.children) {
    switch (item.name) {
      case 'w:r':
        segments.push(...runSegments(item, marks, reader))
        break
      case 'w:hyperlink': {
        const target = reader.package.relationships.get(item.attrs['r:id'] ?? '')
        segments.push(
          ...inlineSegments(item, [...marks, `link:${target ?? ''}`], reader),
        )
        break
      }
      case 'm:oMath':
        segments.push({
          kind: 'math',
          source: descendants(item, 'm:t')
            .map((text) => text.text)
            .join(''),
        })
        break
    }
  }
  return segments
}

const HEADING_STYLES: Record<string, string> = {
  Title: 'heading:title',
  Heading1: 'heading:1',
  Heading2: 'heading:2',
  Heading3: 'heading:3',
  Heading4: 'heading:4',
  Heading5: 'heading:5',
  Heading6: 'heading:6',
}

function paragraphLine(paragraph: XmlNode, reader: Reader): ContentLine {
  const properties = child(paragraph, 'w:pPr')
  const inline = renderInline(inlineSegments(paragraph, [], reader))

  const style = properties ? child(properties, 'w:pStyle')?.attrs['w:val'] : undefined
  if (style && HEADING_STYLES[style]) return line(HEADING_STYLES[style]!, inline)

  const numbering = properties ? child(properties, 'w:numPr') : undefined
  if (numbering) {
    const id = child(numbering, 'w:numId')?.attrs['w:val'] ?? ''
    const level = child(numbering, 'w:ilvl')?.attrs['w:val'] ?? '0'
    const ordered = reader.package.ordered.get(id) ?? true
    return line(`list:${ordered ? 'ordered' : 'bullet'}:${level}`, inline)
  }

  if (properties && child(properties, 'w:pBdr')) return line('rule', inline)
  if (properties && child(properties, 'w:shd')) return line('code', inline)
  return line(style === CENTRED_PARAGRAPH_STYLE ? 'para:center' : 'para', inline)
}

/** The `w:tblStyle` a table names, which is how `docx-export.ts` marks the
 *  table-shaped blocks that are not tables: a boxed Blockquote and a
 *  Side-by-Side. */
function tableStyleOf(table: XmlNode): string | undefined {
  return path(table, 'w:tblPr', 'w:tblStyle')?.attrs['w:val']
}

/** A cell without the empty paragraph a writer must end it with when its
 *  content ends in a table: Word requires a cell to close on a paragraph. An
 *  authored empty paragraph after the table leaves nothing to pad, so the
 *  padding is never mistaken for content. */
function withoutClosingPad(cell: XmlNode): XmlNode {
  const last = cell.children.at(-1)
  const beforeLast = cell.children.at(-2)
  const empty = last?.name === 'w:p' && !last.children.some((node) => node.name !== 'w:pPr')
  return empty && beforeLast?.name === 'w:tbl'
    ? { ...cell, children: cell.children.slice(0, -1) }
    : cell
}

function cellsOf(table: XmlNode): XmlNode[] {
  return table.children
    .filter((row) => row.name === 'w:tr')
    .flatMap((row) => row.children.filter((cell) => cell.name === 'w:tc'))
    .map(withoutClosingPad)
}

function tableLines(table: XmlNode, reader: Reader): ContentLine[] {
  const style = tableStyleOf(table)
  if (style === BLOCKQUOTE_TABLE_STYLE) {
    return ['box', ...cellsOf(table).flatMap((cell) => blockLines(cell, reader)), '/box']
  }
  if (style === SIDE_BY_SIDE_TABLE_STYLE) {
    const panels = cellsOf(table)
    return [
      `side:${panels.length}`,
      ...panels.flatMap((panel, index) => {
        const content = blockLines(panel, reader)
        return [`panel:${index}`, ...(content.length > 0 ? content : ['para'])]
      }),
      '/side',
    ]
  }
  const rows = table.children.filter((row) => row.name === 'w:tr')
  const columns = rows.reduce(
    (widest, row) =>
      Math.max(widest, row.children.filter((cell) => cell.name === 'w:tc').length),
    1,
  )
  const lines: ContentLine[] = [
    `table:${rows.length}x${columns}${style === CENTRED_TABLE_STYLE ? ':center' : ''}`,
  ]
  rows.forEach((row, rowIndex) => {
    const cells = row.children.filter((cell) => cell.name === 'w:tc')
    for (let column = 0; column < columns; column += 1) {
      lines.push(`cell:${rowIndex},${column}`)
      const cell = cells[column]
      const content = cell ? blockLines(withoutClosingPad(cell), reader) : []
      lines.push(...(content.length > 0 ? content : ['para']))
    }
  })
  lines.push('/table')
  return lines
}

/** A section-break marker: the paragraph a writer parks section properties in,
 *  which is packaging rather than content. */
function isSectionBreak(node: XmlNode): boolean {
  return (
    node.name === 'w:p' && path(node, 'w:pPr', 'w:sectPr') !== undefined
  )
}

// The paragraph styles `docx-export.ts` gives a work space, and which kind each
// one is. A run of them is one work space; its rules are the bordered ones.
const WORK_SPACE_STYLES: Record<string, 'blank' | 'lines'> = {
  WorkSpace: 'blank',
  WorkSpaceLines: 'lines',
}

function paragraphStyleOf(paragraph: XmlNode): string | undefined {
  const properties = child(paragraph, 'w:pPr')
  return properties ? child(properties, 'w:pStyle')?.attrs['w:val'] : undefined
}

function blockLines(container: XmlNode, reader: Reader): ContentLine[] {
  const lines: ContentLine[] = []
  const open: {
    space: { style: 'blank' | 'lines'; rules: number; ruling?: string; points?: string } | null
  } = { space: null }
  const closeSpace = () => {
    if (open.space) {
      lines.push(workSpaceLine(open.space.style, open.space.rules, open.space.ruling, open.space.points))
    }
    open.space = null
  }
  for (const node of container.children) {
    const spaceStyle = node.name === 'w:p'
      ? WORK_SPACE_STYLES[paragraphStyleOf(node) ?? '']
      : undefined
    if (spaceStyle) {
      if (open.space?.style !== spaceStyle) {
        closeSpace()
        open.space = { style: spaceStyle, rules: 0 }
      }
      const rule = path(node, 'w:pPr', 'w:pBdr', 'w:bottom')
      if (path(node, 'w:pPr', 'w:pBdr')) open.space!.rules += 1
      if (rule?.attrs['w:val'] === 'dotted') open.space!.ruling = 'dotted'
      // The last rule, drawn as a tab's leader up to the answer's Points.
      const leader = path(node, 'w:pPr', 'w:tabs', 'w:tab')?.attrs['w:leader']
      if (leader) {
        open.space!.rules += 1
        if (leader === 'dot') open.space!.ruling = 'dotted'
        const points = renderInline(inlineSegments(node, [], reader))
        if (points) open.space!.points = points
      }
      continue
    }
    closeSpace()
    if (node.name === 'w:p') {
      if (isSectionBreak(node)) continue
      lines.push(paragraphLine(node, reader))
    } else if (node.name === 'w:tbl') {
      lines.push(...tableLines(node, reader))
    }
  }
  closeSpace()
  return lines
}

// ---------------------------------------------------------------------------
// Sections
//
// One Word section per planned page, so a section is a page: its properties
// carry the sheet size, and its header and footer references carry the
// furniture the plan assigned.

type Section = {
  properties: XmlNode
  children: XmlNode[]
}

function sectionsOf(body: XmlNode): Section[] {
  const sections: Section[] = []
  let current: XmlNode[] = []
  for (const node of body.children) {
    if (node.name === 'w:sectPr') {
      sections.push({ properties: node, children: current })
      current = []
      continue
    }
    if (isSectionBreak(node)) {
      sections.push({ properties: path(node, 'w:pPr', 'w:sectPr')!, children: current })
      current = []
      continue
    }
    current.push(node)
  }
  return sections
}

function referencedPart(
  properties: XmlNode,
  name: 'w:headerReference' | 'w:footerReference',
  reader: Reader,
): XmlNode | undefined {
  const reference = properties.children.find(
    (node) => node.name === name && (node.attrs['w:type'] ?? 'default') === 'default',
  )
  if (!reference) return undefined
  const target = reader.package.relationships.get(reference.attrs['r:id'] ?? '')
  return target ? reader.package.parts.get(target) : undefined
}

function pageOf(section: Section, index: number, reader: Reader): PageFingerprint {
  const size = child(section.properties, 'w:pgSz')
  const margin = child(section.properties, 'w:pgMar')
  const header = referencedPart(section.properties, 'w:headerReference', reader)
  const footer = referencedPart(section.properties, 'w:footerReference', reader)
  const body = { name: 'section', attrs: {}, children: section.children, text: '' }
  return {
    number: index + 1,
    width: px(size?.attrs['w:w']),
    height: px(size?.attrs['w:h']),
    // Exact rather than whole pixels: a margin set in twentieths of an inch
    // is a fraction of a pixel, and is compared with the plan's own.
    margins: {
      top: exactPx(margin?.attrs['w:top']),
      right: exactPx(margin?.attrs['w:right']),
      bottom: exactPx(margin?.attrs['w:bottom']),
      left: exactPx(margin?.attrs['w:left']),
    },
    header: header ? blockLines(header, reader) : [],
    footer: footer ? blockLines(footer, reader) : [],
    content: blockLines(body, reader),
  }
}

/**
 * A generated DOCX reduced to the same fingerprint a Layout Plan reduces to.
 * Compare the two with `compareFingerprints` and any difference is a real
 * difference in what the two documents say.
 */
export async function docxFingerprint(
  bytes: Uint8Array | ArrayBuffer,
): Promise<ExportFingerprint> {
  const pkg = await readPackage(bytes)
  let images = 0
  const reader: Reader = { package: pkg, nextImage: () => (images += 1) }

  const body = child(pkg.document, 'w:body')
  if (!body) throw new Error('The document part has no body')

  const sections = sectionsOf(body)
  return {
    title: pkg.core ? (child(pkg.core, 'dc:title')?.text ?? '') : '',
    arrangement: pkg.core
      ? (child(pkg.core, 'dc:description')?.text ?? '').replace(/^Output ID /, '')
      : '',
    pages: sections.map((section, index) => pageOf(section, index, reader)),
    media: pkg.media,
  }
}
