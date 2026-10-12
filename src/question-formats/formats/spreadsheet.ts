import { richBlocks } from '../rich-text'
import { excerpt, plainStructure, pointsIn } from '../text'
import type { ForeignChoice, ForeignQuestion, FormatInput, FormatSpec, ImportIssue, ParseResult } from '../types'
import { isBlankRow, readSheet, type SheetRow } from './sheet'

/**
 * A spreadsheet of questions a teacher, a colleague or another tool laid
 * out their own way: a header row names the columns, and each row below it
 * is a question. Columns are known by their usual names — `Question`,
 * `Prompt` or `Stem`; `Option A`, `Choice 1`, `Answer B` and the like;
 * `Correct answer`, `Answer` or `Key`; `Type`; `Topic`, `Category` or
 * `Tags`; `Points` or `Marks` — in any case and order. Points are kept as
 * the question's Points when a whole number. Explanations, feedback and
 * difficulty have no place in a Test Parrot question and are left out.
 *
 * The correct answer may be a letter, a 1-based number, the answer's own
 * text, or a list such as `A, C`. The type column is optional: a question
 * with options is Multiple Choice, one whose answer is true or false is
 * True/False, and any other with an answer is Fill in the Blank, its answer
 * the Blank's — without one, it is Short Answer.
 *
 * This is the format of last resort for a table, so it scores lower than
 * any format a file names more precisely.
 */

const HEADER_ROWS = 10

type Option = { column: number; index: number }

export type SpreadsheetHeader = {
  line: number
  question: number
  type: number
  correct: number
  topics: number[]
  points: number
  options: Option[]
  /** Whether the options are the wrong answers, the right one given apart. */
  distractors: boolean
}

const label = (value: string) =>
  plainStructure(value).trim().toLowerCase()
    .replace(/\(s\)/g, 's')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[_\-:.#*?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const QUESTION = /^(question|questions|question text|question stem|question wording|prompt|stem|item|q)$/
const TYPE = /^(type|question type|qtype|item type|format)$/
const CORRECT = /^(correct|correct answers?|correct options?|correct choices?|correct letter|answers?|answer key|key|right answer|solution)$/
const TOPICS = /^(topics?|category|categories|tags?|subject|unit|chapter)$/
const POINTS = /^(points?|pts|point value|marks?)$/
const OPTION = /^(?:(option|choice|answer|alternative|response)s? ?([a-j]|10|[1-9])|(incorrect answer|wrong answer|distractor|incorrect) ?([a-j]|10|[1-9])?|([a-j]))$/

/** The header row among the first rows: a question column, and options or
 *  a correct answer. */
export function spreadsheetHeader(rows: SheetRow[]): SpreadsheetHeader | null {
  for (const row of rows.slice(0, HEADER_ROWS)) {
    const labels = row.fields.map(label)
    const question = labels.findIndex((text) => QUESTION.test(text))
    if (question < 0) continue
    const options: Option[] = []
    let distractors = false
    let bareLetters = 0
    labels.forEach((text, column) => {
      if (column === question) return
      const match = OPTION.exec(text)
      if (!match) return
      const mark = match[2] ?? match[4] ?? match[5]
      if (match[3]) distractors = true
      if (match[5]) bareLetters += 1
      const index = mark === undefined
        ? options.length
        : /^\d+$/.test(mark) ? Number(mark) - 1 : mark.charCodeAt(0) - 97
      options.push({ column, index })
    })
    // A lone column headed `a` is not a set of options.
    const kept = bareLetters === 1 && options.length === 1 ? [] : options
    const correct = labels.findIndex((text, column) => column !== question && CORRECT.test(text))
    if (kept.length < 2 && correct < 0) continue
    return {
      line: row.line,
      question,
      type: labels.findIndex((text) => TYPE.test(text)),
      correct,
      topics: labels.flatMap((text, column) => (TOPICS.test(text) ? [column] : [])),
      points: labels.findIndex((text) => POINTS.test(text)),
      options: kept,
      distractors: distractors && kept.length > 0,
    }
  }
  return null
}

type Kind = 'multiple-choice' | 'multiple-answer' | 'true-false' | 'short-answer' | 'fill-in-blank' | 'essay'

function kindOf(value: string): Kind | null | 'unsupported' {
  const text = value.trim().toLowerCase().replace(/[_\-/]+/g, ' ').replace(/\s+/g, ' ')
  if (!text) return null
  if (/^(mc|mcq|multiple choice|multichoice|multiple choice question|single choice|quiz)$/.test(text)) return 'multiple-choice'
  if (/^(ma|ms|mr|multiple answers?|multiple select|multiple response|multi select|select all|checkbox(es)?|multiple correct)$/.test(text)) return 'multiple-answer'
  if (/^(tf|t f|true false|true or false|boolean)$/.test(text)) return 'true-false'
  if (/^(sa|fb|fib|fitb|short answer|fill in the blank|fill in blank|fill in|blank|cloze|short)$/.test(text)) return 'fill-in-blank'
  if (/^(es|ess|essay|long answer|paragraph|open|open ended|written response|wr|free response)$/.test(text)) return 'essay'
  return 'unsupported'
}

const TRUTH: Record<string, boolean> = { true: true, t: true, false: false, f: false }

/** The options a correct-answer cell names, by 0-based position among
 *  `options`; `null` when it names none of them. */
function resolveCorrect(value: string, options: { index: number; text: string }[]): number[] | null {
  const given = value.trim()
  if (!given) return []
  const byText = (text: string) => options.findIndex((option) => option.text.trim().toLowerCase() === text.trim().toLowerCase())
  const exact = byText(given)
  if (exact >= 0) return [exact]
  const tokens = given.split(/[\s,;&/]+|\band\b/i).filter(Boolean)
  const find = (index: number) => options.findIndex((option) => option.index === index)
  if (tokens.every((token) => /^[a-j]$/i.test(token))) {
    const found = tokens.map((token) => find(token.toLowerCase().charCodeAt(0) - 97))
    if (found.every((index) => index >= 0)) return found
  }
  if (tokens.every((token) => /^(10|[1-9])$/.test(token))) {
    const found = tokens.map((token) => find(Number(token) - 1))
    if (found.every((index) => index >= 0)) return found
  }
  const parts = given.split(/\s*[,;|]\s*/).filter(Boolean)
  if (parts.length > 1) {
    const found = parts.map(byText)
    if (found.every((index) => index >= 0)) return found
  }
  return null
}

function parseRow(row: SheetRow, header: SpreadsheetHeader): ForeignQuestion | string {
  const field = (column: number) => (column >= 0 ? row.fields[column] ?? '' : '')
  const typeText = field(header.type).trim()
  const kind = kindOf(typeText)
  if (kind === 'unsupported') return `Test Parrot does not read “${excerpt(typeText, 30)}” questions from a spreadsheet.`
  const topics = header.topics.flatMap((column) => field(column).split(/[,;]/)).map((topic) => topic.trim()).filter(Boolean)
  const points = pointsIn(field(header.points))
  const base = {
    line: row.line,
    ...(typeText ? { sourceType: typeText } : {}),
    ...(topics.length ? { topics } : {}),
    ...(points !== undefined ? { points } : {}),
    stem: richBlocks(field(header.question).trim()),
  }
  const answer = field(header.correct).trim()
  const options = header.options
    .map((option) => ({ index: option.index, text: field(option.column) }))
    .filter((option) => option.text.trim())

  const truth = TRUTH[answer.toLowerCase()]
  if (kind === 'true-false' || (kind === null && !options.length && truth !== undefined)) {
    if (truth !== undefined) return { ...base, kind: 'true-false', answer: truth }
    const named = resolveCorrect(answer, options)
    const chosen = named?.length === 1 ? TRUTH[options[named[0]!]!.text.trim().toLowerCase()] : undefined
    if (chosen !== undefined) return { ...base, kind: 'true-false', answer: chosen }
    return answer ? `its answer “${excerpt(answer, 20)}” is not true or false.` : { ...base, kind: 'true-false', answer: null }
  }
  if (kind === 'essay') {
    return { ...base, kind: 'short-answer', ...(answer ? { suggestedAnswer: richBlocks(answer) } : {}) }
  }
  if (kind === 'fill-in-blank' || (kind === null && !options.length)) {
    if (!answer && kind === null) return { ...base, kind: 'short-answer' }
    return { ...base, kind: 'fill-in-blank', accepted: answer ? [answer] : [] }
  }

  // Multiple Choice or Multiple Answer.
  let choices: ForeignChoice[]
  const named = resolveCorrect(answer, options)
  if (named) {
    choices = options.map((option, index) => ({ content: richBlocks(option.text), correct: named.includes(index) }))
  } else if (header.distractors) {
    // The options are the wrong answers; the correct one is written out.
    choices = [
      { content: richBlocks(answer), correct: true },
      ...options.map((option) => ({ content: richBlocks(option.text), correct: false })),
    ]
  } else {
    return `its correct answer “${excerpt(answer, 30)}” is not one of its options, their letter or their number.`
  }
  const correct = choices.filter((choice) => choice.correct).length
  return kind === 'multiple-answer' || correct > 1
    ? { ...base, kind: 'multiple-answer', choices }
    : { ...base, kind: 'multiple-choice', choices }
}

export function parseSpreadsheetRows(rows: SheetRow[]): ParseResult {
  const header = spreadsheetHeader(rows)
  if (!header) return { questions: [], issues: [], found: 0 }
  const questions: ForeignQuestion[] = []
  const issues: ImportIssue[] = []
  let found = 0
  for (const row of rows) {
    if (row.line <= header.line || isBlankRow(row)) continue
    found += 1
    const parsed = parseRow(row, header)
    if (typeof parsed === 'string') {
      issues.push({
        severity: 'error',
        code: 'unreadable-question',
        message: `Question ${found} (line ${row.line}): ${parsed}`,
        line: row.line,
        excerpt: excerpt(row.fields[header.question] ?? ''),
      })
    } else {
      questions.push({ ...parsed, number: found })
    }
  }
  return { questions, issues, found }
}

async function detect(input: FormatInput): Promise<number> {
  const rows = (await readSheet(input))?.rows
  const header = rows && spreadsheetHeader(rows)
  if (!header) return 0
  return 0.45 + (header.options.length >= 2 ? 0.1 : 0) + (header.correct >= 0 ? 0.05 : 0) + (header.type >= 0 ? 0.05 : 0)
}

export const spreadsheet: FormatSpec = {
  id: 'spreadsheet',
  detect,
  parse: async (input) => parseSpreadsheetRows((await readSheet(input))?.rows ?? []),
}
