import { plainBlocks } from '../rich-text'
import { blocksOf, excerpt, plainStructure, type Line } from '../text'
import type { ForeignQuestion, FormatInput, FormatSpec, ImportIssue, ParseResult } from '../types'

/**
 * Aiken: Moodle's simplest format, multiple choice only. The question, then
 * its answers each on a line of its own starting with a capital letter and a
 * period or parenthesis (`A.` or `A)`), then `ANSWER: B`.
 *
 * Moodle wants the question on one line and a blank line between questions;
 * this is more forgiving. Every line before the first answer is the
 * question, and an `ANSWER:` line ends a question even with no blank line
 * after it. `ANSWER:B` with no space, or a lower-case `answer:` or letter,
 * is read with a warning, since Moodle would refuse it.
 */

const OPTION = /^([A-Z])[.)]\s+(.*)$/
const ANSWER = /^answer\s*:\s*([A-Za-z])\s*$/i
const STRICT_ANSWER = /^ANSWER: [A-Z]$/

const clean = (line: Line) => plainStructure(line.text).trim()

/** A block's lines split into questions, each ending at its `ANSWER:` line. */
function questionsOf(block: Line[]): Line[][] {
  const questions: Line[][] = []
  let current: Line[] = []
  for (const line of block) {
    current.push(line)
    if (ANSWER.test(clean(line))) {
      questions.push(current)
      current = []
    }
  }
  if (current.length) questions.push(current)
  return questions
}

type Parsed = { question: ForeignQuestion; warning?: string } | { error: string }

function parseQuestion(lines: Line[]): Parsed {
  const line = lines[0]!.line
  const answerLine = lines.at(-1)!
  const answer = ANSWER.exec(clean(answerLine))
  if (!answer) return { error: 'it has no ANSWER line. Put “ANSWER: ” and the correct letter on the line after its answers.' }
  const body = lines.slice(0, -1)
  const first = body.findIndex((each) => OPTION.test(clean(each)))
  if (first === -1) return { error: 'it has no answers. Put each on its own line starting “A. ”, “B. ” and so on.' }
  if (first === 0) return { error: 'it has no question text before its answers.' }

  const stem = body.slice(0, first).map((each) => each.text.trim()).join('\n')
  const options: { letter: string; text: string }[] = []
  for (const each of body.slice(first)) {
    const option = OPTION.exec(clean(each))
    if (option) {
      // Keep the teacher's own characters in the answer text.
      const original = each.text.trim()
      const at = original.length - option[2]!.length
      options.push({ letter: option[1]!, text: at >= 0 ? original.slice(at).trim() : option[2]!.trim() })
    } else {
      // A line that is not an answer continues the one above it.
      options.at(-1)!.text += `\n${each.text.trim()}`
    }
  }
  const letter = answer[1]!.toUpperCase()
  if (!options.some((option) => option.letter === letter)) {
    return { error: `its ANSWER is ${letter}, but it has no answer ${letter}.` }
  }
  const question: ForeignQuestion = {
    kind: 'multiple-choice',
    line,
    sourceType: 'Aiken',
    stem: plainBlocks(stem),
    choices: options.map((option) => ({ content: plainBlocks(option.text), correct: option.letter === letter })),
  }
  return STRICT_ANSWER.test(clean(answerLine))
    ? { question }
    : { question, warning: `its answer line “${excerpt(answerLine.text, 20)}” should be written “ANSWER: ${letter}”; Moodle would refuse it as it is.` }
}

export function parseAiken(text: string): ParseResult {
  const questions: ForeignQuestion[] = []
  const issues: ImportIssue[] = []
  let found = 0
  for (const block of blocksOf(text)) {
    for (const lines of questionsOf(block)) {
      found += 1
      const line = lines[0]!.line
      const parsed = parseQuestion(lines)
      const report = (severity: ImportIssue['severity'], code: string, message: string) =>
        issues.push({
          severity,
          code,
          message: `Question ${found} (line ${line}): ${message}`,
          line,
          excerpt: excerpt(lines.map((each) => each.text).join(' ')),
        })
      if ('error' in parsed) {
        report('error', 'unreadable-question', parsed.error)
        continue
      }
      questions.push({ ...parsed.question, number: found })
      if (parsed.warning) report('warning', 'answer-line', parsed.warning)
    }
  }
  return { questions, issues, found }
}

function detect(input: FormatInput): number {
  const blocks = blocksOf(input.text())
  if (!blocks.length) return 0
  const lines = blocks.flat().map(clean)
  if (!lines.some((line) => ANSWER.test(line))) return 0
  let questions = 0
  let aiken = 0
  for (const block of blocks) {
    for (const each of questionsOf(block)) {
      questions += 1
      const cleaned = each.map(clean)
      if (ANSWER.test(cleaned.at(-1)!) && cleaned.filter((line) => OPTION.test(line)).length >= 2) aiken += 1
    }
  }
  const share = aiken / questions
  let score = share >= 0.5 ? 0.6 + 0.4 * share : share * 0.6
  // Other formats' own markers: the Blackboard generator's `*` and tags,
  // Respondus's `Type:`.
  if (lines.some((line) => /^\*/.test(line))) score *= 0.5
  if (lines.some((line) => /^(MC|MA|TF|ES|ESS|BL|FIB|MAT)$/.test(line) || /^(Type|Title|Points):/i.test(line))) score *= 0.5
  return Math.max(0, Math.min(1, score))
}

export const aiken: FormatSpec = {
  id: 'aiken',
  detect,
  parse: (input) => parseAiken(input.text()),
}
