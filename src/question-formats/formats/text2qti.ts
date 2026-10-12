import type { SemanticMark, SemanticNode } from '../../question-bank-export'
import { textRun } from '../rich-text'
import { excerpt, linesOf, plainStructure, pointsIn, type Line } from '../text'
import type { Blocks, ForeignChoice, ForeignQuestion, FormatInput, FormatSpec, ImportIssue, ParseResult } from '../types'

/**
 * text2qti's plain-text quizzes (github.com/gpoore/text2qti), which turn
 * Markdown into QTI for Canvas. Everything at the left margin is text2qti's
 * own syntax; everything indented under it is the Markdown of the element
 * above it.
 *
 * A question is `1.  Stem`. What follows it says its kind: `a)` choices with
 * `*c)` the correct one; `[*]` and `[ ]` for multiple answers; `*   text` for
 * each accepted short answer; `=   1.4142 +- 0.0001`, `=   [1.2598, 1.26]`
 * or `=   5` for a number; `____` for an essay and `^^^^` for a file upload.
 * `Quiz title:` and `Quiz description:` name the bank. `Points:` above a
 * question, or a group's `Points per question:`, is kept as its Points when a
 * whole number. `Title:` above a question, feedback (`... `, `+ `, `- `) and
 * question groups are text2qti's and are not kept, though a `!` solution
 * becomes an essay's suggested answer and every question in a group comes in.
 *
 * Bold, italics, code, links and `$…$` math in the Markdown are kept.
 * text2qti can run a ```` ```{.python .run} ```` block to write questions;
 * Test Parrot never runs one, and says it left it out.
 */

const QUESTION = /^(\d+)\.[ \t]+(.*)$/
const CHOICE = /^(\*)?([a-zA-Z])\)[ \t]+(.*)$/
const MULTIPLE_ANSWER = /^\[(\*| )?\][ \t]+(.*)$/
const SHORT_ANSWER = /^\*[ \t]+(.*)$/
const NUMERIC = /^=[ \t]+(.*)$/
const ESSAY = /^_{3,}\s*$/
const UPLOAD = /^\^{3,}\s*$/
const FEEDBACK = /^(\.\.\.|\+|-)[ \t]+/
const SOLUTION = /^![ \t]+(.*)$/
const SETTING = /^([A-Za-z][A-Za-z' ]*):[ \t]*(.*)$/
const QUIZ_OPTIONS = new Set([
  'shuffle answers', 'show correct answers', 'one question at a time', "can't go back",
  'feedback is solution', 'solutions sample groups', 'solutions randomize groups',
])
const GROUP_SETTINGS = new Set(['pick', 'points per question', 'solutions pick'])

const expand = (text: string) => text.replace(/\t/g, '    ')
const indentOf = (text: string) => expand(text).length - expand(text).trimStart().length

/** One element of the quiz: its Markdown, gathered from its first line and
 *  the indented lines after it. */
type Element = { lines: string[]; line: number }

type Draft = {
  number: string
  line: number
  stem: Element
  choices: { correct: boolean; element: Element }[]
  answers: { correct: boolean; element: Element }[]
  accepted: string[]
  numeric: { value: string; tolerance?: string }[]
  essay: boolean
  upload: boolean
  solution?: Element
  points?: number
}

export function parseText2qti(text: string): ParseResult {
  const lines = linesOf(text)
  const questions: ForeignQuestion[] = []
  const issues: ImportIssue[] = []
  let found = 0
  let name: string | undefined
  let description: Element | undefined
  let draft: Draft | null = null
  // The element indented lines continue, and the column its text starts at.
  let open: { element: Element; indent: number } | null = null
  let inComment = false
  let groups = 0
  let pictures = 0
  // `Points:` holds for the next question; a group's `Points per question:`
  // for every question in it that gives none of its own.
  let points: number | undefined
  let groupPoints: number | undefined

  const markdown = (element: Element) => markdownBlocks(element.lines.join('\n'), () => {
    pictures += 1
  })

  const finish = () => {
    if (!draft) return
    found += 1
    const current = draft
    draft = null
    open = null
    const result = build(current, markdown)
    if ('question' in result) {
      questions.push({ ...result.question, number: found, ...(current.points !== undefined ? { points: current.points } : {}) })
      if (current.upload) {
        issues.push({
          severity: 'info',
          code: 'file-upload',
          message: `Question ${found} (line ${current.line}): it asks for a file to be uploaded, which a printed test cannot, so it came in as Short Answer.`,
          line: current.line,
        })
      }
    } else {
      issues.push({
        severity: 'error',
        code: result.code,
        message: `Question ${found} (line ${current.line}): ${result.error}`,
        line: current.line,
        excerpt: excerpt(current.stem.lines.join(' ')),
      })
    }
  }

  const start = (lines: string[], line: number, indent: number) => {
    const element = { lines, line }
    open = { element, indent }
    return element
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const raw = line.text
    const text = plainStructure(raw)
    if (inComment) {
      if (/^END_COMMENT\s*$/.test(text)) inComment = false
      continue
    }
    if (text.trim() === '') {
      if (open) open.element.lines.push('')
      continue
    }
    if (/^[ \t]/.test(text)) {
      // Markdown belonging to the element above.
      if (open) open.element.lines.push(expand(raw).slice(Math.min(open.indent, indentOf(raw))))
      continue
    }
    if (text.startsWith('%')) continue
    if (/^COMMENT\s*$/.test(text)) {
      inComment = true
      continue
    }
    if (/^(```|~~~)/.test(text)) {
      // A fenced block at the left margin is one text2qti would run to write
      // questions. It is never run here.
      const fence = text.slice(0, 3)
      finish()
      let end = index + 1
      while (end < lines.length && !lines[end]!.text.startsWith(fence)) end += 1
      issues.push(/\.run\b/.test(text)
        ? {
            severity: 'warning',
            code: 'code-block-not-run',
            message: `Line ${line.line}: this code block writes questions when text2qti runs it. Test Parrot never runs code, so any questions it would write were left out.`,
            line: line.line,
            excerpt: excerpt(text),
          }
        : {
            severity: 'warning',
            code: 'unreadable-line',
            message: `Line ${line.line}: this code block is not part of any question, so it was left out. Indent it under the question it belongs to.`,
            line: line.line,
            excerpt: excerpt(text),
          })
      index = end
      continue
    }
    if (/^GROUP\s*$/.test(text)) {
      finish()
      groups += 1
      groupPoints = undefined
      continue
    }
    if (/^END_GROUP\s*$/.test(text)) {
      finish()
      groupPoints = undefined
      continue
    }

    const question = QUESTION.exec(text)
    if (question) {
      finish()
      const indent = indentOf(raw.replace(/^(\d+\.[ \t]+).*$/, '$1'))
      draft = {
        number: question[1]!, line: line.line, stem: { lines: [question[2]!], line: line.line },
        choices: [], answers: [], accepted: [], numeric: [], essay: false, upload: false,
        ...((points ?? groupPoints) !== undefined ? { points: points ?? groupPoints } : {}),
      }
      points = undefined
      open = { element: draft.stem, indent }
      continue
    }

    if (draft) {
      const markerIndent = (pattern: RegExp) => indentOf(raw.replace(pattern, '$1'))
      const choice = CHOICE.exec(text)
      if (choice) {
        const element = start([choice[3]!], line.line, markerIndent(/^(\*?[a-zA-Z]\)[ \t]+).*$/))
        draft.choices.push({ correct: Boolean(choice[1]), element })
        continue
      }
      const answer = MULTIPLE_ANSWER.exec(text)
      if (answer) {
        const element = start([answer[2]!], line.line, markerIndent(/^(\[[* ]?\][ \t]+).*$/))
        draft.answers.push({ correct: answer[1] === '*', element })
        continue
      }
      const short = SHORT_ANSWER.exec(text)
      if (short) {
        draft.accepted.push(short[1]!.trim())
        open = null
        continue
      }
      const numeric = NUMERIC.exec(text)
      if (numeric) {
        draft.numeric.push(numericAnswer(numeric[1]!.trim()))
        open = null
        continue
      }
      if (ESSAY.test(text)) {
        draft.essay = true
        open = null
        continue
      }
      if (UPLOAD.test(text)) {
        draft.upload = true
        open = null
        continue
      }
      const solution = SOLUTION.exec(text)
      if (solution) {
        draft.solution = start([solution[1]!], line.line, markerIndent(/^(![ \t]+).*$/))
        continue
      }
      if (FEEDBACK.test(text)) {
        // Feedback, and its indented lines, are not kept.
        open = { element: { lines: [], line: line.line }, indent: markerIndent(/^((?:\.\.\.|\+|-)[ \t]+).*$/) }
        continue
      }
    }

    const setting = SETTING.exec(text)
    if (setting) {
      const key = setting[1]!.trim().toLowerCase()
      const value = setting[2]!.trim()
      if (key === 'quiz title') {
        finish()
        name = value
        open = { element: { lines: [], line: line.line }, indent: 2 }
        continue
      }
      if (key === 'quiz description') {
        finish()
        description = start([value], line.line, indentOf(raw.replace(/^([^:]*:[ \t]*).*$/, '$1')))
        continue
      }
      if (key === 'points') points = pointsIn(value)
      if (key === 'points per question') groupPoints = pointsIn(value)
      if (key === 'title' || key === 'points' || key === 'text title' || key === 'text' || QUIZ_OPTIONS.has(key) || GROUP_SETTINGS.has(key)) {
        finish()
        // A title's or text region's wrapped lines are indented too.
        open = { element: { lines: [], line: line.line }, indent: 2 }
        continue
      }
    }

    // Text at the margin that text2qti does not know.
    if (draft) {
      issues.push({
        severity: 'warning',
        code: 'unreadable-line',
        message: `Question ${found + 1} (line ${line.line}): this line was not understood and was left out: “${excerpt(text)}”. Indent it to make it part of the text above.`,
        line: line.line,
        excerpt: excerpt(text),
      })
    }
  }
  finish()

  if (groups) {
    issues.push({
      severity: 'info',
      code: 'question-group',
      message: `The file has ${groups === 1 ? 'a question group' : `${groups} question groups`}, from which a quiz picks some questions at random. Every question in ${groups === 1 ? 'it' : 'them'} came in.`,
    })
  }
  if (pictures) {
    issues.push({
      severity: 'warning',
      code: 'picture-left-out',
      message: `${pictures === 1 ? 'One picture' : `${pictures} pictures`} named in the file ${pictures === 1 ? 'is' : 'are'} a separate file, not in it, so ${pictures === 1 ? 'it was' : 'they were'} left out. Add ${pictures === 1 ? 'it' : 'them'} after importing.`,
    })
  }
  const descriptionText = description ? description.lines.join('\n').trim() : ''
  return {
    questions,
    issues,
    found,
    ...(name ? { name } : {}),
    ...(descriptionText ? { description: descriptionText } : {}),
  }
}

/** `1.4142 +- 0.0001`, `[1.2598, 1.2600]`, `5`, `1_000`. */
function numericAnswer(text: string): { value: string; tolerance?: string } {
  const range = /^\[\s*([^,\]]+?)\s*,\s*([^\]]+?)\s*\]$/.exec(text)
  if (range) return { value: `${range[1]} to ${range[2]}` }
  const margin = /^(.+?)\s*\+-\s*(.+)$/.exec(text)
  if (margin) return { value: margin[1]!.replace(/_/g, ''), tolerance: margin[2]!.trim() }
  return { value: text.replace(/_/g, '') }
}

type Built = { question: ForeignQuestion } | { error: string; code: string }

function build(draft: Draft, markdown: (element: Element) => Blocks): Built {
  const line = draft.line
  const stem = markdown(draft.stem)
  const kinds = [
    draft.choices.length > 0, draft.answers.length > 0, draft.accepted.length > 0,
    draft.numeric.length > 0, draft.essay, draft.upload,
  ].filter(Boolean).length
  if (kinds > 1) {
    return { code: 'mixed-answers', error: 'its answers are of more than one kind — choices, [*] answers, * short answers, = numbers, ____ or ^^^^ — and a question has one.' }
  }
  if (draft.choices.length) {
    if (draft.choices.length < 2) return { code: 'too-few-choices', error: 'a multiple choice question needs at least two choices.' }
    const correct = draft.choices.filter((choice) => choice.correct).length
    if (!correct) return { code: 'no-correct-answer', error: 'no choice is marked correct. Put * directly before the correct choice’s letter, e.g. “*c) 5”.' }
    const texts = draft.choices.map((choice) => choice.element.lines.join(' ').trim().toLowerCase())
    if (texts.length === 2 && correct === 1 && texts.includes('true') && texts.includes('false')) {
      const answer = draft.choices.find((choice) => choice.correct)!
      return { question: { kind: 'true-false', line, sourceType: 'true_false', stem, answer: answer.element.lines.join(' ').trim().toLowerCase() === 'true' } }
    }
    const choices: ForeignChoice[] = draft.choices.map((choice) => ({ correct: choice.correct, content: markdown(choice.element) }))
    return {
      question: correct === 1
        ? { kind: 'multiple-choice', line, sourceType: 'multiple_choice', stem, choices }
        : { kind: 'multiple-answer', line, sourceType: 'multiple_choice', stem, choices },
    }
  }
  if (draft.answers.length) {
    if (draft.answers.length < 2) return { code: 'too-few-choices', error: 'a multiple answers question needs at least two answers.' }
    const choices: ForeignChoice[] = draft.answers.map((answer) => ({ correct: answer.correct, content: markdown(answer.element) }))
    return { question: { kind: 'multiple-answer', line, sourceType: 'multiple_answers', stem, choices } }
  }
  if (draft.accepted.length) return { question: { kind: 'fill-in-blank', line, sourceType: 'short_answer', stem, accepted: draft.accepted } }
  if (draft.numeric.length) return { question: { kind: 'numeric', line, sourceType: 'numerical', stem, answers: draft.numeric } }
  if (draft.essay || draft.upload) {
    const solution = draft.solution ? markdown(draft.solution) : undefined
    return {
      question: {
        kind: 'short-answer', line, sourceType: draft.essay ? 'essay' : 'file_upload', stem,
        ...(solution ? { suggestedAnswer: solution } : {}),
      },
    }
  }
  return { code: 'no-answers', error: 'it has no answers. Give it choices (“a)”, “*b)”), or end it with ____ for an essay.' }
}

// Markdown, the part of it question text uses.

/** Markdown as blocks: paragraphs the blank lines separate, fenced code, and
 *  bold, italics, code, links and `$…$` math within a paragraph. A picture
 *  is left out and counted. */
export function markdownBlocks(text: string, onPicture: () => void = () => {}): Blocks {
  const blocks: Blocks = []
  const lines = text.split('\n')
  let paragraph: string[] = []
  const flush = () => {
    const joined = paragraph.join('\n').trim()
    paragraph = []
    if (!joined) return
    const content = markdownInline(joined, onPicture)
    if (content.length) blocks.push({ type: 'paragraph', content })
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      let end = index + 1
      while (end < lines.length && !lines[end]!.trim().startsWith(fence[1]!)) {
        code.push(lines[end]!)
        end += 1
      }
      blocks.push({ type: 'code-block', text: code.join('\n'), ...(fence[2] ? { language: fence[2] } : {}) })
      index = end
      continue
    }
    if (line.trim() === '') flush()
    else paragraph.push(line)
  }
  flush()
  return blocks.length ? blocks : [{ type: 'paragraph' }]
}

const SAFE_HREF = /^https?:\/\//i

/** One paragraph's inline Markdown. A line break is a space, as Markdown
 *  reads it, unless the line ends in two spaces or a backslash. */
function markdownInline(text: string, onPicture: () => void, marks: SemanticMark[] = []): SemanticNode[] {
  const nodes: SemanticNode[] = []
  let plain = ''
  const push = () => {
    if (plain) nodes.push(textRun(plain, marks.length ? marks : undefined))
    plain = ''
  }
  const withMark = (mark: SemanticMark) => (marks.some((each) => each.type === mark.type) ? marks : [...marks, mark])
  let index = 0
  while (index < text.length) {
    const rest = text.slice(index)
    const character = text[index]!
    if (character === '\\' && /^\\[\\`*_$[\]()!#+\-.{}]/.test(rest)) {
      plain += rest[1]
      index += 2
      continue
    }
    if (character === '\n' || /^( {2,}|\\)\n/.test(rest)) {
      const hard = /^( {2,}|\\)\n/.exec(rest)
      if (hard) {
        plain = plain.replace(/ +$/, '')
        push()
        nodes.push({ type: 'hard-break' })
        index += hard[0].length
      } else {
        plain = `${plain.replace(/ +$/, '')} `
        index += 1
        while (text[index] === ' ') index += 1
      }
      continue
    }
    const code = /^(`+)([\s\S]+?)\1(?!`)/.exec(rest)
    if (code) {
      push()
      nodes.push(textRun(code[2]!.trim(), withMark({ type: 'inline-code' })))
      index += code[0].length
      continue
    }
    const math = /^\$(\S(?:[^$]*?\S)?)\$/.exec(rest)
    if (math) {
      push()
      nodes.push({ type: 'inline-math', source: math[1]! })
      index += math[0].length
      continue
    }
    const image = /^!\[([^\]]*)\]\(([^)]*)\)(\{[^}]*\})?/.exec(rest)
    if (image) {
      push()
      onPicture()
      index += image[0].length
      continue
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest)
    if (link) {
      push()
      const href = link[2]!
      nodes.push(...markdownInline(link[1]!, onPicture, SAFE_HREF.test(href) ? withMark({ type: 'link', href }) : marks))
      index += link[0].length
      continue
    }
    const strong = /^(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1/.exec(rest)
    if (strong) {
      push()
      nodes.push(...markdownInline(strong[2]!, onPicture, withMark({ type: 'strong' })))
      index += strong[0].length
      continue
    }
    const emphasis = /^(\*|_)(?=\S)([\s\S]+?)(?<=\S)\1/.exec(rest)
    const wordInside = character === '_' && /\w/.test(text[index - 1] ?? '')
    if (emphasis && !wordInside) {
      push()
      nodes.push(...markdownInline(emphasis[2]!, onPicture, withMark({ type: 'emphasis' })))
      index += emphasis[0].length
      continue
    }
    const strike = /^~~(?=\S)([\s\S]+?)(?<=\S)~~/.exec(rest)
    if (strike) {
      push()
      nodes.push(...markdownInline(strike[1]!, onPicture, withMark({ type: 'strike' })))
      index += strike[0].length
      continue
    }
    plain += character
    index += 1
  }
  push()
  return nodes.filter((node) => node.type !== 'text' || node.text)
}

function detect(input: FormatInput): number {
  const lines = linesOf(input.text()).map((line: Line) => plainStructure(line.text))
  const margin = lines.filter((line) => line.trim() !== '')
  if (!margin.length) return 0
  const questions = margin.filter((line) => QUESTION.test(line)).length
  const quizTitle = margin.some((line) => /^Quiz (title|description):/i.test(line))
  if (!questions && !quizTitle) return 0
  // Other formats' own markers.
  if (margin.some((line) => /^\s*Type:\s*\S+\s*$/i.test(line) || /^\s*Answers:\s*$/i.test(line) || /^\s*[@~] /.test(line))) return 0.1
  if (margin.some((line) => /^(MC|MA|TF|ES|ESS|BL|FIB|MAT)\s*$/.test(line.trim()))) return 0.1
  if (margin.some((line) => /^ANSWER:\s*[A-Za-z]\s*$/.test(line.trim()))) return 0.1

  let markers = 0
  const signals = [
    /^Quiz title:/i, /^Quiz description:/i, MULTIPLE_ANSWER, /^=[ \t]+[-+\d[.]/, /^\.\.\.[ \t]/, /^[+-][ \t]+\S/,
    ESSAY, UPLOAD, /^GROUP\s*$/, /^END_GROUP\s*$/, /^pick:/, /^\*[ \t]+\S/,
  ]
  for (const signal of signals) if (margin.some((line) => signal.test(line))) markers += 1
  if (!markers) return 0.25
  return Math.min(0.97, 0.8 + 0.05 * markers)
}

export const text2qti: FormatSpec = {
  id: 'text2qti',
  detect,
  parse: (input) => parseText2qti(input.text()),
}
