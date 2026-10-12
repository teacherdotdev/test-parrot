import { blocksText, htmlBlocks, inMarkedOrder, looksLikeHtml, markNamedBlanks, plainBlocks } from '../rich-text'
import { decodeText, excerpt, pointsIn } from '../text'
import { BLANK_MARK, type Blocks, type ForeignImage, type ForeignQuestion, type FormatInput, type FormatSpec, type ImportIssue, type ParseResult, type ZipFiles } from '../types'
import {
  attributeOf,
  childOf,
  childrenOf,
  descendantOf,
  descendantsOf,
  documentElement,
  isElement,
  parseXml,
  textOf,
  type XmlElement,
} from '../xml'
import { imageMimeType, resolveEntryPath, safeEntryPath, zipFile } from '../zip'

/**
 * IMS QTI, the question format learning management systems trade in: what
 * Canvas's Quiz Export saves, what Brightspace and Blackboard read and write
 * as a “QTI package”, and what most test tools can export.
 *
 * Three generations are read:
 *
 * - QTI 1.2, `<questestinterop>` (with or without its namespace): items with
 *   a `presentation` of materials and responses, and `resprocessing` whose
 *   conditions say which responses score. Canvas names each item's type in a
 *   `question_type` metadata field; without one the type is read from the
 *   responses themselves.
 * - QTI 2.1 and 2.2, one `<assessmentItem>` per file, its answers in a
 *   `responseDeclaration`'s `correctResponse` (or its `mapping`).
 * - QTI 3.0, the same with kebab-case names: `<qti-assessment-item>`,
 *   `<qti-choice-interaction>`.
 *
 * A package is a ZIP with an `imsmanifest.xml` naming its QTI files; a ZIP
 * without one, or a single `.xml`, is read by what its files hold. Canvas's
 * course cartridges carry each quiz twice, once under `non_cc_assessments/`:
 * each quiz is read once. Pictures are read from inside the package; a
 * Canvas `$IMS-CC-FILEBASE$` address is its `web_resources` folder. A
 * Blackboard pool or test export is QTI 1.2 too, but is left to its own
 * reader, which knows Blackboard's ways.
 *
 * An item's points are kept as its Points when they are a whole number:
 * QTI 1.2's Canvas `points_possible`, Blackboard `qmd_absolutescore_max`,
 * `qmd_weighting`, or failing those its SCORE's `maxvalue`; QTI 2 and 3's
 * `MAXSCORE` outcome, or failing that its SCORE's `normalMaximum`. Feedback
 * and partial credit are not kept: Test Parrot questions have one correct
 * answer.
 */

// ——— Reading items into questions, shared with Blackboard's own QTI ———

/** What one item in a file became. */
export type Reading =
  | { question: ForeignQuestion; warnings?: string[] }
  | { error: string; code?: string }
  /** Not a question at all, such as a passage of text between questions. */
  | { skip: string }

/**
 * Questions gathered across a file's items: numbered in the order they
 * appear, each one's problems reported against its number, and every
 * picture its HTML shows looked up by `resolve` and kept in `images`.
 */
export class Gatherer {
  readonly questions: ForeignQuestion[] = []
  readonly issues: ImportIssue[] = []
  readonly images = new Map<string, ForeignImage>()
  found = 0
  /** A picture's `src` as the key of an image in `images`, or null. */
  resolve: (source: string) => string | null = () => null
  private missing: string[] = []

  /** HTML as blocks, its pictures resolved. */
  readonly html = (html: string): Blocks =>
    htmlBlocks(html, {
      image: (source) => this.dataImage(source) ?? this.resolve(source.trim()),
      onMissing: (source) => this.missing.push(source),
    })

  /** Text in whichever form a material gave it. */
  readonly rich = (text: string, html: boolean): Blocks => (html ? this.html(text) : plainBlocks(text.trim()))

  /** The picture at a path in an archive, registered under its path. */
  picture(files: ZipFiles, path: string | null): string | null {
    if (!path) return null
    if (this.images.has(path)) return path
    const bytes = zipFile(files, path)
    if (!bytes) return null
    const mimeType = imageMimeType(bytes, path)
    if (!mimeType) return null
    this.images.set(path, { bytes, mimeType })
    return path
  }

  private dataImage(source: string): string | null {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(source.trim())
    if (!match) return null
    const key = `data:${this.images.size + 1}`
    try {
      const bytes = Uint8Array.from(atob(match[2]!.replace(/\s+/g, '')), (character) => character.charCodeAt(0))
      this.images.set(key, { bytes, mimeType: imageMimeType(bytes) ?? match[1]!.toLowerCase() })
    } catch {
      return null
    }
    return key
  }

  /** Forget the pictures missed so far: a new question begins. */
  begin() {
    this.missing = []
  }

  /** Keep a question or report why not, with its label for messages. */
  add(reading: Reading, label: string, topics?: string[]) {
    const missing = this.missing
    this.missing = []
    if ('skip' in reading) {
      this.issues.push({ severity: 'info', code: 'not-a-question', message: reading.skip, excerpt: excerpt(label) })
      return
    }
    this.found += 1
    const place = `Question ${this.found}`
    if ('error' in reading) {
      this.issues.push({
        severity: 'error',
        code: reading.code ?? 'unreadable-question',
        message: `${place}: ${reading.error}`,
        excerpt: excerpt(label),
      })
      return
    }
    const question = { ...reading.question, number: this.found, ...(topics?.length ? { topics } : {}) }
    this.questions.push(question)
    const quoted = excerpt(blocksText(question.stem)) || excerpt(label)
    for (const warning of reading.warnings ?? []) {
      this.issues.push({ severity: 'warning', code: 'changed-on-import', message: `${place}: ${warning}`, excerpt: quoted })
    }
    for (const source of new Set(missing)) {
      this.issues.push({
        severity: 'warning',
        code: 'picture-missing',
        message: `${place}: its picture “${excerpt(source, 50)}” is not in this file, so it was left out. Add it after importing.`,
        excerpt: quoted,
      })
    }
  }

  result(name?: string): ParseResult {
    return {
      questions: this.questions,
      issues: this.issues,
      found: this.found,
      ...(name?.trim() ? { name: name.trim() } : {}),
      ...(this.images.size ? { images: this.images } : {}),
    }
  }
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttribute = (text: string) => escapeHtml(text).replace(/"/g, '&quot;')

/** A QTI 1.2 `material` (or anything holding materials) as HTML. */
export function materialHtml(element: XmlElement): string {
  return element.children
    .map((node) => {
      if (!isElement(node)) return ''
      switch (node.local) {
        case 'mattext':
        case 'matemtext': {
          const text = textOf(node)
          const type = (attributeOf(node, 'texttype') ?? '').toLowerCase()
          if (type.includes('html') || (!type.includes('plain') && looksLikeHtml(text))) return text
          const escaped = escapeHtml(text.trim()).replace(/\r?\n/g, '<br>')
          return node.local === 'matemtext' ? `<em>${escaped}</em>` : escaped
        }
        case 'mat_formattedtext': {
          // Blackboard's: HTML, “smart text” (HTML too) or plain text.
          const text = textOf(node)
          return /plain/i.test(attributeOf(node, 'type') ?? '') ? escapeHtml(text.trim()).replace(/\r?\n/g, '<br>') : text
        }
        case 'matimage':
        case 'matapplication': {
          const uri = attributeOf(node, 'uri') ?? ''
          const label = attributeOf(node, 'label') ?? ''
          const image = node.local === 'matimage' || /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(label || uri)
          return uri && image ? `<img src="${escapeAttribute(uri)}" alt="">` : ''
        }
        case 'matbreak':
          return '<br>'
        default:
          return materialHtml(node)
      }
    })
    .join('')
}

/** The HTML of every material in an element, each its own block. */
function materialsHtml(materials: XmlElement[]): string {
  return materials.map((material) => `<div>${materialHtml(material)}</div>`).join('')
}

const RESPONSE_ELEMENTS = new Set(['response_lid', 'response_str', 'response_num', 'response_grp', 'response_xy'])

/** The materials of a presentation that are its question, not its answers. */
function stemMaterials(element: XmlElement): XmlElement[] {
  const found: XmlElement[] = []
  for (const child of childrenOf(element)) {
    if (RESPONSE_ELEMENTS.has(child.local)) continue
    if (child.local === 'flow' && /RIGHT_MATCH_BLOCK|RESPONSE_BLOCK/i.test(attributeOf(child, 'class') ?? '')) continue
    if (child.local === 'material') found.push(child)
    else found.push(...stemMaterials(child))
  }
  return found
}

/** Materials inside an element but outside its `render_*` choices. */
function ownMaterials(element: XmlElement): XmlElement[] {
  const found: XmlElement[] = []
  for (const child of childrenOf(element)) {
    if (child.local.startsWith('render_')) continue
    if (child.local === 'material') found.push(child)
    else found.push(...ownMaterials(child))
  }
  return found
}

function descendantsWhere(element: XmlElement, test: (element: XmlElement) => boolean): XmlElement[] {
  const found: XmlElement[] = []
  const walk = (node: XmlElement) => {
    for (const child of childrenOf(node)) {
      if (test(child)) found.push(child)
      else walk(child)
    }
  }
  walk(element)
  return found
}

type Label = { ident: string; html: string }
type Response = {
  ident: string
  kind: string
  cardinality: string
  labels: Label[]
  /** The text beside the response: a matching item, or a blank's name. */
  promptHtml: string
  fibType: string
}

function responsesOf(presentation: XmlElement): Response[] {
  const responses: Response[] = []
  const walk = (parent: XmlElement) => {
    const inside = childrenOf(parent).filter((child) => RESPONSE_ELEMENTS.has(child.local))
    for (const child of childrenOf(parent)) {
      if (!RESPONSE_ELEMENTS.has(child.local)) {
        walk(child)
        continue
      }
      let prompt = ownMaterials(child)
      // Blackboard puts a matching item's text beside its response, in the
      // flow that holds just the two.
      if (!prompt.length && inside.length === 1 && parent.local === 'flow') {
        prompt = childrenOf(parent).filter((sibling) => sibling !== child).flatMap((sibling) =>
          sibling.local === 'material' ? [sibling] : descendantsOf(sibling, 'material'))
      }
      responses.push({
        ident: attributeOf(child, 'ident') ?? '',
        kind: child.local,
        cardinality: (attributeOf(child, 'rcardinality') ?? 'Single').toLowerCase(),
        labels: descendantsOf(child, 'response_label').map((label) => ({
          ident: attributeOf(label, 'ident') ?? '',
          html: materialsHtml(descendantsOf(label, 'material')),
        })),
        promptHtml: materialsHtml(prompt),
        fibType: (attributeOf(descendantOf(child, 'render_fib'), 'fibtype') ?? '').toLowerCase(),
      })
    }
  }
  walk(presentation)
  return responses
}

type Test = { respident: string; value: string }
type Condition = {
  /** Whether the condition scores the question right; null when it does not say. */
  correct: boolean | null
  equals: Test[]
  gte: Test[]
  lte: Test[]
}

function conditionsOf(item: XmlElement): Condition[] {
  return descendantsOf(item, 'respcondition').map((condition) => {
    const equals: Test[] = []
    const gte: Test[] = []
    const lte: Test[] = []
    const walk = (element: XmlElement, negated: boolean) => {
      for (const child of childrenOf(element)) {
        const test = { respident: attributeOf(child, 'respident') ?? '', value: textOf(child).trim() }
        if (child.local === 'not') walk(child, !negated)
        else if (negated) continue
        else if (child.local === 'varequal' || child.local === 'varsubset' || child.local === 'varsubstring') equals.push(test)
        else if (child.local === 'vargte' || child.local === 'vargt') gte.push(test)
        else if (child.local === 'varlte' || child.local === 'varlt') lte.push(test)
        else walk(child, negated)
      }
    }
    const conditionvar = childOf(condition, 'conditionvar')
    if (conditionvar) walk(conditionvar, false)
    return { correct: conditionCorrect(condition, Boolean(childOf(conditionvar, 'other'))), equals, gte, lte }
  })
}

function conditionCorrect(condition: XmlElement, other: boolean): boolean | null {
  const title = (attributeOf(condition, 'title') ?? '').trim().toLowerCase()
  if (/incorrect|wrong/.test(title)) return false
  if (/correct|right/.test(title)) return true
  const feedback = childrenOf(condition, 'displayfeedback').map((element) => (attributeOf(element, 'linkrefid') ?? '').toLowerCase())
  if (feedback.includes('correct')) return true
  if (feedback.includes('incorrect')) return false
  if (other) return false
  for (const setvar of childrenOf(condition, 'setvar')) {
    const value = textOf(setvar).trim()
    const action = (attributeOf(setvar, 'action') ?? 'Set').toLowerCase()
    if (/\.max$/i.test(value)) return true
    const number = Number(value)
    if (Number.isFinite(number)) return action === 'subtract' ? false : number > 0
  }
  return null
}

/** The conditions that score right, or — when none says — every one that
 *  does not say it scores wrong. */
function correctConditions(conditions: Condition[]): Condition[] {
  const correct = conditions.filter((condition) => condition.correct === true)
  return correct.length ? correct : conditions.filter((condition) => condition.correct === null)
}

/** Every value a response must equal to score right. */
function correctValues(conditions: Condition[], respident?: string): string[] {
  const values: string[] = []
  for (const condition of correctConditions(conditions)) {
    for (const test of condition.equals) {
      if (respident && test.respident && test.respident !== respident) continue
      if (test.value && !values.includes(test.value)) values.push(test.value)
    }
  }
  return values
}

/** The kinds of question a QTI 1.2 item can be read as. */
type Kind =
  | 'choice' | 'multiple-answer' | 'true-false' | 'essay' | 'file' | 'matching' | 'fill-in-blank'
  | 'fill-in-blanks' | 'dropdowns' | 'numeric' | 'ordering' | 'text' | 'unsupported'

const BLACKBOARD_TYPES: Record<string, Kind> = {
  'multiple choice': 'choice',
  'either/or': 'choice',
  'multiple answer': 'multiple-answer',
  'true/false': 'true-false',
  essay: 'essay',
  'short response': 'essay',
  'file upload': 'file',
  matching: 'matching',
  'fill in the blank': 'fill-in-blank',
  'fill in the blank plus': 'fill-in-blanks',
  'fill in multiple blanks': 'fill-in-blanks',
  'jumbled sentence': 'dropdowns',
  numeric: 'numeric',
  'calculated numeric': 'numeric',
  ordering: 'ordering',
  'quiz bowl': 'fill-in-blank',
}

const CANVAS_TYPES: Record<string, Kind> = {
  multiple_choice_question: 'choice',
  true_false_question: 'true-false',
  short_answer_question: 'fill-in-blank',
  fill_in_multiple_blanks_question: 'fill-in-blanks',
  multiple_answers_question: 'multiple-answer',
  multiple_dropdowns_question: 'dropdowns',
  matching_question: 'matching',
  numerical_question: 'numeric',
  essay_question: 'essay',
  file_upload_question: 'file',
  text_only_question: 'text',
}

/** A QTI 1.2 metadata field's entry, such as Canvas's `question_type`. */
export function metadataField(element: XmlElement | undefined, label: string): string | undefined {
  for (const field of descendantsOf(element, 'qtimetadatafield')) {
    if (textOf(childOf(field, 'fieldlabel')).trim() === label) return textOf(childOf(field, 'fieldentry')).trim()
  }
  return undefined
}

/** The type an item declares: Blackboard's `bbmd_questiontype`, Canvas's
 *  `question_type`, or — failing both — its responses' shape. */
function kindOf(item: XmlElement, responses: Response[]): { kind: Kind; sourceType?: string } {
  const metadata = childOf(item, 'itemmetadata')
  const blackboard = textOf(descendantOf(metadata, 'bbmd_questiontype')).trim()
  if (blackboard) return { kind: BLACKBOARD_TYPES[blackboard.toLowerCase()] ?? 'unsupported', sourceType: blackboard }
  const canvas = metadataField(metadata, 'question_type')
  if (canvas) return { kind: CANVAS_TYPES[canvas] ?? 'unsupported', sourceType: canvas }

  if (!responses.length) return { kind: 'text' }
  const lids = responses.filter((response) => response.kind === 'response_lid')
  if (lids.length > 1) return { kind: 'matching' }
  const [first] = responses
  if (responses.length > 1) return { kind: 'fill-in-blanks' }
  if (first!.kind === 'response_num' || /decimal|integer/.test(first!.fibType)) return { kind: 'numeric' }
  if (first!.kind === 'response_str') {
    return correctValues(conditionsOf(item)).length ? { kind: 'fill-in-blank' } : { kind: 'essay' }
  }
  if (first!.kind !== 'response_lid') return { kind: 'unsupported', sourceType: first!.kind }
  if (first!.cardinality === 'ordered') return { kind: 'ordering' }
  if (first!.cardinality === 'multiple') return { kind: 'multiple-answer' }
  return { kind: 'choice' }
}

const TRUE_WORDS = /^(t|true|yes|vrai|verdadero|wahr)$/i
const FALSE_WORDS = /^(f|false|no|faux|falso)$/i

const plainOf = (html: string) => blocksText(htmlBlocks(html))

const number = (value: string) => {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

const tidy = (value: number) => String(Number(value.toPrecision(12)))

/** A reading's question with the points its item gives it, if any. */
const withPoints = (reading: Reading, points: number | undefined): Reading =>
  'question' in reading && points !== undefined ? { ...reading, question: { ...reading.question, points } } : reading

/** What a QTI 1.2 item is worth, from the first of these it gives: Canvas's
 *  `points_possible`, Blackboard's `qmd_absolutescore_max`, a non-zero
 *  `qmd_weighting`, or its SCORE variable's `maxvalue`. A Canvas item's
 *  SCORE always runs to 100, a percentage, so it is never read there. */
export function qti12Points(item: XmlElement): number | undefined {
  const metadata = childOf(item, 'itemmetadata')
  const canvas = metadataField(metadata, 'points_possible')
  if (canvas !== undefined) return pointsIn(canvas)
  if (metadataField(metadata, 'question_type') !== undefined) return undefined
  const field = (name: string) => textOf(descendantOf(metadata, name)).trim() || metadataField(metadata, name)
  const absolute = pointsIn(field('qmd_absolutescore_max'))
  if (absolute !== undefined) return absolute
  const weighting = pointsIn(field('qmd_weighting'))
  if (weighting) return weighting
  const score = descendantsOf(childOf(item, 'resprocessing'), 'decvar')
    .find((variable) => (attributeOf(variable, 'varname') ?? 'SCORE').toUpperCase() === 'SCORE')
  return score ? pointsIn(attributeOf(score, 'maxvalue')) : undefined
}

/** One QTI 1.2 `item` as a question, with its points. `html` reads the
 *  item's HTML, its pictures resolved. */
export function readQti12Item(item: XmlElement, html: (source: string) => Blocks): Reading {
  return withPoints(readQti12Question(item, html), qti12Points(item))
}

/** One QTI 1.2 `item` as a question; `solution` is an essay's model answer,
 *  if any. */
function readQti12Question(item: XmlElement, html: (source: string) => Blocks): Reading {
  const presentation = childOf(item, 'presentation')
  if (!presentation) return { error: 'it has no question text or answers, so it was left out.' }
  const responses = responsesOf(presentation)
  const { kind, sourceType } = kindOf(item, responses)
  const stem = html(materialsHtml(stemMaterials(presentation)))
  const conditions = conditionsOf(item)
  const base = { ...(sourceType ? { sourceType } : {}), stem }
  const [first] = responses

  switch (kind) {
    case 'text':
      return { skip: `“${excerpt(blocksText(stem)) || 'A passage'}” is text between questions, not a question, so it was left out.` }
    case 'unsupported':
      return {
        code: 'unsupported-type',
        error: `Test Parrot has no ${sourceType ? `“${sourceType}”` : 'such'} questions, so it was left out.`,
      }
    case 'essay':
    case 'file': {
      const solution = childrenOf(item, 'itemfeedback').find((feedback) => /solution/i.test(attributeOf(feedback, 'ident') ?? ''))
      const answer = solution ? html(materialsHtml(descendantsOf(solution, 'material'))) : undefined
      return {
        question: { ...base, kind: 'short-answer', ...(answer ? { suggestedAnswer: answer } : {}) },
        ...(kind === 'file'
          ? { warnings: ['it asks for a file upload. It came in as Short Answer.'] }
          : {}),
      }
    }
    case 'choice':
    case 'multiple-answer':
    case 'true-false': {
      if (!first?.labels.length) return { error: 'it has no answers to choose from, so it was left out.' }
      const correct = new Set(correctValues(conditions, first.ident))
      if (kind === 'true-false') {
        const right = first.labels.find((label) => correct.has(label.ident))
        if (!right) return { question: { ...base, kind: 'true-false', answer: null } }
        const word = (plainOf(right.html) || right.ident).trim()
        const answer = TRUE_WORDS.test(word) || TRUE_WORDS.test(right.ident) ? true
          : FALSE_WORDS.test(word) || FALSE_WORDS.test(right.ident) ? false
            // Two choices, not named True and False: the first is True.
            : first.labels.indexOf(right) === 0
        return { question: { ...base, kind: 'true-false', answer } }
      }
      const choices = first.labels.map((label) => ({ content: html(label.html), correct: correct.has(label.ident) }))
      return { question: { ...base, kind: kind === 'multiple-answer' ? 'multiple-answer' : 'multiple-choice', choices } }
    }
    case 'ordering': {
      if (!first?.labels.length) return { error: 'it has no items to put in order, so it was left out.' }
      const order = correctValues(conditions, first.ident)
      const byIdent = new Map(first.labels.map((label) => [label.ident, label]))
      const ordered = order.map((ident) => byIdent.get(ident)).filter((label): label is Label => Boolean(label))
      const rest = first.labels.filter((label) => !ordered.includes(label))
      return {
        question: { ...base, kind: 'ordering', items: [...ordered, ...rest].map((label) => html(label.html)) },
        ...(ordered.length ? {} : { warnings: ['it does not say the correct order, so the order it lists is kept.'] }),
      }
    }
    case 'matching':
      return readMatching(presentation, responses, conditions, base, html)
    case 'fill-in-blank': {
      const accepted = correctValues(conditions)
      return { question: { ...base, kind: 'fill-in-blank', accepted } }
    }
    case 'fill-in-blanks':
    case 'dropdowns': {
      const blanks = responses.map((response) => {
        const values = correctValues(conditions, response.ident)
        const labels = new Map(response.labels.map((label) => [label.ident, plainOf(label.html)]))
        const accepted = response.labels.length
          ? (kind === 'fill-in-blanks' && !values.length ? [...labels.values()] : values.map((value) => labels.get(value) ?? value))
          : values
        const name = plainOf(response.promptHtml) || response.ident.replace(/^response_/, '')
        return { name, accepted: accepted.filter(Boolean), ...(kind === 'dropdowns' ? { dropdown: true } : {}) }
      })
      // Canvas and Blackboard write each blank in the text as `[name]`,
      // named by its response.
      const marked = markNamedBlanks(stem, responses.map((response) => response.ident.replace(/^response_/, '')))
      return { question: { ...base, stem: marked.stem, kind: 'fill-in-blanks', blanks: inMarkedOrder(blanks, marked.order) } }
    }
    case 'numeric': {
      const answers: { value: string; tolerance?: string }[] = []
      for (const condition of correctConditions(conditions)) {
        const exact = condition.equals.map((test) => test.value).filter((value) => number(value) !== null)
        const low = condition.gte.map((test) => number(test.value)).find((value) => value !== null)
        const high = condition.lte.map((test) => number(test.value)).find((value) => value !== null)
        const range = low !== undefined && high !== undefined && low !== null && high !== null
        if (exact.length) {
          for (const value of exact) {
            const tolerance = range ? tidy(Math.max(Math.abs(number(value)! - low!), Math.abs(high! - number(value)!))) : undefined
            answers.push({ value, ...(tolerance && tolerance !== '0' ? { tolerance } : {}) })
          }
        } else if (range) {
          answers.push({ value: tidy((low! + high!) / 2), tolerance: tidy((high! - low!) / 2) })
        }
      }
      return { question: { ...base, kind: 'numeric', answers } }
    }
  }
}

/** Matching: a `response_lid` per item, choosing among the answers —
 *  Canvas's in each response's own choices, Blackboard's in a separate
 *  `RIGHT_MATCH_BLOCK` in the choices' order. An answer no item is matched
 *  to is a distractor. */
function readMatching(
  presentation: XmlElement,
  responses: Response[],
  conditions: Condition[],
  base: { sourceType?: string; stem: Blocks },
  html: (source: string) => Blocks,
): Reading {
  const lids = responses.filter((response) => response.kind === 'response_lid')
  if (!lids.length) return { error: 'it has no items to match, so it was left out.' }
  const rightBlock = descendantsWhere(presentation, (element) =>
    element.local === 'flow' && /RIGHT_MATCH_BLOCK/i.test(attributeOf(element, 'class') ?? ''))[0]
  const rightTexts = rightBlock
    ? childrenOf(rightBlock).map((flow) => materialsHtml(descendantsOf(flow, 'material'))).filter((text) => text)
    : []

  const rights: { key: string; blocks: Blocks }[] = []
  const rightFor = (source: string) => {
    const blocks = html(source)
    const key = JSON.stringify(blocks)
    if (!rights.some((right) => right.key === key)) rights.push({ key, blocks })
    return key
  }
  const answerOf = (response: Response, ident: string) => {
    const index = response.labels.findIndex((label) => label.ident === ident)
    if (index === -1) return null
    const label = response.labels[index]!
    const source = rightTexts.length ? rightTexts[index] ?? '' : label.html
    return source ? rightFor(source) : null
  }
  for (const response of lids) {
    response.labels.forEach((label, index) => {
      const source = rightTexts.length ? rightTexts[index] ?? '' : label.html
      if (source) rightFor(source)
    })
  }
  for (const text of rightTexts) rightFor(text)

  const used = new Set<string>()
  const pairs: { left: Blocks | null; right: Blocks | null }[] = lids.map((response) => {
    const [value] = correctValues(conditions, response.ident)
    const key = value ? answerOf(response, value) : null
    if (key) used.add(key)
    return { left: html(response.promptHtml), right: key ? rights.find((right) => right.key === key)!.blocks : null }
  })
  for (const right of rights) if (!used.has(right.key)) pairs.push({ left: null, right: right.blocks })
  return { question: { ...base, kind: 'matching', pairs } }
}

/** The title of a QTI 1.2 assessment, or of a Canvas question bank. */
export function assessmentTitle(element: XmlElement): string {
  return (attributeOf(element, 'title') ?? metadataField(element, 'bank_title') ?? '').trim()
}

// ——— QTI 2.x and 3.0 ———

/** A QTI 3.0 name in QTI 2's spelling: `qti-choice-interaction` → `choiceInteraction`. */
const nameOf = (element: XmlElement) =>
  element.local.startsWith('qti-')
    ? element.local.slice(4).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    : element.local

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/** An attribute in either spelling: `responseIdentifier` or `response-identifier`. */
const attr = (element: XmlElement | undefined, name: string) =>
  element ? attributeOf(element, name) ?? attributeOf(element, kebab(name)) : undefined

const kids = (element: XmlElement | undefined, name?: string) =>
  childrenOf(element).filter((child) => name === undefined || nameOf(child) === name)

const kid = (element: XmlElement | undefined, name: string) => kids(element, name)[0]

const BLANK_INTERACTIONS = new Set(['textEntryInteraction', 'inlineChoiceInteraction'])
const DROPPED = new Set(['feedbackBlock', 'feedbackInline', 'modalFeedback', 'rubricBlock', 'templateBlock', 'templateInline', 'stylesheet', 'companionMaterialsInfo'])

/** Content of a QTI 2/3 item body as HTML, each interaction replaced by
 *  what `replace` says. */
function bodyHtml(element: XmlElement, replace: (element: XmlElement) => string | null): string {
  return element.children
    .map((node) => {
      if (!isElement(node)) return escapeHtml(node)
      const name = nameOf(node)
      const replaced = replace(node)
      if (replaced !== null) return replaced
      if (DROPPED.has(name)) return ''
      if (name === 'object' && /^image\//.test(attr(node, 'type') ?? '')) {
        return `<img src="${escapeAttribute(attr(node, 'data') ?? '')}" alt="${escapeAttribute(textOf(node).trim())}">`
      }
      const tag = node.local.startsWith('qti-') ? 'div' : node.local
      const kept = ['src', 'alt', 'href', 'style', 'start', 'encoding', 'data-latex']
        .flatMap((key) => (node.attributes[key] !== undefined ? [` ${key}="${escapeAttribute(node.attributes[key]!)}"`] : []))
        .join('')
      return `<${tag}${kept}>${bodyHtml(node, replace)}</${tag}>`
    })
    .join('')
}

type Declaration = { values: string[]; mapped: string[]; baseType: string; cardinality: string }

function declarationsOf(item: XmlElement): Map<string, Declaration> {
  const declarations = new Map<string, Declaration>()
  for (const declaration of kids(item, 'responseDeclaration')) {
    const values = kids(kid(declaration, 'correctResponse'), 'value').map((value) => textOf(value).trim())
    const mapped = kids(kid(declaration, 'mapping'), 'mapEntry')
      .filter((entry) => Number(attr(entry, 'mappedValue') ?? '0') > 0)
      .map((entry) => (attr(entry, 'mapKey') ?? '').trim())
    declarations.set(attr(declaration, 'identifier') ?? '', {
      values,
      mapped,
      baseType: attr(declaration, 'baseType') ?? '',
      cardinality: attr(declaration, 'cardinality') ?? 'single',
    })
  }
  return declarations
}

const INTERACTION = /Interaction$/

/** What a QTI 2.x or 3.0 item is worth: its `MAXSCORE` outcome's default
 *  value, or failing that its SCORE outcome's `normalMaximum`. */
function qti2Points(item: XmlElement): number | undefined {
  const outcomes = kids(item, 'outcomeDeclaration')
  const named = (identifier: string) => outcomes.find((outcome) => attr(outcome, 'identifier') === identifier)
  const max = named('MAXSCORE')
  if (max) return pointsIn(textOf(kid(kid(max, 'defaultValue'), 'value')))
  return pointsIn(attr(named('SCORE'), 'normalMaximum'))
}

/** One QTI 2.x or 3.0 `assessmentItem` as a question, with its points. */
export function readQti2Item(item: XmlElement, html: (source: string) => Blocks): Reading {
  return withPoints(readQti2Question(item, html), qti2Points(item))
}

function readQti2Question(item: XmlElement, html: (source: string) => Blocks): Reading {
  const body = kid(item, 'itemBody')
  if (!body) return { error: 'it has no item body, so it was left out.' }
  const declarations = declarationsOf(item)
  const interactions = deepInteractions(body)
  const correctOf = (interaction: XmlElement) => {
    const declaration = declarations.get(attr(interaction, 'responseIdentifier') ?? '')
    if (!declaration) return []
    return declaration.values.length ? declaration.values : declaration.mapped
  }
  const blanks = interactions.filter((interaction) => BLANK_INTERACTIONS.has(nameOf(interaction)))
  const others = interactions.filter((interaction) => !BLANK_INTERACTIONS.has(nameOf(interaction)))
  const blankName = (interaction: XmlElement) => (blanks.length > 1 ? `Blank ${blanks.indexOf(interaction) + 1}` : '')
  const dropdown = (interaction: XmlElement) => nameOf(interaction) === 'inlineChoiceInteraction'
  const choiceText = (choice: XmlElement) => blocksText(html(bodyHtml(choice, () => null)))

  let singleInline: XmlElement | null = null
  if (!others.length && blanks.length === 1 && nameOf(blanks[0]!) === 'inlineChoiceInteraction') singleInline = blanks[0]!
  const stem = html(bodyHtml(body, (element) => {
    const name = nameOf(element)
    if (BLANK_INTERACTIONS.has(name)) return BLANK_MARK
    if (INTERACTION.test(name)) {
      const prompt = kid(element, 'prompt')
      return prompt ? `<div>${bodyHtml(prompt, () => null)}</div>` : ''
    }
    return null
  }))
  const base = { stem, ...(interactions[0] ? { sourceType: nameOf(interactions[0]) } : {}) }

  if (!interactions.length) return { skip: `“${excerpt(blocksText(stem)) || attr(item, 'title') || 'An item'}” asks for no answer, so it was left out.` }
  if (others.length > 1 || (others.length && blanks.length)) {
    return { code: 'unsupported-type', error: 'it asks several questions in one item, which Test Parrot cannot read, so it was left out.' }
  }

  if (singleInline) {
    const correct = new Set(correctOf(singleInline))
    const choices = kids(singleInline, 'inlineChoice').map((choice) => ({
      content: html(bodyHtml(choice, () => null)),
      correct: correct.has(attr(choice, 'identifier') ?? ''),
    }))
    return { question: { ...base, kind: 'multiple-choice', choices } }
  }
  if (blanks.length) {
    const read = blanks.map((interaction) => {
      const values = correctOf(interaction)
      if (nameOf(interaction) === 'inlineChoiceInteraction') {
        const byId = new Map(kids(interaction, 'inlineChoice').map((choice) => [attr(choice, 'identifier') ?? '', choiceText(choice)]))
        return values.map((value) => byId.get(value) ?? value)
      }
      return values
    })
    if (blanks.length === 1) {
      const declaration = declarations.get(attr(blanks[0], 'responseIdentifier') ?? '')
      if (declaration && /float|integer/.test(declaration.baseType)) {
        return { question: { ...base, kind: 'numeric', answers: read[0]!.map((value) => ({ value })) } }
      }
      return { question: { ...base, kind: 'fill-in-blank', accepted: read[0]!, ...(dropdown(blanks[0]!) ? { dropdown: true } : {}) } }
    }
    return {
      question: {
        ...base,
        kind: 'fill-in-blanks',
        blanks: blanks.map((interaction, index) => ({
          name: blankName(interaction),
          accepted: read[index]!,
          ...(dropdown(interaction) ? { dropdown: true } : {}),
        })),
      },
    }
  }

  const [interaction] = others as [XmlElement]
  const correct = correctOf(interaction)
  switch (nameOf(interaction)) {
    case 'choiceInteraction': {
      const set = new Set(correct)
      const choices = kids(interaction, 'simpleChoice').map((choice) => ({
        id: attr(choice, 'identifier') ?? '',
        content: html(bodyHtml(choice, () => null)),
        correct: set.has(attr(choice, 'identifier') ?? ''),
      }))
      if (choices.length === 2 && set.size === 1) {
        const words = choices.map((choice) => blocksText(choice.content).trim())
        if (TRUE_WORDS.test(words[0]!) && FALSE_WORDS.test(words[1]!)) {
          return { question: { ...base, kind: 'true-false', answer: choices[0]!.correct } }
        }
      }
      const max = Number(attr(interaction, 'maxChoices') ?? '1')
      return {
        question: {
          ...base,
          kind: max === 1 ? 'multiple-choice' : 'multiple-answer',
          choices: choices.map(({ content, correct: isCorrect }) => ({ content, correct: isCorrect })),
        },
      }
    }
    case 'orderInteraction': {
      const choices = kids(interaction, 'simpleChoice')
      const byId = new Map(choices.map((choice) => [attr(choice, 'identifier') ?? '', choice]))
      const ordered = correct.map((id) => byId.get(id)).filter((choice): choice is XmlElement => Boolean(choice))
      const rest = choices.filter((choice) => !ordered.includes(choice))
      return {
        question: { ...base, kind: 'ordering', items: [...ordered, ...rest].map((choice) => html(bodyHtml(choice, () => null))) },
        ...(ordered.length ? {} : { warnings: ['it does not say the correct order, so the order it lists is kept.'] }),
      }
    }
    case 'matchInteraction': {
      const [leftSet, rightSet] = kids(interaction, 'simpleMatchSet')
      const lefts = kids(leftSet, 'simpleAssociableChoice')
      const rights = kids(rightSet, 'simpleAssociableChoice')
      const rightById = new Map(rights.map((choice) => [attr(choice, 'identifier') ?? '', choice]))
      const used = new Set<XmlElement>()
      const pairs: { left: Blocks | null; right: Blocks | null }[] = lefts.map((left) => {
        const id = attr(left, 'identifier') ?? ''
        const pair = correct.map((value) => value.split(/\s+/)).find(([from]) => from === id)
        const right = pair ? rightById.get(pair[1] ?? '') : undefined
        if (right) used.add(right)
        return { left: html(bodyHtml(left, () => null)), right: right ? html(bodyHtml(right, () => null)) : null }
      })
      for (const right of rights) if (!used.has(right)) pairs.push({ left: null, right: html(bodyHtml(right, () => null)) })
      return { question: { ...base, kind: 'matching', pairs } }
    }
    case 'extendedTextInteraction': {
      const model = correct.join('\n').trim()
      return { question: { ...base, kind: 'short-answer', ...(model ? { suggestedAnswer: plainBlocks(model) } : {}) } }
    }
    case 'uploadInteraction':
      return { question: { ...base, kind: 'short-answer' }, warnings: ['it asks for a file upload. It came in as Short Answer.'] }
    default:
      return {
        code: 'unsupported-type',
        error: `Test Parrot cannot read a question that uses “${nameOf(interaction)}”, so it was left out.`,
      }
  }
}

/** The interactions in an item body, in order, not looking inside one. */
function deepInteractions(body: XmlElement): XmlElement[] {
  const found: XmlElement[] = []
  const walk = (node: XmlElement) => {
    for (const child of childrenOf(node)) {
      if (INTERACTION.test(nameOf(child))) found.push(child)
      else walk(child)
    }
  }
  walk(body)
  return found
}

// ——— Files and packages ———

const QTI12_ROOT = /<(?:[\w-]+:)?questestinterop[\s>]/
const QTI2_ROOT = /<(?:[\w-]+:)?assessmentItem[\s>]/
const QTI3_ROOT = /<(?:[\w-]+:)?qti-assessment-item[\s>]/
const BLACKBOARD_MARK = /<bbmd_[a-z_]+[\s>]/

/** How a single XML file's opening looks as QTI, from 0 to 1. */
function sniffXml(head: string): number {
  if (QTI12_ROOT.test(head)) return BLACKBOARD_MARK.test(head) ? 0.3 : 0.95
  if (QTI2_ROOT.test(head)) return /imsqti_v2p\d|imsqti_v2/.test(head) ? 0.95 : 0.8
  if (QTI3_ROOT.test(head)) return 0.95
  return 0
}

const readXml = (bytes: Uint8Array): XmlElement | null => {
  try {
    return documentElement(parseXml(decodeText(bytes).text)) ?? null
  } catch {
    return null
  }
}

const QTI_RESOURCE = /^imsqti_(xmlv1p2|item_xmlv2p\d|test_xmlv2p\d|item_xmlv3p0|test_xmlv3p0|xmlv3p0)/i
const BLACKBOARD_RESOURCE = /^assessment\/x-bb-/i

/** Manifest resources: their type and the file each one names. */
export function manifestResources(files: ZipFiles): { identifier: string; type: string; file: string | null; title: string; element: XmlElement }[] | null {
  const bytes = zipFile(files, 'imsmanifest.xml')
  if (!bytes) return null
  const manifest = readXml(bytes)
  if (!manifest) return []
  return descendantsOf(manifest, 'resource').map((resource) => {
    const href = attributeOf(resource, 'href') ?? attributeOf(resource, 'file') ?? attributeOf(childOf(resource, 'file'), 'href')
    const base = attributeOf(resource, 'base') ?? ''
    const path = href ? safeEntryPath(base && !zipFile(files, href) ? `${base}/${href}` : href) : null
    return {
      identifier: attributeOf(resource, 'identifier') ?? '',
      type: attributeOf(resource, 'type') ?? '',
      file: path,
      title: attributeOf(resource, 'title') ?? '',
      element: resource,
    }
  })
}

/** Whether an archive is a Blackboard pool or test export. */
export function isBlackboardPackage(files: ZipFiles): boolean {
  const resources = manifestResources(files)
  return Boolean(resources?.some((resource) => BLACKBOARD_RESOURCE.test(resource.type)))
}

const isQtiFile = (path: string) => /\.(xml|qti|dat)$/i.test(path) && !/(^|\/)(imsmanifest|assessment_meta)\.xml$/i.test(path)

async function detect(input: FormatInput): Promise<number> {
  const files = await input.zip()
  if (!files) return sniffXml(input.text().slice(0, 4096))
  const resources = manifestResources(files)
  if (resources?.some((resource) => BLACKBOARD_RESOURCE.test(resource.type))) return 0.1
  if ([...files.keys()].some((path) => /(^|\/)assessment_meta\.xml$/i.test(path))) return 0.97
  if (resources?.some((resource) => QTI_RESOURCE.test(resource.type))) return 0.95
  let best = 0
  for (const [path, bytes] of files) {
    if (!isQtiFile(path)) continue
    best = Math.max(best, sniffXml(new TextDecoder().decode(bytes.subarray(0, 4096))) * 0.85)
    if (best >= 0.8) break
  }
  return best
}

/** Where a picture's `src` in a file points inside the archive. */
function pictureResolver(gatherer: Gatherer, files: ZipFiles, from: string) {
  return (source: string): string | null => {
    if (/^(https?:|data:|\/\/)/i.test(source)) return null
    const clean = source.replace(/[?#].*$/, '')
    const canvas = /^(?:\$IMS-CC-FILEBASE\$|%24IMS-CC-FILEBASE%24)\/?(.*)$/i.exec(clean)
    const candidates = canvas
      ? [safeEntryPath(`web_resources/${decode(canvas[1]!)}`), safeEntryPath(decode(canvas[1]!))]
      : [resolveEntryPath(from, clean), safeEntryPath(decode(clean))]
    for (const candidate of candidates) {
      const key = gatherer.picture(files, candidate)
      if (key) return key
    }
    // Last, a file of the same name anywhere in the archive, if only one.
    const name = decode(clean).replace(/^.*\//, '').toLowerCase()
    const matches = [...files.keys()].filter((path) => path.toLowerCase().endsWith(`/${name}`) || path.toLowerCase() === name)
    return matches.length === 1 ? gatherer.picture(files, matches[0]!) : null
  }
}

const decode = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Read a QTI file's items into the gatherer; returns the titles it gives. */
function readDocument(root: XmlElement, gatherer: Gatherer, seen: Set<string>, multiple: boolean): string[] {
  const name = nameOf(root)
  if (name === 'assessmentItem') {
    gatherer.begin()
    gatherer.add(readQti2Item(root, gatherer.html), attr(root, 'title') ?? '')
    return []
  }
  if (root.local !== 'questestinterop') return []
  const titles: string[] = []
  const groups = [...descendantsOf(root, 'assessment'), ...descendantsOf(root, 'objectbank')]
  for (const group of groups.length ? groups : [root]) {
    const ident = attributeOf(group, 'ident')
    if (ident && seen.has(ident)) continue
    if (ident) seen.add(ident)
    const title = group === root ? '' : assessmentTitle(group)
    if (title) titles.push(title)
    for (const item of descendantsOf(group, 'item')) {
      gatherer.begin()
      gatherer.add(readQti12Item(item, gatherer.html), attributeOf(item, 'title') ?? '', multiple && title ? [title] : undefined)
    }
    const banks = descendantsOf(group, 'sourcebank_ref').length
    if (banks) {
      gatherer.issues.push({
        severity: 'warning',
        code: 'question-bank-missing',
        message: `${title ? `“${title}”` : 'This quiz'} draws questions from ${banks === 1 ? 'a question bank' : `${banks} question banks`} that ${banks === 1 ? 'is' : 'are'} not in this file. Export the ${banks === 1 ? 'bank' : 'banks'} too to bring those questions in.`,
      })
    }
  }
  return titles
}

export async function parseQti(input: FormatInput): Promise<ParseResult> {
  const gatherer = new Gatherer()
  const files = await input.zip()
  if (!files) {
    let root: XmlElement | undefined
    try {
      root = documentElement(parseXml(input.text()))
    } catch (reason) {
      gatherer.issues.push({ severity: 'error', code: 'unreadable-file', message: `This file is not well-formed XML: ${(reason as Error).message}` })
      return gatherer.result()
    }
    const titles = root ? readDocument(root, gatherer, new Set(), false) : []
    return gatherer.result(titles.length === 1 ? titles[0] : undefined)
  }

  // The manifest's QTI files first, in its order; then any the manifest
  // does not name. Canvas's `non_cc_assessments` copies come last, so the
  // quiz they repeat is already read.
  const resources = manifestResources(files) ?? []
  let testTitle = ''
  const paths: string[] = []
  for (const resource of resources) {
    if (!QTI_RESOURCE.test(resource.type) || !resource.file) continue
    if (/test_xml/i.test(resource.type)) {
      const test = zipFile(files, resource.file) && readXml(zipFile(files, resource.file)!)
      if (test) testTitle ||= attr(test, 'title') ?? ''
      continue
    }
    if (!paths.includes(resource.file)) paths.push(resource.file)
  }
  const rest = [...files.keys()].filter((path) => isQtiFile(path) && !paths.some((named) => named.toLowerCase() === path.toLowerCase()))
  rest.sort((a, b) => Number(/non_cc_assessments\//i.test(a)) - Number(/non_cc_assessments\//i.test(b)) || a.localeCompare(b))
  const candidates = [...paths, ...rest]

  const documents: { path: string; root: XmlElement }[] = []
  for (const path of candidates) {
    const bytes = zipFile(files, path)
    if (!bytes) continue
    const head = new TextDecoder().decode(bytes.subarray(0, 4096))
    if (!sniffXml(head) && !QTI12_ROOT.test(head)) continue
    const root = readXml(bytes)
    if (!root) {
      gatherer.issues.push({ severity: 'error', code: 'unreadable-file', message: `“${path}” in this archive is not well-formed XML, so its questions were left out.` })
      continue
    }
    documents.push({ path, root })
  }
  const assessments = documents.reduce((count, { root }) =>
    count + descendantsOf(root, 'assessment').length + descendantsOf(root, 'objectbank').length, 0)
  const seen = new Set<string>()
  const titles: string[] = []
  for (const { path, root } of documents) {
    gatherer.resolve = pictureResolver(gatherer, files, path)
    titles.push(...readDocument(root, gatherer, seen, assessments > 1))
  }
  const name = testTitle || (new Set(titles).size === 1 ? titles[0] : undefined)
  return gatherer.result(name)
}

export const qti: FormatSpec = {
  id: 'qti',
  detect,
  parse: parseQti,
}
