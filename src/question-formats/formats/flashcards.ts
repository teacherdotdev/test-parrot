import { htmlBlocks, plainBlocks, richBlocks } from '../rich-text'
import { delimitedRows, excerpt, plainStructure } from '../text'
import { BLANK_MARK, type Blocks, type ForeignQuestion, type FormatInput, type FormatSpec, type ImportIssue, type ParseResult } from '../types'

/**
 * Flashcards exported as text: one card to a line, its term and definition
 * separated by a tab (Quizlet's default), a comma, a semicolon, or a dash
 * (Quizlet's “custom” separator, ` - `). Quizlet can also put the cards on
 * one line, separated by semicolons. Each card becomes a Short Answer
 * question: the term is asked, and the definition is its Suggested Answer.
 *
 * Anki's text export adds header lines — `#separator:Tab`, `#html:true`,
 * `#columns:…`, `#deck:…`, `#tags:…` and the `#… column:N` lines naming its
 * tags and deck columns. A deck names the bank, and tags become topics. A
 * cloze note, `The capital of France is {{c1::Paris}}.`, becomes a Fill in
 * the Blank question whose Blank, where the cloze stood, holds `Paris`.
 *
 * Any two-column table would fit this description, so without Anki's
 * headers it scores below every format that says more about itself.
 */

type Separator = '\t' | ',' | ';' | ' - ' | '|' | ':' | ' '
type Layout = { rows: '\n' | ';'; fields: Separator }

const LAYOUTS: Layout[] = [
  { rows: '\n', fields: '\t' },
  { rows: '\n', fields: ',' },
  { rows: '\n', fields: ';' },
  { rows: '\n', fields: ' - ' },
  { rows: ';', fields: '\t' },
  { rows: ';', fields: ',' },
  { rows: ';', fields: ' - ' },
]

const BB_CODES = new Set(['MC', 'MA', 'TF', 'ESS', 'MAT', 'FIB', 'FIB_PLUS', 'NUM', 'ORD', 'FIL', 'SR', 'OP', 'EO'])

const ANKI_SEPARATORS: Record<string, Separator> = {
  tab: '\t', comma: ',', semicolon: ';', space: ' ', pipe: '|', colon: ':',
}

type Anki = {
  separator?: Separator
  html?: boolean
  deck?: string
  tags: string[]
  /** 0-based columns that are not a card's sides. */
  meta: Set<number>
  tagsColumn?: number
}

type Row = { fields: string[]; line: number }

/** Anki's `#key:value` header lines, which come before the first card. */
function readAnkiHeader(lines: string[]): { anki: Anki | null; skip: number } {
  const anki: Anki = { tags: [], meta: new Set() }
  let skip = 0
  let known = false
  for (const line of lines) {
    const match = /^#([a-z ]+):(.*)$/i.exec(line.trim())
    if (!match) break
    skip += 1
    const key = match[1]!.trim().toLowerCase()
    const value = match[2]!.trim()
    if (key === 'separator') {
      const named = ANKI_SEPARATORS[value.toLowerCase()]
      anki.separator = named ?? (['\t', ',', ';', '|', ':', ' '].includes(value) ? (value as Separator) : undefined)
    } else if (key === 'html') {
      anki.html = value.toLowerCase() === 'true'
    } else if (key === 'deck') {
      anki.deck = value
    } else if (key === 'tags') {
      anki.tags = value.split(/\s+/).filter(Boolean)
    } else if (/^(tags|deck|notetype|guid) column$/.test(key)) {
      const column = Number(value) - 1
      if (Number.isInteger(column) && column >= 0) {
        anki.meta.add(column)
        if (key === 'tags column') anki.tagsColumn = column
      }
    } else if (key !== 'columns' && key !== 'notetype') {
      continue
    }
    known = true
  }
  return known ? { anki, skip } : { anki: null, skip: 0 }
}

/** The cards, split the way `layout` says, with the line each starts on. */
function rowsOf(text: string, layout: Layout): Row[] {
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length
  const pieces: { text: string; line: number }[] = []
  if (layout.rows === '\n') {
    if (layout.fields !== ' - ') {
      return delimitedRows(text, layout.fields).filter((row) => row.fields.some((field) => field.trim()))
    }
    text.split('\n').forEach((line, index) => pieces.push({ text: line, line: index + 1 }))
  } else {
    let offset = 0
    for (const piece of text.split(';')) {
      pieces.push({ text: piece.replace(/^\s*\n/, ''), line: lineAt(offset + (piece.length - piece.trimStart().length)) })
      offset += piece.length + 1
    }
  }
  return pieces
    .filter((piece) => piece.text.trim())
    .map((piece) => {
      if (layout.fields === ' - ') {
        const at = piece.text.indexOf(' - ')
        return { fields: at < 0 ? [piece.text] : [piece.text.slice(0, at), piece.text.slice(at + 3)], line: piece.line }
      }
      return { fields: piece.text.split(layout.fields), line: piece.line }
    })
}

const isCard = (row: Row) => row.fields.length === 2 && row.fields.every((field) => field.trim())

const HEADER = /^(term|terms|front|question|word|prompt)$/i
const HEADER_BACK = /^(definition|definitions|back|answer|meaning)$/i

type Reading = { rows: Row[]; layout: Layout | null; anki: Anki | null; share: number }

function read(text: string): Reading {
  const lines = text.split('\n')
  const { anki, skip } = readAnkiHeader(lines)
  const body = '\n'.repeat(skip) + lines.slice(skip).join('\n')
  if (anki) {
    const separator = anki.separator ?? sniffAnki(body)
    const rows = delimitedRows(body, separator === ' - ' ? '\t' : separator)
      .filter((row) => row.fields.some((field) => field.trim()))
    return { rows, layout: { rows: '\n', fields: separator }, anki, share: 1 }
  }
  let best: Reading = { rows: [], layout: null, anki: null, share: 0 }
  for (const layout of LAYOUTS) {
    const rows = rowsOf(body, layout)
    if (rows.length && HEADER.test(rows[0]!.fields[0]?.trim() ?? '') && HEADER_BACK.test(rows[0]!.fields[1]?.trim() ?? '')) {
      rows.shift()
    }
    if (!rows.length) continue
    // Rows on one line need several cards before a semicolon means a row.
    if (layout.rows === ';' && rows.length < 3) continue
    const share = rows.filter(isCard).length / rows.length
    if (share > best.share + 1e-9) best = { rows, layout, anki: null, share }
    if (share >= 0.9) break
  }
  return best
}

/** Anki without a `#separator:` line: the separator most rows split on. */
function sniffAnki(text: string): Separator {
  for (const separator of ['\t', ';', ','] as const) {
    const rows = delimitedRows(text, separator).filter((row) => row.fields.some((field) => field.trim()))
    if (rows.length && rows.filter((row) => row.fields.length >= 2).length / rows.length >= 0.9) return separator
  }
  return '\t'
}

const CLOZE = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g

function card(row: Row, reading: Reading): ForeignQuestion | string {
  const anki = reading.anki
  const sides = row.fields.filter((_, index) => !anki?.meta.has(index))
  const [term = '', definition = ''] = sides
  if (!anki && !isCard(row)) {
    return row.fields.length < 2
      ? 'it has no definition: a card is a term and a definition, separated by a tab, a comma or a dash.'
      : `it has ${row.fields.length} parts, not a term and a definition.`
  }
  const blocks = (text: string): Blocks =>
    anki?.html === true ? htmlBlocks(text) : anki?.html === false ? plainBlocks(text) : richBlocks(text)
  const tags = [
    ...(anki?.tags ?? []),
    ...(anki?.tagsColumn !== undefined ? (row.fields[anki.tagsColumn] ?? '').split(/\s+/) : []),
  ].filter(Boolean)
  const base = { line: row.line, ...(tags.length ? { topics: tags } : {}) }
  const clozes = [...term.matchAll(CLOZE)]
  if (clozes.length) {
    const stem = blocks(term.replace(CLOZE, BLANK_MARK))
    if (clozes.length === 1) return { ...base, sourceType: 'Cloze', stem, kind: 'fill-in-blank', accepted: [clozes[0]![2]!] }
    return {
      ...base,
      sourceType: 'Cloze',
      stem,
      kind: 'fill-in-blanks',
      blanks: clozes.map((match, index) => ({ name: `Blank ${index + 1}`, accepted: [match[2]!] })),
    }
  }
  if (!term.trim()) return 'it has no term.'
  return {
    ...base,
    stem: blocks(term.trim()),
    kind: 'short-answer',
    ...(definition.trim() ? { suggestedAnswer: blocks(definition.trim()) } : {}),
  }
}

export function parseFlashcards(text: string): ParseResult {
  const reading = read(text)
  const questions: ForeignQuestion[] = []
  const issues: ImportIssue[] = []
  reading.rows.forEach((row, index) => {
    const parsed = card(row, reading)
    if (typeof parsed === 'string') {
      issues.push({
        severity: 'error',
        code: 'unreadable-question',
        message: `Question ${index + 1} (line ${row.line}): ${parsed}`,
        line: row.line,
        excerpt: excerpt(row.fields.join(' ')),
      })
    } else {
      questions.push({ ...parsed, number: index + 1 })
    }
  })
  const deck = reading.anki?.deck?.split('::').at(-1)?.trim()
  return { questions, issues, found: reading.rows.length, ...(deck ? { name: deck } : {}) }
}

function detect(input: FormatInput): number {
  const text = input.text()
  if (!text.trim()) return 0
  // Enough cards to tell, not a whole large file read seven ways.
  const sample = text.length > 64 * 1024 ? text.slice(0, text.lastIndexOf('\n', 64 * 1024) + 1 || 64 * 1024) : text
  const reading = read(sample)
  if (!reading.rows.length) return 0
  if (reading.anki) return 0.98
  const coded = reading.rows.filter((row) => BB_CODES.has(plainStructure(row.fields[0] ?? '').trim().toUpperCase())).length
  if (coded / reading.rows.length > 0.2) return 0
  // Brightspace's key/value rows are two cells too; `NewQuestion` is theirs.
  if (reading.rows.some((row) => /^newquestion$/i.test(plainStructure(row.fields[0] ?? '').trim()))) return 0
  return reading.share >= 0.9 ? 0.5 + 0.25 * reading.share : reading.share * 0.3
}

export const flashcards: FormatSpec = {
  id: 'flashcards',
  detect,
  parse: (input) => parseFlashcards(input.text()),
}
