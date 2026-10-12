import {
  DEFAULT_EXAM_TITLE,
  snapWorkSpaceHeight,
  type ColumnSetting,
  type ExamSection,
  type Question,
  type WordBankLayout,
  type WorkSpace,
} from './exam'
import type { SavedState } from './exam-store'
import { wordBankLayoutFor, type BankAnswerWidth } from './export-plan'
import type { ImportSelection } from './import-selection'
import { blockPictureKeysOf, positionColumns, type ExamRecordPosition, type ImportProposal } from './package-import'
import { withResolvedImages, type PendingImageResolution } from './pending-images'
import { createWorkingCopy } from './question-bank'
import { UNTITLED_QUESTION_BANK } from './question-bank-workspaces'
import {
  importedQuestionIdentities,
  type ImportedQuestionIdentity,
  type ParsedQuestionBankRecord,
} from './question-bank-import'

/**
 * What one import writes, worked out before anything is written: the banks to
 * create, the Questions to append to existing banks, the Media Assets to
 * store, and each Exam's saved state. The storage service applies a plan in
 * one go; planning is pure so the id mapping and the Exam defaults can be
 * read and tested without storage.
 */

export type PlannedBank = {
  /** The package-local bank id this came from. */
  source: string
  /** The local bank the Questions land in: a fresh id, or the existing
   *  bank's. */
  bankId: string
  /** Present for a new bank, absent when appending to an existing one — an
   *  existing bank keeps its own name and provenance. */
  created?: {
    name: string
    description?: string
    author?: string
    license?: { name: string; url?: string }
  }
  questions: Question[]
}

export type PlannedExam = {
  source: string
  examId: string
  saved: SavedState
  /** The local banks this Exam's Questions came from, in order of first
   *  use: the tabs its editor opens with. */
  bankIds: string[]
}

export type ImportPlan = {
  banks: PlannedBank[]
  media: ParsedQuestionBankRecord['media']
  exams: PlannedExam[]
}

/** Every Question and answer gets a fresh identity, nothing is deduplicated,
 *  and only allowed items appear. A selection whose allowed Exam needs a
 *  denied bank is refused rather than half-applied. Pending Images resolved
 *  in Resolve Images arrive as ordinary images of their Media Assets; the
 *  rest stay Pending Images. */
export function planImport(
  proposal: ImportProposal,
  selection: ImportSelection,
  createId: () => string = () => crypto.randomUUID(),
  resolution: PendingImageResolution = new Map(),
  bankAnswerWidth?: BankAnswerWidth,
): ImportPlan {
  const identities = new Map<string, Map<string, ImportedQuestionIdentity>>()
  const localBankIds = new Map<string, string>()
  const banks: PlannedBank[] = []
  const media = new Map<string, ParsedQuestionBankRecord['media'][number]>()
  for (const bank of proposal.banks) {
    const chosen = selection.banks[bank.id]
    if (!chosen?.allowed) continue
    const record = withResolvedImages(bank.id, bank.record, resolution)
    const imported = importedQuestionIdentities(record, createId)
    identities.set(bank.id, imported)
    const bankId = chosen.target.kind === 'existing' ? chosen.target.bankId : createId()
    localBankIds.set(bank.id, bankId)
    banks.push({
      source: bank.id,
      bankId,
      ...(chosen.target.kind === 'new'
        ? {
            created: {
              name: chosen.target.name.trim() || UNTITLED_QUESTION_BANK,
              ...(record.bank.description !== undefined ? { description: record.bank.description } : {}),
              ...(record.bank.author !== undefined ? { author: record.bank.author } : {}),
              ...(record.bank.license !== undefined ? { license: { ...record.bank.license } } : {}),
            },
          }
        : {}),
      questions: [...imported.values()].map(({ question }) => question),
    })
    for (const asset of record.media) media.set(asset.id, asset)
  }

  const exams = proposal.exams.flatMap((exam): PlannedExam[] => {
    if (!selection.exams[exam.key]?.allowed) return []
    const missing = exam.banks.filter((id) => !identities.has(id))
    if (missing.length > 0) {
      throw new Error(`“${exam.name}” needs a Question Bank that is not being imported: ${missing.join(', ')}.`)
    }
    const questions: Question[] = []
    const columns: Record<string, ColumnSetting> = {}
    const choiceOrder: Record<string, string[]> = {}
    const hiddenAnswers: Record<string, string[]> = {}
    const workSpace: Record<string, WorkSpace> = {}
    const wordBankLayout: Record<string, WordBankLayout> = {}
    const wordBankLayoutSet: Record<string, true> = {}
    const pictureSizes: Record<string, Record<string, number>> = {}
    const identityOf = (position: ExamRecordPosition) =>
      identities.get(position.question.bank)!.get(position.question.question)!
    const layout = positionColumns(
      exam.positions,
      (position) => identityOf(position).question.type === 'multiple-choice',
    )
    for (const position of exam.positions) {
      const { question, answers } = identityOf(position)
      questions.push(question)
      const laidOut = layout.get(`${position.question.bank}/${position.question.question}`)
      if (laidOut) columns[question.id] = laidOut
      if (position.answerOrder) {
        choiceOrder[question.id] = position.answerOrder.map((id) => answers.get(id)!)
      }
      if (position.hiddenAnswers) {
        hiddenAnswers[question.id] = position.hiddenAnswers.map((id) => answers.get(id)!)
      }
      // Every Matching position stores where its Word Bank prints. A record
      // that does not say — written before it could, or by another tool —
      // takes the layout its Paper Style and the fit rule give it here,
      // once, as a question added to an Exam does (ADR-0041).
      if (question.type === 'matching') {
        wordBankLayout[question.id] = position.wordBankLayout
          ?? wordBankLayoutFor(question, exam, bankAnswerWidth)
        // One the teacher chose stays where it is when the style changes
        // (ADR-0044); one placed here does not.
        if (position.wordBankLayout !== undefined && position.wordBankLayoutSet === true) {
          wordBankLayoutSet[question.id] = true
        }
      }
      // An Exam Picture Size names its picture by its place among the
      // Question's block pictures, which the imported Question holds in the
      // record's order; one still a Pending Image has nothing to size yet.
      if (position.pictureSizes) {
        const keys = blockPictureKeysOf(question)
        const sizes: Record<string, number> = {}
        for (const { picture, size } of position.pictureSizes) {
          const key = keys[picture - 1]
          if (key) sizes[key] = size
        }
        if (Object.keys(sizes).length > 0) pictureSizes[question.id] = sizes
      }
      if (position.workSpace) {
        workSpace[question.id] = {
          height: snapWorkSpaceHeight(position.workSpace.height),
          style: position.workSpace.style,
          fill: position.workSpace.fill,
        }
      }
    }
    // A 0.3.0 Exam's Sections are stored, each under a fresh id with its
    // wording in full, and every Question is placed in the one its position
    // names, whatever its type. An older Exam stores none and keeps its
    // per-type wording, so its Sections are derived one per type.
    const sections: ExamSection[] | undefined = exam.sections?.map(({ title, instructions }) => ({
      id: createId(),
      title,
      instructions,
    }))
    const sectionOf: Record<string, string> = {}
    if (sections) {
      exam.positions.forEach((position, index) => {
        sectionOf[questions[index]!.id] = sections[position.section!]!.id
      })
    }
    const workingCopy = {
      ...createWorkingCopy(exam.name.trim() || DEFAULT_EXAM_TITLE),
      questionIds: questions.map(({ id }) => id),
      choiceOrder,
      ...(Object.keys(hiddenAnswers).length > 0 ? { hiddenAnswers } : {}),
      ...(Object.keys(columns).length > 0 ? { columns } : {}),
      ...(Object.keys(workSpace).length > 0 ? { workSpace } : {}),
      ...(Object.keys(wordBankLayout).length > 0 ? { wordBankLayout } : {}),
      ...(Object.keys(wordBankLayoutSet).length > 0 ? { wordBankLayoutSet } : {}),
      ...(Object.keys(pictureSizes).length > 0 ? { pictureSizes } : {}),
      ...(sections ? { sections, sectionOf } : {}),
      ...(exam.sectionHeadings ? { sectionHeadings: exam.sectionHeadings } : {}),
      ...(exam.headingSize ? { headingSize: exam.headingSize } : {}),
      ...(exam.textSize ? { textSize: exam.textSize } : {}),
      ...(exam.paperStyle ? { paperStyle: exam.paperStyle } : {}),
      ...(exam.header ? { header: exam.header } : {}),
      ...(exam.margins ? { margins: exam.margins } : {}),
    }
    return [{
      source: exam.key,
      examId: createId(),
      saved: { questionBank: { questions }, workingCopy },
      bankIds: exam.banks.map((id) => localBankIds.get(id)!),
    }]
  })

  return { banks, media: [...media.values()], exams }
}
