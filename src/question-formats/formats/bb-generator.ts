import { plainBlocks } from '../rich-text'
import { blocksOf, excerpt, plainStructure, type Line } from '../text'
import type { ForeignQuestion, FormatInput, FormatSpec, ImportIssue, ParseResult } from '../types'

/**
 * The plain text teachers type or paste into the Blackboard Test Generator —
 * Oklahoma Christian University's (ed.oc.edu), and the Algonquin and College
 * of Southern Idaho tools it came from — read the way its QuizParser reads it.
 *
 * Questions are separated by a blank line, and come two ways:
 *
 * - numbered: `1. Stem`, then lettered answers `a) …`, a `*` before each
 *   correct one. One answer line of `True`/`F`/… makes True/False, none makes
 *   an essay, and several correct make Multiple Answer. `blank 5. …` is fill
 *   in the blank, every answer accepted; `match 6. …` is matching, each
 *   answer `left / right` (Southern Idaho's generator; Oklahoma Christian's
 *   refuses matching).
 * - tagged: a line of just `MC`, `MA`, `TF`, `ES` or `BL`, then the stem on
 *   the next line and the answers on the lines after it, unlettered, a `*`
 *   before each correct one. A tag holds for the questions after it until a
 *   numbered question or another tag, and a tag alone above a question
 *   applies to it.
 *
 * Where Oklahoma Christian's parser would refuse a question outright but its
 * meaning is plain — an essay prompt that runs over two lines, a question
 * tagged `MC` with two answers starred — this reads it and says so.
 */

const QUESTION = /^\s*(\d+)[.)]\s*(.+)$/
const BLANK_QUESTION = /^\s*blank\s+(\d+)[.)]\s*(.+)$/i
const MATCH_QUESTION = /^\s*match\s+(\d+)[.)]\s*(.+)$/i
const ANSWER = /^\s*(\*)?\s*([a-zA-Z])[.)]\s*(.+)$/
const TRUE_FALSE = /^\s*(t|true|f|false)\s*$/i

type Tag = 'MC' | 'MA' | 'TF' | 'ES' | 'BL' | 'MAT'

const TAGS: Record<string, Tag> = {
  MC: 'MC', MA: 'MA', TF: 'TF', ES: 'ES', ESS: 'ES', BL: 'BL', FIB: 'BL', BLANK: 'BL', MAT: 'MAT', MATCH: 'MAT',
}

const tagOf = (line: string): Tag | null => TAGS[plainStructure(line).trim().toUpperCase()] ?? null

const clean = (line: Line) => plainStructure(line.text).trim()

const isQuestionLine = (line: Line) => {
  const text = clean(line)
  return QUESTION.test(text) || BLANK_QUESTION.test(text) || MATCH_QUESTION.test(text)
}

const isAnswerBlock = (block: Line[]) =>
  (block.length === 1 && TRUE_FALSE.test(clean(block[0]!))) || block.every((line) => ANSWER.test(clean(line)))

/** A starred answer line: whether it is correct, and its text. */
function starred(line: Line): { correct: boolean; text: string } {
  const text = line.text.trim()
  const plain = plainStructure(text)
  if (plain.startsWith('*')) return { correct: true, text: text.slice(text.indexOf('*') + 1).trim() }
  return { correct: false, text }
}

/** A lettered answer's text, when every answer in a tagged question is
 *  lettered: `a) 4` reads as `4`. */
function withoutLetters(answers: { correct: boolean; text: string }[]) {
  if (answers.length < 2 || !answers.every(({ text }) => /^[a-zA-Z][.)]\s+\S/.test(plainStructure(text)))) return answers
  return answers.map(({ correct, text }) => ({ correct, text: text.replace(/^\s*[a-zA-Z][.)]\s+/, '') }))
}

function splitPair(text: string): { left: string; right: string } | null {
  const slash = text.indexOf('/')
  if (slash === -1) return null
  return { left: text.slice(0, slash).trim(), right: text.slice(slash + 1).trim() }
}

const pairsOf = (texts: string[]) =>
  texts.map((text) => {
    const pair = splitPair(text)
    return pair
      ? { left: pair.left ? plainBlocks(pair.left) : null, right: pair.right ? plainBlocks(pair.right) : null }
      : { left: plainBlocks(text), right: null }
  })

type Parsed = { question: ForeignQuestion } | { error: string } | { header: Tag }

/** Oklahoma Christian's “gather orphan answers”: a question alone in its
 *  block, followed by a block of only answers, is one question. */
function gatherOrphanAnswers(blocks: Line[][]): Line[][] {
  const gathered: Line[][] = []
  for (const block of blocks) {
    const previous = gathered.at(-1)
    if (previous && previous.length === 1 && isQuestionLine(previous[0]!) && isAnswerBlock(block)) {
      gathered[gathered.length - 1] = [...previous, ...block]
    } else {
      gathered.push(block)
    }
  }
  return gathered
}

function parseNumbered(block: Line[]): Parsed | null {
  const first = clean(block[0]!)
  const line = block[0]!.line
  const blank = BLANK_QUESTION.exec(first)
  const match = MATCH_QUESTION.exec(first)
  const numbered = QUESTION.exec(first)
  if (!blank && !match && !numbered) return null
  const rest = block.slice(1)

  // The stem runs until the first lettered answer. Oklahoma Christian's
  // parser wants it on one line; a wrapped stem is read as one.
  let answerAt = rest.findIndex((next) => ANSWER.test(clean(next)))
  if (answerAt === -1) answerAt = rest.length
  let stemLines = [(blank ?? match ?? numbered)![2]!.trim(), ...rest.slice(0, answerAt).map((next) => next.text.trim())]
  const answers = rest.slice(answerAt)
  const invalid = answers.find((next) => !ANSWER.test(clean(next)))
  if (invalid) return { error: `this answer does not start with a letter and a period or parenthesis: “${excerpt(invalid.text)}”.` }
  const lettered = answers.map((next) => {
    const [, star, , text] = ANSWER.exec(clean(next))!
    // Keep the teacher's own characters in the answer text.
    const original = next.text.trim()
    const at = original.length - text!.length
    return { correct: Boolean(star), text: at >= 0 ? original.slice(at).trim() : text!.trim() }
  })

  if (blank) {
    if (!lettered.length) return { error: 'a fill-in-the-blank question needs at least one answer.' }
    return {
      question: { kind: 'fill-in-blank', line, sourceType: 'blank', stem: plainBlocks(stemLines.join('\n')), accepted: lettered.map(({ text }) => text) },
    }
  }
  if (match) {
    if (!lettered.length) return { error: 'a matching question needs its pairs, each written “left / right”.' }
    const missing = lettered.find(({ text }) => !text.includes('/'))
    if (missing) return { error: `this matching pair has no “/” between its two sides: “${excerpt(missing.text)}”.` }
    return {
      question: { kind: 'matching', line, sourceType: 'match', stem: plainBlocks(stemLines.join('\n')), pairs: pairsOf(lettered.map(({ text }) => text)) },
    }
  }

  if (!lettered.length) {
    // A last line of just True or False is the answer of a True/False question.
    const last = stemLines.at(-1)!
    if (stemLines.length > 1 && TRUE_FALSE.test(plainStructure(last))) {
      stemLines = stemLines.slice(0, -1)
      return {
        question: { kind: 'true-false', line, sourceType: 'TF', stem: plainBlocks(stemLines.join('\n')), answer: /^\s*t/i.test(plainStructure(last)) },
      }
    }
    return { question: { kind: 'short-answer', line, sourceType: 'essay', stem: plainBlocks(stemLines.join('\n')) } }
  }
  if (lettered.length === 1) {
    return { error: 'it has one answer, and it is not True or False. A multiple choice question needs at least two answers.' }
  }
  const correct = lettered.filter((answer) => answer.correct).length
  if (correct === 0) return { error: 'no answer is marked correct. Put * directly before the correct answer, e.g. “*b) 5”.' }
  const stem = plainBlocks(stemLines.join('\n'))
  const trueFalse = trueFalseChoices(lettered)
  if (trueFalse !== undefined) return { question: { kind: 'true-false', line, sourceType: 'TF', stem, answer: trueFalse } }
  const choices = lettered.map(({ correct: isCorrect, text }) => ({ correct: isCorrect, content: plainBlocks(text) }))
  return {
    question: correct === 1
      ? { kind: 'multiple-choice', line, sourceType: 'MC', stem, choices }
      : { kind: 'multiple-answer', line, sourceType: 'MA', stem, choices },
  }
}

/** `*a) True` / `b) False` is a True/False question written as choices. */
function trueFalseChoices(answers: { correct: boolean; text: string }[]): boolean | undefined {
  if (answers.length !== 2) return undefined
  const [first, second] = answers.map(({ text }) => plainStructure(text).trim().toLowerCase())
  if (first !== 'true' || second !== 'false') return undefined
  const correct = answers.filter((answer) => answer.correct)
  if (correct.length !== 1) return undefined
  return answers[0]!.correct
}

function parseTagged(block: Line[], active: Tag | null): { parsed: Parsed; active: Tag | null } {
  const ownTag = tagOf(block[0]!.text)
  const tag = ownTag ?? active
  const body = ownTag ? block.slice(1) : block
  if (!tag) {
    return {
      parsed: { error: 'Test Parrot could not tell what kind of question this is. Number it (“1.”), or put its type — MC, MA, TF, ES or BL — on the line above it.' },
      active,
    }
  }
  if (!body.length) return { parsed: { header: tag }, active: tag }
  // The question starts where the teacher wrote it, on its tag line.
  const line = block[0]!.line
  const stemText = body[0]!.text.trim()
  const answerLines = body.slice(1)
  const stem = plainBlocks(stemText)
  const next = (parsed: Parsed) => ({ parsed, active: tag })

  switch (tag) {
    case 'ES':
      return next({
        question: { kind: 'short-answer', line, sourceType: 'ES', stem: plainBlocks(body.map((each) => each.text.trim()).join('\n')) },
      })
    case 'BL': {
      if (!answerLines.length) return next({ error: 'a fill-in-the-blank question needs at least one answer, each on its own line below the question.' })
      return next({ question: { kind: 'fill-in-blank', line, sourceType: 'BL', stem, accepted: answerLines.map((each) => each.text.trim()) } })
    }
    case 'TF': {
      if (answerLines.length !== 1) return next({ error: 'a True/False question needs its answer — T or F — on one line below it.' })
      const answer = plainStructure(answerLines[0]!.text).trim().replace(/^\*/, '').trim().toLowerCase()[0]
      if (answer !== 't' && answer !== 'f') return next({ error: 'True and False are the only answers a True/False question can have.' })
      return next({ question: { kind: 'true-false', line, sourceType: 'TF', stem, answer: answer === 't' } })
    }
    case 'MAT': {
      if (!answerLines.length) return next({ error: 'a matching question needs its pairs, each written “left / right”.' })
      const missing = answerLines.find((each) => !each.text.includes('/'))
      if (missing) return next({ error: `this matching pair has no “/” between its two sides: “${excerpt(missing.text)}”.` })
      const texts = answerLines.map((each) => each.text.trim().replace(/^\s*[a-zA-Z][.)]\s+/, ''))
      return next({ question: { kind: 'matching', line, sourceType: 'MAT', stem, pairs: pairsOf(texts) } })
    }
    case 'MC':
    case 'MA': {
      if (!answerLines.length) return next({ error: 'a multiple choice question needs its answers, each on its own line below the question, with * before the correct one.' })
      const answers = withoutLetters(answerLines.map(starred))
      const correct = answers.filter((answer) => answer.correct).length
      if (correct === 0) return next({ error: 'no answer is marked correct. Put * directly before the correct answer, e.g. “*Mercury”.' })
      const trueFalse = trueFalseChoices(answers)
      if (trueFalse !== undefined) return next({ question: { kind: 'true-false', line, sourceType: tag, stem, answer: trueFalse } })
      const choices = answers.map(({ correct: isCorrect, text }) => ({ correct: isCorrect, content: plainBlocks(text) }))
      return next({
        question: tag === 'MC' && correct === 1
          ? { kind: 'multiple-choice', line, sourceType: tag, stem, choices }
          : { kind: 'multiple-answer', line, sourceType: tag, stem, choices },
      })
    }
  }
}

export function parseBbGenerator(text: string): ParseResult {
  const questions: ForeignQuestion[] = []
  const issues: ImportIssue[] = []
  let found = 0
  let active: Tag | null = null
  let pendingHeader: { tag: Tag; line: number } | null = null
  for (const block of gatherOrphanAnswers(blocksOf(text))) {
    let parsed: Parsed | null = null
    if (!pendingHeader) parsed = parseNumbered(block)
    if (parsed) {
      active = null
    } else {
      const tagged = parseTagged(block, pendingHeader?.tag ?? active)
      parsed = tagged.parsed
      active = tagged.active
    }
    pendingHeader = null
    if ('header' in parsed) {
      pendingHeader = { tag: parsed.header, line: block[0]!.line }
      continue
    }
    found += 1
    if ('question' in parsed) {
      questions.push({ ...parsed.question, number: found })
    } else {
      issues.push({
        severity: 'error',
        code: 'unreadable-question',
        message: `Question ${found} (line ${block[0]!.line}): ${parsed.error}`,
        line: block[0]!.line,
        excerpt: excerpt(block.filter((each) => !tagOf(each.text)).map((each) => each.text).join(' ')),
      })
    }
  }
  if (pendingHeader) {
    issues.push({
      severity: 'warning',
      code: 'orphan-tag',
      message: `Line ${pendingHeader.line}: the type “${pendingHeader.tag}” has no question after it.`,
      line: pendingHeader.line,
    })
  }
  return { questions, issues, found }
}

function detect(input: FormatInput): number {
  const text = input.text()
  const blocks = blocksOf(text)
  if (!blocks.length) return 0
  const lines = blocks.flat().map(clean)
  // Other formats' own markers.
  if (lines.some((line) => /^ANSWER:\s*[A-Za-z]\s*$/i.test(line) || /^(Type|Title|Points):/i.test(line))) return 0.2
  if (lines.filter((line) => line.includes('\t')).length > lines.length / 2) return 0.05
  if (/\{[^}]*[=~][^}]*\}/.test(text) && /::|\{T\}|\{F\}/.test(text)) return 0.1

  let recognized = 0
  let tags = 0
  let stars = 0
  for (const block of blocks) {
    const first = block[0]!
    if (tagOf(first.text)) {
      tags += 1
      recognized += 1
    } else if (isQuestionLine(first)) {
      recognized += 1
    }
    if (block.slice(1).some((line) => clean(line).startsWith('*'))) stars += 1
  }
  let score = recognized / blocks.length
  if (tags > 0) score = Math.min(1, score + 0.15)
  if (stars > 0) score = Math.min(1, score + 0.1)
  else if (tags === 0) score *= 0.7
  return score
}

export const bbGenerator: FormatSpec = {
  id: 'bb-generator',
  detect,
  parse: (input) => parseBbGenerator(input.text()),
}
