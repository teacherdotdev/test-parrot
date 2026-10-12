import {
  choicesOf,
  partsOf,
  promptsOf,
  topicsOf,
  type Choice,
  type Difficulty,
  type Question,
  type QuestionType,
  type Subpart,
} from './exam'
import { isCentred } from './centring'
import { bankLetter } from './matching'
import { pointsOnQuestion } from './points'
import {
  choiceLockOf,
  pendingImageOf,
  readPoints,
  stemNodesOf,
  type PendingImageReference,
  type ProseMirrorJSON,
} from './question-doc'
import type { QuestionBankResource } from './question-bank-workspaces'
import { PAGE_CONTENT_WIDTH, subpartLabelAt } from './export-plan'
import { mediaFilePath } from './package-zip'
import { jpegOrientation } from './export-media'
import {
  MIN_SIZE,
  clampSize,
  legacyRatioOf,
  pictureCropOf,
  type CropBox,
} from './picture-geometry'

export const QUESTION_BANK_FORMAT = 'test-parrot/question-bank'
export const QUESTION_BANK_FORMAT_VERSION = '0.10.0'
export const QUESTION_BANK_ATTACHMENT_NAME = 'pdfcx.json'
export const QUESTION_BANK_ATTACHMENT_DESCRIPTION = 'pdf-canonical-extraction'

export const SUPPORTED_SEMANTIC_NODE_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bullet-list',
  'ordered-list',
  'list-item',
  'code-block',
  'rule',
  'table',
  'table-row',
  'table-cell',
  'inline-math',
  'display-math',
  'hard-break',
  'text',
  'inline-image',
  'block-image',
] as const

/** The layout nodes a stem alone may hold, apart from every other node: a
 *  `side-by-side` is only ever a top-level block of a Question's or a Part's
 *  stem, and a `panel` only ever one of its two or three areas. */
export const SUPPORTED_STEM_LAYOUT_NODE_TYPES = ['side-by-side', 'panel'] as const

/** The node a Fill in the Blank Question's stem alone may hold, apart from
 *  every other node: a `blank`, standing among the text of one of the stem's
 *  paragraphs or headings, whose content is its answer — text and
 *  `inline-math` only (ADR-0049). Added in 0.10.0. */
export const SUPPORTED_BLANK_NODE_TYPE = 'blank'

/** What a Blank's answer may hold. */
export const SUPPORTED_BLANK_CONTENT_TYPES = ['text', 'inline-math'] as const

export const SUPPORTED_SEMANTIC_MARK_TYPES = [
  'strong',
  'emphasis',
  'inline-code',
  'strike',
  'subscript',
  'superscript',
  'link',
] as const

export type SemanticMark =
  | {
      type:
        | 'strong'
        | 'emphasis'
        | 'inline-code'
        | 'strike'
        | 'subscript'
        | 'superscript'
    }
  | { type: 'link'; href: string; title?: string }

export type { PendingImageReference } from './question-doc'

export type SemanticNode = {
  type: string
  content?: SemanticNode[]
  text?: string
  marks?: SemanticMark[]
  level?: number
  start?: number
  language?: string
  source?: string
  header?: boolean
  asset?: string
  pending?: PendingImageReference
  alt?: string
  caption?: string
  /** From 0.7.0, the width of what the picture shows as a share of its
   *  container, 0.05–1. */
  authoredSize?: number
  /** A Picture Crop, on a block image with an `asset` only (0.7.0). */
  crop?: CropBox
  /** A Centred paragraph, block image or table (0.9.0); absent is left. */
  align?: 'center'
  /** Importer-only, never written to a record: the Authored Image Size a
   *  0.1.0–0.6.0 record gave, which meant Crepe's ratio against the size the
   *  picture fit at, not a share of its container. */
  legacyRatio?: number
  /** Importer-only, never written to a record: the pixel size of the Media
   *  Asset a cropped picture shows, from the record's media declaration. */
  pictureSize?: { width: number; height: number }
}

/** A Media Asset an export embeds for one image source. */
type EmbeddedMedia = { id: string; width: number }

export type SemanticDocument = { type: 'document'; content: SemanticNode[] }

/** The Question Types the exchange format names. They are the same Question
 *  Sections the app authors, spelled the way the published contract spells
 *  them: a Short Answer question is `'short-answer'` rather than the `'open'`
 *  the local model calls it. `'fill-in-the-blank'` was added in 0.10.0. */
export type QuestionBankRecordQuestionType =
  | 'multiple-choice'
  | 'true-false'
  | 'matching'
  | 'fill-in-the-blank'
  | 'short-answer'
  | 'multipart'

/** How each record Question Type is written wherever a teacher reads one — the
 *  export preview, the import preview, and the Question Bank File's own pages. */
export const RECORD_TYPE_LABELS: Record<QuestionBankRecordQuestionType, string> = {
  'multiple-choice': 'Multiple Choice',
  'true-false': 'True/False',
  matching: 'Matching',
  'fill-in-the-blank': 'Fill in the Blank',
  'short-answer': 'Short Answer',
  multipart: 'Multipart',
}

/** The order a summary counts the Question Types off in — the order a test
 *  prints its sections, so an import preview reads like the exam it will make. */
export const RECORD_TYPE_ORDER: readonly QuestionBankRecordQuestionType[] = [
  'multiple-choice',
  'true-false',
  'matching',
  'fill-in-the-blank',
  'short-answer',
  'multipart',
]

/** One item of a matching set. `answer` is the package-local id of the Word
 *  Bank answer it matches, and is absent while the item is unmatched. */
export type QuestionBankRecordPrompt = {
  id: string
  content: SemanticDocument
  answer?: string
}

/** A Fill in the Blank stem's answers as a preview prints them: one
 *  paragraph of its Blanks' answers in order, `; ` between them, a Blank left
 *  empty holding its place as `—` beside others. `null` when no Blank has an
 *  answer — the record twin of `blankAnswerBlocks` in `blank.ts`. */
export function recordBlankAnswers(stem: SemanticDocument): SemanticDocument | null {
  const answers: SemanticNode[][] = []
  const visit = (node: SemanticNode) => {
    if (node.type === SUPPORTED_BLANK_NODE_TYPE) answers.push(node.content ?? [])
    else (node.content ?? []).forEach(visit)
  }
  stem.content.forEach(visit)
  if (answers.every((answer) => answer.length === 0)) return null
  const content: SemanticNode[] = []
  answers.forEach((answer, index) => {
    if (index > 0) content.push({ type: 'text', text: '; ' })
    content.push(...(answer.length > 0 ? structuredClone(answer) : [{ type: 'text', text: '—' }]))
  })
  return { type: 'document', content: [{ type: 'paragraph', content }] }
}

/** The letter each Word Bank answer of a record Question carries, by its id —
 *  its position in the bank, which is what a preview prints beside the answer
 *  and in the blank of every item that names it. */
export function wordBankLettersOf(
  question: Pick<QuestionBankRecordQuestion, 'wordBank'>,
): ReadonlyMap<string, string> {
  return new Map(
    (question.wordBank ?? []).map((answer, index) => [answer.id, bankLetter(index)]),
  )
}

/** What a Part of a Multipart question can be. A Part is never True/False,
 *  Matching or Multipart itself. */
export type QuestionBankRecordPartType = 'multiple-choice' | 'short-answer'

/** One lettered Part of a Multipart question that answers — or one Subpart of a
 *  Part, which has the same shape: its own stem, then the choices of a
 *  Multiple Choice one or the optional Suggested Answer of a Short Answer
 *  one. Answer columns and Work Space are Exam presentation, as they are for a
 *  whole Question, so neither is written here. */
export type QuestionBankRecordAnsweringPart = {
  id: string
  type: QuestionBankRecordPartType
  stem: SemanticDocument
  choices?: QuestionBankRecordChoice[]
  suggestedAnswer?: SemanticDocument
  /** What answering it is worth, when it has points. Added in 0.9.0. */
  points?: number
}

/** A Subpart of a Part, numbered (i), (ii)…: shaped as a Part that answers,
 *  and never holding Subparts of its own. Added in 0.9.0. */
export type QuestionBankRecordSubpart = QuestionBankRecordAnsweringPart

/** A Part that holds Subparts: its stem is their lead-in, and it has no type,
 *  choices or Suggested Answer of its own (ADR-0043). Added in 0.9.0. */
export type QuestionBankRecordHoldingPart = {
  id: string
  stem: SemanticDocument
  subparts: QuestionBankRecordSubpart[]
}

/** One lettered Part of a Multipart question: one that answers, or one that holds
 *  Subparts. */
export type QuestionBankRecordPart = QuestionBankRecordAnsweringPart | QuestionBankRecordHoldingPart

/** Whether a record Part holds Subparts rather than answering itself. */
export function holdsSubparts(part: QuestionBankRecordPart): part is QuestionBankRecordHoldingPart {
  return 'subparts' in part && Array.isArray(part.subparts)
}

/** One answer of a Multiple Choice or True/False Question or a Multiple
 *  Choice Part. `locked` is a Locked Answer's: `true` keeps it at its
 *  authored letter however answers are shuffled; `false` says the author
 *  unlocked it, so a consumer that locks answers by their wording must not;
 *  absent, it moves unless its wording locks it (ADR-0038). Added in 0.9.0. */
export type QuestionBankRecordChoice = {
  id: string
  content: SemanticDocument
  correct: boolean
  locked?: boolean
}

/** How each Part type is written wherever a teacher reads one. */
export const RECORD_PART_TYPE_LABELS: Record<QuestionBankRecordPartType, string> = {
  'multiple-choice': 'Multiple Choice',
  'short-answer': 'Short Answer',
}

/** A Part's letter from its position, the way a test prints it: `a`, `b`, … */
export function partLetter(index: number): string {
  return bankLetter(index).toLowerCase()
}

export type QuestionBankRecordQuestion = {
  id: string
  type: QuestionBankRecordQuestionType
  stem: SemanticDocument
  difficulty?: Difficulty
  topics?: string[]
  /** What answering it is worth, on any type but `multipart`, whose worth is
   *  its Parts' and Subparts' sum and never written (ADR-0042). Added in
   *  0.9.0. */
  points?: number
  choices?: QuestionBankRecordChoice[]
  prompts?: QuestionBankRecordPrompt[]
  wordBank?: { id: string; content: SemanticDocument }[]
  /** A Multipart question's Parts, in lettered order; `stem` is the shared material. */
  parts?: QuestionBankRecordPart[]
  suggestedAnswer?: SemanticDocument
}

export type QuestionBankRecord = {
  format: typeof QUESTION_BANK_FORMAT
  formatVersion: typeof QUESTION_BANK_FORMAT_VERSION
  generator: { name: string; version: string }
  requiredFeatures: string[]
  bank: {
    name: string
    description?: string
    author?: string
    license?: { name: string; url?: string }
    questions: QuestionBankRecordQuestion[]
  }
  /** Each Media Asset's bytes are the file it names, beside the record in
   *  its package's zip (ADR-0036). */
  media: {
    id: string
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
    width: number
    height: number
    file: string
  }[]
}

export type PreparedQuestionBankExport = {
  record: QuestionBankRecord
  recordBytes: Uint8Array
  /** Each Media Asset's original bytes, by the path its `file` names. */
  files: Map<string, Uint8Array>
  filename: string
  /** Renderer-oriented bytes; canonical source bytes remain in record.media. */
  previewMedia?: Map<string, { data: Uint8Array; type: 'png' | 'jpg'; width: number; height: number }>
}

export type QuestionBankMediaSource = {
  data: Uint8Array
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  previewData?: Uint8Array
  previewType?: 'png' | 'jpg'
}

export type QuestionBankMediaLoader = (source: string) => Promise<QuestionBankMediaSource | null>

const childNodes = (node: ProseMirrorJSON): ProseMirrorJSON[] =>
  Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []

const attributes = (node: ProseMirrorJSON): Record<string, unknown> =>
  typeof node.attrs === 'object' && node.attrs !== null
    ? (node.attrs as Record<string, unknown>)
    : {}

const stringValue = (value: unknown): string =>
  typeof value === 'string' ? value : ''

function safeHttpUrl(value: unknown): string {
  const href = stringValue(value)
  let url: URL
  try {
    url = new URL(href)
  } catch {
    throw new Error(
      'Question Bank export supports only absolute HTTP or HTTPS links.',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Question Bank export supports only HTTP or HTTPS links.')
  }
  return href
}

function semanticMarks(node: ProseMirrorJSON): SemanticMark[] | undefined {
  if (!Array.isArray(node.marks) || node.marks.length === 0) return undefined
  return (node.marks as ProseMirrorJSON[]).map((mark): SemanticMark => {
    const attrs = attributes(mark)
    switch (mark.type) {
      case 'strong':
        return { type: 'strong' }
      case 'emphasis':
        return { type: 'emphasis' }
      case 'inlineCode':
        return { type: 'inline-code' }
      case 'strike_through':
        return { type: 'strike' }
      case 'subscript':
        return { type: 'subscript' }
      case 'superscript':
        return { type: 'superscript' }
      case 'link': {
        const title = stringValue(attrs.title)
        return {
          type: 'link',
          href: safeHttpUrl(attrs.href),
          ...(title ? { title } : {}),
        }
      }
      default:
        throw new Error(
          `Question Bank export does not support the “${String(mark.type)}” text mark.`,
        )
    }
  })
}

function imageSemanticNode(
  node: ProseMirrorJSON,
  mediaIds: ReadonlyMap<string, EmbeddedMedia>,
): SemanticNode {
  const attrs = attributes(node)
  const pending = pendingImageOf(node)
  const source = stringValue(attrs.src)
  const media = pending ? undefined : mediaIds.get(source)
  if (!pending && !media) {
    throw new Error(`Required media “${source || 'without a source'}” could not be resolved. Re-add the image and try again.`)
  }
  const block = node.type !== 'image'
  const authoredSize = block ? recordSize(attrs, media) : undefined
  const crop = block && media ? pictureCropOf(attrs) : null
  return {
    type: block ? 'block-image' : 'inline-image',
    ...(pending ? { pending } : { asset: media!.id }),
    ...centredOf(node),
    ...(stringValue(attrs.alt) ? { alt: stringValue(attrs.alt) } : {}),
    ...(stringValue(attrs.caption) ? { caption: stringValue(attrs.caption) } : {}),
    ...(authoredSize !== undefined ? { authoredSize } : {}),
    ...(crop ? { crop: { left: crop.left, top: crop.top, right: crop.right, bottom: crop.bottom } } : {}),
  }
}

/**
 * A block image's Authored Image Size as Record 0.7.0 writes it: a share of
 * its container. A picture sized in the editor already has one. One that has
 * only Crepe's legacy `ratio` — the size a drag left it at over the size it
 * fit at — is converted against the Question Content lane, where it fit at
 * its own width or the lane's when narrower; a picture no one sized has none.
 */
function recordSize(attrs: Record<string, unknown>, media: EmbeddedMedia | undefined): number | undefined {
  if (attrs.size !== null && attrs.size !== undefined) {
    const size = Number(attrs.size)
    if (!Number.isFinite(size) || size < MIN_SIZE || size > 1) {
      throw new Error('Authored Image Size must be between 0.05 and 1.')
    }
    return size
  }
  const ratio = legacyRatioOf(attrs)
  if (ratio === 1) return undefined
  const fitted = media ? Math.min(media.width, PAGE_CONTENT_WIDTH) : PAGE_CONTENT_WIDTH
  return clampSize((ratio * fitted) / PAGE_CONTENT_WIDTH)
}

/** A Centred block's `align`, as the record writes it. */
function centredOf(node: ProseMirrorJSON): { align?: 'center' } {
  return isCentred(node) ? { align: 'center' } : {}
}

function semanticNode(node: ProseMirrorJSON, mediaIds: ReadonlyMap<string, EmbeddedMedia>): SemanticNode {
  const attrs = attributes(node)
  const content = () => childNodes(node).map((child) => semanticNode(child, mediaIds))
  switch (node.type) {
    case 'sideBySide':
    case 'sideBySidePanel':
      throw new Error('A Side-by-Side may appear only as a top-level block of a stem.')
    case 'text': {
      const marks = semanticMarks(node)
      return {
        type: 'text',
        text: stringValue(node.text),
        ...(marks ? { marks } : {}),
      }
    }
    case 'hardbreak':
      return { type: 'hard-break' }
    case 'paragraph':
      return { type: 'paragraph', ...centredOf(node), content: content() }
    case 'heading':
      return {
        type: 'heading',
        level: Math.min(6, Math.max(1, Number(attrs.level) || 1)),
        content: content(),
      }
    case 'blockquote':
      return { type: 'blockquote', content: content() }
    case 'bullet_list':
      return { type: 'bullet-list', content: content() }
    case 'ordered_list':
      return {
        type: 'ordered-list',
        start: Number(attrs.order) || 1,
        content: content(),
      }
    case 'list_item':
      return { type: 'list-item', content: content() }
    case 'code_block': {
      const source = childNodes(node)
        .map((child) => stringValue(child.text))
        .join('')
      if (stringValue(attrs.language).toLowerCase() === 'latex') {
        return { type: 'display-math', source }
      }
      const language = stringValue(attrs.language)
      return {
        type: 'code-block',
        ...(language ? { language } : {}),
        text: source,
      }
    }
    case 'hr':
      return { type: 'rule' }
    case 'table':
      return { type: 'table', ...centredOf(node), content: content() }
    case 'table_header_row':
      return { type: 'table-row', header: true, content: content() }
    case 'table_row':
      return { type: 'table-row', content: content() }
    case 'table_header':
      return { type: 'table-cell', header: true, content: content() }
    case 'table_cell':
      return { type: 'table-cell', content: content() }
    case 'math_inline':
      return { type: 'inline-math', source: stringValue(attrs.value) }
    // A Blank and its answer (ADR-0049). `portableQuestion` lets one reach
    // here only from a Fill in the Blank Question's stem.
    case 'blank': {
      const answer = content()
      return { type: 'blank', ...(answer.length > 0 ? { content: answer } : {}) }
    }
    case 'doc':
      throw new Error(
        'A document node may appear only at the root of Question Content.',
      )
    case 'multipleChoice':
    case 'multipleChoiceChoice':
      throw new Error(
        'Multiple Choice structure must remain separate from its stem.',
      )
    case 'matching':
    case 'matchingPrompt':
    case 'matchingAnswer':
      throw new Error('Matching structure must remain separate from its stem.')
    case 'multipartParts':
    case 'multipartPart':
    case 'multipartPartStem':
      throw new Error('Multipart Parts must remain separate from their question’s stem.')
    case 'image':
    case 'image-block':
      return imageSemanticNode(node, mediaIds)
    default:
      throw new Error(
        `Question Bank export does not support the “${String(node.type)}” content node.`,
      )
  }
}

function semanticDocument(
  nodes: readonly ProseMirrorJSON[],
  mediaIds: ReadonlyMap<string, EmbeddedMedia>,
): SemanticDocument {
  return { type: 'document', content: nodes.map((node) => semanticNode(node, mediaIds)) }
}

/** A Side-by-Side: its two or three Panels, each holding ordinary blocks. */
function semanticSideBySide(
  node: ProseMirrorJSON,
  mediaIds: ReadonlyMap<string, EmbeddedMedia>,
): SemanticNode {
  const panels = childNodes(node)
  if (panels.length < 2 || panels.length > 3) {
    throw new Error('A Side-by-Side must hold two or three Panels.')
  }
  return {
    type: 'side-by-side',
    content: panels.map((panel) => {
      if (panel.type !== 'sideBySidePanel') {
        throw new Error('A Side-by-Side may hold only Panels.')
      }
      const blocks = childNodes(panel)
      if (blocks.length === 0) throw new Error('A Panel must hold at least one block.')
      return { type: 'panel', content: blocks.map((block) => semanticNode(block, mediaIds)) }
    }),
  }
}

/** A Question's or a Part's stem: the one document whose top-level blocks may
 *  also be Side-by-Sides. */
function semanticStem(
  nodes: readonly ProseMirrorJSON[],
  mediaIds: ReadonlyMap<string, EmbeddedMedia>,
): SemanticDocument {
  return {
    type: 'document',
    content: nodes.map((node) =>
      node.type === 'sideBySide' ? semanticSideBySide(node, mediaIds) : semanticNode(node, mediaIds),
    ),
  }
}

/** The local Question Type each record Question Type is written as. The one
 *  place the two vocabularies meet on the way out; `LOCAL_TYPES` in the
 *  importer is its inverse. */
export const RECORD_TYPES: Record<QuestionType, QuestionBankRecordQuestionType> = {
  'multiple-choice': 'multiple-choice',
  'true-false': 'true-false',
  matching: 'matching',
  'fill-in-the-blank': 'fill-in-the-blank',
  open: 'short-answer',
  multipart: 'multipart',
}

/** A document with every Blank in it replaced by its answer, as ordinary
 *  text. A Blank belongs only to a Fill in the Blank Question's stem; one that
 *  strayed anywhere else — pasted into another type's question — is written as
 *  the words it holds rather than as a Blank the record cannot carry there. */
function withoutBlanks(node: ProseMirrorJSON): ProseMirrorJSON {
  if (!Array.isArray(node.content)) return node
  return {
    ...node,
    content: (node.content as ProseMirrorJSON[]).flatMap((child) =>
      child.type === 'blank' ? childNodes(child).map(withoutBlanks) : [withoutBlanks(child)],
    ),
  }
}

function portableQuestion(
  authored: Question,
  index: number,
  mediaIds: ReadonlyMap<string, EmbeddedMedia>,
): QuestionBankRecordQuestion {
  // Only a Fill in the Blank Question's stem holds Blanks; any other
  // Question's are unwrapped into the words they hold.
  const question: Question = authored.type === 'fill-in-the-blank'
    ? authored
    : {
        ...authored,
        doc: withoutBlanks(authored.doc),
        ...(authored.suggestedAnswer ? { suggestedAnswer: withoutBlanks(authored.suggestedAnswer) } : {}),
      }
  const base: QuestionBankRecordQuestion = {
    id: `q${index + 1}`,
    type: RECORD_TYPES[question.type],
    stem: semanticStem(stemNodesOf(question.doc), mediaIds),
    ...(question.difficulty ? { difficulty: question.difficulty } : {}),
    ...(topicsOf(question).length > 0
      ? { topics: [...topicsOf(question)] }
      : {}),
    ...pointsOf(pointsOnQuestion(question) ? question.points : undefined),
  }
  if (question.type === 'open') {
    return {
      ...base,
      ...(question.suggestedAnswer
        ? {
            suggestedAnswer: semanticDocument(
              childNodes(question.suggestedAnswer),
              mediaIds,
            ),
          }
        : {}),
    }
  }
  if (question.type === 'fill-in-the-blank') {
    // Its Blanks, in its stem, are what it answers with; it carries nothing
    // else that answers. A stem with no Blank is incomplete, not invalid.
    return base
  }
  if (question.type === 'matching') {
    const prompts = promptsOf(question)
    const bank = choicesOf(question)
    if (prompts.length < 1) {
      throw new Error(`Question ${index + 1} is a matching set and must have an item to match.`)
    }
    if (bank.length < 2) {
      throw new Error(
        `Question ${index + 1} is a matching set and must have at least two Word Bank answers.`,
      )
    }
    const answerIds = new Map(
      bank.map((answer, answerIndex) => [answer.id, `q${index + 1}-a${answerIndex + 1}`]),
    )
    return {
      ...base,
      prompts: prompts.map((prompt, promptIndex) => {
        const answer = answerIds.get(prompt.answerId)
        return {
          id: `q${index + 1}-p${promptIndex + 1}`,
          content: semanticDocument(childNodes(prompt.node), mediaIds),
          // An answer the bank no longer holds is no answer: the item is
          // written as unmatched rather than pointing at nothing.
          ...(answer ? { answer } : {}),
        }
      }),
      wordBank: bank.map((answer) => ({
        id: answerIds.get(answer.id)!,
        content: semanticDocument(childNodes(answer.node), mediaIds),
      })),
    }
  }
  if (question.type === 'multipart') {
    // The stem is the Multipart question; each Part follows it under an id of its own.
    // Parts are lettered where they stand, so they keep authored order.
    return {
      ...base,
      parts: partsOf(question).map((part, partIndex): QuestionBankRecordPart => {
        const id = `q${index + 1}-s${partIndex + 1}`
        const where = `Question ${index + 1}, Part ${partLetter(partIndex)}`
        if (part.type !== 'subparts') {
          return recordAnsweringPart({ ...part, type: part.type }, id, where, mediaIds)
        }
        // A Part that holds Subparts is their lead-in alone; each Subpart is
        // written as a Part that answers, under an id that carries its Part's.
        return {
          id,
          stem: semanticStem(part.stem, mediaIds),
          subparts: part.subparts.map((subpart, subpartIndex) =>
            recordAnsweringPart(
              subpart,
              `${id}-s${subpartIndex + 1}`,
              `${where} (${subpartLabelAt(subpartIndex)})`,
              mediaIds,
            )),
        }
      }),
    }
  }
  const choices = choicesOf(question)
  if (choices.length < 2) {
    throw new Error(`Question ${index + 1} must have at least two choices.`)
  }
  if (question.type === 'true-false' && choices.length !== 2) {
    throw new Error(
      `Question ${index + 1} is True/False and must have exactly two choices.`,
    )
  }
  if (choices.filter((choice) => choice.correct).length > 1) {
    throw new Error(
      `Question ${index + 1} must have zero or one correct choice.`,
    )
  }
  return {
    ...base,
    choices: choices.map((choice, choiceIndex) => ({
      id: `q${index + 1}-c${choiceIndex + 1}`,
      content: semanticDocument(childNodes(choice.node), mediaIds),
      correct: choice.correct,
      ...(question.type === 'multiple-choice' ? recordLockOf(choice) : {}),
    })),
  }
}

/** A Part that answers, or a Subpart, as a record writes it under `id`: a
 *  Short Answer one with its Suggested Answer, if any, or a Multiple Choice one
 *  with its choices, held to a Multiple Choice Question's rules. `where` names
 *  it in an error. */
function recordAnsweringPart(
  part: Subpart,
  id: string,
  where: string,
  mediaIds: ReadonlyMap<string, EmbeddedMedia>,
): QuestionBankRecordAnsweringPart {
  const stem = semanticStem(part.stem, mediaIds)
  if (part.type === 'open') {
    return {
      id,
      type: 'short-answer',
      stem,
      ...(part.suggestedAnswer
        ? { suggestedAnswer: semanticDocument(childNodes(part.suggestedAnswer), mediaIds) }
        : {}),
      ...pointsOf(part.points),
    }
  }
  if (part.choices.length < 2) {
    throw new Error(`${where} must have at least two choices.`)
  }
  if (part.choices.filter((choice) => choice.correct).length > 1) {
    throw new Error(`${where} must have zero or one correct choice.`)
  }
  return {
    id,
    type: 'multiple-choice',
    stem,
    choices: part.choices.map((choice, choiceIndex) => ({
      id: `${id}-c${choiceIndex + 1}`,
      content: semanticDocument(childNodes(choice.node), mediaIds),
      correct: choice.correct,
      ...recordLockOf(choice),
    })),
    ...pointsOf(part.points),
  }
}

/** `points` as a record writes it: present only when there are any. */
function pointsOf(value: unknown): { points?: number } {
  const points = readPoints(value)
  return points === undefined ? {} : { points }
}

/** A choice's `locked` as a record writes it: `true` for every Locked Answer,
 *  whether the teacher or its wording locked it, so no consumer needs Test
 *  Parrot's reading of the wording; `false` for one the teacher unlocked, so
 *  an importer that locks by wording leaves it alone; nothing otherwise. A
 *  True/False answer is never locked, so it never carries one. */
function recordLockOf(choice: Choice): { locked?: boolean } {
  if (choice.locked) return { locked: true }
  return choiceLockOf(choice.node) === false ? { locked: false } : {}
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** Serialize semantic record content at the public exchange boundary. */
export async function serializeQuestionBankRecord(
  content: Pick<QuestionBankRecord, 'bank' | 'media' | 'requiredFeatures'>,
): Promise<{ record: QuestionBankRecord; bytes: Uint8Array }> {
  const record: QuestionBankRecord = {
    format: QUESTION_BANK_FORMAT,
    formatVersion: QUESTION_BANK_FORMAT_VERSION,
    generator: { name: 'Test Parrot', version: QUESTION_BANK_FORMAT_VERSION },
    requiredFeatures: [...content.requiredFeatures],
    bank: structuredClone(content.bank),
    media: structuredClone(content.media),
  }
  const bytes = new TextEncoder().encode(JSON.stringify(record))
  return {
    record: JSON.parse(new TextDecoder().decode(bytes)) as QuestionBankRecord,
    bytes,
  }
}

export function questionBankFilename(name: string): string {
  const stem = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '')
  return `${stem || 'untitled-question-bank'}.question-bank.pdf`
}

function imageSources(nodes: readonly ProseMirrorJSON[]): string[] {
  const sources: string[] = []
  const visit = (node: ProseMirrorJSON) => {
    if (node.type === 'image' || node.type === 'image-block') {
      const source = stringValue(attributes(node).src)
      if (source && !sources.includes(source)) sources.push(source)
    }
    for (const child of childNodes(node)) visit(child)
  }
  for (const node of nodes) visit(node)
  return sources
}

const browserQuestionBankMedia: QuestionBankMediaLoader = async (source) => {
  try {
    const response = await fetch(source)
    if (!response.ok) return null
    const blob = await response.blob()
    if (!blob.type.toLowerCase().startsWith('image/') || blob.type.toLowerCase() === 'image/svg+xml') return null
    const originalMimeType = blob.type.toLowerCase()
    const bitmap = await createImageBitmap(blob)
    try {
      let data = new Uint8Array(await blob.arrayBuffer())
      let mimeType: QuestionBankMediaSource['mimeType']
      let previewData = data
      let previewType: 'png' | 'jpg'
      if (originalMimeType === 'image/jpeg' && jpegOrientation(data) !== 1) {
        // A camera photo stored turned: the record keeps its bytes as they
        // are, but a PDF draws stored pixels as they are, so the preview is
        // drawn from the bitmap, which the browser has already turned upright.
        mimeType = originalMimeType
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
        const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
        if (!jpeg) return null
        previewData = new Uint8Array(await jpeg.arrayBuffer())
        previewType = 'jpg'
      } else if (originalMimeType === 'image/png' || originalMimeType === 'image/jpeg') {
        mimeType = originalMimeType
        previewType = originalMimeType === 'image/jpeg' ? 'jpg' : 'png'
      } else {
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
        const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!png) return null
        previewData = new Uint8Array(await png.arrayBuffer())
        previewType = 'png'
        if (originalMimeType === 'image/webp') {
          mimeType = 'image/webp'
        } else {
          data = previewData
          mimeType = 'image/png'
        }
      }
      return { data, mimeType, width: bitmap.width, height: bitmap.height, previewData, previewType }
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

export async function prepareQuestionBankExport(
  bank: QuestionBankResource,
  loadMedia: QuestionBankMediaLoader = browserQuestionBankMedia,
): Promise<PreparedQuestionBankExport> {
  if (bank.questions.length === 0) {
    throw new Error(
      'A Question Bank requires at least one Question before it can be exported.',
    )
  }
  const sources = bank.questions.flatMap((question) => [
    ...imageSources(childNodes(question.doc)),
    ...imageSources(question.suggestedAnswer ? childNodes(question.suggestedAnswer) : []),
  ]).filter((source, index, all) => all.indexOf(source) === index)
  const loaded = await Promise.all(sources.map((source) => loadMedia(source)))
  const mediaIds = new Map<string, EmbeddedMedia>()
  const media: QuestionBankRecord['media'] = []
  const files = new Map<string, Uint8Array>()
  const previewMedia = new Map<string, NonNullable<PreparedQuestionBankExport['previewMedia']> extends Map<string, infer V> ? V : never>()
  for (const [index, source] of sources.entries()) {
    const asset = loaded[index]
    if (!asset) throw new Error(`Required media for “${source}” could not be resolved. Re-add the image and try again.`)
    const digest = hex(await crypto.subtle.digest('SHA-256', asset.data))
    const id = `sha256:${digest}`
    mediaIds.set(source, { id, width: asset.width })
    if (!media.some((candidate) => candidate.id === id)) {
      const file = mediaFilePath(id, asset.mimeType)
      media.push({ id, mimeType: asset.mimeType, width: asset.width, height: asset.height, file })
      files.set(file, asset.data)
      previewMedia.set(id, {
        data: asset.previewData ?? asset.data,
        type: asset.previewType ?? (asset.mimeType === 'image/jpeg' ? 'jpg' : 'png'),
        width: asset.width,
        height: asset.height,
      })
    }
  }
  if (bank.license?.url) safeHttpUrl(bank.license.url)
  const serialized = await serializeQuestionBankRecord({
    requiredFeatures: [],
    bank: {
      name: bank.name,
      ...(bank.description !== undefined ? { description: bank.description } : {}),
      ...(bank.author !== undefined ? { author: bank.author } : {}),
      ...(bank.license !== undefined ? { license: { ...bank.license } } : {}),
      questions: bank.questions.map((question, index) => portableQuestion(question, index, mediaIds)),
    },
    media,
  })
  // Preview and attachment share the serializer's exact record and bytes.
  return {
    record: serialized.record,
    recordBytes: serialized.bytes,
    files,
    filename: questionBankFilename(bank.name),
    previewMedia,
  }
}

const EDITOR_NODE_TYPES: Record<string, string> = {
  'side-by-side': 'sideBySide',
  panel: 'sideBySidePanel',
  'hard-break': 'hardbreak',
  'bullet-list': 'bullet_list',
  'ordered-list': 'ordered_list',
  'list-item': 'list_item',
  'code-block': 'code_block',
  rule: 'hr',
  'table-row': 'table_row',
  'table-cell': 'table_cell',
  'inline-math': 'math_inline',
}

const EDITOR_MARK_TYPES: Record<SemanticMark['type'], string> = {
  strong: 'strong',
  emphasis: 'emphasis',
  'inline-code': 'inlineCode',
  strike: 'strike_through',
  subscript: 'subscript',
  superscript: 'superscript',
  link: 'link',
}

/** The media declarations a record's pictures are read against. */
export type RecordMediaSizes = readonly { id: string; width: number; height: number }[]

/**
 * A block image's size and crop as the editor holds them: a 0.7.0
 * `authoredSize` is its `size`, a share of its container; an older record's is
 * the legacy `ratio` it always meant. A crop carries the whole Media Asset's
 * pixel size, from the importer or else from the record's media.
 */
function editorPictureAttrs(node: SemanticNode, media: RecordMediaSizes | undefined): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
  if (node.authoredSize !== undefined) attrs.size = node.authoredSize
  else if (node.legacyRatio !== undefined) attrs.ratio = node.legacyRatio
  const size = node.pictureSize ?? media?.find((asset) => asset.id === node.asset)
  if (node.crop && size) {
    attrs.crop = { ...node.crop, width: size.width, height: size.height }
  }
  return attrs
}

function editorNode(node: SemanticNode, media?: RecordMediaSizes): ProseMirrorJSON {
  if (node.type === 'inline-math')
    return { type: 'math_inline', attrs: { value: node.source ?? '' } }
  if (node.type === 'display-math') {
    return {
      type: 'code_block',
      attrs: { language: 'latex' },
      content: [{ type: 'text', text: node.source ?? '' }],
    }
  }
  if (node.type === 'inline-image' || node.type === 'block-image') {
    return {
      type: node.type === 'inline-image' ? 'image' : 'image-block',
      attrs: {
        // A Pending Image has no bytes yet, so no source: it keeps what it
        // names, exactly, until Resolve Images gives it a Media Asset.
        ...(node.pending
          ? { src: '', pending: { ...node.pending } }
          : { src: `/local-images/${node.asset!.slice('sha256:'.length)}` }),
        ...(node.alt !== undefined ? { alt: node.alt } : {}),
        ...(node.caption !== undefined ? { caption: node.caption } : {}),
        ...(node.type === 'block-image' ? editorPictureAttrs(node, media) : {}),
        ...(node.type === 'block-image' && node.align === 'center' ? { align: 'center' } : {}),
      },
    }
  }
  if (node.type === 'code-block') {
    return {
      type: 'code_block',
      ...(node.language ? { attrs: { language: node.language } } : {}),
      content: [{ type: 'text', text: node.text ?? '' }],
    }
  }
  const type = EDITOR_NODE_TYPES[node.type] ?? node.type
  const attrs: Record<string, unknown> = {}
  if (node.type === 'heading') attrs.level = node.level
  if (node.type === 'ordered-list') attrs.order = node.start
  if ((node.type === 'paragraph' || node.type === 'table') && node.align === 'center') attrs.align = 'center'
  const converted: ProseMirrorJSON = {
    type,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.content ? { content: node.content.map((child) => editorNode(child, media)) } : {}),
  }
  if (node.type === 'table-row' && node.header)
    converted.type = 'table_header_row'
  if (node.type === 'table-cell' && node.header) converted.type = 'table_header'
  if (Object.keys(attrs).length > 0) converted.attrs = attrs
  if (node.marks)
    converted.marks = node.marks.map((mark) => ({
      type: EDITOR_MARK_TYPES[mark.type],
      ...(mark.type === 'link'
        ? {
            attrs: {
              href: mark.href,
              ...(mark.title ? { title: mark.title } : {}),
            },
          }
        : {}),
    }))
  return converted
}

/** Preview adapter: the preview consumes only the portable record. Pass the
 *  record's `media` so a Picture Crop in a record the importer did not parse,
 *  such as the export preview's, can find its Media Asset's pixel size. */
export function recordDocumentToEditorNodes(
  document: SemanticDocument,
  media?: RecordMediaSizes,
): ProseMirrorJSON[] {
  return document.content.map((node) => editorNode(node, media))
}
