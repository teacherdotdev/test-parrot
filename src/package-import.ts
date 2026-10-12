import Ajv2020, { type ErrorObject } from 'ajv/dist/2020'
import type { ColumnSetting, Question, WordBankLayout, WorkSpace } from './exam'
import { pictureKey } from './picture-geometry'
import type { ProseMirrorJSON } from './question-doc'
import type { HeadingSize, SectionHeadings, TextSize } from './section-headings'
import type { ExamHeader } from './page-header'
import type { PageMargins } from './page-margins'
import type { PaperStyle } from './paper-style'
import examSchema010 from './exam-record-0.1.0.schema.json'
import examSchema020 from './exam-record-0.2.0.schema.json'
import examSchema030 from './exam-record-0.3.0.schema.json'
import examSchema040 from './exam-record-0.4.0.schema.json'
import examSchema050 from './exam-record-0.5.0.schema.json'
import packageSchema010 from './test-parrot-package-0.1.0.schema.json'
import type { QuestionFileSummary } from './question-formats'
import { PackageZipError, isPackageZip, readPackageZip } from './package-zip'
import {
  QUESTION_BANK_FORMAT,
  RECORD_TYPE_ORDER,
  type QuestionBankRecordQuestion,
  type QuestionBankRecordQuestionType,
  type SemanticDocument,
  type SemanticNode,
} from './question-bank-export'
import {
  DEFAULT_QUESTION_BANK_IMPORT_LIMITS,
  LOCAL_TYPES,
  QuestionBankImportError,
  decodeRecordJson,
  inspectQuestionBankRecordValue,
  packageFiles,
  readCanonicalAttachment,
  type PackageFiles,
  type ParsedQuestionBankRecord,
  type QuestionBankRecordSummary,
} from './question-bank-import'

/**
 * Reading whatever a teacher hands the importer — a bare Question Bank Record
 * or a Test Parrot Package, as JSON, as a package zip with its pictures
 * (ADR-0036), or inside a Test Parrot PDF — into one proposal: every bank,
 * every Exam, and which depends on which.
 *
 * The whole file is accepted or rejected. Each embedded record goes through
 * its own format's parser and rules first, then the package's own rules bind
 * them together: every Exam position must resolve inside the package, fit its
 * Question's type, and use its Question once. Nothing here writes anything.
 */

export const EXAM_FORMAT = 'test-parrot/exam'
export const EXAM_FORMAT_VERSION = '0.5.0'
export const PACKAGE_FORMAT = 'test-parrot/package'
export const PACKAGE_FORMAT_VERSION = '0.1.0'
/** The conventional extension a standalone package is saved under. */
export const PACKAGE_EXTENSION = '.parrot.json'

/** A package's own resource limits, on top of every Question Bank Record's
 *  limits applied to each bank in it. The Question and media limits apply
 *  again across the whole package, so splitting one oversized bank into many
 *  small ones does not get it past them. */
export const DEFAULT_PACKAGE_IMPORT_LIMITS = Object.freeze({
  ...DEFAULT_QUESTION_BANK_IMPORT_LIMITS,
  banks: 100,
  exams: 100,
})

export type PackageImportLimits = typeof DEFAULT_PACKAGE_IMPORT_LIMITS

/** One Exam position, as the package wrote it. */
export type ExamRecordPosition = {
  question: { bank: string; question: string }
  /** From Exam Record 0.3.0: the index into the record's `sections` of the
   *  Section this position is in. */
  section?: number
  columns?: ColumnSetting
  answerOrder?: string[]
  /** From Exam Record 0.4.0: the incorrect answers a Multiple Choice position
   *  leaves off, by the record's choice ids (ADR-0038). */
  hiddenAnswers?: string[]
  workSpace?: WorkSpace
  /** From Exam Record 0.4.0: where a Matching position's Word Bank prints,
   *  when not left to the fit rule. */
  wordBankLayout?: WordBankLayout
  /** From Exam Record 0.4.0: whether the teacher chose that layout, so a
   *  change of Paper Style leaves it (ADR-0044). Absent means false. */
  wordBankLayoutSet?: boolean
  /** From Exam Record 0.5.0: Exam Picture Sizes (ADR-0050), each naming one of
   *  the Question's block pictures by its place among them (`picture`, from 1,
   *  in `recordBlockPictures` order) and the share of its container it
   *  prints at. */
  pictureSizes?: ExamRecordPictureSize[]
}

/**
 * A local Question's block pictures by `pictureKey`, in the order an Exam
 * Record counts a record Question's (`recordBlockPictures`): the editor's
 * document holds its stem, answers and Parts in that same order, and a Short
 * Answer's Suggested Answer is read after it. A Pending Image has no picture
 * to size yet and is counted with an empty key.
 */
export function blockPictureKeysOf(question: Pick<Question, 'doc' | 'suggestedAnswer'>): string[] {
  const keys: string[] = []
  const visit = (node: ProseMirrorJSON) => {
    if (node.type === 'image-block') {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>
      keys.push(attrs.src ? pictureKey(attrs) : '')
    }
    if (Array.isArray(node.content)) (node.content as ProseMirrorJSON[]).forEach(visit)
  }
  visit(question.doc)
  if (question.suggestedAnswer) visit(question.suggestedAnswer)
  return keys
}

/** One Exam Picture Size, as an Exam Record 0.5.0 writes it. */
export type ExamRecordPictureSize = { picture: number; size: number }

/**
 * A record Question's block pictures in the order an Exam Record 0.5.0 counts
 * them: its stem; then its choices, Matching Items and Word Bank answers in
 * turn; then its Suggested Answer; then each Part in turn — its stem, its
 * choices and Suggested Answer, then each of its Subparts the same way. Each
 * document is read depth first in document order, Pending Images included.
 * This is also the order the editor's own document holds them in, which is
 * what lets an exported size find its picture again on import.
 */
export function recordBlockPictures(question: QuestionBankRecordQuestion): SemanticNode[] {
  const found: SemanticNode[] = []
  const visit = (node: SemanticNode) => {
    if (node.type === 'block-image') found.push(node)
    node.content?.forEach(visit)
  }
  const document = (doc: SemanticDocument | undefined) => doc?.content.forEach(visit)
  type Answering = {
    stem: SemanticDocument
    choices?: { content: SemanticDocument }[]
    suggestedAnswer?: SemanticDocument
    subparts?: Answering[]
  }
  const part = (each: Answering) => {
    document(each.stem)
    each.choices?.forEach(({ content }) => document(content))
    document(each.suggestedAnswer)
    each.subparts?.forEach(part)
  }
  document(question.stem)
  question.choices?.forEach(({ content }) => document(content))
  question.prompts?.forEach(({ content }) => document(content))
  question.wordBank?.forEach(({ content }) => document(content))
  document(question.suggestedAnswer)
  question.parts?.forEach((each) => part(each as Answering))
  return found
}

/**
 * The answer columns an imported Exam gives each Multiple Choice position, by
 * `bank/question`: what the position says, or the rule a teacher adding a
 * Question meets — a Multiple Choice Question takes the layout of the one
 * before it, and the first takes one column. `isMultipleChoice` says which
 * positions that is.
 */
export function positionColumns(
  positions: readonly ExamRecordPosition[],
  isMultipleChoice: (position: ExamRecordPosition) => boolean,
): Map<string, ColumnSetting> {
  const columns = new Map<string, ColumnSetting>()
  let previous: ColumnSetting | undefined
  for (const position of positions) {
    if (!isMultipleChoice(position)) continue
    previous = position.columns ?? previous ?? 1
    columns.set(`${position.question.bank}/${position.question.question}`, previous)
  }
  return columns
}

/** One Question Section's wording, as an Exam Record 0.2.0 writes it. */
export type ExamRecordSectionHeading = { title?: string; instructions?: string }

/** One Question Section, as an Exam Record 0.3.0 writes it: its wording in
 *  full, and no type — a Section holds Questions of any type (ADR-0029). An
 *  empty string is a part the teacher cleared. */
export type ExamRecordSection = {
  title: string
  instructions: string
}

export type ExamRecord = {
  format: typeof EXAM_FORMAT
  /** The version the record was written in. A parser migrates an older
   *  record's content forward but keeps saying which version it came from. */
  formatVersion: keyof typeof SUPPORTED_EXAM_VERSIONS
  name: string
  /** From 0.3.0: the Exam's Sections in print order, empty ones included. */
  sections?: ExamRecordSection[]
  /** 0.2.0 only. Keyed by the record's own Question Type names
   *  (`'short-answer'`, not `'open'`); only departures from the default
   *  wording. */
  sectionHeadings?: Partial<Record<QuestionBankRecordQuestionType, ExamRecordSectionHeading>>
  headingSize?: HeadingSize
  textSize?: TextSize
  /** From 0.4.0: how every question on the Exam prints; only when not
   *  Standard. */
  paperStyle?: PaperStyle
  /** The Exam's own test-page header lines; only departures from the default. */
  header?: ExamHeader
  /** From 0.4.0: the Exam's Page Margins in inches, every side; only when they
   *  depart from the default. */
  margins?: PageMargins
  positions: ExamRecordPosition[]
}

export type TestParrotPackage = {
  format: typeof PACKAGE_FORMAT
  formatVersion: typeof PACKAGE_FORMAT_VERSION
  generator: { name: string; version: string }
  requiredFeatures: string[]
  questionBanks: { id: string; record: unknown }[]
  exams: ExamRecord[]
}

export type ProposedBank = {
  /** The package-local bank id. A bare Question Bank Record's one bank is
   *  given `BARE_RECORD_BANK_ID`. */
  id: string
  record: ParsedQuestionBankRecord
  summary: QuestionBankRecordSummary
  /** Keys of the Exams that use this bank, in package order. */
  exams: string[]
}

/** An imported Section's wording. It has no id yet: the plan that writes it
 *  gives it a fresh one. */
export type ProposedSection = {
  title: string
  instructions: string
}

export type ProposedExam = {
  /** Exam Records carry no id; this is the Exam's place in the package. */
  key: string
  name: string
  formatVersion: string
  /** The Exam's Sections in print order, from a 0.3.0 record; each
   *  position's `section` indexes this list. Absent for an older record,
   *  whose Sections are derived one per Question Type. */
  sections?: ProposedSection[]
  /** An older record's section wording, keyed by local Question Type —
   *  absent when the record says nothing but the defaults. */
  sectionHeadings?: SectionHeadings
  headingSize?: HeadingSize
  textSize?: TextSize
  paperStyle?: PaperStyle
  header?: ExamHeader
  margins?: PageMargins
  /** Positions regrouped Section by Section — in `sections` order, or for an
   *  older record in Test Parrot's fixed type order — keeping only the order
   *  within each Section. */
  positions: ExamRecordPosition[]
  /** Ids of the banks this Exam uses, in order of first use. */
  banks: string[]
}

export type ImportProposal = {
  /** What the file itself was: a bare Question Bank Record, or a package. */
  source: { format: typeof QUESTION_BANK_FORMAT | typeof PACKAGE_FORMAT; formatVersion: string }
  banks: ProposedBank[]
  exams: ProposedExam[]
  /** Set when the file came from another tool and was read as questions:
   *  which format it was read as, and what came in and what did not. */
  reading?: QuestionFileSummary
}

export const BARE_RECORD_BANK_ID = 'bank'

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validateExam010 = ajv.compile(examSchema010)
const validateExam020 = ajv.compile(examSchema020)
const validateExam030 = ajv.compile(examSchema030)
const validateExam040 = ajv.compile(examSchema040)
const validateExam050 = ajv.compile(examSchema050)
const validatePackage010 = ajv.compile(packageSchema010)

function schemaFailure(
  what: string,
  errors: ErrorObject[] | null | undefined,
): QuestionBankImportError {
  const first = errors?.[0]
  return new QuestionBankImportError(
    'invalid-structure',
    first
      ? `${what} schema validation failed at ${first.instancePath || '/'}: ${first.message}.`
      : `${what} schema validation failed.`,
  )
}

function stringAt(object: unknown, key: string): string | undefined {
  if (typeof object !== 'object' || object === null) return undefined
  const value = (object as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/** Copy only what every version defines: unknown optional fields are dropped
 *  here, as they are from a Question Bank Record. A 0.3.0 position's
 *  `section` is added by its own parser. */
function copyPosition(position: ExamRecordPosition): ExamRecordPosition {
  return {
    question: { bank: position.question.bank, question: position.question.question },
    ...(position.columns !== undefined ? { columns: position.columns } : {}),
    ...(position.answerOrder !== undefined ? { answerOrder: [...position.answerOrder] } : {}),
    ...(position.workSpace !== undefined
      ? {
          workSpace: {
            height: position.workSpace.height,
            style: position.workSpace.style,
            fill: position.workSpace.fill,
          },
        }
      : {}),
  }
}

/** Only the wording parts a record sets. */
function wordingOf(heading: ExamRecordSectionHeading): ExamRecordSectionHeading {
  return {
    ...(heading.title !== undefined ? { title: heading.title } : {}),
    ...(heading.instructions !== undefined ? { instructions: heading.instructions } : {}),
  }
}

/** An Exam Record's Sections and section wording in the local vocabulary,
 *  where a Short Answer section is `'open'` — or nothing, when it keeps the
 *  defaults. */
function localHeadingsOf(
  exam: ExamRecord,
): {
  sections?: ProposedSection[]
  sectionHeadings?: SectionHeadings
  headingSize?: HeadingSize
  textSize?: TextSize
  paperStyle?: PaperStyle
  header?: ExamHeader
  margins?: PageMargins
} {
  const entries = Object.entries(exam.sectionHeadings ?? {}) as [
    QuestionBankRecordQuestionType,
    ExamRecordSectionHeading,
  ][]
  const sectionHeadings: SectionHeadings = Object.fromEntries(
    entries.map(([type, heading]) => [LOCAL_TYPES[type], { ...heading }]),
  )
  return {
    ...(exam.sections
      ? { sections: exam.sections.map(({ title, instructions }) => ({ title, instructions })) }
      : {}),
    ...(entries.length > 0 ? { sectionHeadings } : {}),
    ...(exam.headingSize && exam.headingSize !== 'normal' ? { headingSize: exam.headingSize } : {}),
    ...(exam.textSize && exam.textSize !== 'normal' ? { textSize: exam.textSize } : {}),
    ...(exam.paperStyle && exam.paperStyle !== 'standard'
      ? { paperStyle: exam.paperStyle }
      : {}),
    ...(exam.header && Object.keys(exam.header).length > 0 ? { header: { ...exam.header } } : {}),
    ...(exam.margins ? { margins: { ...exam.margins } } : {}),
  }
}

type ExamParser = (value: unknown) => ExamRecord

// 0.1.0 had no section wording or heading size, so it migrates forward as an
// Exam that prints the defaults.
const examParser010: ExamParser = (value) => {
  if (!validateExam010(value)) throw schemaFailure('Exam Record', validateExam010.errors)
  const exam = value as ExamRecord
  return {
    format: EXAM_FORMAT,
    formatVersion: '0.1.0',
    name: exam.name,
    positions: exam.positions.map(copyPosition),
  }
}

const examParser020: ExamParser = (value) => {
  if (!validateExam020(value)) throw schemaFailure('Exam Record', validateExam020.errors)
  const exam = value as ExamRecord
  const sectionHeadings = Object.fromEntries(
    Object.entries(exam.sectionHeadings ?? {}).map(([type, heading]) => [type, wordingOf(heading)]),
  )
  return {
    format: EXAM_FORMAT,
    formatVersion: '0.2.0',
    name: exam.name,
    ...(Object.keys(sectionHeadings).length > 0 ? { sectionHeadings } : {}),
    ...(exam.headingSize ? { headingSize: exam.headingSize } : {}),
    ...(exam.textSize ? { textSize: exam.textSize } : {}),
    ...(exam.header ? { header: { ...exam.header } } : {}),
    positions: exam.positions.map(copyPosition),
  }
}

// 0.3.0 stores the Exam's Sections, each with its own wording, and places
// every position in one. A Section holds Questions of any type, and
// per-type `sectionHeadings` is gone (ADR-0029).
function sectionedParser(
  validate: typeof validateExam030,
  formatVersion: '0.3.0' | '0.4.0' | '0.5.0',
  extra: (position: ExamRecordPosition) => Partial<ExamRecordPosition> = () => ({}),
): ExamParser {
  return (value) => {
    if (!validate(value)) throw schemaFailure('Exam Record', validate.errors)
    const exam = value as ExamRecord
    return {
      format: EXAM_FORMAT,
      formatVersion,
      name: exam.name,
      sections: exam.sections!.map(({ title, instructions }) => ({ title, instructions })),
      ...(exam.headingSize ? { headingSize: exam.headingSize } : {}),
      ...(exam.textSize ? { textSize: exam.textSize } : {}),
      ...(exam.header ? { header: { ...exam.header } } : {}),
      positions: exam.positions.map((position) => ({
        ...copyPosition(position),
        section: position.section!,
        ...extra(position),
      })),
    }
  }
}

const examParser030: ExamParser = sectionedParser(validateExam030, '0.3.0')

// 0.4.0 adds to 0.3.0 a Multiple Choice position's `hiddenAnswers`, the
// incorrect answers it leaves off (ADR-0038); a Matching position's
// `wordBankLayout`, and whether the teacher chose it (`wordBankLayoutSet`,
// ADR-0044); the Exam's Page Margins (ADR-0039); and its `paperStyle`
// (ADR-0041) — and nothing else. A record without them hides nothing, prints
// today's margins and prints in the standard style; a Matching position
// without a `wordBankLayout` takes one on import, from its style and the fit
// rule (`planImport`), and is not the teacher's choice.
const positionFrom040 = (position: ExamRecordPosition): Partial<ExamRecordPosition> => ({
  ...(position.hiddenAnswers !== undefined ? { hiddenAnswers: [...position.hiddenAnswers] } : {}),
  ...(position.wordBankLayout !== undefined ? { wordBankLayout: position.wordBankLayout } : {}),
  ...(position.wordBankLayout !== undefined && position.wordBankLayoutSet === true
    ? { wordBankLayoutSet: true }
    : {}),
})

/** 0.4.0's Exam-wide members, Paper Style and Page Margins, read on top of
 *  its Sections and positions. */
function withPaperOf(parser: ExamParser): ExamParser {
  return (value) => {
    const parsed = parser(value)
    const { paperStyle, margins } = value as ExamRecord
    const { top, right, bottom, left } = margins ?? {}
    return {
      ...parsed,
      ...(paperStyle ? { paperStyle } : {}),
      ...(margins ? { margins: { top: top!, right: right!, bottom: bottom!, left: left! } } : {}),
    }
  }
}

const examParser040: ExamParser = withPaperOf(sectionedParser(validateExam040, '0.4.0', positionFrom040))

// 0.5.0 adds to 0.4.0 a position's `pictureSizes`, the Exam Picture Sizes it
// gives its Question's block pictures (ADR-0050), and nothing else. A record
// without them prints every picture at its Default Picture Size.
const examParser050: ExamParser = withPaperOf(sectionedParser(validateExam050, '0.5.0', (position) => ({
  ...positionFrom040(position),
  ...(position.pictureSizes !== undefined
    ? { pictureSizes: position.pictureSizes.map(({ picture, size }) => ({ picture, size })) }
    : {}),
})))

/** Exact versions only, as for the Question Bank Record: each supported
 *  version names its own parser, which migrates it forward. */
export const SUPPORTED_EXAM_VERSIONS = Object.freeze({
  '0.1.0': examParser010,
  '0.2.0': examParser020,
  '0.3.0': examParser030,
  '0.4.0': examParser040,
  '0.5.0': examParser050,
} satisfies Record<string, ExamParser>)

type PackageParser = (value: unknown) => TestParrotPackage

const packageParser010: PackageParser = (value) => {
  if (!validatePackage010(value)) throw schemaFailure('Test Parrot Package', validatePackage010.errors)
  const parsed = value as TestParrotPackage
  return {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_FORMAT_VERSION,
    generator: { name: parsed.generator.name, version: parsed.generator.version },
    requiredFeatures: [...parsed.requiredFeatures],
    questionBanks: parsed.questionBanks.map((bank) => ({ id: bank.id, record: bank.record })),
    exams: parsed.exams,
  }
}

export const SUPPORTED_PACKAGE_VERSIONS: Readonly<Record<string, PackageParser>> =
  Object.freeze({ '0.1.0': packageParser010 })

function parserFor<T>(
  table: Readonly<Record<string, T>>,
  label: string,
  value: unknown,
): T {
  const version = stringAt(value, 'formatVersion') ?? 'missing'
  const parser = table[version]
  if (!parser) {
    throw new QuestionBankImportError(
      'unsupported-version',
      `${label} format version “${version}” is unsupported. Supported versions: ${Object.keys(table).join(', ')}.`,
    )
  }
  return parser
}

function parseExam(value: unknown): ExamRecord {
  const format = stringAt(value, 'format')
  if (format !== EXAM_FORMAT) {
    throw new QuestionBankImportError(
      'unsupported-format',
      `A package Exam has format “${format ?? 'missing'}”, not ${EXAM_FORMAT}.`,
    )
  }
  return parserFor(SUPPORTED_EXAM_VERSIONS, 'Exam Record', value)(value)
}

const SECTION_INDEX = new Map(RECORD_TYPE_ORDER.map((type, index) => [type, index]))

function isPermutation(order: readonly string[], ids: readonly string[]): boolean {
  if (order.length !== ids.length) return false
  const remaining = new Set(ids)
  return order.every((id) => remaining.delete(id))
}

/** The rules that bind an Exam to the banks beside it, then the Section
 *  regrouping. Every rejection names the Exam and the position, 1-based, the
 *  way a teacher would count them. */
function proposedExam(
  exam: ExamRecord,
  index: number,
  banks: ReadonlyMap<string, ReadonlyMap<string, QuestionBankRecordQuestion>>,
): ProposedExam {
  const label = `Exam “${exam.name || `#${index + 1}`}”`
  const used = new Set<string>()
  const bankOrder: string[] = []
  const typed = exam.positions.map((position, positionIndex) => {
    const where = `${label} position ${positionIndex + 1}`
    const { bank, question: questionId } = position.question
    const questions = banks.get(bank)
    if (!questions) {
      throw new QuestionBankImportError(
        'dangling-reference',
        `${where} names bank “${bank}”, which is not in this package.`,
      )
    }
    const question = questions.get(questionId)
    if (!question) {
      throw new QuestionBankImportError(
        'dangling-reference',
        `${where} names Question “${questionId}”, which is not in bank “${bank}”.`,
      )
    }
    // A pair of ids joined by a character no JSON string key forbids but no
    // sensible generator uses, so two different pairs never collide.
    const key = `${bank}\u0000${questionId}`
    if (used.has(key)) {
      throw new QuestionBankImportError(
        'duplicate-reference',
        `${where} uses Question “${questionId}” from bank “${bank}” again. An Exam may use each Question once.`,
      )
    }
    used.add(key)
    if (!bankOrder.includes(bank)) bankOrder.push(bank)

    // A Multipart position is accepted as a whole Question and sets none of
    // these: its answer columns, answer order and Work Space are set per Part,
    // and Exam Record 0.1.0 has nowhere yet to carry per-Part presentation, so
    // an imported Multipart question takes each Part's defaults.
    if (position.columns !== undefined && question.type !== 'multiple-choice') {
      throw new QuestionBankImportError(
        'invalid-position',
        `${where} sets answer columns, which only a Multiple Choice Question has.`,
      )
    }
    if ((position.wordBankLayout !== undefined || position.wordBankLayoutSet !== undefined)
      && question.type !== 'matching') {
      throw new QuestionBankImportError(
        'invalid-position',
        `${where} sets a Word Bank layout, which only a Matching Question has.`,
      )
    }
    if (position.workSpace !== undefined && question.type !== 'short-answer') {
      throw new QuestionBankImportError(
        'invalid-position',
        `${where} sets Work Space, which only a Short Answer Question has.`,
      )
    }
    if (position.answerOrder !== undefined) {
      const answers =
        question.type === 'multiple-choice'
          ? question.choices
          : question.type === 'matching'
            ? question.wordBank
            : undefined
      if (!answers) {
        throw new QuestionBankImportError(
          'invalid-position',
          `${where} sets an answer order, which only Multiple Choice answers and a Matching Word Bank have.`,
        )
      }
      if (!isPermutation(position.answerOrder, answers.map((answer) => answer.id))) {
        throw new QuestionBankImportError(
          'invalid-answer-order',
          `${where} has an answer order that does not list each of Question “${questionId}”’s answers exactly once.`,
        )
      }
    }
    if (position.hiddenAnswers !== undefined) {
      if (question.type !== 'multiple-choice') {
        throw new QuestionBankImportError(
          'invalid-position',
          `${where} hides answers, which only a Multiple Choice Question may.`,
        )
      }
      const choices = new Map((question.choices ?? []).map((choice) => [choice.id, choice]))
      for (const id of position.hiddenAnswers) {
        const choice = choices.get(id)
        if (!choice) {
          throw new QuestionBankImportError(
            'dangling-reference',
            `${where} hides “${id}”, which is not one of Question “${questionId}”’s answers.`,
          )
        }
        if (choice.correct) {
          throw new QuestionBankImportError(
            'invalid-position',
            `${where} hides “${id}”, Question “${questionId}”’s correct answer.`,
          )
        }
      }
    }
    if (position.pictureSizes !== undefined) {
      const pictures = recordBlockPictures(question).length
      const sized = new Set<number>()
      for (const { picture, size } of position.pictureSizes) {
        if (!Number.isInteger(picture) || picture < 1 || picture > pictures) {
          throw new QuestionBankImportError(
            'dangling-reference',
            `${where} sizes picture ${picture}, but Question “${questionId}” has ${pictures === 1 ? '1 block picture' : `${pictures} block pictures`}.`,
          )
        }
        if (sized.has(picture)) {
          throw new QuestionBankImportError(
            'invalid-position',
            `${where} sizes picture ${picture} more than once.`,
          )
        }
        sized.add(picture)
        if (!(size >= 0.05 && size <= 1)) {
          throw new QuestionBankImportError(
            'invalid-position',
            `${where} sizes picture ${picture} at ${size}, outside 0.05 to 1 of its container.`,
          )
        }
      }
    }
    // A 0.3.0 record places each position in one of its own Sections, which
    // takes a Question of any type; an older record's are placed by type.
    if (exam.sections) {
      if (position.section! >= exam.sections.length) {
        throw new QuestionBankImportError(
          'dangling-reference',
          `${where} names Section ${position.section! + 1}, but this Exam has ${exam.sections.length}.`,
        )
      }
      return { position, section: position.section! }
    }
    return { position, section: SECTION_INDEX.get(question.type)! }
  })
  // Array.prototype.sort is stable, so within one Section the source order
  // survives and only order across Sections is given up.
  const positions = typed
    .map((item, order) => ({ ...item, order }))
    .sort((left, right) => left.section - right.section || left.order - right.order)
    .map(({ position }) => position)
  return {
    key: `exam-${index + 1}`,
    name: exam.name,
    formatVersion: exam.formatVersion,
    ...localHeadingsOf(exam),
    positions,
    banks: bankOrder,
  }
}

async function inspectPackageValue(
  value: unknown,
  limits: PackageImportLimits,
  files: PackageFiles | undefined,
): Promise<ImportProposal> {
  const testParrotPackage = parserFor(SUPPORTED_PACKAGE_VERSIONS, 'Test Parrot Package', value)(value)
  if (testParrotPackage.requiredFeatures.length > 0) {
    throw new QuestionBankImportError(
      'unsupported-feature',
      `Unsupported required feature: ${testParrotPackage.requiredFeatures.join(', ')}.`,
    )
  }
  if (testParrotPackage.questionBanks.length > limits.banks) {
    throw new QuestionBankImportError(
      'bank-count-limit',
      `This package contains more than the ${limits.banks} Question Bank limit.`,
    )
  }
  if (testParrotPackage.exams.length > limits.exams) {
    throw new QuestionBankImportError(
      'exam-count-limit',
      `This package contains more than the ${limits.exams} Exam limit.`,
    )
  }
  const seen = new Set<string>()
  for (const { id } of testParrotPackage.questionBanks) {
    if (seen.has(id)) {
      throw new QuestionBankImportError('duplicate-id', `Package bank id “${id}” is duplicated.`)
    }
    seen.add(id)
  }
  // Exams are parsed before any bank's media is decoded: an unsupported Exam
  // version is a cheap refusal, and there is no reason to pay for images first.
  const exams = testParrotPackage.exams.map(parseExam)

  const banks: ProposedBank[] = []
  let questions = 0
  let mediaBytes = 0
  for (const { id, record } of testParrotPackage.questionBanks) {
    const inspected = await inspectQuestionBankRecordValue(record, limits, files)
    questions += inspected.record.bank.questions.length
    if (questions > limits.questions) {
      throw new QuestionBankImportError(
        'question-count-limit',
        `This package contains more than the ${limits.questions} Question limit.`,
      )
    }
    mediaBytes += inspected.summary.decodedMediaBytes
    if (mediaBytes > limits.totalMediaBytes) {
      throw new QuestionBankImportError(
        'total-media-size-limit',
        `Decoded media across this package exceeds the total limit of ${limits.totalMediaBytes} bytes.`,
      )
    }
    banks.push({ id, record: inspected.record, summary: inspected.summary, exams: [] })
  }

  const questionsByBank = new Map(
    banks.map((bank) => [
      bank.id,
      new Map(bank.record.bank.questions.map((question) => [question.id, question])),
    ]),
  )
  const proposedExams = exams.map((exam, index) => {
    if (exam.positions.length > limits.questions) {
      throw new QuestionBankImportError(
        'question-count-limit',
        `An Exam in this package has more than the ${limits.questions} Question limit.`,
      )
    }
    return proposedExam(exam, index, questionsByBank)
  })
  const byId = new Map(banks.map((bank) => [bank.id, bank]))
  for (const exam of proposedExams) {
    for (const bankId of exam.banks) byId.get(bankId)!.exams.push(exam.key)
  }
  return {
    source: { format: PACKAGE_FORMAT, formatVersion: testParrotPackage.formatVersion },
    banks,
    exams: proposedExams,
  }
}

/** Inspect one decoded JSON value: a bare Question Bank Record, which reads
 *  as a package with one bank and no Exams, or a Test Parrot Package. `files`
 *  are the pictures beside it in its zip, when it came in one. */
export async function inspectImportValue(
  value: unknown,
  limits: PackageImportLimits = DEFAULT_PACKAGE_IMPORT_LIMITS,
  files?: ReadonlyMap<string, Uint8Array>,
): Promise<ImportProposal> {
  const carried = files ? packageFiles(files) : undefined
  const proposal = await inspectValue(value, limits, carried)
  // A picture no Media Asset names is refused, as a Media Asset nothing shows
  // is. Anything outside `media/` is not the package's, and is ignored.
  for (const path of files?.keys() ?? []) {
    if (path.startsWith('media/') && !carried!.used.has(path)) {
      throw new QuestionBankImportError(
        'invalid-media',
        `This zip holds “${path}”, which no Media Asset names.`,
      )
    }
  }
  return proposal
}

async function inspectValue(
  value: unknown,
  limits: PackageImportLimits,
  files: PackageFiles | undefined,
): Promise<ImportProposal> {
  const format = stringAt(value, 'format')
  if (format === QUESTION_BANK_FORMAT) {
    const { record, summary } = await inspectQuestionBankRecordValue(value, limits, files)
    return {
      source: { format: QUESTION_BANK_FORMAT, formatVersion: record.sourceVersion },
      banks: [{ id: BARE_RECORD_BANK_ID, record, summary, exams: [] }],
      exams: [],
    }
  }
  if (format === PACKAGE_FORMAT) return inspectPackageValue(value, limits, files)
  if (format === EXAM_FORMAT) {
    throw new QuestionBankImportError(
      'unsupported-format',
      'This is an Exam Record on its own. An Exam imports only inside a Test Parrot Package, beside the Question Bank it uses.',
    )
  }
  throw new QuestionBankImportError(
    'unsupported-format',
    `The file format “${format ?? 'missing'}” is not ${QUESTION_BANK_FORMAT} or ${PACKAGE_FORMAT}.`,
  )
}

/** Inspect a file's bytes: a package zip with its pictures, or JSON. */
export async function inspectImportRecord(
  bytes: Uint8Array,
  options: { limits?: PackageImportLimits } = {},
): Promise<ImportProposal> {
  const limits = options.limits ?? DEFAULT_PACKAGE_IMPORT_LIMITS
  if (isPackageZip(bytes)) return inspectPackageZip(bytes, limits)
  if (bytes.byteLength > limits.recordBytes) {
    throw new QuestionBankImportError(
      'record-size-limit',
      `The file exceeds the ${limits.recordBytes} byte limit.`,
    )
  }
  return inspectImportValue(decodeRecordJson(bytes), limits)
}

async function inspectPackageZip(bytes: Uint8Array, limits: PackageImportLimits): Promise<ImportProposal> {
  if (bytes.byteLength > limits.pdfBytes) {
    throw new QuestionBankImportError(
      'record-size-limit',
      `The zip exceeds the ${limits.pdfBytes} byte limit.`,
    )
  }
  let opened: Awaited<ReturnType<typeof readPackageZip>>
  try {
    opened = await readPackageZip(bytes)
  } catch (reason) {
    if (reason instanceof PackageZipError) throw new QuestionBankImportError('invalid-zip', reason.message)
    throw reason
  }
  if (opened.json.byteLength > limits.recordBytes) {
    throw new QuestionBankImportError(
      'record-size-limit',
      `The package in this zip exceeds the ${limits.recordBytes} byte limit.`,
    )
  }
  return inspectImportValue(decodeRecordJson(opened.json), limits, opened.files)
}

/** Inspect a Test Parrot PDF: a Question Bank File or an Exam PDF exported
 *  with its answer key. Both carry their record the same way. */
export async function inspectImportFile(
  bytes: Uint8Array,
  options: { limits?: PackageImportLimits } = {},
): Promise<ImportProposal> {
  const limits = options.limits ?? DEFAULT_PACKAGE_IMPORT_LIMITS
  return inspectImportRecord(await readCanonicalAttachment(bytes, limits), { limits })
}
