import { htmlBlocks, plainBlocks, richBlocks, type HtmlOptions } from '../rich-text'
import { excerpt, pointsIn } from '../text'
import { BLANK_MARK, type Blocks, type ForeignBlank, type ForeignChoice, type ForeignImage, type ForeignQuestion, type FormatInput, type FormatSpec, type ImportIssue, type ParseResult } from '../types'
import {
  attributeOf,
  childOf,
  childrenOf,
  decodeEntities,
  descendantsOf,
  documentElement,
  parseXml,
  textOf,
  type XmlElement,
} from '../xml'

/**
 * Moodle XML: the question bank export every Moodle writes, a `<quiz>` of
 * `<question type="…">` elements.
 *
 * - Multiple choice says with `<single>` whether one answer or several are
 *   right; each `<answer>` carries a `fraction`, the percentage it earns.
 *   With one right answer, the one worth 100 is it (or, if none is, the one
 *   worth most); with several, every answer worth anything is right.
 * - True/false, short answer (every answer worth anything accepted),
 *   matching (a `<subquestion>` with no text is a distractor answer), essay
 *   (the grader information, or failing that the response template, is its
 *   model answer), numerical (each answer and its tolerance) and ordering
 *   come across as those kinds.
 * - Cloze (“embedded answers”) writes its blanks in the question text, such
 *   as `{1:MULTICHOICE:=Paris~London}` or `{:NUMERICAL:=3.14:0.01}`; each
 *   becomes a Blank where it stands, with its accepted answers — a
 *   drop-down's being its right choices. A short answer question's Blank
 *   follows its text.
 * - A `category` pseudo-question names the category the questions after it
 *   belong to, such as `$course$/top/Chapter 1`; its last real part becomes
 *   their topic, as each question's own `<tags>` do.
 * - Pictures travel inside the file, base64 in a `<file>` the text points to
 *   as `@@PLUGINFILE@@/name`; Moodle 1.9 wrote one `<image_base64>` per
 *   question instead.
 *
 * A question's `<defaultgrade>`, its points in a quiz, is kept as its Points
 * when a whole number. Descriptions, which are text and not questions, are
 * skipped and noted.
 */

type Context = {
  index: number
  images: Map<string, ForeignImage>
  /** The pictures of this question, by their `path` + `name`. */
  files: Map<string, string>
  missing: string[]
}

const MIME_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp',
}

const mimeTypeOf = (name: string) => MIME_TYPES[name.toLowerCase().replace(/^.*\./, '')] ?? 'application/octet-stream'

function base64Bytes(text: string): Uint8Array | null {
  try {
    const binary = atob(text.replace(/\s+/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Every `<file>` a question carries, registered as an image. */
function collectFiles(question: XmlElement, context: Context) {
  for (const file of descendantsOf(question, 'file')) {
    const name = attributeOf(file, 'name')
    if (!name || (attributeOf(file, 'encoding') ?? 'base64') !== 'base64') continue
    const bytes = base64Bytes(textOf(file))
    if (!bytes) continue
    const path = attributeOf(file, 'path') ?? '/'
    const full = `${path.endsWith('/') ? path : `${path}/`}${name}`
    const key = `moodle:${context.index}:${full}`
    context.images.set(key, { bytes, mimeType: mimeTypeOf(name) })
    context.files.set(full, key)
  }
}

function htmlOptions(context: Context): HtmlOptions {
  return {
    image: (source) => {
      const src = source.trim()
      if (src.startsWith('@@PLUGINFILE@@')) {
        const path = safeDecode(src.slice('@@PLUGINFILE@@'.length).replace(/[?#].*$/, ''))
        const full = path.startsWith('/') ? path : `/${path}`
        const found = context.files.get(full)
        if (found) return found
        const name = full.replace(/^.*\//, '')
        for (const [each, key] of context.files) if (each.endsWith(`/${name}`)) return key
        return null
      }
      const data = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(src)
      if (data) {
        const bytes = base64Bytes(data[2]!)
        if (!bytes) return null
        const key = `moodle:${context.index}:data:${context.images.size}`
        context.images.set(key, { bytes, mimeType: data[1]!.toLowerCase() })
        return key
      }
      return null
    },
    onMissing: (source) => context.missing.push(source),
  }
}

/** A Moodle text element — `<questiontext format="html"><text>…` — as blocks. */
function blocksOf(element: XmlElement | undefined, context: Context, text = textOf(childOf(element, 'text'))): Blocks {
  switch (attributeOf(element, 'format')) {
    case 'html':
      return htmlBlocks(text, htmlOptions(context))
    case 'plain_text':
    case 'markdown':
      return plainBlocks(text)
    default:
      // `moodle_auto_format`, or no format at all as older answers are
      // written: plain text that may hold HTML.
      return richBlocks(text, htmlOptions(context))
  }
}

/** A short answer's text, which Moodle keeps plain but an editor may not. */
function plainText(text: string): string {
  return decodeEntities(text.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''), true).replace(/\s+/g, ' ').trim()
}

const fractionOf = (answer: XmlElement) => {
  const value = Number(attributeOf(answer, 'fraction') ?? '0')
  return Number.isFinite(value) ? value : 0
}

/** A category's path as a topic: `$course$/top/Chapter 1` → `Chapter 1`;
 *  `null` when it names only Moodle's own levels. `//` is a slash in a name. */
export function categoryTopic(path: string): string | null {
  const parts = path
    .replace(/\/\//g, '\ue000')
    .split('/')
    .map((part) => part.replace(/\ue000/g, '/').trim())
    .filter((part) => part && !/^\$[a-z0-9]+\$$/i.test(part) && part.toLowerCase() !== 'top' && !/^default for\b/i.test(part))
  return parts.at(-1) ?? null
}

/** The line each `<question` starts on, in document order. */
function questionLines(text: string): number[] {
  // Blank out comments and CDATA, keeping their line breaks, so a `<question`
  // inside them is not counted.
  const visible = text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, (hidden) => hidden.replace(/[^\n]/g, ' '))
  const lines: number[] = []
  let line = 1
  let last = 0
  for (const match of visible.matchAll(/<question[\s>/]/g)) {
    for (let index = last; index < match.index; index += 1) if (visible.charCodeAt(index) === 10) line += 1
    last = match.index
    lines.push(line)
  }
  return lines
}

// ——— Cloze ———


/** One cloze answer: `=Paris#Right!`, `%50%Lyon`, `~London`. */
function clozeAnswers(body: string): { text: string; weight: number }[] {
  const answers: { text: string; weight: number }[] = []
  // `~` separates answers; `\~`, `\}`, `\#` and `\/` are the characters themselves.
  const protectedBody = body.replace(/\\([~}#/\\"])/g, (_, character: string) => String.fromCharCode(0xe000 + character.charCodeAt(0)))
  for (const raw of protectedBody.split('~')) {
    let text = raw.trim()
    if (!text) continue
    let weight = 0
    if (text.startsWith('=')) {
      weight = 100
      text = text.slice(1)
    } else {
      const percent = /^%(-?[\d.]+)%/.exec(text)
      if (percent) {
        weight = Number(percent[1])
        text = text.slice(percent[0].length)
      }
    }
    const hash = text.indexOf('#')
    if (hash !== -1) text = text.slice(0, hash)
    text = text.replace(/[\ue000-\ue07f]/g, (held) => String.fromCharCode(held.charCodeAt(0) - 0xe000))
    answers.push({ text: plainText(text), weight })
  }
  return answers
}

const CLOZE = /\{(\d*):([A-Za-z_]+):((?:\\.|[^\\}])*)\}/g

/** A cloze question's text with each embedded answer made a blank. */
function readCloze(html: string): { html: string; blanks: ForeignBlank[]; unknown: string[] } {
  const blanks: ForeignBlank[] = []
  const unknown: string[] = []
  const replaced = html.replace(CLOZE, (whole, _weight: string, type: string, body: string) => {
    const kind = type.toUpperCase()
    const answers = clozeAnswers(body)
    let accepted: string[]
    // A multiple choice or multiple response embedded answer is picked from
    // a list; the others are typed.
    const dropdown = /^(MULTICHOICE|MULTIRESPONSE)(_[A-Z]+)?$|^(MC|MR)[A-Z]{0,2}$/.test(kind)
    if (/^(NUMERICAL|NM)$/.test(kind)) {
      accepted = answers.filter(({ weight }) => weight > 0).map(({ text }) => {
        const [value, tolerance] = text.split(':')
        return tolerance && Number(tolerance) !== 0 ? `${value!.trim()} (± ${tolerance.trim()})` : value!.trim()
      })
    } else if (/^(MULTICHOICE|MULTIRESPONSE|SHORTANSWER)(_[A-Z]+)?$|^(MC|MR|SA|MW)[A-Z]{0,2}$/.test(kind)) {
      accepted = answers.filter(({ weight }) => weight > 0).map(({ text }) => text)
    } else {
      unknown.push(type)
      return whole
    }
    blanks.push({ name: String(blanks.length + 1), accepted, ...(dropdown ? { dropdown: true } : {}) })
    return BLANK_MARK
  })
  return { html: replaced, blanks, unknown }
}

// ——— Questions ———

type Read = { question: ForeignQuestion } | { error: string; unsupported?: true } | { skip: string }

function readQuestion(element: XmlElement, type: string, context: Context, line: number | undefined): Read {
  const questionText = childOf(element, 'questiontext')
  const answers = childrenOf(element, 'answer')
  const base = { ...(line ? { line } : {}), sourceType: type }
  const stem = () => {
    const blocks = blocksOf(questionText, context)
    // Moodle 1.9 kept a question's one picture beside its text.
    const legacy = textOf(childOf(element, 'image_base64')).trim()
    const legacyName = textOf(childOf(element, 'image')).trim()
    if (legacy) {
      const bytes = base64Bytes(legacy)
      if (bytes) {
        const key = `moodle:${context.index}:image_base64`
        context.images.set(key, { bytes, mimeType: mimeTypeOf(legacyName || 'picture.png') })
        blocks.push({ type: 'block-image', asset: key })
      } else {
        context.missing.push(legacyName || 'picture')
      }
    } else if (legacyName) {
      context.missing.push(legacyName)
    }
    return blocks
  }

  switch (type) {
    case 'multichoice':
    case 'multichoiceset': {
      const single = type === 'multichoice' && textOf(childOf(element, 'single')).trim().toLowerCase() !== 'false'
      const fractions = answers.map(fractionOf)
      let correct: (fraction: number) => boolean
      if (single) {
        const best = Math.max(0, ...fractions)
        correct = fractions.includes(100) ? (fraction) => fraction === 100 : (fraction) => best > 0 && fraction === best
      } else {
        correct = (fraction) => fraction > 0
      }
      const choices: ForeignChoice[] = answers.map((answer, index) => ({
        content: blocksOf(answer, context),
        correct: correct(fractions[index]!),
      }))
      return { question: { ...base, kind: single ? 'multiple-choice' : 'multiple-answer', stem: stem(), choices } }
    }
    case 'truefalse': {
      const right = answers.find((answer) => fractionOf(answer) === 100) ?? answers.find((answer) => fractionOf(answer) > 0)
      let answer: boolean | null = null
      if (right) {
        const said = plainText(textOf(childOf(right, 'text'))).toLowerCase()
        answer = said === 'true' ? true : said === 'false' ? false : answers.indexOf(right) === 0
      }
      return { question: { ...base, kind: 'true-false', stem: stem(), answer } }
    }
    case 'shortanswer': {
      const accepted = answers.filter((answer) => fractionOf(answer) > 0).map((answer) => plainText(textOf(childOf(answer, 'text'))))
      return { question: { ...base, kind: 'fill-in-blank', stem: stem(), accepted } }
    }
    case 'numerical': {
      const values = answers
        .filter((answer) => fractionOf(answer) > 0)
        .map((answer) => ({ value: plainText(textOf(childOf(answer, 'text'))), tolerance: textOf(childOf(answer, 'tolerance')).trim() }))
        .filter(({ value }) => value && value !== '*')
      const invalid = values.find(({ value }) => Number.isNaN(Number(value.replace(',', '.'))))
      if (invalid) return { error: `its answer “${excerpt(invalid.value, 20)}” is not a number.` }
      return {
        question: {
          ...base,
          kind: 'numeric',
          stem: stem(),
          answers: values.map(({ value, tolerance }) => ({ value, ...(tolerance ? { tolerance } : {}) })),
        },
      }
    }
    case 'matching': {
      const pairs = childrenOf(element, 'subquestion').map((subquestion) => {
        const left = blocksOf(subquestion, context)
        const right = plainText(textOf(childOf(childOf(subquestion, 'answer'), 'text')))
        const hasLeft = plainText(textOf(childOf(subquestion, 'text'))) !== '' || /<img\b/i.test(textOf(childOf(subquestion, 'text')))
        return { left: hasLeft ? left : null, right: right ? plainBlocks(right) : null }
      })
      if (!pairs.length) return { error: 'a matching question needs its pairs, and this one has none.' }
      return { question: { ...base, kind: 'matching', stem: stem(), pairs } }
    }
    case 'essay': {
      const grader = blocksOf(childOf(element, 'graderinfo'), context)
      const template = blocksOf(childOf(element, 'responsetemplate'), context)
      const hasText = (blocks: Blocks) => JSON.stringify(blocks) !== JSON.stringify([{ type: 'paragraph' }])
      const suggested = hasText(grader) ? grader : hasText(template) ? template : undefined
      return { question: { ...base, kind: 'short-answer', stem: stem(), ...(suggested ? { suggestedAnswer: suggested } : {}) } }
    }
    case 'cloze':
    case 'multianswer': {
      const html = textOf(childOf(questionText, 'text'))
      const cloze = readCloze(html)
      if (cloze.unknown.length) return { error: `its embedded answer type “${cloze.unknown[0]}” is not one Test Parrot knows.` }
      if (!cloze.blanks.length) return { error: 'it is a cloze question with no embedded answers, such as {1:SHORTANSWER:=Paris}.' }
      return { question: { ...base, kind: 'fill-in-blanks', stem: blocksOf(questionText, context, cloze.html), blanks: cloze.blanks } }
    }
    case 'ordering': {
      // Each answer's fraction is its place in the correct order.
      const items = answers
        .map((answer, index) => ({ answer, index, place: fractionOf(answer) }))
        .sort((a, b) => (a.place && b.place ? a.place - b.place : a.index - b.index))
        .map(({ answer }) => blocksOf(answer, context))
      if (!items.length) return { error: 'it has nothing to put in order.' }
      return { question: { ...base, kind: 'ordering', stem: stem(), items } }
    }
    case 'description':
      return { skip: 'it is a description, text shown between questions, so it was skipped.' }
    case 'ddwtos':
      return { error: 'Test Parrot does not support drag-and-drop into text questions.', unsupported: true }
    case 'gapselect':
      return { error: 'Test Parrot does not support select-missing-words questions.', unsupported: true }
    case 'random':
      return { error: 'it is a random question, which Moodle fills from a category when a quiz runs, not a question of its own.', unsupported: true }
    default:
      return { error: `Test Parrot does not support Moodle’s “${type || 'untyped'}” questions.`, unsupported: true }
  }
}

export function parseMoodleXml(text: string): ParseResult {
  const questions: ForeignQuestion[] = []
  const issues: ImportIssue[] = []
  const images = new Map<string, ForeignImage>()
  let quiz: XmlElement | undefined
  try {
    quiz = documentElement(parseXml(text))
  } catch (reason) {
    const detail = reason instanceof Error ? ` ${reason.message}` : ''
    issues.push({ severity: 'error', code: 'unreadable-file', message: `This Moodle XML file could not be read.${detail}` })
    return { questions, issues, found: 0 }
  }
  if (!quiz || quiz.local !== 'quiz') {
    issues.push({ severity: 'error', code: 'unreadable-file', message: 'This is not a Moodle XML file: it has no <quiz>.' })
    return { questions, issues, found: 0 }
  }

  const lines = questionLines(text)
  let found = 0
  let topic: string | null = null
  childrenOf(quiz, 'question').forEach((element, position) => {
    const type = (attributeOf(element, 'type') ?? '').trim().toLowerCase()
    const line = lines[position]
    if (type === 'category') {
      topic = categoryTopic(textOf(childOf(childOf(element, 'category'), 'text')))
      return
    }
    const questionText = plainText(textOf(childOf(childOf(element, 'questiontext'), 'text')))
    const place = (number: number) => (line ? `Question ${number} (line ${line})` : `Question ${number}`)
    const report = (severity: ImportIssue['severity'], code: string, message: string, number: number) =>
      issues.push({
        severity,
        code,
        message: `${place(number)}: ${message}`,
        ...(line ? { line } : {}),
        excerpt: excerpt(questionText || textOf(childOf(childOf(element, 'name'), 'text'))),
      })

    if (type === 'description') {
      issues.push({
        severity: 'info',
        code: 'description-skipped',
        message: `${line ? `Line ${line}` : 'A description'}: a description, text shown between questions, was skipped.`,
        ...(line ? { line } : {}),
        excerpt: excerpt(questionText),
      })
      return
    }
    found += 1
    const context: Context = { index: found, images, files: new Map(), missing: [] }
    let read: Read
    try {
      collectFiles(element, context)
      read = readQuestion(element, type, context, line)
    } catch {
      read = { error: 'it could not be read.' }
    }
    if ('error' in read) {
      report('error', 'unsupported' in read ? 'unsupported-type' : 'unreadable-question', read.error, found)
      return
    }
    if ('skip' in read) return
    const tags = childrenOf(childOf(element, 'tags'), 'tag').map((tag) => plainText(textOf(childOf(tag, 'text')))).filter(Boolean)
    const topics = [...(topic ? [topic] : []), ...tags]
    const points = pointsIn(textOf(childOf(element, 'defaultgrade')))
    questions.push({
      ...read.question,
      number: found,
      ...(topics.length ? { topics } : {}),
      ...(points !== undefined ? { points } : {}),
    })
    if (context.missing.length) {
      const count = context.missing.length
      report(
        'warning',
        'picture-missing',
        `${count === 1 ? `a picture (${excerpt(context.missing[0]!, 40)}) is` : `${count} pictures are`} not in the file, so ${count === 1 ? 'it was' : 'they were'} left out.`,
        found,
      )
    }
  })
  return { questions, issues, found, ...(images.size ? { images } : {}) }
}

function detect(input: FormatInput): number {
  const head = input.text().slice(0, 65536)
  if (!/<quiz[\s>]/.test(head)) return 0
  if (/<question\s[^>]*type\s*=\s*["'][a-z_]+["']/i.test(head)) return 0.97
  return /<quiz\s*\/>|<quiz>\s*<\/quiz>/.test(head) ? 0.6 : 0.3
}

export const moodleXml: FormatSpec = {
  id: 'moodle-xml',
  detect,
  parse: (input) => parseMoodleXml(input.text()),
}
