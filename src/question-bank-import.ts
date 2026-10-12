import Ajv2020, { type ErrorObject } from 'ajv/dist/2020'
import { DEFAULT_COLUMNS, type Question, type QuestionType } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import { jpegOrientation } from './export-media'
import questionBankSchema010 from './question-bank-record-0.1.0.schema.json'
import questionBankSchema020 from './question-bank-record-0.2.0.schema.json'
import questionBankSchema030 from './question-bank-record-0.3.0.schema.json'
import questionBankSchema040 from './question-bank-record-0.4.0.schema.json'
import questionBankSchema050 from './question-bank-record-0.5.0.schema.json'
import questionBankSchema060 from './question-bank-record-0.6.0.schema.json'
import questionBankSchema070 from './question-bank-record-0.7.0.schema.json'
import questionBankSchema080 from './question-bank-record-0.8.0.schema.json'
import questionBankSchema090 from './question-bank-record-0.9.0.schema.json'
import questionBankSchema0100 from './question-bank-record-0.10.0.schema.json'
import {
  QUESTION_BANK_ATTACHMENT_DESCRIPTION,
  QUESTION_BANK_FORMAT,
  QUESTION_BANK_FORMAT_VERSION,
  RECORD_PART_TYPE_LABELS,
  RECORD_TYPE_LABELS,
  SUPPORTED_BLANK_CONTENT_TYPES,
  SUPPORTED_BLANK_NODE_TYPE,
  holdsSubparts,
  partLetter,
  recordDocumentToEditorNodes,
  type QuestionBankRecord,
  type QuestionBankRecordAnsweringPart,
  type QuestionBankRecordChoice,
  type QuestionBankRecordPart,
  type QuestionBankRecordQuestion,
  type QuestionBankRecordQuestionType,
  type SemanticDocument,
  type SemanticNode,
} from './question-bank-export'
import { subpartLabelAt } from './export-plan'

export const DEFAULT_QUESTION_BANK_IMPORT_LIMITS = Object.freeze({
  pdfBytes: 100 * 1024 * 1024,
  recordBytes: 75 * 1024 * 1024,
  questions: 10_000,
  mediaAssets: 2_000,
  mediaAssetBytes: 25 * 1024 * 1024,
  totalMediaBytes: 75 * 1024 * 1024,
  questionNodes: 25_000,
  richTextDepth: 50,
  imageWidth: 20_000,
  imageHeight: 20_000,
})

export type QuestionBankImportLimits = typeof DEFAULT_QUESTION_BANK_IMPORT_LIMITS

export type QuestionBankImportErrorCode =
  | 'pdf-size-limit'
  | 'invalid-pdf'
  | 'missing-attachment'
  | 'ambiguous-attachments'
  | 'record-size-limit'
  | 'invalid-json'
  | 'unsupported-format'
  | 'unsupported-version'
  | 'invalid-structure'
  | 'unsupported-feature'
  | 'duplicate-id'
  | 'dangling-reference'
  | 'duplicate-reference'
  | 'invalid-position'
  | 'invalid-answer-order'
  | 'bank-count-limit'
  | 'exam-count-limit'
  | 'invalid-question'
  | 'unsafe-url'
  | 'question-count-limit'
  | 'media-count-limit'
  | 'media-asset-size-limit'
  | 'total-media-size-limit'
  | 'question-node-limit'
  | 'rich-text-depth-limit'
  | 'image-dimension-limit'
  | 'invalid-media'
  | 'missing-media'
  | 'invalid-zip'

export class QuestionBankImportError extends Error {
  constructor(
    readonly code: QuestionBankImportErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'QuestionBankImportError'
  }
}

/**
 * One record, parsed. Every supported version parses into the current shape:
 * migration happens in the version's own parser, so everything downstream reads
 * one vocabulary and a new version costs a parser rather than a branch in each
 * reader. `sourceVersion` is what the file actually said, kept because that is
 * what a teacher is told they are importing.
 */
export type ParsedQuestionBankRecord = ParsedRecord

type ParsedRecord = {
  format: typeof QUESTION_BANK_FORMAT
  formatVersion: typeof QUESTION_BANK_FORMAT_VERSION
  sourceVersion: string
  generator: { name: string; version: string }
  requiredFeatures: string[]
  bank: {
    name: string
    description?: string
    author?: string
    license?: { name: string; url?: string }
    questions: QuestionBankRecordQuestion[]
  }
  media: ParsedMediaAsset[]
}

/** A Media Asset with its original bytes, however the record carried them. */
export type ParsedMediaAsset = {
  id: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  bytes: Uint8Array
}

/** A Media Asset as a record declares it, before its bytes are checked:
 *  0.1.0–0.7.0 carry them as base64, 0.8.0 and later name a file in the
 *  package's zip. */
type DeclaredMediaAsset = Omit<ParsedMediaAsset, 'bytes'> & ({ bytes: string } | { file: string })

/** A record structurally parsed, its Media Assets still as declared. */
type DeclaredRecord = Omit<ParsedRecord, 'media'> & { media: DeclaredMediaAsset[] }

/**
 * The files a package's zip carries beside `parrot.json`, by path. Each file
 * a Media Asset names is marked used, so a package can refuse a picture no
 * record declares, as a record refuses a Media Asset nothing shows.
 */
export type PackageFiles = {
  get: (path: string) => Uint8Array | undefined
  used: Set<string>
}

export function packageFiles(files: ReadonlyMap<string, Uint8Array>): PackageFiles {
  return { get: (path) => files.get(path), used: new Set() }
}

export type QuestionBankRecordSummary = QuestionBankImportProposal['summary']

export type QuestionBankImportProposal = {
  record: ParsedRecord
  summary: {
    bankName: string
    questionCounts: Record<QuestionBankRecordQuestionType, number>
    topics: string[]
    /** Questions that answer with choices but have none marked correct,
     *  matching sets with an item left unmatched, and Multipart questions with no Parts or
     *  with a Multiple Choice Part none of whose choices is correct. That is
     *  conforming — a bank may be shared mid-authoring — so it is reported
     *  rather than refused. */
    questionsWithoutCorrectAnswer: number
    mediaAssets: number
    /** Images that name an Image Tag or a page of a Source Document instead
     *  of carrying bytes: conforming, and left for Resolve Images. */
    pendingImages: number
    decodedMediaBytes: number
    externalLinks: boolean
    formatVersion: string
  }
}

/** The local Question Type each record Question Type reads as — the inverse of
 *  the exporter's `RECORD_TYPES`. */
export const LOCAL_TYPES: Record<QuestionBankRecordQuestionType, QuestionType> = {
  'multiple-choice': 'multiple-choice',
  'true-false': 'true-false',
  matching: 'matching',
  'fill-in-the-blank': 'fill-in-the-blank',
  'short-answer': 'open',
  multipart: 'multipart',
}

/** Where each package-local id of one record Question landed locally. */
export type ImportedQuestionIdentity = {
  question: Question
  /** Choice ids for Multiple Choice and True/False; Word Bank ids for
   *  Matching; Part ids and every Part's choice ids for a Multipart question. Answer
   *  order in an Exam Record is written in these. */
  answers: ReadonlyMap<string, string>
}

/** A matching set's editor node: its prompts, then its Word Bank, each given
 *  a fresh local id — and each prompt pointed at its answer's new id, since a
 *  package-local id is only meaningful inside the record. */
function importedMatching(
  question: QuestionBankRecordQuestion,
  createId: () => string,
  answerIds: Map<string, string>,
): ProseMirrorJSON {
  for (const answer of question.wordBank ?? []) answerIds.set(answer.id, createId())
  return {
    type: 'matching',
    content: [
      ...(question.prompts ?? []).map((prompt) => ({
        type: 'matchingPrompt',
        attrs: {
          id: createId(),
          answer: (prompt.answer && answerIds.get(prompt.answer)) || '',
        },
        content: recordDocumentToEditorNodes(prompt.content),
      })),
      ...(question.wordBank ?? []).map((answer) => ({
        type: 'matchingAnswer',
        attrs: { id: answerIds.get(answer.id)! },
        content: recordDocumentToEditorNodes(answer.content),
      })),
    ],
  }
}

/** A Multipart question's Parts box: each Part given a fresh local id, its stem, then
 *  its answer component — a Multiple Choice Part's choices, each with a fresh
 *  id, or a Short Answer Part's Suggested Answer, which stays inside the
 *  document beside the stem it answers, unlike a Short Answer question's — or
 *  the Subparts it holds, each built the same way. A Part's answer columns
 *  are not in the record, so it starts with the editor's default, as a new
 *  Part does. */
function importedParts(
  parts: readonly QuestionBankRecordPart[],
  createId: () => string,
  answerIds: Map<string, string>,
): ProseMirrorJSON {
  return {
    type: 'multipartParts',
    content: parts.map((part) => {
      if (!holdsSubparts(part)) return importedPart('multipartPart', part, createId, answerIds)
      const id = createId()
      answerIds.set(part.id, id)
      return {
        type: 'multipartPart',
        attrs: { id, columns: DEFAULT_COLUMNS },
        content: [
          { type: 'multipartPartStem', content: blocksOrBlank(part.stem) },
          {
            type: 'multipartSubparts',
            content: part.subparts.map((subpart) =>
              importedPart('multipartSubpart', subpart, createId, answerIds)),
          },
        ],
      }
    }),
  }
}

/** A Part that answers, or a Subpart, as the editor holds it. */
function importedPart(
  type: 'multipartPart' | 'multipartSubpart',
  part: QuestionBankRecordAnsweringPart,
  createId: () => string,
  answerIds: Map<string, string>,
): ProseMirrorJSON {
  const id = createId()
  answerIds.set(part.id, id)
  return {
    type,
    attrs: { id, columns: DEFAULT_COLUMNS, ...(part.points !== undefined ? { points: part.points } : {}) },
    content: [
      { type: 'multipartPartStem', content: blocksOrBlank(part.stem) },
      part.type === 'multiple-choice'
        ? {
            type: 'multipleChoice',
            content: (part.choices ?? []).map((choice) => {
              const choiceId = createId()
              answerIds.set(choice.id, choiceId)
              return {
                type: 'multipleChoiceChoice',
                attrs: { id: choiceId, correct: choice.correct, ...lockAttrOf(choice) },
                content: recordDocumentToEditorNodes(choice.content),
              }
            }),
          }
        : {
            type: 'suggestedAnswer',
            content: part.suggestedAnswer
              ? blocksOrBlank(part.suggestedAnswer)
              : [{ type: 'paragraph' }],
          },
    ],
  }
}

/** The teacher's decision a record's choice carries, as the editor keeps it.
 *  A choice that says nothing has no decision, and its wording locks it or
 *  not — so an older record's “All of the above”, a Question File's or an
 *  assistant's is locked on import as a typed one is (ADR-0038). */
function lockAttrOf(choice: QuestionBankRecordChoice): { locked?: boolean } {
  return choice.locked === undefined ? {} : { locked: choice.locked }
}

/** A document's blocks, or one empty paragraph for a visibly blank one — a
 *  Part's stem and Suggested Answer each hold at least one block. */
function blocksOrBlank(document: SemanticDocument): ProseMirrorJSON[] {
  const blocks = recordDocumentToEditorNodes(document)
  return blocks.length > 0 ? blocks : [{ type: 'paragraph' }]
}

/** Map a validated portable record into fresh local authoring identities,
 *  keyed by each Question's package-local id so an Exam Record travelling
 *  beside it can be pointed at what was made. */
export function importedQuestionIdentities(
  record: Pick<ParsedRecord, 'bank'>,
  createId: () => string = () => crypto.randomUUID(),
): Map<string, ImportedQuestionIdentity> {
  const imported = new Map<string, ImportedQuestionIdentity>()
  for (const question of record.bank.questions) {
    const stem = recordDocumentToEditorNodes(question.stem)
    const answers = new Map<string, string>()
    const local: Question = {
      id: createId(),
      type: LOCAL_TYPES[question.type],
      columns: 1,
      doc: {
        type: 'doc',
        content:
          question.type === 'matching'
            ? [...stem, importedMatching(question, createId, answers)]
            : question.type === 'multipart'
              ? [...stem, importedParts(question.parts ?? [], createId, answers)]
              : question.choices
              ? [
                  ...stem,
                  {
                    type: 'multipleChoice',
                    content: question.choices.map((choice) => {
                      const id = createId()
                      answers.set(choice.id, id)
                      return {
                        type: 'multipleChoiceChoice',
                        attrs: {
                          id,
                          correct: choice.correct,
                          ...(question.type === 'multiple-choice' ? lockAttrOf(choice) : {}),
                        },
                        content: recordDocumentToEditorNodes(choice.content),
                      }
                    }),
                  },
                ]
              : stem,
      },
      ...(question.difficulty ? { difficulty: question.difficulty } : {}),
      ...(question.topics ? { topics: [...question.topics] } : {}),
      ...(question.points !== undefined && question.type !== 'multipart' ? { points: question.points } : {}),
      ...(question.suggestedAnswer
        ? {
            suggestedAnswer: {
              type: 'doc',
              content: recordDocumentToEditorNodes(question.suggestedAnswer),
            },
          }
        : {}),
    }
    imported.set(question.id, { question: local, answers })
  }
  return imported
}

/** Map a validated portable record into fresh local authoring identities. */
export function importedQuestionsFromRecord(
  record: Pick<ParsedRecord, 'bank'>,
  createId: () => string = () => crypto.randomUUID(),
): Question[] {
  return [...importedQuestionIdentities(record, createId).values()].map(
    ({ question }) => question,
  )
}

type Parser = (value: unknown) => DeclaredRecord

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validate010 = ajv.compile(questionBankSchema010)
const validate020 = ajv.compile(questionBankSchema020)
const validate030 = ajv.compile(questionBankSchema030)
const validate040 = ajv.compile(questionBankSchema040)
const validate050 = ajv.compile(questionBankSchema050)
const validate060 = ajv.compile(questionBankSchema060)
const validate070 = ajv.compile(questionBankSchema070)
const validate080 = ajv.compile(questionBankSchema080)
const validate090 = ajv.compile(questionBankSchema090)
const validate0100 = ajv.compile(questionBankSchema0100)

function schemaMessage(errors: ErrorObject[] | null | undefined): string {
  const first = errors?.[0]
  return first
    ? `Question Bank Record schema validation failed at ${first.instancePath || '/'}: ${first.message}.`
    : 'Question Bank Record schema validation failed.'
}

/** How one record's nodes are read: whether its `authoredSize` is Record
 *  0.7.0's share of the container or an older record's legacy ratio, and the
 *  pixel size of each Media Asset it declares, which a crop carries into the
 *  editor. */
type CopyContext = {
  currentSize: boolean
  crops: boolean
  /** Whether the record's choices may say they are locked; an older record
   *  that carries `locked` carries an unknown optional field, ignored. */
  locks: boolean
  /** Whether the record's Parts may hold Subparts; an older record's Part that
   *  carries `subparts` carries an unknown optional field, ignored, and is
   *  read as the Part its `type` says. */
  subparts: boolean
  /** Whether the record may carry Points; an older record's `points`, if it
   *  carries any, is an unknown optional field, ignored, and every Question
   *  it holds is read as unpointed (ADR-0042). */
  points: boolean
  /** Whether the record's paragraphs, block images and tables may be
   *  centred, added in 0.9.0; an older record's `align` is ignored and its
   *  blocks are read as left. */
  aligns: boolean
  media: ReadonlyMap<string, { width: number; height: number }>
}

/** The versions whose `authoredSize` is a share of the picture's container,
 *  and which know the Picture Crop — both added in 0.7.0. */
const SHARE_SIZE_VERSIONS: ReadonlySet<string> = new Set(['0.7.0', '0.8.0', '0.9.0', '0.10.0'])

/** The versions that know the Locked Answer, added in 0.9.0. */
const LOCKED_ANSWER_VERSIONS: ReadonlySet<string> = new Set(['0.9.0', '0.10.0'])

/** The versions that let a Part hold Subparts, added in 0.9.0. */
const SUBPART_VERSIONS: ReadonlySet<string> = new Set(['0.9.0', '0.10.0'])

/** The versions that know Points, added in 0.9.0. */
const POINTS_VERSIONS: ReadonlySet<string> = new Set(['0.9.0', '0.10.0'])

/** The versions that know a Centred block, added in 0.9.0. */
const ALIGN_VERSIONS: ReadonlySet<string> = new Set(['0.9.0', '0.10.0'])

/** The versions that know Fill in the Blank and its Blanks, added in 0.10.0. */
const BLANK_VERSIONS: ReadonlySet<string> = new Set(['0.10.0'])

/** The record nodes that may be centred. */
const CENTRABLE_RECORD_NODES: ReadonlySet<string> = new Set(['paragraph', 'block-image', 'table'])

function copyPicture(node: SemanticNode, context: CopyContext): Partial<SemanticNode> {
  const size =
    node.authoredSize === undefined
      ? {}
      : context.currentSize
        ? { authoredSize: node.authoredSize }
        : { legacyRatio: node.authoredSize }
  if (!context.crops || node.crop === undefined) return size
  const { left, top, right, bottom } = node.crop
  const pictureSize = node.asset !== undefined ? context.media.get(node.asset) : undefined
  return {
    ...size,
    crop: { left, top, right, bottom },
    ...(pictureSize ? { pictureSize: { width: pictureSize.width, height: pictureSize.height } } : {}),
  }
}

/** `centred` says whether the node may be centred where it stands: never in
 *  a list item, nor in an answer, an Item or a Word Bank answer, which open
 *  with their own marker or letter. */
function copyNode(node: SemanticNode, context: CopyContext, centred = context.aligns): SemanticNode {
  return {
    type: node.type,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.content
      ? { content: node.content.map((child) => copyNode(child, context, centred && node.type !== 'list-item')) }
      : {}),
    ...(centred && node.align === 'center' && CENTRABLE_RECORD_NODES.has(node.type) ? { align: 'center' as const } : {}),
    ...(node.marks
      ? {
          marks: node.marks.map((mark) =>
            mark.type === 'link'
              ? {
                  type: 'link' as const,
                  href: mark.href,
                  ...(mark.title !== undefined ? { title: mark.title } : {}),
                }
              : { type: mark.type },
          ),
        }
      : {}),
    ...(node.level !== undefined ? { level: node.level } : {}),
    ...(node.start !== undefined ? { start: node.start } : {}),
    ...(node.language !== undefined ? { language: node.language } : {}),
    ...(node.source !== undefined ? { source: node.source } : {}),
    ...(node.header !== undefined ? { header: node.header } : {}),
    ...(node.asset !== undefined ? { asset: node.asset } : {}),
    ...(node.pending !== undefined ? { pending: { ...node.pending } } : {}),
    ...(node.alt !== undefined ? { alt: node.alt } : {}),
    ...(node.caption !== undefined ? { caption: node.caption } : {}),
    ...(node.type === 'inline-image' || node.type === 'block-image' ? copyPicture(node, context) : {}),
  }
}

function copyQuestion(question: QuestionBankRecordQuestion, context: CopyContext): QuestionBankRecordQuestion {
  const copyDocument = (document: SemanticDocument, centred = context.aligns): SemanticDocument => ({
    type: 'document',
    content: document.content.map((node) => copyNode(node, context, centred)),
  })
  const copyChoice = (choice: QuestionBankRecordChoice): QuestionBankRecordChoice => ({
    id: choice.id,
    content: copyDocument(choice.content, false),
    correct: choice.correct,
    ...(context.locks && choice.locked !== undefined ? { locked: choice.locked } : {}),
  })
  const copyAnsweringPart = (part: QuestionBankRecordAnsweringPart): QuestionBankRecordAnsweringPart => ({
    id: part.id,
    type: part.type,
    stem: copyDocument(part.stem),
    ...(part.choices !== undefined
      ? { choices: part.choices.map(copyChoice) }
      : {}),
    ...(part.suggestedAnswer !== undefined
      ? { suggestedAnswer: copyDocument(part.suggestedAnswer) }
      : {}),
    ...(context.points && part.points !== undefined ? { points: part.points } : {}),
  })
  return {
    id: question.id,
    type: question.type,
    stem: copyDocument(question.stem),
    ...(question.difficulty !== undefined ? { difficulty: question.difficulty } : {}),
    ...(question.topics !== undefined ? { topics: [...question.topics] } : {}),
    ...(context.points && question.points !== undefined ? { points: question.points } : {}),
    ...(question.choices !== undefined
      ? { choices: question.choices.map(copyChoice) }
      : {}),
    ...(question.prompts !== undefined
      ? {
          prompts: question.prompts.map((prompt) => ({
            id: prompt.id,
            content: copyDocument(prompt.content, false),
            ...(prompt.answer !== undefined ? { answer: prompt.answer } : {}),
          })),
        }
      : {}),
    ...(question.wordBank !== undefined
      ? {
          wordBank: question.wordBank.map((answer) => ({
            id: answer.id,
            content: copyDocument(answer.content, false),
          })),
        }
      : {}),
    ...(question.parts !== undefined
      ? {
          parts: question.parts.map((part): QuestionBankRecordPart =>
            context.subparts && holdsSubparts(part)
              ? {
                  id: part.id,
                  stem: copyDocument(part.stem),
                  subparts: part.subparts.map(copyAnsweringPart),
                }
              : copyAnsweringPart(part as QuestionBankRecordAnsweringPart)),
        }
      : {}),
    ...(question.suggestedAnswer !== undefined
      ? { suggestedAnswer: copyDocument(question.suggestedAnswer) }
      : {}),
  }
}

type SchemaValidator = (value: unknown) => boolean

function valueAt(value: unknown, pointer: string): unknown {
  return pointer
    .split('/')
    .filter(Boolean)
    .reduce<unknown>((current, part) =>
      typeof current === 'object' && current !== null
        ? (current as Record<string, unknown>)[part]
        : undefined, value)
}

const isTypedObject = (value: unknown): value is { type: string } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) &&
  typeof (value as { type?: unknown }).type === 'string'

/**
 * Content written under a member no node has — a table an assistant nested
 * in a paragraph's `table` instead of placing beside it — is not an optional
 * field to ignore: dropping it would discard Question Content without a word.
 * Only `content` holds child nodes, and only a mark list holds marks.
 */
function misplacedContent(value: unknown): string | undefined {
  const questions = valueAt(value, 'bank/questions')
  if (!Array.isArray(questions)) return undefined
  for (const question of questions) {
    const id = typeof question?.id === 'string' ? question.id : undefined
    let found: string | undefined
    const visitNode = (node: unknown) => {
      if (found || !isTypedObject(node)) return
      for (const [key, member] of Object.entries(node)) {
        if (key === 'content') {
          if (Array.isArray(member)) member.forEach(visitNode)
          continue
        }
        if (key === 'marks') continue
        const nested = Array.isArray(member) ? member.find(isTypedObject) : isTypedObject(member) ? member : undefined
        if (nested) {
          found = `${id ? `Question “${id}”` : 'A Question'} has a ${nested.type} inside a ${node.type}’s “${key}” member, where it cannot be read. ` +
            `Put the ${nested.type} in the “content” list beside the ${node.type}, as a block of its own.`
          return
        }
      }
    }
    // Every document a Question holds — stem, answers, Items, Word Bank,
    // Parts, Suggested Answer — wherever it sits in the Question.
    const visitQuestion = (part: unknown) => {
      if (found || typeof part !== 'object' || part === null) return
      if (isTypedObject(part) && part.type === 'document') return visitNode(part)
      Object.values(part).forEach(visitQuestion)
    }
    visitQuestion(question)
    if (found) return found
  }
  return undefined
}

/** The versions that know the Pending Image, added in 0.5.0. */
const PENDING_IMAGE_VERSIONS: ReadonlySet<string> = new Set(['0.5.0', '0.6.0', '0.7.0', '0.8.0', '0.9.0', '0.10.0'])

/** The versions that know the Side-by-Side, added in 0.6.0. */
const SIDE_BY_SIDE_VERSIONS: ReadonlySet<string> = new Set(['0.6.0', '0.7.0', '0.8.0', '0.9.0', '0.10.0'])

/** Where a Side-by-Side may stand: a top-level block of a Question's stem or
 *  of a Multipart Part's stem, and nowhere else. */
const STEM_BLOCK = /^bank\/questions\/\d+\/(?:parts\/\d+\/)?stem\/content\/\d+$/

const isSideBySideNode = (node: unknown): node is { type: 'side-by-side' | 'panel'; content?: unknown } =>
  typeof node === 'object' &&
  node !== null &&
  ((node as { type?: unknown }).type === 'side-by-side' || (node as { type?: unknown }).type === 'panel')

/** What is wrong with the Side-by-Side a schema failure at `pointer` passes
 *  through, if that is what failed. */
function sideBySideProblem(value: unknown, pointer: string, sourceVersion: string): string | undefined {
  const segments = pointer.split('/').filter(Boolean)
  const trail: { path: string; node: { type: 'side-by-side' | 'panel'; content?: unknown } }[] = []
  let current = value
  for (const [index, segment] of segments.entries()) {
    current =
      typeof current === 'object' && current !== null
        ? (current as Record<string, unknown>)[segment]
        : undefined
    if (isSideBySideNode(current)) trail.push({ path: segments.slice(0, index + 1).join('/'), node: current })
  }
  const [outer, ...within] = trail
  if (!outer) return undefined
  if (!SIDE_BY_SIDE_VERSIONS.has(sourceVersion))
    return `Side-by-Sides need Question Bank Record 0.6.0 or later; this record declares ${sourceVersion}.`
  if (outer.node.type === 'panel') return 'A Panel may appear only inside a Side-by-Side.'
  if (!STEM_BLOCK.test(outer.path))
    return 'A Side-by-Side may appear only as a top-level block of a Question’s or a Part’s stem — not in an answer, a matching item, a Word Bank answer or a Suggested Answer, and not inside a blockquote, a list, a table or a Panel.'
  const panels = outer.node.content
  if (!Array.isArray(panels) || panels.length < 2 || panels.length > 3)
    return `A Side-by-Side must hold two or three Panels; this one holds ${Array.isArray(panels) ? panels.length : 'none'}.`
  if (panels.some((panel) => (panel as { type?: unknown } | null)?.type !== 'panel'))
    return 'A Side-by-Side may hold only Panels.'
  if (within.some(({ node }) => node.type === 'side-by-side'))
    return 'A Side-by-Side cannot be placed inside a Panel of another Side-by-Side.'
  if (panels.some((panel) => !Array.isArray((panel as { content?: unknown }).content) || (panel as { content: unknown[] }).content.length === 0))
    return 'A Panel must hold at least one block.'
  return undefined
}

/**
 * A misplaced or malformed Side-by-Side is lifted out of the generic
 * structural failure for the reason a malformed Pending Image is: an
 * assistant converting a test is likely to put one where the format does not
 * allow it, and the message should say where it may go rather than name a
 * JSON pointer. It stays a structural failure — the schema is what forbids it.
 */
function malformedSideBySide(
  errors: ErrorObject[] | null | undefined,
  value: unknown,
  sourceVersion: string,
): QuestionBankImportError | undefined {
  for (const error of errors ?? []) {
    const problem = sideBySideProblem(value, error.instancePath, sourceVersion)
    if (problem) return new QuestionBankImportError('invalid-structure', problem)
  }
  return undefined
}

/** What is wrong with the Picture Crop of an image node, if anything the
 *  schema can see. Its order within the kept part is checked with the
 *  record's semantics, since a schema cannot compare two numbers. */
function cropProblem(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null || !('crop' in node)) return undefined
  const { type, crop, pending } = node as { type?: unknown; crop?: unknown; pending?: unknown }
  if (type === 'inline-image') return 'A Picture Crop belongs only to a block image; an inline image cannot carry one.'
  if (type !== 'block-image') return 'Only a block image may carry a Picture Crop.'
  if (pending !== undefined)
    return 'A Pending Image cannot carry a Picture Crop: crop the picture once Resolve Images has given it a Media Asset.'
  const sides = ['left', 'top', 'right', 'bottom']
  if (
    typeof crop !== 'object' ||
    crop === null ||
    Object.keys(crop).some((key) => !sides.includes(key)) ||
    sides.some((side) => {
      const value = (crop as Record<string, unknown>)[side]
      return typeof value !== 'number' || value < 0 || value > 1
    })
  )
    return 'A Picture Crop must give exactly `left`, `top`, `right` and `bottom`, each a number from 0 to 1.'
  return undefined
}

/**
 * A malformed Picture Crop is lifted out of the generic structural failure,
 * as a malformed Pending Image is: the message should say what a crop may be
 * and where it may go rather than name a JSON pointer.
 */
function malformedCrop(
  errors: ErrorObject[] | null | undefined,
  value: unknown,
  sourceVersion: string,
): QuestionBankImportError | undefined {
  if (!SHARE_SIZE_VERSIONS.has(sourceVersion)) return undefined
  for (const error of errors ?? []) {
    const path = error.instancePath.replace(/\/crop(?:\/.*)?$/, '')
    for (const candidate of [path, path.replace(/\/[^/]*$/, '')]) {
      const problem = cropProblem(valueAt(value, candidate))
      if (problem) return new QuestionBankImportError('invalid-question', problem)
    }
  }
  return undefined
}

/**
 * A malformed Pending Image is lifted out of the generic structural failure,
 * as an unsafe link is: it is the mistake an assistant converting a test is
 * most likely to make, and the message should say what a Pending Image is
 * rather than name a JSON pointer. One that names nothing is a reference to
 * nothing; any other malformation makes its Question invalid.
 */
function malformedPendingImage(
  errors: ErrorObject[] | null | undefined,
  value: unknown,
  sourceVersion: string,
): QuestionBankImportError | undefined {
  for (const error of errors ?? []) {
    const path = error.instancePath.replace(/\/pending(?:\/.*)?$/, '')
    const node = valueAt(value, path)
    if (typeof node !== 'object' || node === null || !('pending' in node)) continue
    const { type, pending, asset } = node as { type?: unknown; pending?: unknown; asset?: unknown }
    if (type !== 'inline-image' && type !== 'block-image') continue
    if (!PENDING_IMAGE_VERSIONS.has(sourceVersion)) {
      return new QuestionBankImportError(
        'invalid-question',
        `Pending Images need Question Bank Record 0.5.0 or later; this record declares ${sourceVersion}.`,
      )
    }
    if (typeof pending === 'object' && pending !== null && Object.keys(pending).length === 0) {
      return new QuestionBankImportError(
        'dangling-reference',
        'A Pending Image names neither an Image Tag nor a page.',
      )
    }
    return new QuestionBankImportError(
      'invalid-question',
      asset !== undefined
        ? 'An image carries both a Media Asset and a Pending Image; it may carry only one.'
        : 'A Pending Image must name exactly one positive whole-number `image` tag or `page`, and nothing else.',
    )
  }
  return undefined
}

/**
 * Structural validation against one version's schema, then the same copy into
 * the parsed shape. Versions differ in what their schema admits, not in how a
 * conforming record is read, so both parsers share this and each supplies its
 * own validator.
 *
 * The unsafe-link case is lifted out of the generic structural failure because
 * a bad `href` is the one schema violation a teacher can act on: it names the
 * link rather than a JSON pointer.
 */
/** Why a Part that holds Subparts cannot stand, in a teacher's words. */
function subpartsAndAnswers(where: string): string {
  return `${where} holds Subparts, so it cannot also have a type, choices, a Suggested Answer or Points of its own; each Subpart carries its own.`
}

/** A Part of a record that knows Subparts which holds them and answers too —
 *  named before the schema would, since its message could only say that the
 *  Part matched neither shape. */
function partWithSubpartsAndAnswers(value: unknown, sourceVersion: string): string | undefined {
  if (!SUBPART_VERSIONS.has(sourceVersion)) return undefined
  const questions = valueAt(value, '/bank/questions')
  if (!Array.isArray(questions)) return undefined
  for (const question of questions) {
    const parts = (question as { parts?: unknown } | null)?.parts
    if (!Array.isArray(parts)) continue
    for (const [partIndex, part] of parts.entries()) {
      if (typeof part !== 'object' || part === null || !('subparts' in part)) continue
      if ('type' in part || 'choices' in part || 'suggestedAnswer' in part || 'points' in part) {
        const id = String((part as { id?: unknown }).id ?? '')
        const questionId = String((question as { id?: unknown }).id ?? '')
        return subpartsAndAnswers(`Part ${partLetter(partIndex)} (“${id}”) of Multipart Question “${questionId}”`)
      }
    }
  }
  return undefined
}

/** A Multipart Question of a record that knows Points which carries Points of
 *  its own — named before the schema would, since a Multipart question's
 *  worth is always its Parts' sum and a teacher can move the number there. */
function multipartWithPoints(value: unknown, sourceVersion: string): string | undefined {
  if (!POINTS_VERSIONS.has(sourceVersion)) return undefined
  const questions = valueAt(value, '/bank/questions')
  if (!Array.isArray(questions)) return undefined
  for (const question of questions) {
    if (typeof question !== 'object' || question === null) continue
    const { type, id } = question as { type?: unknown; id?: unknown }
    if (type === 'multipart' && 'points' in question) {
      return `Multipart Question “${String(id ?? '')}” is worth what its Parts and Subparts are, so it cannot have Points of its own; give them to its Parts and Subparts.`
    }
  }
  return undefined
}

/** The record nodes whose inline content a Blank may stand among. */
const BLANK_HOSTS: ReadonlySet<string> = new Set(['paragraph', 'heading'])

/**
 * A Blank that stands where the format does not allow it, named before the
 * schema would: an assistant converting a test is likely to put one in an
 * answer, or in another type's stem, and the message should say where a Blank
 * may go rather than name a JSON pointer (ADR-0049). A Blank belongs only
 * among the text of a paragraph or heading of a Fill in the Blank Question's
 * stem, holds only text and inline mathematics, and never holds another.
 */
function misplacedBlank(value: unknown, sourceVersion: string): string | undefined {
  const questions = valueAt(value, 'bank/questions')
  if (!Array.isArray(questions)) return undefined
  for (const question of questions) {
    if (typeof question !== 'object' || question === null) continue
    const { id, type, stem } = question as { id?: unknown; type?: unknown; stem?: unknown }
    const named = typeof id === 'string' ? `Question “${id}”` : 'A Question'
    let found: string | undefined
    const visit = (node: unknown, parent: string | undefined, inStem: boolean) => {
      if (found || !isTypedObject(node)) return
      const content = (node as { content?: unknown }).content
      if (node.type === SUPPORTED_BLANK_NODE_TYPE) {
        if (!BLANK_VERSIONS.has(sourceVersion)) {
          found = `Blanks need Question Bank Record 0.10.0 or later; this record declares ${sourceVersion}.`
        } else if (parent === SUPPORTED_BLANK_NODE_TYPE) {
          found = `${named} has a Blank inside another Blank. A Blank’s answer holds only text and inline mathematics.`
        } else if (!inStem) {
          found = `${named} has a Blank outside the stem of a Fill in the Blank Question. A Blank may appear only there — not in another type’s stem, an answer, a matching item, a Word Bank answer, a Part or a Suggested Answer.`
        } else if (parent === undefined || !BLANK_HOSTS.has(parent)) {
          found = `${named} has a Blank that stands as a block of its own. A Blank stands among the text of a paragraph or heading of its stem.`
        } else if (
          Array.isArray(content) &&
          content.some((child) => isTypedObject(child) && child.type !== SUPPORTED_BLANK_NODE_TYPE &&
            !(SUPPORTED_BLANK_CONTENT_TYPES as readonly string[]).includes(child.type))
        ) {
          found = `${named} has a Blank whose answer holds something other than text and inline mathematics.`
        }
      }
      if (Array.isArray(content)) content.forEach((child) => visit(child, node.type, inStem))
    }
    // Every document the Question holds — stem, answers, Items, Word Bank,
    // Parts, Suggested Answer — wherever it sits in the Question.
    const visitQuestion = (part: unknown) => {
      if (found || typeof part !== 'object' || part === null) return
      if (isTypedObject(part) && part.type === 'document') {
        const inStem = part === stem && type === 'fill-in-the-blank'
        const blocks = (part as { content?: unknown }).content
        if (Array.isArray(blocks)) blocks.forEach((block) => visit(block, undefined, inStem))
        return
      }
      Object.values(part).forEach(visitQuestion)
    }
    visitQuestion(question)
    if (found) return found
  }
  return undefined
}

function parseWith(
  validate: SchemaValidator & { errors?: ErrorObject[] | null },
  sourceVersion: string,
  value: unknown,
): DeclaredRecord {
  const misplaced = misplacedContent(value)
  if (misplaced) throw new QuestionBankImportError('invalid-question', misplaced)
  const blank = misplacedBlank(value, sourceVersion)
  if (blank) throw new QuestionBankImportError('invalid-structure', blank)
  const doubled = partWithSubpartsAndAnswers(value, sourceVersion)
  if (doubled) throw new QuestionBankImportError('invalid-question', doubled)
  const summed = multipartWithPoints(value, sourceVersion)
  if (summed) throw new QuestionBankImportError('invalid-question', summed)
  if (!validate(value)) {
    const unsafeLink = validate.errors?.find(
      (error) =>
        error.keyword === 'pattern' &&
        error.instancePath.endsWith('/href'),
    )
    if (unsafeLink) {
      const href = valueAt(value, unsafeLink.instancePath)
      throw new QuestionBankImportError(
        'unsafe-url',
        `The link “${String(href)}” is unsafe. Question Bank links must use absolute HTTP or HTTPS URLs.`,
      )
    }
    const cropError = malformedCrop(validate.errors, value, sourceVersion)
    if (cropError) throw cropError
    const pendingError = malformedPendingImage(validate.errors, value, sourceVersion)
    if (pendingError) throw pendingError
    const sideBySideError = malformedSideBySide(validate.errors, value, sourceVersion)
    if (sideBySideError) throw sideBySideError
    throw new QuestionBankImportError(
      'invalid-structure',
      schemaMessage(validate.errors),
    )
  }
  const record = value as Omit<QuestionBankRecord, 'media'> & {
    bank: ParsedRecord['bank']
    media: DeclaredMediaAsset[]
  }
  return {
    format: QUESTION_BANK_FORMAT,
    formatVersion: QUESTION_BANK_FORMAT_VERSION,
    sourceVersion,
    generator: {
      name: record.generator.name,
      version: record.generator.version,
    },
    requiredFeatures: [...record.requiredFeatures],
    bank: {
      name: record.bank.name,
      ...(record.bank.description !== undefined
        ? { description: record.bank.description }
        : {}),
      ...(record.bank.author !== undefined ? { author: record.bank.author } : {}),
      ...(record.bank.license !== undefined
        ? {
            license: {
              name: record.bank.license.name,
              ...(record.bank.license.url !== undefined
                ? { url: record.bank.license.url }
                : {}),
            },
          }
        : {}),
      questions: record.bank.questions.map((question) =>
        copyQuestion(question, {
          currentSize: SHARE_SIZE_VERSIONS.has(sourceVersion),
          crops: SHARE_SIZE_VERSIONS.has(sourceVersion),
          locks: LOCKED_ANSWER_VERSIONS.has(sourceVersion),
          subparts: SUBPART_VERSIONS.has(sourceVersion),
          points: POINTS_VERSIONS.has(sourceVersion),
          aligns: ALIGN_VERSIONS.has(sourceVersion),
          media: new Map(record.media.map((asset) => [asset.id, asset])),
        }),
      ),
    },
    media: record.media.map((asset) => ({
      id: asset.id,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      ...('file' in asset ? { file: asset.file } : { bytes: asset.bytes }),
    })),
  }
}

/**
 * Every retained version migrates forward. 0.2.0 added `true-false` to 0.1.0,
 * 0.3.0 added `matching` to 0.2.0, 0.4.0 added `multipart` to 0.3.0, 0.5.0
 * added Pending Images to 0.4.0, 0.6.0 added the Side-by-Side to 0.5.0, and
 * 0.7.0 added the Picture Crop to 0.6.0; none can appear in an older record.
 * 0.8.0 changed only how a Media Asset's bytes travel: it names a file in the
 * package's zip where 0.1.0–0.7.0 carry base64 (ADR-0036). 0.9.0 added a
 * choice's optional `locked` (ADR-0038); a choice of an older record has none,
 * and is locked by its wording once imported, as an undecided one is. 0.9.0
 * also let a Part hold `subparts` (ADR-0043); an older record's Parts all answer.
 * 0.10.0 added `fill-in-the-blank` and its Blanks (ADR-0049), which no older
 * record can carry.
 * 0.7.0 is the one version that changed something an older record already
 * says: its `authoredSize` is a share of the picture's container, where
 * 0.1.0–0.6.0's was Crepe's ratio against the size the picture fit at. An
 * older record's is therefore read as that legacy ratio (`legacyRatio`, which
 * no record carries), and otherwise a record that satisfies an older schema
 * is a conforming 0.7.0 record once its version is restated.
 */
const parser010: Parser = (value) => parseWith(validate010, '0.1.0', value)

const parser020: Parser = (value) => parseWith(validate020, '0.2.0', value)

const parser030: Parser = (value) => parseWith(validate030, '0.3.0', value)

const parser040: Parser = (value) => parseWith(validate040, '0.4.0', value)

const parser050: Parser = (value) => parseWith(validate050, '0.5.0', value)

const parser060: Parser = (value) => parseWith(validate060, '0.6.0', value)

const parser070: Parser = (value) => parseWith(validate070, '0.7.0', value)

const parser080: Parser = (value) => parseWith(validate080, '0.8.0', value)

const parser090: Parser = (value) => parseWith(validate090, '0.9.0', value)

const parser0100: Parser = (value) => parseWith(validate0100, '0.10.0', value)

/** Exact versions only: adding compatibility requires adding an explicit parser or migration. */
export const SUPPORTED_QUESTION_BANK_VERSIONS: Readonly<Record<string, Parser>> =
  Object.freeze({
    '0.1.0': parser010,
    '0.2.0': parser020,
    '0.3.0': parser030,
    '0.4.0': parser040,
    '0.5.0': parser050,
    '0.6.0': parser060,
    '0.7.0': parser070,
    '0.8.0': parser080,
    '0.9.0': parser090,
    '0.10.0': parser0100,
  })

const utf8 = new TextDecoder('utf-8', { fatal: true })

export function decodeRecordJson(bytes: Uint8Array): unknown {
  let source: string
  try {
    source = utf8.decode(bytes)
  } catch {
    throw new QuestionBankImportError(
      'invalid-json',
      'The canonical attachment is not valid UTF-8 JSON.',
    )
  }
  try {
    return JSON.parse(source)
  } catch {
    throw new QuestionBankImportError(
      'invalid-json',
      'The canonical attachment contains invalid JSON.',
    )
  }
}

function requiredString(object: unknown, key: string): string | undefined {
  if (typeof object !== 'object' || object === null) return undefined
  const value = (object as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function structuralParse(value: unknown): DeclaredRecord {
  const format = requiredString(value, 'format')
  if (format !== QUESTION_BANK_FORMAT) {
    throw new QuestionBankImportError(
      'unsupported-format',
      `The attachment format “${format ?? 'missing'}” is not ${QUESTION_BANK_FORMAT}.`,
    )
  }
  const version = requiredString(value, 'formatVersion') ?? 'missing'
  const parser = SUPPORTED_QUESTION_BANK_VERSIONS[version]
  if (!parser) {
    throw new QuestionBankImportError(
      'unsupported-version',
      `Question Bank format version “${version}” is unsupported. Supported versions: ${Object.keys(SUPPORTED_QUESTION_BANK_VERSIONS).join(', ')}.`,
    )
  }
  return parser(value)
}

function byteHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}


const SAFE_PROTOCOLS = new Set(['http:', 'https:'])

function assertSafeUrl(value: string): void {
  try {
    if (SAFE_PROTOCOLS.has(new URL(value).protocol)) return
  } catch {
    // Fall through to the one actionable policy error.
  }
  throw new QuestionBankImportError(
    'unsafe-url',
    `The link “${value}” is unsafe. Question Bank links must use absolute HTTP or HTTPS URLs.`,
  )
}

type DocumentStats = {
  count: number
  pendingImages: number
  depth: number
  mediaReferences: Set<string>
  externalLinks: boolean
}

/** Whether a document holds a Blank anywhere. */
function holdsBlank(document: SemanticDocument): boolean {
  const visit = (node: SemanticNode): boolean =>
    node.type === SUPPORTED_BLANK_NODE_TYPE || (node.content ?? []).some(visit)
  return document.content.some(visit)
}

function inspectDocument(document: SemanticDocument): DocumentStats {
  let count = 0
  let depth = 0
  let pendingImages = 0
  let externalLinks = false
  const mediaReferences = new Set<string>()
  const visit = (node: SemanticNode, atDepth: number) => {
    count += 1
    depth = Math.max(depth, atDepth)
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link') {
        assertSafeUrl(mark.href)
        externalLinks = true
      }
    }
    if (node.type === 'inline-image' || node.type === 'block-image') {
      if (node.pending !== undefined) {
        pendingImages += 1
        return
      }
      const reference = node.asset
      if (typeof reference !== 'string') {
        throw new QuestionBankImportError(
          'dangling-reference',
          'An image node is missing its Media Asset reference.',
        )
      }
      mediaReferences.add(reference)
      if (node.crop && (node.crop.left >= node.crop.right || node.crop.top >= node.crop.bottom)) {
        throw new QuestionBankImportError(
          'invalid-question',
          'A Picture Crop must keep part of its picture: `left` must be less than `right`, and `top` less than `bottom`.',
        )
      }
    }
    for (const child of node.content ?? []) visit(child, atDepth + 1)
  }
  for (const node of document.content) visit(node, 1)
  return { count, depth, pendingImages, mediaReferences, externalLinks }
}

function validatedBase64Size(value: string): number {
  if (
    value.length % 4 !== 0 ||
    // One flat character class, never a repeated group: a group repeated over
    // a photo's millions of characters overflows V8's regex stack.
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new QuestionBankImportError(
      'invalid-media',
      'A Media Asset contains malformed base64 bytes.',
    )
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new QuestionBankImportError(
      'invalid-media',
      'A Media Asset contains malformed base64 bytes.',
    )
  }
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte))
    return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]!
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      }
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...bytes.slice(at, at + length))
  if (bytes.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP')
    return null
  const kind = ascii(12, 4)
  if (kind === 'VP8X') {
    return {
      width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
      height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16),
    }
  }
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const bits =
      bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
      height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff,
    }
  }
  return null
}

export function mediaDimensions(
  mimeType: ParsedMediaAsset['mimeType'],
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (mimeType === 'image/png') return pngDimensions(bytes)
  if (mimeType === 'image/jpeg') {
    // Declared upright, as a browser measures it: orientations 5–8 store a
    // camera's pixels a quarter turn from how they are seen.
    const stored = jpegDimensions(bytes)
    return stored && jpegOrientation(bytes) >= 5
      ? { width: stored.height, height: stored.width }
      : stored
  }
  return webpDimensions(bytes)
}

async function validateSemantics(
  record: DeclaredRecord,
  limits: QuestionBankImportLimits,
  files: PackageFiles | undefined,
): Promise<{ summary: QuestionBankImportProposal['summary']; media: ParsedMediaAsset[] }> {
  if (record.requiredFeatures.length > 0) {
    throw new QuestionBankImportError(
      'unsupported-feature',
      `Unsupported required feature: ${record.requiredFeatures.join(', ')}.`,
    )
  }
  if (record.bank.questions.length > limits.questions) {
    throw new QuestionBankImportError(
      'question-count-limit',
      `This record contains more than the ${limits.questions} Question limit.`,
    )
  }
  if (record.media.length > limits.mediaAssets) {
    throw new QuestionBankImportError(
      'media-count-limit',
      `This record contains more than the ${limits.mediaAssets} Media Asset limit.`,
    )
  }

  const ids = new Set<string>()
  const references = new Set<string>()
  const topics = new Set<string>()
  let questionsWithoutCorrectAnswer = 0
  let pendingImages = 0
  let externalLinks = false
  const counts: Record<QuestionBankRecordQuestionType, number> = {
    'multiple-choice': 0,
    'true-false': 0,
    matching: 0,
    'fill-in-the-blank': 0,
    'short-answer': 0,
    multipart: 0,
  }

  for (const question of record.bank.questions) {
    if (ids.has(question.id)) {
      throw new QuestionBankImportError(
        'duplicate-id',
        `Package-local ID “${question.id}” is duplicated.`,
      )
    }
    ids.add(question.id)
    counts[question.type] += 1
    for (const topic of question.topics ?? []) topics.add(topic)

    if (question.type !== 'matching' && (question.prompts !== undefined || question.wordBank !== undefined)) {
      throw new QuestionBankImportError(
        'invalid-question',
        `${RECORD_TYPE_LABELS[question.type]} Question “${question.id}” cannot contain matching items or a Word Bank.`,
      )
    }
    if (question.type !== 'multipart' && question.parts !== undefined) {
      throw new QuestionBankImportError(
        'invalid-question',
        `${RECORD_TYPE_LABELS[question.type]} Question “${question.id}” cannot contain Multipart Parts.`,
      )
    }
    if (question.type === 'multipart') {
      // The Multipart question answers nothing itself: every answer belongs to a Part,
      // and a Part obeys the rules of the Question Type it is named for. A
      // Multipart question with no Parts, or with a Multiple Choice Part none of whose
      // choices is correct, is incomplete — conforming, but reported.
      if (question.choices !== undefined || question.suggestedAnswer !== undefined) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Multipart Question “${question.id}” cannot contain choices or a Suggested Answer of its own; each Part carries its own.`,
        )
      }
      const parts = question.parts ?? []
      let incomplete = parts.length === 0
      // A Part that holds Subparts answers nothing itself (ADR-0043): each of
      // its Subparts obeys the rules a Part that answers does.
      const answering = parts.flatMap((part, partIndex) => {
        const where = `Part ${partLetter(partIndex)} (“${part.id}”) of Multipart Question “${question.id}”`
        if (!holdsSubparts(part)) return [{ part, where }]
        const answers = part as Partial<QuestionBankRecordAnsweringPart>
        if (answers.type !== undefined || answers.choices !== undefined || answers.suggestedAnswer !== undefined) {
          throw new QuestionBankImportError('invalid-question', subpartsAndAnswers(where))
        }
        if (part.subparts.length === 0) {
          throw new QuestionBankImportError('invalid-question', `${where} must hold at least one Subpart.`)
        }
        return part.subparts.map((subpart, subpartIndex) => ({
          part: subpart,
          where: `Subpart (${subpartLabelAt(subpartIndex)}) (“${subpart.id}”) of ${where}`,
        }))
      })
      answering.forEach(({ part, where }) => {
        const label = RECORD_PART_TYPE_LABELS[part.type]
        if (part.type === 'short-answer') {
          if (part.choices !== undefined) {
            throw new QuestionBankImportError(
              'invalid-question',
              `${where} is ${label} and cannot contain choices.`,
            )
          }
          return
        }
        if (!part.choices || part.choices.length < 2) {
          throw new QuestionBankImportError(
            'invalid-question',
            `${where} is ${label} and must have at least two choices.`,
          )
        }
        const correct = part.choices.filter((choice) => choice.correct).length
        if (correct > 1) {
          throw new QuestionBankImportError(
            'invalid-question',
            `${where} is ${label} and may have at most one correct choice.`,
          )
        }
        if (correct === 0) incomplete = true
        if (part.suggestedAnswer !== undefined) {
          throw new QuestionBankImportError(
            'invalid-question',
            `${where} is ${label} and cannot contain a Suggested Answer.`,
          )
        }
      })
      if (incomplete) questionsWithoutCorrectAnswer += 1
    } else if (question.type === 'fill-in-the-blank') {
      // It answers with the Blanks in its stem, and nothing else. A stem with
      // no Blank is incomplete — conforming, but reported.
      if (question.choices !== undefined || question.suggestedAnswer !== undefined) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Fill in the Blank Question “${question.id}” cannot contain choices or a Suggested Answer; its Blanks hold its answers.`,
        )
      }
      if (!holdsBlank(question.stem)) questionsWithoutCorrectAnswer += 1
    } else if (question.type === 'short-answer') {
      if (question.choices !== undefined) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Short Answer Question “${question.id}” cannot contain choices.`,
        )
      }
    } else if (question.type === 'matching') {
      // A matching set answers by naming: every item's answer must be one of
      // the set's own Word Bank answers. Several items may name the same
      // answer, an answer nobody names is a distractor, and an item that
      // names nothing is unmatched — conforming, but reported.
      if (question.choices !== undefined || question.suggestedAnswer !== undefined) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Matching Question “${question.id}” cannot contain choices or a Suggested Answer.`,
        )
      }
      if (!question.prompts || question.prompts.length < 1) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Matching Question “${question.id}” must have at least one item to match.`,
        )
      }
      if (!question.wordBank || question.wordBank.length < 2) {
        throw new QuestionBankImportError(
          'invalid-question',
          `Matching Question “${question.id}” must have at least two Word Bank answers.`,
        )
      }
      const bankIds = new Set(question.wordBank.map((answer) => answer.id))
      let unmatched = false
      for (const prompt of question.prompts) {
        if (prompt.answer === undefined) {
          unmatched = true
        } else if (!bankIds.has(prompt.answer)) {
          throw new QuestionBankImportError(
            'dangling-reference',
            `Matching item “${prompt.id}” names answer “${prompt.answer}”, which is not in its Word Bank.`,
          )
        }
      }
      if (unmatched) questionsWithoutCorrectAnswer += 1
    } else {
      // Multiple Choice and True/False both answer with choices, and the same
      // three rules govern both: enough answers to choose between, at most one
      // of them correct, and no Suggested Answer — that is what the choices are.
      const label = RECORD_TYPE_LABELS[question.type]
      if (!question.choices || question.choices.length < 2) {
        throw new QuestionBankImportError(
          'invalid-question',
          `${label} Question “${question.id}” must have at least two choices.`,
        )
      }
      if (question.type === 'true-false' && question.choices.length !== 2) {
        throw new QuestionBankImportError(
          'invalid-question',
          `True/False Question “${question.id}” must have exactly two choices.`,
        )
      }
      const correct = question.choices.filter((choice) => choice.correct).length
      if (correct > 1) {
        throw new QuestionBankImportError(
          'invalid-question',
          `${label} Question “${question.id}” may have at most one correct choice.`,
        )
      }
      if (correct === 0) questionsWithoutCorrectAnswer += 1
      if (question.suggestedAnswer !== undefined) {
        throw new QuestionBankImportError(
          'invalid-question',
          `${label} Question “${question.id}” cannot contain a Suggested Answer.`,
        )
      }
    }

    const claimed = (part: { id: string; content: SemanticDocument }) => {
      if (ids.has(part.id)) {
        throw new QuestionBankImportError(
          'duplicate-id',
          `Package-local ID “${part.id}” is duplicated.`,
        )
      }
      ids.add(part.id)
      return part.content
    }
    // A Multipart Part claims its own id, then brings its stem, its choices
    // and its Suggested Answer — or its Subparts, each the same way — under
    // the Question's node and depth limits: the limits bound the whole
    // Question, however it is divided.
    const partDocuments = (part: QuestionBankRecordPart): SemanticDocument[] =>
      holdsSubparts(part)
        ? [claimed({ id: part.id, content: part.stem }), ...part.subparts.flatMap(partDocuments)]
        : [
            claimed({ id: part.id, content: part.stem }),
            ...(part.choices?.map(claimed) ?? []),
            ...(part.suggestedAnswer ? [part.suggestedAnswer] : []),
          ]
    const documents = [
      question.stem,
      ...(question.suggestedAnswer ? [question.suggestedAnswer] : []),
      ...(question.choices?.map(claimed) ?? []),
      ...(question.prompts?.map(claimed) ?? []),
      ...(question.wordBank?.map(claimed) ?? []),
      ...(question.parts?.flatMap(partDocuments) ?? []),
    ]
    let questionNodes = 0
    for (const document of documents) {
      const stats = inspectDocument(document)
      questionNodes += stats.count
      pendingImages += stats.pendingImages
      externalLinks ||= stats.externalLinks
      for (const reference of stats.mediaReferences) references.add(reference)
      if (stats.depth > limits.richTextDepth) {
        throw new QuestionBankImportError(
          'rich-text-depth-limit',
          `Question “${question.id}” exceeds the rich-text nesting depth limit of ${limits.richTextDepth}.`,
        )
      }
    }
    if (questionNodes > limits.questionNodes) {
      throw new QuestionBankImportError(
        'question-node-limit',
        `Question “${question.id}” exceeds the semantic document node limit of ${limits.questionNodes}.`,
      )
    }
  }

  if (record.bank.license?.url) {
    assertSafeUrl(record.bank.license.url)
    externalLinks = true
  }

  let decodedMediaBytes = 0
  const mediaIds = new Set<string>()
  const mediaSizes = new Map<string, number>()
  // Validate declarations and sizes in a cheap pass. No attacker-controlled
  // base64 buffer is allocated until every layered size limit is known to hold.
  for (const asset of record.media) {
    if (mediaIds.has(asset.id)) {
      throw new QuestionBankImportError(
        'duplicate-id',
        `Media Asset declaration “${asset.id}” is duplicated.`,
      )
    }
    mediaIds.add(asset.id)
    if (asset.width > limits.imageWidth || asset.height > limits.imageHeight) {
      throw new QuestionBankImportError(
        'image-dimension-limit',
        `Media Asset “${asset.id}” exceeds the ${limits.imageWidth} by ${limits.imageHeight} pixel limit.`,
      )
    }
    const size = 'file' in asset ? packageFile(asset, files).byteLength : validatedBase64Size(asset.bytes)
    if (size > limits.mediaAssetBytes) {
      throw new QuestionBankImportError(
        'media-asset-size-limit',
        `Media Asset “${asset.id}” exceeds the decoded per-asset limit of ${limits.mediaAssetBytes} bytes.`,
      )
    }
    decodedMediaBytes += size
    if (decodedMediaBytes > limits.totalMediaBytes) {
      throw new QuestionBankImportError(
        'total-media-size-limit',
        `Decoded media exceeds the total limit of ${limits.totalMediaBytes} bytes.`,
      )
    }
    mediaSizes.set(asset.id, size)
  }
  const media: ParsedMediaAsset[] = []
  for (const asset of record.media) {
    const bytes = 'file' in asset ? packageFile(asset, files) : decodeBase64(asset.bytes)
    if (bytes.byteLength !== mediaSizes.get(asset.id)) {
      throw new QuestionBankImportError(
        'invalid-media',
        `Media Asset “${asset.id}” decoded to an unexpected size.`,
      )
    }
    const dimensions = mediaDimensions(asset.mimeType, bytes)
    if (!dimensions) {
      throw new QuestionBankImportError(
        'invalid-media',
        `Media Asset “${asset.id}” does not contain valid ${asset.mimeType} bytes.`,
      )
    }
    if (dimensions.width !== asset.width || dimensions.height !== asset.height) {
      throw new QuestionBankImportError(
        'invalid-media',
        `Media Asset “${asset.id}” decoded dimensions do not match its declaration.`,
      )
    }
    const digest = byteHex(await crypto.subtle.digest('SHA-256', bytes))
    if (asset.id !== `sha256:${digest}`) {
      throw new QuestionBankImportError(
        'invalid-media',
        `Media Asset “${asset.id}” does not match its SHA-256 digest.`,
      )
    }
    media.push({ id: asset.id, mimeType: asset.mimeType, width: asset.width, height: asset.height, bytes })
  }
  for (const reference of references) {
    if (!mediaIds.has(reference)) {
      throw new QuestionBankImportError(
        'dangling-reference',
        `Image reference “${reference}” has no Media Asset declaration.`,
      )
    }
  }
  for (const id of mediaIds) {
    if (!references.has(id)) {
      throw new QuestionBankImportError(
        'invalid-media',
        `Media Asset “${id}” is not referenced by Question Content.`,
      )
    }
  }

  const summary = {
    bankName: record.bank.name,
    questionCounts: counts,
    topics: [...topics].sort((left, right) => left.localeCompare(right)),
    questionsWithoutCorrectAnswer,
    mediaAssets: record.media.length,
    pendingImages,
    decodedMediaBytes,
    externalLinks,
    formatVersion: record.sourceVersion,
  }
  return { summary, media }
}

/** The bytes of the zip file a 0.8.0 or later Media Asset names. A record read
 *  outside its zip has none, so it may declare no Media Asset at all. */
function packageFile(asset: DeclaredMediaAsset & { file: string }, files: PackageFiles | undefined): Uint8Array {
  const bytes = files?.get(asset.file)
  if (!bytes) {
    throw new QuestionBankImportError(
      'missing-media',
      files
        ? `Media Asset “${asset.id}” names “${asset.file}”, which is not in this zip.`
        : 'This file names pictures that travel beside it in a zip. Import the .parrot.zip or the PDF it came in instead.',
    )
  }
  files!.used.add(asset.file)
  return bytes
}

/** One Question Bank Record already decoded from JSON, checked against its
 *  version's schema and every semantic rule and limit. A package inspects each
 *  of its banks through this, so a bank inside a package obeys exactly the
 *  rules a bare one does. */
export async function inspectQuestionBankRecordValue(
  value: unknown,
  limits: QuestionBankImportLimits = DEFAULT_QUESTION_BANK_IMPORT_LIMITS,
  files?: PackageFiles,
): Promise<QuestionBankImportProposal> {
  const declared = structuralParse(value)
  const { summary, media } = await validateSemantics(declared, limits, files)
  return { record: { ...declared, media }, summary }
}

export async function inspectQuestionBankRecord(
  bytes: Uint8Array,
  options: { limits?: QuestionBankImportLimits } = {},
): Promise<QuestionBankImportProposal> {
  const limits = options.limits ?? DEFAULT_QUESTION_BANK_IMPORT_LIMITS
  if (bytes.byteLength > limits.recordBytes) {
    throw new QuestionBankImportError(
      'record-size-limit',
      `The decoded canonical JSON attachment exceeds the ${limits.recordBytes} byte limit.`,
    )
  }
  return inspectQuestionBankRecordValue(decodeRecordJson(bytes), limits)
}

export async function inspectQuestionBankFile(
  bytes: Uint8Array,
  options: { limits?: QuestionBankImportLimits } = {},
): Promise<QuestionBankImportProposal> {
  const limits = options.limits ?? DEFAULT_QUESTION_BANK_IMPORT_LIMITS
  return inspectQuestionBankRecord(await readCanonicalAttachment(bytes, limits), { limits })
}

/** The bytes of the one `pdf-canonical-extraction` attachment a Test Parrot
 *  PDF carries: a package zip (ADR-0036), or, in a PDF made before it, a
 *  Question Bank File's bare Question Bank Record or an Exam PDF's package as
 *  JSON. What those bytes are is for the caller to read. */
export async function readCanonicalAttachment(
  bytes: Uint8Array,
  limits: QuestionBankImportLimits = DEFAULT_QUESTION_BANK_IMPORT_LIMITS,
): Promise<Uint8Array> {
  if (bytes.byteLength > limits.pdfBytes) {
    throw new QuestionBankImportError(
      'pdf-size-limit',
      `The PDF exceeds the ${limits.pdfBytes} byte limit. Choose a smaller Question Bank File.`,
    )
  }
  let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs')
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  } catch {
    throw new QuestionBankImportError(
      'invalid-pdf',
      'The selected file is not a valid PDF.',
    )
  }
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() })
  let reader: Awaited<typeof loadingTask.promise>
  try {
    reader = await loadingTask.promise
  } catch {
    throw new QuestionBankImportError(
      'invalid-pdf',
      'The selected file is not a valid PDF.',
    )
  }
  try {
    const attachments = await reader.getAttachments()
    const candidates = attachments
      ? [...attachments.values()].filter(
          (attachment) =>
            attachment.description === QUESTION_BANK_ATTACHMENT_DESCRIPTION,
        )
      : []
    if (candidates.length === 0) {
      throw new QuestionBankImportError(
        'missing-attachment',
        'This PDF was not exported from Test Parrot, so there is no Question Bank inside it to import.',
      )
    }
    if (candidates.length > 1) {
      throw new QuestionBankImportError(
        'ambiguous-attachments',
        'This PDF contains several canonical Question Bank Records, so the application cannot choose one safely.',
      )
    }
    const attachment = candidates[0]!
    const content = await reader.getAttachmentContent(attachment.filename)
    if (!content) {
      throw new QuestionBankImportError(
        'invalid-json',
        'The canonical attachment could not be decoded.',
      )
    }
    // A package zip carries its pictures too, so it may be as large as the
    // PDF allows; the JSON inside it is held to the record limit when read.
    const zip = content[0] === 0x50 && content[1] === 0x4b && content[2] === 0x03 && content[3] === 0x04
    const limit = zip ? limits.pdfBytes : limits.recordBytes
    if (content.byteLength > limit) {
      throw new QuestionBankImportError(
        'record-size-limit',
        `The canonical attachment exceeds the ${limit} byte limit.`,
      )
    }
    return content
  } finally {
    await loadingTask.destroy()
  }
}
