import { decodeText, normalizeText } from '../text'
import type { ZipFiles } from '../types'
import { zipFile } from '../zip'
import { attributeOf, childOf, childrenOf, documentElement, isElement, parseXml, type XmlElement } from '../xml'

/**
 * A Word document's text, the way a teacher sees it on the page, so the text
 * formats' own detectors and parsers can read a .docx as if it were typed
 * into a .txt file.
 *
 * Each paragraph is one line and an empty paragraph an empty line; a line
 * break inside a paragraph starts a new line and a tab stays a tab. A table
 * is read cell by cell, each of a cell's paragraphs a line. Text Word hides,
 * deletes in tracked changes, or keeps in field codes is left out.
 *
 * Word's automatic numbering is not in the text itself: a list the teacher
 * sees as “1. Question” and “a) answer” stores only “Question” and
 * “answer”, with a pointer into `word/numbering.xml`. The labels are counted
 * back in — list by list and level by level, with each level's start, format
 * and restarts — and followed by a space, as the teacher would have typed
 * them. A bullet is left out: no question format reads one, and a `*` typed
 * after it still marks the answer.
 *
 * Bold or highlighted answers are not read as correct: only text is.
 */

const NS_SKIPPED = new Set([
  'pPr', 'rPr', 'del', 'delText', 'instrText', 'delInstrText', 'fldData', 'drawing', 'pict', 'object',
  'AlternateContent', 'footnoteReference', 'endnoteReference', 'commentReference', 'annotationRef',
])

type Level = {
  start: number
  format: string
  text: string
  suffix: string
  /** 1-based level whose use restarts this one; 0 for never. */
  restart?: number
  legal: boolean
}

type Numbering = {
  /** numId → abstractNum id and its overrides. */
  instances: Map<string, { abstract: string; starts: Map<number, number>; levels: Map<number, Level> }>
  abstracts: Map<string, Map<number, Level>>
}

type Styles = Map<string, { numId?: string; ilvl?: number; basedOn?: string }>

function xmlOf(zip: ZipFiles, path: string): XmlElement | undefined {
  const bytes = zipFile(zip, path)
  if (!bytes) return undefined
  try {
    return documentElement(parseXml(decodeText(bytes).text))
  } catch {
    return undefined
  }
}

const valueOf = (element: XmlElement | undefined, child: string) => attributeOf(childOf(element, child), 'val')

function levelOf(element: XmlElement): Level {
  const start = Number(valueOf(element, 'start') ?? 1)
  const restart = valueOf(element, 'lvlRestart')
  const legal = childOf(element, 'isLgl')
  return {
    start: Number.isFinite(start) ? start : 1,
    format: valueOf(element, 'numFmt') ?? 'decimal',
    text: valueOf(element, 'lvlText') ?? '',
    suffix: valueOf(element, 'suff') ?? 'tab',
    ...(restart !== undefined && Number.isFinite(Number(restart)) ? { restart: Number(restart) } : {}),
    legal: Boolean(legal) && attributeOf(legal, 'val') !== 'false' && attributeOf(legal, 'val') !== '0',
  }
}

function levelsOf(element: XmlElement): Map<number, Level> {
  const levels = new Map<number, Level>()
  for (const lvl of childrenOf(element, 'lvl')) levels.set(Number(attributeOf(lvl, 'ilvl') ?? 0), levelOf(lvl))
  return levels
}

function readStyles(root: XmlElement | undefined): Styles {
  const styles: Styles = new Map()
  for (const style of childrenOf(root, 'style')) {
    const id = attributeOf(style, 'styleId')
    if (!id) continue
    const numPr = childOf(childOf(style, 'pPr'), 'numPr')
    const ilvl = valueOf(numPr, 'ilvl')
    styles.set(id, {
      numId: valueOf(numPr, 'numId'),
      ...(ilvl !== undefined ? { ilvl: Number(ilvl) } : {}),
      basedOn: valueOf(style, 'basedOn'),
    })
  }
  return styles
}

/** A style's numbering, following the styles it is based on. */
function styleNumbering(styles: Styles, id: string | undefined): { numId?: string; ilvl?: number } {
  const seen = new Set<string>()
  let numId: string | undefined
  let ilvl: number | undefined
  while (id && !seen.has(id)) {
    seen.add(id)
    const style = styles.get(id)
    if (!style) break
    numId ??= style.numId
    ilvl ??= style.ilvl
    id = style.basedOn
  }
  return { numId, ilvl }
}

function readNumbering(root: XmlElement | undefined, styles: Styles): Numbering {
  const abstracts = new Map<string, Map<number, Level>>()
  const links = new Map<string, string>()
  for (const abstract of childrenOf(root, 'abstractNum')) {
    const id = attributeOf(abstract, 'abstractNumId')
    if (id === undefined) continue
    abstracts.set(id, levelsOf(abstract))
    const link = valueOf(abstract, 'numStyleLink')
    if (link) links.set(id, link)
  }
  const instances: Numbering['instances'] = new Map()
  for (const num of childrenOf(root, 'num')) {
    const id = attributeOf(num, 'numId')
    const abstract = valueOf(num, 'abstractNumId')
    if (id === undefined || abstract === undefined) continue
    const starts = new Map<number, number>()
    const levels = new Map<number, Level>()
    for (const override of childrenOf(num, 'lvlOverride')) {
      const ilvl = Number(attributeOf(override, 'ilvl') ?? 0)
      const start = valueOf(override, 'startOverride')
      if (start !== undefined && Number.isFinite(Number(start))) starts.set(ilvl, Number(start))
      const lvl = childOf(override, 'lvl')
      if (lvl) levels.set(ilvl, levelOf(lvl))
    }
    instances.set(id, { abstract, starts, levels })
  }
  // A list whose definition lives in a numbering style: `numStyleLink` names
  // the style, whose numbering names the list that holds the levels.
  for (const [id, link] of links) {
    const numId = styleNumbering(styles, link).numId
    const target = numId ? instances.get(numId)?.abstract : undefined
    const levels = target ? abstracts.get(target) : undefined
    if (levels?.size) abstracts.set(id, levels)
  }
  return { instances, abstracts }
}

function roman(value: number): string {
  if (value <= 0 || value >= 4000) return String(value)
  const numerals: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ]
  let rest = value
  let result = ''
  for (const [amount, numeral] of numerals) {
    while (rest >= amount) {
      result += numeral
      rest -= amount
    }
  }
  return result
}

/** Word's letters: a … z, then aa … zz, then aaa. */
function letters(value: number): string {
  if (value <= 0) return String(value)
  const letter = String.fromCharCode(97 + ((value - 1) % 26))
  return letter.repeat(Math.floor((value - 1) / 26) + 1)
}

function formatNumber(value: number, format: string): string {
  switch (format) {
    case 'lowerLetter': return letters(value)
    case 'upperLetter': return letters(value).toUpperCase()
    case 'lowerRoman': return roman(value)
    case 'upperRoman': return roman(value).toUpperCase()
    case 'decimalZero': return value < 10 ? `0${value}` : String(value)
    case 'none': return ''
    default: return String(value)
  }
}

/** Numbering labels, counted paragraph by paragraph through the document. */
class ListCounter {
  private readonly counts = new Map<string, (number | undefined)[]>()
  private readonly seen = new Set<string>()

  constructor(private readonly numbering: Numbering) {}

  label(numId: string, ilvl: number): string {
    const instance = this.numbering.instances.get(numId)
    if (!instance) return ''
    const abstract = this.numbering.abstracts.get(instance.abstract) ?? new Map<number, Level>()
    const levelAt = (at: number) => instance.levels.get(at) ?? abstract.get(at)
    const level = levelAt(ilvl)
    if (!level) return ''
    // Lists that share a definition share their counts, unless one starts over.
    const key = instance.abstract
    const counts = this.counts.get(key) ?? []
    this.counts.set(key, counts)
    if (!this.seen.has(numId)) {
      this.seen.add(numId)
      for (const [at, start] of instance.starts) counts[at] = start - 1
    }
    const startOf = (at: number) => instance.starts.get(at) ?? levelAt(at)?.start ?? 1
    counts[ilvl] = counts[ilvl] === undefined ? startOf(ilvl) : counts[ilvl]! + 1
    for (let deeper = ilvl + 1; deeper < 9; deeper += 1) {
      const restart = levelAt(deeper)?.restart ?? deeper
      if (restart !== 0 && ilvl < restart) counts[deeper] = undefined
    }
    if (level.format === 'bullet') return ''
    const text = level.text.replace(/%([1-9])/g, (_, digit: string) => {
      const at = Number(digit) - 1
      const value = counts[at] ?? startOf(at)
      const format = level.legal && at < ilvl ? 'decimal' : levelAt(at)?.format ?? 'decimal'
      return formatNumber(value, format)
    })
    if (!text) return ''
    return level.suffix === 'nothing' ? text : `${text} `
  }
}

/** A `w:sym`'s character. Symbol fonts put theirs at U+F0xx; the ASCII
 *  range of those is the character itself. */
function symbolText(element: XmlElement): string {
  const code = parseInt(attributeOf(element, 'char') ?? '', 16)
  if (!Number.isFinite(code)) return ''
  const plain = code >= 0xf020 && code <= 0xf07e ? code - 0xf000 : code
  if (plain >= 0xe000 && plain <= 0xf8ff) return ''
  try {
    return String.fromCodePoint(plain)
  } catch {
    return ''
  }
}

const hidden = (run: XmlElement) => {
  const vanish = childOf(childOf(run, 'rPr'), 'vanish')
  return Boolean(vanish) && !['false', '0', 'off'].includes(attributeOf(vanish, 'val') ?? '')
}

/** A paragraph's own text, not its label. */
function paragraphText(paragraph: XmlElement): string {
  let text = ''
  const walk = (element: XmlElement) => {
    for (const child of element.children) {
      if (!isElement(child)) continue
      switch (child.local) {
        case 't': text += childTextOf(child); break
        case 'tab': text += '\t'; break
        case 'br': case 'cr': text += '\n'; break
        case 'noBreakHyphen': text += '-'; break
        case 'softHyphen': break
        case 'sym': text += symbolText(child); break
        case 'r':
          if (!hidden(child)) walk(child)
          break
        default:
          if (!NS_SKIPPED.has(child.local)) walk(child)
      }
    }
  }
  walk(paragraph)
  return text
}

const childTextOf = (element: XmlElement) => element.children.filter((node) => !isElement(node)).join('')

export async function wordText(zip: ZipFiles): Promise<string> {
  const document = xmlOf(zip, 'word/document.xml')
  const body = childOf(document, 'body')
  if (!body) return ''
  const styles = readStyles(xmlOf(zip, 'word/styles.xml'))
  const counter = new ListCounter(readNumbering(xmlOf(zip, 'word/numbering.xml'), styles))
  const lines: string[] = []

  const paragraph = (element: XmlElement) => {
    const pPr = childOf(element, 'pPr')
    const numPr = childOf(pPr, 'numPr')
    const fromStyle = styleNumbering(styles, valueOf(pPr, 'pStyle'))
    const numId = valueOf(numPr, 'numId') ?? fromStyle.numId
    const ilvl = Number(valueOf(numPr, 'ilvl') ?? fromStyle.ilvl ?? 0)
    const label = numId && numId !== '0' ? counter.label(numId, Number.isFinite(ilvl) ? ilvl : 0) : ''
    const text = paragraphText(element)
    lines.push(...`${label}${text}`.replace(/[ \t]+$/gm, '').split('\n'))
  }

  const blocks = (element: XmlElement) => {
    for (const child of childrenOf(element)) {
      switch (child.local) {
        case 'p': paragraph(child); break
        case 'tbl':
          for (const row of childrenOf(child, 'tr')) for (const cell of childrenOf(row, 'tc')) blocks(cell)
          break
        case 'sdt': blocks(childOf(child, 'sdtContent') ?? child); break
        case 'customXml': case 'ins': case 'smartTag': blocks(child); break
        default: break
      }
    }
  }
  blocks(body)
  return normalizeText(lines.join('\n'))
}
