import { htmlBlocks, plainBlocks } from '../rich-text'
import { excerpt, linesOf, plainStructure, pointsIn, type Line } from '../text'
import { BLANK_MARK, type Blocks, type ForeignChoice, type ForeignQuestion, type FormatInput, type FormatSpec, type ImportIssue, type ParseResult } from '../types'

/**
 * Respondus's “Standard Format” for importing questions from plain text or
 * Word, as Respondus 4 documents it: a question is a number and `.` or `)`,
 * its answers the letters A to T, and a `*` directly before a letter marks
 * that answer correct. Without stars, an `Answers:` list at the end of the
 * file gives each question's answer by its number — `3. B`, `4. B, D`, or a
 * fill-in-the-blank's number repeated once per accepted answer.
 *
 * Lines above a question say more about it: `Type:` gives its kind (`E`
 * essay, `F` fill in the blank, `S` short answer, `MT` matching, `MA`, `MS`
 * or `MR` multiple answer, `ORD` ordering, `FMB` fill in multiple blanks),
 * `Title:` its title, and `Points:` its points and every later question's,
 * kept as Points when a whole number. `~ ` and `@ ` lines are feedback.
 * Test Parrot keeps neither titles nor feedback.
 *
 * Where Respondus would quietly mark answer A correct because nothing else
 * is, this leaves the question out and says so: a guessed answer key is
 * worse than none.
 */

const QUESTION = /^\s*(\d+)\s*[.)]\s+(.*)$/
const CHOICE = /^\s*(\*)?\s*([A-Ta-t])\s*[.)]\s+(.*)$/
const TYPE = /^\s*Type:\s*(\S+)\s*$/i
const TITLE = /^\s*Title:/i
const POINTS = /^\s*Points:\s*(.*)$/i
const FEEDBACK = /^\s*[@~]\s/
const ANSWERS = /^\s*Answers:\s*$/i
const KEY_ENTRY = /^\s*(\d+)\s*[.)]\s*(.*)$/
const IMAGE = /\[img:[^\]]*\]/gi

type Kind = 'MC' | 'MA' | 'E' | 'F' | 'S' | 'MT' | 'ORD' | 'FMB'

const TYPES: Record<string, Kind> = {
  MC: 'MC', MA: 'MA', MS: 'MA', MR: 'MA', E: 'E', F: 'F', S: 'S', MT: 'MT', ORD: 'ORD', FMB: 'FMB',
}

const clean = (line: Line) => plainStructure(line.text).trim()

type Draft = {
  number: string
  line: number
  sourceType?: string
  points?: number
  stem: string[]
  choices: { correct: boolean; letter: string; lines: string[]; line: number }[]
}

/** Question text, answer text: plain, or the `[HTML]…[/HTML]` Respondus
 *  passes through; a picture it names from a folder is left out. */
function contentOf(text: string, onPicture: () => void): Blocks {
  const withoutPictures = text.replace(IMAGE, () => {
    onPicture()
    return ''
  }).trim()
  const html = /\[HTML\]([\s\S]*?)\[\/HTML\]/i.exec(withoutPictures)
  if (html) {
    const combined = withoutPictures.replace(/\[HTML\]([\s\S]*?)\[\/HTML\]/gi, (_, inner: string) => inner)
    return htmlBlocks(combined)
  }
  return plainBlocks(withoutPictures)
}

/** The `Answers:` list: each question number's answers, in order. */
function readKey(lines: Line[]): Map<string, string[]> {
  const key = new Map<string, string[]>()
  let current: { number: string; index: number } | null = null
  for (const line of lines) {
    const text = clean(line)
    if (!text) continue
    const entry = KEY_ENTRY.exec(text)
    if (entry) {
      const values = key.get(entry[1]!) ?? []
      values.push(entry[2]!.trim())
      key.set(entry[1]!, values)
      current = { number: entry[1]!, index: values.length - 1 }
    } else if (current) {
      // An essay's answer runs over several lines.
      const values = key.get(current.number)!
      values[current.index] = `${values[current.index]} ${text}`.trim()
    }
  }
  return key
}

const TRUE_WORDS = new Set(['true', 't'])
const FALSE_WORDS = new Set(['false', 'f'])

export function parseRespondus(text: string): ParseResult {
  const lines = linesOf(text)
  const questions: ForeignQuestion[] = []
  const issues: ImportIssue[] = []
  let found = 0

  // The answer list is the last line of just “Answers:”, and all after it.
  let keyAt = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (ANSWERS.test(clean(lines[index]!))) {
      keyAt = index
      break
    }
  }
  const key = keyAt === -1 ? new Map<string, string[]>() : readKey(lines.slice(keyAt + 1))
  const body = keyAt === -1 ? lines : lines.slice(0, keyAt)

  let pendingType: string | undefined
  // A `Points:` line holds for every question after it, until the next.
  let points: number | undefined
  let draft: Draft | null = null
  // Where continuation lines go: the stem, the last answer, or feedback.
  let target: 'stem' | 'choice' | 'feedback' = 'stem'

  const finish = () => {
    if (!draft) return
    found += 1
    const current = draft
    draft = null
    let pictures = 0
    const content = (value: string) => contentOf(value, () => { pictures += 1 })
    const result = build(current, key, content)
    if (pictures) {
      issues.push({
        severity: 'warning',
        code: 'picture-left-out',
        message: `Question ${found} (line ${current.line}): ${pictures === 1 ? 'its picture is' : `its ${pictures} pictures are`} in a separate folder Respondus reads, not in this file, so ${pictures === 1 ? 'it was' : 'they were'} left out. Add ${pictures === 1 ? 'it' : 'them'} after importing.`,
        line: current.line,
        excerpt: excerpt(current.stem.join(' ')),
      })
    }
    if ('question' in result) {
      questions.push({ ...result.question, number: found })
    } else {
      issues.push({
        severity: 'error',
        code: result.code,
        message: `Question ${found} (line ${current.line}): ${result.error}`,
        line: current.line,
        excerpt: excerpt(current.stem.join(' ')),
      })
    }
  }

  for (const line of body) {
    const text = clean(line)
    if (!text) continue
    const type = TYPE.exec(text)
    if (type) {
      finish()
      pendingType = type[1]!
      continue
    }
    const pointsLine = POINTS.exec(text)
    if (pointsLine) points = pointsIn(pointsLine[1])
    if (TITLE.test(text) || pointsLine) {
      finish()
      continue
    }
    const question = QUESTION.exec(text)
    if (question) {
      finish()
      const at = line.text.length - line.text.trimStart().length
      const original = line.text.slice(at).replace(/^\s*\d+\s*[.)]\s+/, '')
      draft = { number: question[1]!, line: line.line, sourceType: pendingType, points, stem: [original.trim() || question[2]!], choices: [] }
      pendingType = undefined
      target = 'stem'
      continue
    }
    if (!draft) continue
    if (FEEDBACK.test(text)) {
      target = 'feedback'
      continue
    }
    const choice = CHOICE.exec(text)
    if (choice) {
      draft.choices.push({ correct: Boolean(choice[1]), letter: choice[2]!.toUpperCase(), lines: [choice[3]!.trim()], line: line.line })
      target = 'choice'
      continue
    }
    if (target === 'stem') draft.stem.push(line.text.trim())
    else if (target === 'choice') draft.choices.at(-1)!.lines.push(line.text.trim())
  }
  finish()
  if (pendingType) {
    issues.push({ severity: 'warning', code: 'orphan-type', message: `The type “Type: ${pendingType}” at the end of the file has no question after it.` })
  }
  return { questions, issues, found }
}

type Built = { question: ForeignQuestion } | { error: string; code: string }

const letterIndex = (letter: string) => letter.toUpperCase().charCodeAt(0) - 65

function build(draft: Draft, key: Map<string, string[]>, content: (text: string) => Blocks): Built {
  const typeName = draft.sourceType?.toUpperCase()
  const kind: Kind | undefined = typeName === undefined ? 'MC' : TYPES[typeName]
  const line = draft.line
  const stemText = draft.stem.join('\n')
  const stem = content(stemText)
  const keyed = key.get(draft.number)
  const choiceText = (choice: Draft['choices'][number]) => choice.lines.join(' ').trim()
  const sourceType = draft.sourceType ?? 'MC'
  const base = { line, sourceType, stem, ...(draft.points !== undefined ? { points: draft.points } : {}) }
  if (!kind) {
    return { code: 'unsupported-type', error: `Test Parrot cannot read Respondus questions of type “${draft.sourceType}”, so it was left out.` }
  }

  switch (kind) {
    case 'E': {
      const answer = draft.choices.length
        ? draft.choices.map(choiceText).join('\n')
        : keyed?.join('\n')
      return { question: { ...base, kind: 'short-answer', ...(answer ? { suggestedAnswer: content(answer) } : {}) } }
    }
    case 'F':
    case 'S': {
      const accepted = draft.choices.length ? draft.choices.map(choiceText) : keyed ?? []
      if (!accepted.length) {
        if (kind === 'S') return { question: { ...base, kind: 'short-answer' } }
        return { code: 'no-accepted-answer', error: 'a fill-in-the-blank question needs its answer, lettered below it (“a. Zworykin”) or in the Answers: list.' }
      }
      return { question: { ...base, kind: 'fill-in-blank', accepted } }
    }
    case 'FMB': {
      const blanks: { name: string; accepted: string[] }[] = []
      const shown = stemText.replace(/\[([^\]]*)\]/g, (_, inside: string) => {
        blanks.push({ name: `Blank ${blanks.length + 1}`, accepted: inside.split(',').map((each) => each.trim()).filter(Boolean) })
        return BLANK_MARK
      })
      if (!blanks.length) return { code: 'no-blanks', error: 'a fill in multiple blanks question needs each blank’s answer in [square brackets] in its wording.' }
      return { question: { ...base, stem: content(shown), kind: 'fill-in-blanks', blanks } }
    }
    case 'MT': {
      if (!draft.choices.length) return { code: 'no-matching-pairs', error: 'a matching question needs its pairs, lettered, each written “left = right”.' }
      const missing = draft.choices.find((choice) => !choiceText(choice).includes('='))
      if (missing) return { code: 'unreadable-pair', error: `this matching pair has no “=” between its two sides: “${excerpt(choiceText(missing))}”.` }
      const pairs = draft.choices.map((choice) => {
        const value = choiceText(choice)
        const at = value.indexOf('=')
        const left = value.slice(0, at).trim()
        const right = value.slice(at + 1).trim()
        return { left: left ? content(left) : null, right: right ? content(right) : null }
      })
      return { question: { ...base, kind: 'matching', pairs } }
    }
    case 'ORD': {
      if (draft.choices.length < 2) return { code: 'too-few-items', error: 'an ordering question needs at least two items, lettered below it in their correct order.' }
      return { question: { ...base, kind: 'ordering', items: draft.choices.map((choice) => content(choiceText(choice))) } }
    }
    case 'MC':
    case 'MA':
      break
  }

  if (!draft.choices.length) {
    // A numbered question with no answers and no type reads as the essay
    // it plainly is.
    return { question: { ...base, sourceType: 'E', kind: 'short-answer' } }
  }
  if (draft.choices.length === 1) {
    return { code: 'too-few-choices', error: 'it has one answer. A multiple choice question needs at least two; an essay needs “Type: E” on the line above it.' }
  }
  const texts = draft.choices.map(choiceText)
  const trueFalse = texts.length === 2 &&
    TRUE_WORDS.has(texts[0]!.toLowerCase()) && FALSE_WORDS.has(texts[1]!.toLowerCase()) && kind === 'MC'

  let correct = draft.choices.map((choice) => choice.correct)
  if (!correct.some(Boolean) && keyed?.length) {
    const value = keyed.join(' ').trim()
    const lower = value.toLowerCase()
    if (trueFalse && (TRUE_WORDS.has(lower) || FALSE_WORDS.has(lower))) {
      correct = [TRUE_WORDS.has(lower), FALSE_WORDS.has(lower)]
    } else {
      const letters = value.split(/[\s,]+/).filter(Boolean)
      const unknown = letters.find((each) => !/^[A-Ta-t]$/.test(each) || letterIndex(each) >= draft.choices.length)
      if (unknown) {
        return { code: 'unreadable-answer-key', error: `the Answers: list gives “${excerpt(value, 30)}” for it, which is not the letter of one of its answers.` }
      }
      const marked = new Set(letters.map(letterIndex))
      correct = draft.choices.map((_, index) => marked.has(index))
    }
  }
  if (!correct.some(Boolean)) {
    return {
      code: 'no-correct-answer',
      error: 'no answer is marked correct. Put * directly before the correct answer’s letter, e.g. “*b) 5”, or list it in an Answers: list at the end of the file.',
    }
  }
  if (trueFalse && correct.filter(Boolean).length === 1) {
    return { question: { ...base, sourceType: 'TF', kind: 'true-false', answer: correct[0]! } }
  }
  const choices: ForeignChoice[] = draft.choices.map((choice, index) => ({ correct: correct[index]!, content: content(texts[index]!) }))
  const several = correct.filter(Boolean).length > 1
  return {
    question: kind === 'MA' || several
      ? { ...base, kind: 'multiple-answer', choices }
      : { ...base, kind: 'multiple-choice', choices },
  }
}

function detect(input: FormatInput): number {
  const lines = linesOf(input.text()).map(clean).filter(Boolean)
  if (!lines.length) return 0
  const questions = lines.filter((line) => QUESTION.test(line)).length
  if (!questions) return 0
  // Other formats' own markers: a Blackboard Test Generator tag alone on a
  // line, Aiken's `ANSWER: B`, text2qti's.
  if (lines.some((line) => /^(MC|MA|TF|ES|ESS|BL|FIB|MAT)$/.test(line))) return 0.1
  if (lines.some((line) => /^ANSWER:\s*[A-Za-z]\s*$/.test(line))) return 0.1
  if (lines.some((line) => /^(Quiz title:|\[[ *]?\]\s|=\s+[-\d[]|\.\.\.\s|_{3,}$|\^{3,}$|GROUP$|END_GROUP$)/.test(line))) return 0.15

  const choices = lines.filter((line) => CHOICE.test(line)).length
  let markers = 0
  let strong = false
  if (lines.some((line) => TYPE.test(line) && TYPES[TYPE.exec(line)![1]!.toUpperCase()])) strong = true
  if (lines.some((line) => ANSWERS.test(line))) strong = true
  for (const line of lines) {
    if (TYPE.test(line) || TITLE.test(line) || POINTS.test(line) || FEEDBACK.test(line)) markers += 1
  }
  // Without a marker of its own, Respondus's layout is the Blackboard Test
  // Generator's, which reads it and comes first.
  if (!markers && !strong) return choices ? 0.4 : 0.2
  if (strong) return 0.95
  return Math.min(0.9, 0.75 + 0.05 * markers)
}

export const respondus: FormatSpec = {
  id: 'respondus',
  detect,
  parse: (input) => parseRespondus(input.text()),
}
