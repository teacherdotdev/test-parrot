import { htmlBlocks, plainBlocks } from '../rich-text'
import { excerpt, linesOf, plainStructure, type Line } from '../text'
import { BLANK_MARK, type Blocks, type ForeignChoice, type ForeignQuestion, type FormatInput, type FormatSpec, type ImportIssue, type ParseResult } from '../types'
import { categoryTopic } from './moodle-xml'

/**
 * Moodle's GIFT: questions typed as text, the answers in braces, a blank
 * line between questions — read the way MoodleDocs describes it.
 *
 * - `// …` lines are comments; `$CATEGORY: a/b/c` names the category the
 *   questions after it belong to, whose last part becomes their topic.
 * - `::Title::` names a question and `[html]`, `[markdown]`, `[plain]` or
 *   `[moodle]` says how its text is written. `\~ \= \# \{ \} \:` are the
 *   characters themselves, and `\n` a line break (though not the `\n` of
 *   TeX's `\neq`).
 * - In the braces: nothing is an essay; `T`, `F`, `TRUE` or `FALSE` is
 *   True/False; `#…` is numerical (`3:0.5`, `1..5`, or several `=` answers);
 *   `=a -> b` pairs are matching; only `=` answers are short answer; one `=`
 *   among `~` answers is multiple choice; and `~%50%` weights with no `=` are
 *   multiple answer, every answer worth anything right. `%n%` weights and
 *   `#feedback` may follow any `=` or `~`, and `####` starts general feedback.
 * - Text after the braces makes a missing-word question: the braces become a
 *   blank in the question text — a Blank, for one with only `=` answers, and
 *   a `_____` line in a multiple choice one.
 *
 * A question with no braces is a description, text between questions, and is
 * skipped.
 */

/** GIFT's escapes, held as private-use characters while the structure is read. */
const ESCAPABLE = '~=#{}:'
const HELD = (character: string) => String.fromCharCode(0xe000 + ESCAPABLE.indexOf(character))

function hold(text: string): string {
  return text.replace(/\\([~=#{}:])/g, (_, character: string) => HELD(character)).replace(/\\n(?![a-zA-Z])/g, '\n')
}

function release(text: string): string {
  return text.replace(/[-]/g, (character) => ESCAPABLE[character.charCodeAt(0) - 0xe000]!)
}

type TextFormat = 'html' | 'markdown' | 'plain' | 'moodle'

const blocksIn = (text: string, format: TextFormat, onMissing: (source: string) => void): Blocks =>
  format === 'html' ? htmlBlocks(release(text), { onMissing }) : plainBlocks(release(text).trim())

type Answer = { mark: '=' | '~'; weight: number | null; text: string; match: string | null }

/** `=a#fb ~%50%b -> c` as answers. Feedback is not kept. */
function answersOf(body: string): Answer[] {
  const answers: Answer[] = []
  for (const piece of body.split(/(?=[=~])/)) {
    const mark = piece[0]
    if (mark !== '=' && mark !== '~') continue
    let text = piece.slice(1)
    let weight: number | null = null
    const percent = /^\s*%(-?\d+(?:\.\d+)?)%/.exec(text)
    if (percent) {
      weight = Number(percent[1])
      text = text.slice(percent[0].length)
    }
    const hash = text.indexOf('#')
    if (hash !== -1) text = text.slice(0, hash)
    let match: string | null = null
    const arrow = text.indexOf('->')
    if (arrow !== -1) {
      match = text.slice(arrow + 2).trim()
      text = text.slice(0, arrow)
    }
    answers.push({ mark, weight, text: text.trim(), match })
  }
  return answers
}

type Parsed = { question: ForeignQuestion } | { error: string } | { description: true }

function number(text: string): number | null {
  const value = Number(release(text).trim())
  return release(text).trim() !== '' && Number.isFinite(value) ? value : null
}

const trimNumber = (value: number) => String(Number(value.toPrecision(12)))

/** One numeric answer: `1822:2`, `1..5`, or `3.14`. */
function numericAnswer(text: string): { value: string; tolerance?: string } | null {
  const range = /^(.+?)\.\.(.+)$/.exec(text.trim())
  if (range) {
    const low = number(range[1]!)
    const high = number(range[2]!)
    if (low === null || high === null) return null
    return { value: trimNumber((low + high) / 2), tolerance: trimNumber(Math.abs(high - low) / 2) }
  }
  const [value, tolerance] = text.split(':')
  const parsed = number(value ?? '')
  if (parsed === null) return null
  if (tolerance !== undefined && number(tolerance) === null) return null
  return { value: release(value!).trim(), ...(tolerance !== undefined ? { tolerance: release(tolerance).trim() } : {}) }
}

function parseQuestion(source: string, line: number, onMissing: (source: string) => void): Parsed {
  let text = hold(source).trim()
  // `::Title::` is the question's name, not its text.
  const title = /^::([\s\S]*?)::/.exec(text)
  if (title) text = text.slice(title[0].length).trim()
  let format: TextFormat = 'moodle'
  const declared = /^\[(html|markdown|plain|moodle)\]/i.exec(text)
  if (declared) {
    format = declared[1]!.toLowerCase() as TextFormat
    text = text.slice(declared[0].length)
  }
  const open = text.indexOf('{')
  if (open === -1) return { description: true }
  const close = text.indexOf('}', open)
  if (close === -1) return { error: 'its answers start with “{” but never end with “}”.' }

  const before = text.slice(0, open)
  const after = text.slice(close + 1)
  let body = text.slice(open + 1, close)
  const general = body.indexOf('####')
  if (general !== -1) body = body.slice(0, general)
  body = body.trim()

  // Text after the answers makes it a missing-word question.
  const missingWord = after.trim() !== ''
  const stemText = missingWord
    ? `${before.trimEnd()} ${BLANK_MARK}${/^[\s]*[.,;:!?)]/.test(after) ? '' : ' '}${after.trim()}`
    : before
  const stem = blocksIn(stemText, format, onMissing)
  const base = { line, sourceType: 'GIFT', stem }
  const content = (answer: string) => blocksIn(answer, format, onMissing)

  if (body === '') return { question: { ...base, kind: 'short-answer' } }

  const trueFalse = /^(T|TRUE|F|FALSE)\s*(#[\s\S]*)?$/i.exec(body)
  if (trueFalse) return { question: { ...base, kind: 'true-false', answer: trueFalse[1]!.toUpperCase().startsWith('T') } }

  if (body.startsWith('#')) {
    const numeric = body.slice(1).trim()
    const pieces = /^[=~]/.test(numeric)
      ? answersOf(numeric).filter((answer) => answer.mark === '=' && (answer.weight === null || answer.weight > 0))
      : [{ text: numeric.split('#')[0]! }]
    const answers = []
    for (const piece of pieces) {
      const answer = numericAnswer(piece.text)
      if (!answer) return { error: `its numerical answer “${excerpt(release(piece.text), 20)}” is not a number, a number:tolerance, or a range such as 1..5.` }
      answers.push(answer)
    }
    return { question: { ...base, kind: 'numeric', answers } }
  }

  const answers = answersOf(body)
  if (!answers.length) {
    return { error: `Test Parrot could not read its answers, “${excerpt(release(body), 30)}”. Start each with = (right) or ~ (wrong).` }
  }
  if (answers.some((answer) => answer.match !== null)) {
    const pairs = answers.map((answer) => ({
      left: answer.text ? content(answer.text) : null,
      right: answer.match ? content(answer.match) : null,
    }))
    return { question: { ...base, kind: 'matching', pairs } }
  }
  const right = answers.filter((answer) => answer.mark === '=')
  const wrong = answers.filter((answer) => answer.mark === '~')
  if (!wrong.length) {
    const accepted = right.filter((answer) => answer.weight === null || answer.weight > 0).map((answer) => release(answer.text))
    return { question: { ...base, kind: 'fill-in-blank', accepted } }
  }
  const choicesOf = (correct: (answer: Answer) => boolean): ForeignChoice[] =>
    answers.map((answer) => ({ content: content(answer.text), correct: correct(answer) }))
  if (right.length) {
    const choices = choicesOf((answer) => answer.mark === '=')
    return { question: right.length === 1 ? { ...base, kind: 'multiple-choice', choices } : { ...base, kind: 'multiple-answer', choices } }
  }
  // Only `~` answers: those with a positive weight are right.
  const weighted = answers.filter((answer) => (answer.weight ?? 0) > 0).length
  const choices = choicesOf((answer) => (answer.weight ?? 0) > 0)
  return { question: weighted > 1 ? { ...base, kind: 'multiple-answer', choices } : { ...base, kind: 'multiple-choice', choices } }
}

const isComment = (line: Line) => plainStructure(line.text).trim().startsWith('//')

/** The file's blocks — questions and categories — with comments removed. A
 *  comment's `[tag:x]` belongs to the question below it. */
function blocksOf(text: string): { lines: Line[]; tags: string[] }[] {
  const blocks: { lines: Line[]; tags: string[] }[] = []
  let current: Line[] = []
  let tags: string[] = []
  const flush = () => {
    if (current.length) blocks.push({ lines: current, tags })
    current = []
    tags = []
  }
  for (const line of linesOf(text)) {
    if (plainStructure(line.text).trim() === '') {
      flush()
    } else if (isComment(line)) {
      for (const tag of line.text.matchAll(/\[tag:([^\]]+)\]/g)) tags.push(tag[1]!.trim())
    } else {
      current.push(line)
    }
  }
  flush()
  return blocks
}

const CATEGORY = /^\s*\$CATEGORY:\s*(.*)$/i

export function parseGift(text: string): ParseResult {
  const questions: ForeignQuestion[] = []
  const issues: ImportIssue[] = []
  let found = 0
  let topic: string | null = null
  for (const block of blocksOf(text)) {
    let lines = block.lines
    const category = CATEGORY.exec(lines[0]!.text)
    if (category) {
      topic = categoryTopic(category[1]!.trim())
      lines = lines.slice(1)
      if (!lines.length) continue
    }
    const line = lines[0]!.line
    const source = lines.map((each) => each.text).join('\n')
    const missing: string[] = []
    let parsed: Parsed
    try {
      parsed = parseQuestion(source, line, (picture) => missing.push(picture))
    } catch {
      parsed = { error: 'it could not be read.' }
    }
    if ('description' in parsed) {
      issues.push({
        severity: 'info',
        code: 'description-skipped',
        message: `Line ${line}: this has no answers in braces, so it was read as a description, text shown between questions, and skipped.`,
        line,
        excerpt: excerpt(source),
      })
      continue
    }
    found += 1
    if ('error' in parsed) {
      issues.push({
        severity: 'error',
        code: 'unreadable-question',
        message: `Question ${found} (line ${line}): ${parsed.error}`,
        line,
        excerpt: excerpt(source),
      })
      continue
    }
    const topics = [...(topic ? [topic] : []), ...block.tags]
    questions.push({ ...parsed.question, number: found, ...(topics.length ? { topics } : {}) })
    if (missing.length) {
      issues.push({
        severity: 'warning',
        code: 'picture-missing',
        message: `Question ${found} (line ${line}): a GIFT file cannot carry pictures, so ${missing.length === 1 ? 'its picture was' : `its ${missing.length} pictures were`} left out. Add ${missing.length === 1 ? 'it' : 'them'} after importing.`,
        line,
        excerpt: excerpt(source),
      })
    }
  }
  return { questions, issues, found }
}

/** Braces holding GIFT answers: `{}`, `{T}`, `{#…}`, or `=`/`~` answers —
 *  never `{x}` in LaTeX or `{ return x }` in code. */
const GIFT_ANSWERS = /\{\s*(?:\}|(?:T|F|TRUE|FALSE)\s*(?:#[^}]*)?\}|#[^}]*\}|[=~][^}]*\})/i

function detect(input: FormatInput): number {
  const blocks = blocksOf(input.text())
  if (!blocks.length) return 0
  let questions = 0
  let answered = 0
  let marked = 0
  for (const block of blocks) {
    const lines = CATEGORY.test(block.lines[0]!.text) ? block.lines.slice(1) : block.lines
    if (CATEGORY.test(block.lines[0]!.text)) marked += 1
    if (!lines.length) continue
    questions += 1
    const text = hold(lines.map((each) => each.text).join('\n'))
    if (GIFT_ANSWERS.test(text)) answered += 1
    if (/^::[^\n]*?::/.test(text.trim())) marked += 1
  }
  if (!questions) return 0
  const share = answered / questions
  // LaTeX or code braces, not GIFT: too few blocks have answers.
  if (share < 0.3) return share * 0.3
  let score = 0.5 + 0.35 * share
  if (marked) score += 0.1
  // Other formats' own markers.
  const lines = blocks.flatMap((block) => block.lines).map((line) => plainStructure(line.text).trim())
  if (lines.some((line) => /^ANSWER:\s*[A-Za-z]\s*$/i.test(line))) score -= 0.4
  if (lines.filter((line) => /^\*\s*[a-z][.)]\s/i.test(line)).length > questions / 2) score -= 0.3
  return Math.max(0, Math.min(1, score))
}

export const gift: FormatSpec = {
  id: 'gift',
  detect,
  parse: (input) => parseGift(input.text()),
}
