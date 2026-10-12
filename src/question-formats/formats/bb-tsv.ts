import { inMarkedOrder, markNamedBlanks, richBlocks } from '../rich-text'
import { delimitedRows, excerpt, plainStructure, trimTrailingEmpty } from '../text'
import type { ForeignQuestion, FormatInput, FormatSpec, ImportIssue, ParseResult } from '../types'

/**
 * Blackboard's “Upload Questions” file: tab-delimited text, one question per
 * row, its type in the first field — the file Blackboard documents, and the
 * one the Blackboard Test Generator's “Download Test Questions” saves.
 *
 * Fields a spreadsheet quoted are unquoted the way Excel writes them. Empty
 * fields at a row's end are ignored; empty fields inside it separate Fill in
 * Multiple Blanks groups. Types and the words `correct`, `incorrect`, `true`
 * and `false` are read in any case. A blank line, which Blackboard refuses,
 * is skipped.
 */

const CODES = new Set([
  'MC', 'MA', 'TF', 'ESS', 'MAT', 'FIB', 'FIB_PLUS', 'NUM', 'ORD', 'FIL', 'SR', 'OP', 'JUMBLED_SENTENCE', 'QUIZ_BOWL', 'EO',
])

type Row = { fields: string[]; line: number }

function parseRow({ fields, line }: Row): ForeignQuestion | string {
  const code = plainStructure(fields[0]!).trim().toUpperCase()
  const stemText = fields[1] ?? ''
  const stem = richBlocks(stemText)
  const rest = trimTrailingEmpty(fields.slice(2))
  const base = { line, sourceType: code, stem }
  switch (code) {
    case 'MC':
    case 'MA': {
      if (rest.length < 2) return 'it has no answers. Each answer is followed by a field saying “correct” or “incorrect”.'
      if (rest.length % 2 === 1) rest.push('')
      const choices = []
      for (let index = 0; index < rest.length; index += 2) {
        const mark = rest[index + 1]!.trim().toLowerCase()
        if (mark !== 'correct' && mark !== 'incorrect') {
          return `the answer “${excerpt(rest[index]!, 40)}” is followed by “${excerpt(rest[index + 1]!, 20)}”, not “correct” or “incorrect”.`
        }
        choices.push({ content: richBlocks(rest[index]!), correct: mark === 'correct' })
      }
      if (!choices.some((choice) => choice.correct)) return 'no answer is marked “correct”.'
      const correct = choices.filter((choice) => choice.correct).length
      return code === 'MC' && correct === 1
        ? { ...base, kind: 'multiple-choice', choices }
        : { ...base, kind: 'multiple-answer', choices }
    }
    case 'TF': {
      const answer = (rest[0] ?? '').trim().toLowerCase()
      if (answer !== 'true' && answer !== 'false') return 'its answer must be “true” or “false”.'
      return { ...base, kind: 'true-false', answer: answer === 'true' }
    }
    case 'EO': {
      // Either/Or: a statement answered with one of a pair such as yes/no.
      const answer = (rest[0] ?? '').trim().toLowerCase()
      const [yes, no] = answer.split('/')
      return yes && no
        ? { ...base, kind: 'short-answer', suggestedAnswer: richBlocks(yes) }
        : { ...base, kind: 'short-answer' }
    }
    case 'ESS':
    case 'SR':
      return { ...base, kind: 'short-answer', ...(rest[0]?.trim() ? { suggestedAnswer: richBlocks(rest[0]) } : {}) }
    case 'FIL':
      return { ...base, kind: 'short-answer' }
    case 'MAT': {
      if (rest.length < 2) return 'it has no pairs to match.'
      const pairs = []
      for (let index = 0; index < rest.length; index += 2) {
        const left = rest[index]!
        const right = rest[index + 1] ?? ''
        pairs.push({ left: left.trim() ? richBlocks(left) : null, right: right.trim() ? richBlocks(right) : null })
      }
      return { ...base, kind: 'matching', pairs }
    }
    case 'FIB':
      if (!rest.some((answer) => answer.trim())) return 'it has no accepted answers.'
      return { ...base, kind: 'fill-in-blank', accepted: rest }
    case 'FIB_PLUS': {
      const blanks: { name: string; accepted: string[] }[] = []
      let current: { name: string; accepted: string[] } | null = null
      for (const field of rest) {
        if (field.trim() === '') {
          current = null
        } else if (!current) {
          current = { name: field.trim(), accepted: [] }
          blanks.push(current)
        } else {
          current.accepted.push(field)
        }
      }
      if (!blanks.length) return 'it has no blanks.'
      // Blackboard writes each blank in the question as `[name]`.
      const marked = markNamedBlanks(base.stem, blanks.map((blank) => blank.name))
      return { ...base, stem: marked.stem, kind: 'fill-in-blanks', blanks: inMarkedOrder(blanks, marked.order) }
    }
    case 'NUM': {
      const value = (rest[0] ?? '').trim()
      if (!value || Number.isNaN(Number(value.replace(',', '.')))) return `its answer “${excerpt(value, 20)}” is not a number.`
      const tolerance = rest[1]?.trim()
      return { ...base, kind: 'numeric', answers: [{ value, ...(tolerance ? { tolerance } : {}) }] }
    }
    case 'ORD':
      if (!rest.length) return 'it has nothing to put in order.'
      return { ...base, kind: 'ordering', items: rest.map((item) => richBlocks(item)) }
    case 'OP':
      return 'it is an opinion scale, a survey question with no answer, which Test Parrot does not have.'
    case 'JUMBLED_SENTENCE':
    case 'QUIZ_BOWL':
      return `Test Parrot has no ${code === 'QUIZ_BOWL' ? 'Quiz Bowl' : 'Jumbled Sentence'} questions.`
    default:
      return `“${excerpt(fields[0]!, 20)}” is not a Blackboard question type.`
  }
}

export function parseBbTsv(text: string): ParseResult {
  const questions: ForeignQuestion[] = []
  const issues: ImportIssue[] = []
  let found = 0
  for (const row of delimitedRows(text, '\t')) {
    if (row.fields.every((field) => field.trim() === '')) continue
    found += 1
    const parsed = parseRow(row)
    if (typeof parsed === 'string') {
      issues.push({
        severity: 'error',
        code: 'unreadable-question',
        message: `Question ${found} (line ${row.line}): ${parsed}`,
        line: row.line,
        excerpt: excerpt(row.fields.slice(1, 2).join(' ')),
      })
    } else {
      questions.push({ ...parsed, number: found })
    }
  }
  return { questions, issues, found }
}

function detect(input: FormatInput): number {
  const rows = delimitedRows(input.text(), '\t').filter((row) => row.fields.some((field) => field.trim()))
  if (!rows.length) return 0
  const coded = rows.filter(
    (row) => row.fields.length >= 2 && CODES.has(plainStructure(row.fields[0]!).trim().toUpperCase()),
  ).length
  return coded / rows.length >= 0.8 ? Math.min(1, 0.6 + (coded / rows.length) * 0.4) : (coded / rows.length) * 0.5
}

export const bbTsv: FormatSpec = {
  id: 'bb-tsv',
  detect,
  parse: (input) => parseBbTsv(input.text()),
}
