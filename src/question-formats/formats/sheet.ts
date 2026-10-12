import { normalizeText, delimitedRows } from '../text'
import type { FormatInput, ZipFiles } from '../types'
import { attributeOf, childrenOf, childOf, descendantsOf, documentElement, isElement, parseXml, textOf, type XmlElement } from '../xml'
import { resolveEntryPath, zipFile } from '../zip'

/**
 * A spreadsheet as rows of cells, whichever way a teacher saved it: a CSV
 * (comma, or the semicolon Excel writes where a comma is the decimal
 * point), a tab-delimited file, or the first worksheet of an Excel workbook.
 *
 * A workbook is read from its XML, never run: a formula's cell holds the
 * value Excel last calculated, and that value is what is read. A cell's
 * reference, such as `C5`, puts it in its column, so skipped cells are
 * empty strings and a row's `line` is its row number in the spreadsheet.
 */

export type SheetRow = { fields: string[]; line: number }

export type Sheet = {
  rows: SheetRow[]
  /** How the file was saved: a text file's delimiter, or `xlsx`. */
  source: ',' | ';' | '\t' | 'xlsx'
}

const cache = new WeakMap<Uint8Array, Promise<Sheet | null>>()

/** The file as a spreadsheet, or `null` when it is neither delimited text
 *  nor an Excel workbook. Several formats ask; the file is read once. */
export function readSheet(input: FormatInput): Promise<Sheet | null> {
  let sheet = cache.get(input.bytes)
  if (!sheet) {
    sheet = readUncached(input).catch(() => null)
    cache.set(input.bytes, sheet)
  }
  return sheet
}

export async function sheetRows(input: FormatInput): Promise<SheetRow[] | null> {
  return (await readSheet(input))?.rows ?? null
}

/** Whether a row holds nothing but empty cells. */
export const isBlankRow = (row: SheetRow) => row.fields.every((field) => field.trim() === '')

async function readUncached(input: FormatInput): Promise<Sheet | null> {
  const zip = await input.zip()
  if (zip) {
    const rows = workbookRows(zip)
    return rows ? { rows, source: 'xlsx' } : null
  }
  const text = input.text()
  if (!text.trim()) return null
  const delimiter = /\.(tsv|tab)$/i.test(input.name) ? '\t' : sniffDelimiter(text)
  return { rows: delimitedRows(text, delimiter), source: delimiter }
}

const DELIMITERS = [',', '\t', ';'] as const

/**
 * The delimiter that splits the most lines, and splits them most evenly:
 * a semicolon CSV with decimal commas splits every line on both, but only
 * the semicolon gives every row the same number of cells.
 */
export function sniffDelimiter(text: string): (typeof DELIMITERS)[number] {
  const sample = text.slice(0, 64 * 1024)
  let best: (typeof DELIMITERS)[number] = ','
  let bestScore = -1
  for (const delimiter of DELIMITERS) {
    const rows = delimitedRows(sample, delimiter)
      .slice(0, 100)
      .filter((row) => row.fields.some((field) => field.trim()))
    if (!rows.length) continue
    const split = rows.filter((row) => row.fields.length > 1)
    const counts = new Map<number, number>()
    for (const row of split) counts.set(row.fields.length, (counts.get(row.fields.length) ?? 0) + 1)
    const mode = Math.max(0, ...counts.values())
    const score = (split.length / rows.length) * (0.5 + 0.5 * (split.length ? mode / split.length : 0))
    if (score > bestScore + 1e-9) {
      best = delimiter
      bestScore = score
    }
  }
  return best
}

const decoder = new TextDecoder('utf-8')

function xmlOf(zip: ZipFiles, path: string): XmlElement | undefined {
  const bytes = zipFile(zip, path)
  if (!bytes) return undefined
  try {
    return documentElement(parseXml(decoder.decode(bytes)))
  } catch {
    return undefined
  }
}

/** The first worksheet, in the order the workbook lists its sheets. */
function firstSheetPath(zip: ZipFiles): string | null {
  const workbook = xmlOf(zip, 'xl/workbook.xml')
  if (!workbook) return null
  const first = childrenOf(childOf(workbook, 'sheets'), 'sheet')[0]
  const id = attributeOf(first, 'id')
  const rels = xmlOf(zip, 'xl/_rels/workbook.xml.rels')
  const target = childrenOf(rels, 'Relationship').find((rel) => rel.attributes.Id === id)?.attributes.Target
  if (target) {
    const path = resolveEntryPath('xl/workbook.xml', target)
    if (path && zipFile(zip, path)) return path
  }
  return zipFile(zip, 'xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : null
}

/** A shared or inline string: its text, or the text of its rich-text runs,
 *  leaving out the phonetic guides East Asian text may carry. */
function stringItem(item: XmlElement | undefined): string {
  if (!item) return ''
  const plain = childOf(item, 't')
  if (plain) return textOf(plain)
  return childrenOf(item, 'r').map((run) => textOf(childOf(run, 't'))).join('')
}

function columnIndex(reference: string | undefined): number | null {
  const letters = /^\$?([A-Z]+)\$?\d*$/i.exec(reference ?? '')?.[1]?.toUpperCase()
  if (!letters) return null
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

/** A number as a teacher typed it: Excel stores 0.1 as 0.10000000000000001. */
function numberText(value: string): string {
  const trimmed = value.trim()
  if (!/^-?\d+(\.\d+)?(E[-+]?\d+)?$/i.test(trimmed)) return trimmed
  const number = Number(trimmed)
  return Number.isFinite(number) ? String(Number(number.toPrecision(15))) : trimmed
}

const MAX_COLUMNS = 1024

function workbookRows(zip: ZipFiles): SheetRow[] | null {
  const path = firstSheetPath(zip)
  if (!path) return null
  const worksheet = xmlOf(zip, path)
  if (!worksheet) return null
  const shared = descendantsOf(xmlOf(zip, 'xl/sharedStrings.xml'), 'si').map(stringItem)

  const rows: SheetRow[] = []
  let lastRow = 0
  for (const row of childrenOf(childOf(worksheet, 'sheetData'), 'row')) {
    const number = Number(row.attributes.r)
    const line = Number.isInteger(number) && number > lastRow ? number : lastRow + 1
    lastRow = line
    const fields: string[] = []
    let next = 0
    for (const cell of row.children) {
      if (!isElement(cell) || cell.local !== 'c') continue
      const column = columnIndex(cell.attributes.r) ?? next
      next = column + 1
      if (column >= MAX_COLUMNS) continue
      const type = cell.attributes.t ?? 'n'
      const raw = textOf(childOf(cell, 'v'))
      let value: string
      if (type === 's') value = shared[Number(raw)] ?? ''
      else if (type === 'inlineStr') value = stringItem(childOf(cell, 'is'))
      else if (type === 'b') value = raw.trim() === '1' ? 'TRUE' : raw.trim() === '0' ? 'FALSE' : raw
      else if (type === 'e') value = ''
      else if (type === 'str') value = raw
      else value = numberText(raw)
      while (fields.length < column) fields.push('')
      fields[column] = normalizeText(value)
    }
    rows.push({ fields, line })
  }
  return rows
}
