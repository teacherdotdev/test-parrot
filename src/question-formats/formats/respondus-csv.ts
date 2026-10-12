import { richBlocks } from '../rich-text'
import { excerpt, plainStructure, pointsIn } from '../text'
import type { ForeignQuestion, FormatInput, FormatSpec, ImportIssue, ParseResult } from '../types'
import { isBlankRow, readSheet, type SheetRow } from './sheet'

/**
 * Respondus's “Tab/Comma Delimited (CSV)” import: one question per row, in
 * fixed columns — Type, Title/ID, Points, Question Wording, Correct Answer,
 * Choice 1 to Choice 10, then feedback, Topic, Difficulty and Meta columns.
 *
 * The type is MC, TF, MR (multiple response), FB (fill in the blank, its
 * accepted answers in the Choice columns) or ES (essay, its model answer in
 * Choice 1). A correct answer is a letter A–J or a number 1–10; for MR a
 * list of them, such as `"a,c"` or `"a c"`; for TF also `true` or `false`.
 * A header row, which Respondus lets a teacher skip, is skipped here too.
 * Points are kept when a whole number; the Topic becomes a topic.
 * Feedback and titles are left out.
 */

const TYPES: Record<string, string> = {
  MC: 'Multiple Choice', TF: 'True/False', MR: 'Multiple Response', FB: 'Fill in the Blank', ES: 'Essay',
}

const COLUMN = { type: 0, points: 2, wording: 3, correct: 4, choices: 5, topic: 28 } as const

const typeOf = (row: SheetRow) => plainStructure(row.fields[0] ?? '').trim().toUpperCase()
const isHeader = (row: SheetRow) => /^type$/i.test(plainStructure(row.fields[0] ?? '').trim())

/** A letter A–J or number 1–10 as a 0-based choice, or `null`. */
function choiceIndex(token: string): number | null {
  const value = token.trim().toUpperCase()
  if (/^[A-J]$/.test(value)) return value.charCodeAt(0) - 65
  if (/^(10|[1-9])$/.test(value)) return Number(value) - 1
  return null
}

function parseRow(row: SheetRow): ForeignQuestion | string {
  const code = typeOf(row)
  const field = (index: number) => row.fields[index] ?? ''
  const topic = field(COLUMN.topic).trim()
  const points = pointsIn(field(COLUMN.points))
  const base = {
    line: row.line,
    sourceType: code,
    stem: richBlocks(field(COLUMN.wording)),
    ...(topic ? { topics: [topic] } : {}),
    ...(points !== undefined ? { points } : {}),
  }
  const choiceTexts = Array.from({ length: 10 }, (_, index) => field(COLUMN.choices + index))
  const correct = field(COLUMN.correct).trim()
  switch (code) {
    case 'MC':
    case 'MR': {
      const tokens = correct.split(/[\s,;]+/).filter(Boolean)
      const indexes = tokens.map(choiceIndex)
      if (tokens.length && indexes.some((index) => index === null)) {
        return `its correct answer “${excerpt(correct, 20)}” is not a choice letter (A–J) or number (1–10).`
      }
      if (code === 'MC' && tokens.length > 1) return `a Multiple Choice question has one correct answer, not “${excerpt(correct, 20)}”.`
      const last = choiceTexts.reduce((end, text, index) => (text.trim() ? index + 1 : end), 0)
      const missing = indexes.find((index) => index !== null && index >= last)
      if (missing !== undefined && missing !== null) {
        return `its correct answer “${excerpt(correct, 20)}” names choice ${missing + 1}, which is empty.`
      }
      const choices = choiceTexts.slice(0, last).map((text, index) => ({
        content: richBlocks(text),
        correct: indexes.includes(index),
      }))
      return code === 'MC'
        ? { ...base, kind: 'multiple-choice', choices }
        : { ...base, kind: 'multiple-answer', choices }
    }
    case 'TF': {
      const value = correct.toLowerCase()
      if (['1', 'a', 'true', 't'].includes(value)) return { ...base, kind: 'true-false', answer: true }
      if (['2', 'b', 'false', 'f'].includes(value)) return { ...base, kind: 'true-false', answer: false }
      return value
        ? `its correct answer “${excerpt(correct, 20)}” is not true or false (1 or 2, A or B).`
        : { ...base, kind: 'true-false', answer: null }
    }
    case 'FB':
      return { ...base, kind: 'fill-in-blank', accepted: choiceTexts.filter((text) => text.trim()) }
    case 'ES': {
      const model = choiceTexts[0]!
      return { ...base, kind: 'short-answer', ...(model.trim() ? { suggestedAnswer: richBlocks(model) } : {}) }
    }
    default:
      return `“${excerpt(field(0), 20)}” is not a Respondus CSV question type (MC, TF, MR, FB or ES).`
  }
}

export function parseRespondusRows(rows: SheetRow[]): ParseResult {
  const questions: ForeignQuestion[] = []
  const issues: ImportIssue[] = []
  let found = 0
  const content = rows.filter((row) => !isBlankRow(row))
  content.forEach((row, index) => {
    if (index === 0 && isHeader(row)) return
    found += 1
    const parsed = parseRow(row)
    if (typeof parsed === 'string') {
      issues.push({
        severity: 'error',
        code: 'unreadable-question',
        message: `Question ${found} (line ${row.line}): ${parsed}`,
        line: row.line,
        excerpt: excerpt(row.fields[COLUMN.wording] ?? ''),
      })
    } else {
      questions.push({ ...parsed, number: found })
    }
  })
  return { questions, issues, found }
}

async function detect(input: FormatInput): Promise<number> {
  const sheet = await readSheet(input)
  if (!sheet) return 0
  const rows = sheet.rows.filter((row) => !isBlankRow(row))
  if (rows[0] && isHeader(rows[0])) rows.shift()
  if (!rows.length) return 0
  const typed = rows.filter((row) => TYPES[typeOf(row)] && row.fields.length >= 4)
  // Points, when given, are a number: what tells a Respondus row from a
  // Blackboard one, whose third field is an answer.
  const pointed = typed.filter((row) => !(row.fields[2] ?? '').trim() || Number.isFinite(Number(row.fields[2]!.trim())))
  const share = typed.length / rows.length
  const score = share >= 0.8 ? 0.55 + 0.4 * (pointed.length / typed.length) * share : share * 0.4
  // Respondus reads tab-delimited files too, but those rows look like
  // Blackboard's, which comes first; stay below it.
  return sheet.source === '\t' ? Math.min(score, 0.4) : score
}

export const respondusCsv: FormatSpec = {
  id: 'respondus-csv',
  detect,
  parse: async (input) => parseRespondusRows((await readSheet(input))?.rows ?? []),
}
