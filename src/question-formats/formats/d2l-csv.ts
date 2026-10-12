import { htmlBlocks, richBlocks } from '../rich-text'
import { excerpt, plainStructure, pointsIn } from '../text'
import type { Blocks, ForeignChoice, ForeignQuestion, FormatInput, FormatSpec, ImportIssue, ParseResult } from '../types'
import { isBlankRow, readSheet, type SheetRow } from './sheet'

/**
 * Brightspace's (D2L's) question import CSV: not a table but key/value rows.
 * `NewQuestion,<type>` starts a question and the rows after it describe it —
 * `QuestionText`, then `Option`, `Answer`, `Choice`/`Match` or `Item` rows
 * by type. A row whose first cell starts `//` is a comment.
 *
 * Keys are read in any case, with the spaces around them ignored (D2L's own
 * sample writes `Feedback ,`). A text cell followed by `HTML` is HTML; any
 * other text is read as HTML only if it plainly is. A `Points` row is the
 * question's points, kept as its Points when a whole number (an `Option` or
 * `Answer` row's number is a different thing: the percentage that answer
 * earns, which says which is right). Title, difficulty, hints and feedback
 * have no place in a Test Parrot question and are left out; a picture named
 * by an `Image` row lives outside the file, so the teacher is told to add it.
 */

const TYPES: Record<string, string> = {
  WR: 'Written Response', SA: 'Short Answer', M: 'Matching', MC: 'Multiple Choice',
  TF: 'True or False', MS: 'Multi-Select', O: 'Ordering',
}

const KEYS = new Set([
  'newquestion', 'id', 'title', 'questiontext', 'points', 'difficulty', 'image', 'hint', 'feedback',
  'initialtext', 'answerkey', 'inputbox', 'answer', 'scoring', 'choice', 'match', 'option', 'true', 'false', 'item',
])

const keyOf = (row: SheetRow) => plainStructure(row.fields[0] ?? '').trim().toLowerCase()
const cell = (row: SheetRow, index: number) => row.fields[index] ?? ''
const isComment = (row: SheetRow) => plainStructure(row.fields[0] ?? '').trim().startsWith('//')
const weight = (value: string) => {
  const number = Number(value.trim())
  return Number.isFinite(number) ? number : 0
}

type Block = { type: string; line: number; rows: SheetRow[] }

/** Text as blocks: HTML when the next cell says so, or when it plainly is. */
function textBlocks(text: string, flag: string | undefined, onMissing: () => void): Blocks {
  return (flag ?? '').trim().toUpperCase() === 'HTML'
    ? htmlBlocks(text, { onMissing })
    : richBlocks(text, { onMissing })
}

/** The choices worth full marks; failing that, those worth the most. */
function bestWeighted<T extends { weight: number }>(items: T[]): Set<T> {
  const full = items.filter((item) => item.weight >= 100)
  if (full.length) return new Set(full)
  const top = Math.max(0, ...items.map((item) => item.weight))
  return new Set(top > 0 ? items.filter((item) => item.weight === top) : [])
}

function parseBlock(block: Block, warn: (code: string, message: string) => void): ForeignQuestion | string {
  const code = block.type
  if (!TYPES[code]) {
    return code
      ? `“${excerpt(code, 20)}” is not a Brightspace question type Test Parrot reads.`
      : 'its NewQuestion row does not say what type of question it is.'
  }
  let pictures = 0
  const onMissing = () => { pictures += 1 }
  const rowsWith = (key: string) => block.rows.filter((row) => keyOf(row) === key)
  const textRow = rowsWith('questiontext')[0]
  const stem = textBlocks(textRow ? cell(textRow, 1) : '', textRow ? cell(textRow, 2) : undefined, onMissing)
  const pointsRow = rowsWith('points')[0]
  const points = pointsRow ? pointsIn(cell(pointsRow, 1)) : undefined
  const base = { line: block.line, sourceType: code, stem, ...(points !== undefined ? { points } : {}) }
  for (const image of rowsWith('image')) {
    if (cell(image, 1).trim()) {
      warn('picture-not-imported', `its picture “${excerpt(cell(image, 1), 40)}” is a separate file, so it was not brought in. Add it after importing.`)
    }
  }
  const question = ((): ForeignQuestion | string => {
    switch (code) {
      case 'WR': {
        const key = rowsWith('answerkey')[0]
        const suggested = key && cell(key, 1).trim() ? textBlocks(cell(key, 1), cell(key, 2), onMissing) : undefined
        return { ...base, kind: 'short-answer', ...(suggested ? { suggestedAnswer: suggested } : {}) }
      }
      case 'SA': {
        const answers = rowsWith('answer').map((row) => ({ weight: weight(cell(row, 1)), text: cell(row, 2).trim() }))
          .filter((answer) => answer.text)
        const best = bestWeighted(answers)
        if (rowsWith('answer').some((row) => cell(row, 3).trim().toLowerCase() === 'regexp')) {
          warn('regular-expression', 'an accepted answer is a regular expression, which came in as written. Check it after importing.')
        }
        return { ...base, kind: 'fill-in-blank', accepted: answers.filter((answer) => best.has(answer)).map((answer) => answer.text) }
      }
      case 'MC':
      case 'MS': {
        const options = rowsWith('option').map((row) => ({
          weight: weight(cell(row, 1)),
          content: textBlocks(cell(row, 2), cell(row, 3), onMissing),
        }))
        if (!options.length) return 'it has no Option rows.'
        const correct = code === 'MS'
          ? new Set(options.filter((option) => option.weight > 0))
          : bestWeighted(options)
        const choices: ForeignChoice[] = options.map((option) => ({ content: option.content, correct: correct.has(option) }))
        return code === 'MC' && correct.size <= 1
          ? { ...base, kind: 'multiple-choice', choices }
          : { ...base, kind: 'multiple-answer', choices }
      }
      case 'TF': {
        const truth = rowsWith('true')[0]
        const falsehood = rowsWith('false')[0]
        const yes = truth ? weight(cell(truth, 1)) : 0
        const no = falsehood ? weight(cell(falsehood, 1)) : 0
        return { ...base, kind: 'true-false', answer: yes === no ? null : yes > no }
      }
      case 'M': {
        const matches = rowsWith('match').map((row) => ({ number: cell(row, 1).trim(), row, used: false }))
        const pairs: { left: Blocks | null; right: Blocks | null }[] = rowsWith('choice').map((row) => {
          const number = cell(row, 1).trim()
          const match = matches.find((candidate) => !candidate.used && candidate.number === number)
          if (match) match.used = true
          return {
            left: textBlocks(cell(row, 2), cell(row, 3), onMissing),
            right: match ? textBlocks(cell(match.row, 2), cell(match.row, 3), onMissing) : null,
          }
        })
        for (const match of matches.filter((candidate) => !candidate.used)) {
          pairs.push({ left: null, right: textBlocks(cell(match.row, 2), cell(match.row, 3), onMissing) })
        }
        if (!pairs.length) return 'it has no Choice or Match rows.'
        return { ...base, kind: 'matching', pairs }
      }
      case 'O': {
        const items = rowsWith('item').filter((row) => cell(row, 1).trim())
        if (!items.length) return 'it has no Item rows to put in order.'
        return { ...base, kind: 'ordering', items: items.map((row) => textBlocks(cell(row, 1), cell(row, 2), onMissing)) }
      }
      default:
        return `Test Parrot has no ${TYPES[code]} questions.`
    }
  })()
  if (pictures && typeof question !== 'string') {
    warn('picture-not-imported', pictures === 1
      ? 'a picture in it is a separate file, so it was not brought in. Add it after importing.'
      : `${pictures} pictures in it are separate files, so they were not brought in. Add them after importing.`)
  }
  return question
}

export function parseD2lRows(rows: SheetRow[]): ParseResult {
  const blocks: Block[] = []
  for (const row of rows) {
    if (isBlankRow(row) || isComment(row)) continue
    if (keyOf(row) === 'newquestion') {
      blocks.push({ type: plainStructure(cell(row, 1)).trim().toUpperCase(), line: row.line, rows: [] })
    } else {
      blocks.at(-1)?.rows.push(row)
    }
  }
  const questions: ForeignQuestion[] = []
  const issues: ImportIssue[] = []
  blocks.forEach((block, index) => {
    const place = `Question ${index + 1} (line ${block.line})`
    const textRow = block.rows.find((row) => keyOf(row) === 'questiontext')
    const quote = excerpt(textRow ? cell(textRow, 1).replace(/<[^>]*>/g, ' ') : '')
    const warn = (code: string, message: string) =>
      issues.push({ severity: 'warning', code, message: `${place}: ${message}`, line: block.line, excerpt: quote })
    const parsed = parseBlock(block, warn)
    if (typeof parsed === 'string') {
      issues.push({ severity: 'error', code: 'unreadable-question', message: `${place}: ${parsed}`, line: block.line, excerpt: quote })
    } else {
      questions.push({ ...parsed, number: index + 1 })
    }
  })
  return { questions, issues, found: blocks.length }
}

async function detect(input: FormatInput): Promise<number> {
  const sheet = await readSheet(input)
  if (!sheet) return 0
  const rows = sheet.rows.filter((row) => !isBlankRow(row) && !isComment(row))
  const starts = rows.filter((row) => keyOf(row) === 'newquestion').length
  if (!starts) return 0
  const known = rows.filter((row) => KEYS.has(keyOf(row))).length
  return 0.7 + 0.3 * (known / rows.length)
}

export const d2lCsv: FormatSpec = {
  id: 'd2l-csv',
  detect,
  parse: async (input) => parseD2lRows((await readSheet(input))?.rows ?? []),
}
