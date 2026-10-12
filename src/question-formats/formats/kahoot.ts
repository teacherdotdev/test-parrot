import { plainBlocks } from '../rich-text'
import { excerpt, plainStructure } from '../text'
import type { ForeignQuestion, FormatInput, FormatSpec, ImportIssue, ParseResult } from '../types'
import { isBlankRow, readSheet, type SheetRow } from './sheet'

/**
 * Kahoot's quiz spreadsheet: the .xlsx template Kahoot offers for import
 * (or a CSV saved from it). A few rows of instructions sit above a header
 * row — `Question`, `Answer 1` to `Answer 4`, `Time limit`, `Correct
 * answer(s)`, each header often followed by a note such as “- max 120
 * characters” — and one question per row below it.
 *
 * The correct answers are answer numbers, such as `1` or `2,3`. Kahoot
 * needs at least two answers to a question, so a row with fewer is left
 * out. Kahoot's character limits and time limits are not Test Parrot's
 * concern and are not checked; a question whose two answers are True and
 * False comes in as True/False.
 */

const HEADER_ROWS = 20

type Header = { line: number; question: number; answers: { column: number; number: number }[]; correct: number }

const label = (value: string) => plainStructure(value).trim().toLowerCase().replace(/\s+/g, ' ')

/** The header row: a `Question`, `Answer 1`…, `Time limit` and
 *  `Correct answer(s)` column in one of the first rows. */
export function kahootHeader(rows: SheetRow[]): Header | null {
  for (const row of rows.slice(0, HEADER_ROWS)) {
    const labels = row.fields.map(label)
    const question = labels.findIndex((text) => /^question\b/.test(text) && !/^question (type|number|no\b)/.test(text))
    const correct = labels.findIndex((text) => /^correct answers?\b|^correct answer\(s\)/.test(text))
    const time = labels.findIndex((text) => /^time limit\b/.test(text))
    const answers = labels.flatMap((text, column) => {
      const number = /^answer (\d{1,2})\b/.exec(text)?.[1]
      return number ? [{ column, number: Number(number) }] : []
    })
    if (question >= 0 && correct >= 0 && time >= 0 && answers.some((answer) => answer.number === 1)) {
      return { line: row.line, question, answers, correct }
    }
  }
  return null
}

const TRUE_FALSE = /^(true|false)$/i

function parseRow(row: SheetRow, header: Header): ForeignQuestion | string {
  const field = (index: number) => row.fields[index] ?? ''
  const answers = header.answers
    .map((answer) => ({ ...answer, text: field(answer.column).trim() }))
    .filter((answer) => answer.text)
  if (answers.length < 2) {
    return `Kahoot questions need at least two answers, and this one has ${answers.length === 1 ? 'one' : 'none'}.`
  }
  const given = field(header.correct).trim()
  const tokens = given.split(/[\s,;]+/).filter(Boolean)
  const numbers = tokens.map((token) => Number(token))
  if (numbers.some((number) => !Number.isInteger(number))) {
    return `its correct answer “${excerpt(given, 20)}” is not an answer number such as 1 or 2,3.`
  }
  const empty = numbers.find((number) => !answers.some((answer) => answer.number === number))
  if (empty !== undefined) return `its correct answer is answer ${empty}, which is empty.`
  const base = { line: row.line, stem: plainBlocks(field(header.question).trim()) }
  if (answers.length === 2 && numbers.length === 1 && answers.every((answer) => TRUE_FALSE.test(answer.text))) {
    const chosen = answers.find((answer) => answer.number === numbers[0])!
    return { ...base, kind: 'true-false', answer: chosen.text.toLowerCase() === 'true' }
  }
  const choices = answers.map((answer) => ({ content: plainBlocks(answer.text), correct: numbers.includes(answer.number) }))
  return numbers.length > 1 ? { ...base, kind: 'multiple-answer', choices } : { ...base, kind: 'multiple-choice', choices }
}

export function parseKahootRows(rows: SheetRow[]): ParseResult {
  const header = kahootHeader(rows)
  if (!header) return { questions: [], issues: [], found: 0 }
  const questions: ForeignQuestion[] = []
  const issues: ImportIssue[] = []
  let found = 0
  for (const row of rows) {
    if (row.line <= header.line || isBlankRow(row)) continue
    // The template numbers its rows in the first column; a number alone is
    // an unused row.
    const content = row.fields.filter((_, index) => index === header.question || index === header.correct ||
      header.answers.some((answer) => answer.column === index))
    if (content.every((field) => !field.trim())) continue
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
  return rows && kahootHeader(rows) ? 0.9 : 0
}

export const kahoot: FormatSpec = {
  id: 'kahoot',
  detect,
  parse: async (input) => parseKahootRows((await readSheet(input))?.rows ?? []),
}
