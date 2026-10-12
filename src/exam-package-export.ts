import {
  choicesOf,
  columnsOf,
  orderedChoices,
  orderedQuestions,
  sectionIdOf,
  sectionsOf,
  takesWorkSpace,
  isWorkSpace,
  type Arrangement,
  type Exam,
} from './exam'
import { wordBankLayoutOf } from './export-plan'
import type { PreparedExport } from './export-preparation'
import { hiddenAnswerIdsOf } from './hidden-answers'
import {
  QUESTION_BANK_FORMAT_VERSION,
  prepareQuestionBankExport,
  type QuestionBankMediaLoader,
} from './question-bank-export'
import type { QuestionBankResource } from './question-bank-workspaces'
import {
  EXAM_FORMAT,
  EXAM_FORMAT_VERSION,
  blockPictureKeysOf,
  recordBlockPictures,
  type ExamRecordPictureSize,
  PACKAGE_FORMAT,
  PACKAGE_FORMAT_VERSION,
  type ExamRecord,
  type ExamRecordPosition,
  type ExamRecordSection,
  type TestParrotPackage,
} from './package-import'
import { writePackageZip } from './package-zip'

/**
 * The Test Parrot Package an Exam PDF carries: one Exam Record for exactly
 * what that export printed, and one Question Bank Record, named for the Exam,
 * holding exactly its Questions in Exam order (ADR-0036). What travels with an
 * Exam is the Exam's material, not the teacher's banks, so the banks it drew
 * on keep their names and descriptions at home.
 *
 * Only a PDF whose Content Selection includes the answer key carries one — a
 * Question Bank Record holds the answers, so a student-only PDF must not —
 * and a DOCX never does, because a teacher's Word edits would leave it stale.
 * The package is kept on the Export Record beside its Layout Plans rather
 * than in them, so the Export Fingerprint and print/DOCX parity, which are
 * about pages, never see it.
 */

export function carriesExamPackage(prepared: PreparedExport): boolean {
  return prepared.record.format === 'pdf' && prepared.record.selection.answerKey
}

/** The bank a Question belongs to, or null for one no bank owns. */
export type QuestionOwner = (questionId: string) => Promise<QuestionBankResource | null>

export async function examPackage({
  exam,
  arrangement,
  ownerOf,
  loadMedia,
}: {
  exam: Exam
  arrangement: Arrangement
  ownerOf: QuestionOwner
  loadMedia?: QuestionBankMediaLoader
}): Promise<{ package: TestParrotPackage; files: Map<string, Uint8Array> }> {
  const printed = orderedQuestions(exam, arrangement)
  const owners = await Promise.all(printed.map((question) => ownerOf(question.id)))

  // An author or license travels only when every Question's bank declares the
  // same one, so a shared Exam never credits the wrong person.
  const authors = owners.map((owner) => owner?.author)
  const licenses = owners.map((owner) => owner?.license)
  const author = authors.every((value) => value !== undefined && value === authors[0]) ? authors[0] : undefined
  const license = licenses.every((value) => value !== undefined && value.name === licenses[0]!.name && value.url === licenses[0]!.url)
    ? licenses[0]
    : undefined
  const bankId = 'bank-1'
  const prepared = await prepareQuestionBankExport({
    id: '',
    name: `${exam.title} Question Bank`,
    createdAt: '',
    lastUpdatedAt: '',
    ...(author !== undefined ? { author } : {}),
    ...(license !== undefined ? { license: { ...license } } : {}),
    questions: printed,
  }, loadMedia)

  // The record exporter numbers Questions and answers by position, so where
  // each printed Question landed is read back off that numbering.
  const recordIds = new Map<string, { bank: string; question: string; answers: Map<string, string> }>()
  printed.forEach((question, questionIndex) => {
    const record = prepared.record.bank.questions[questionIndex]!
    const recordAnswers = record.choices ?? record.wordBank ?? []
    recordIds.set(question.id, {
      bank: bankId,
      question: record.id,
      answers: new Map(choicesOf(question).map((choice, answerIndex) => [choice.id, recordAnswers[answerIndex]!.id])),
    })
  })
  const questionBanks = [{ id: bankId, record: prepared.record }]

  // A Multipart question travels as a bare position. Its Parts' answer order, answer
  // columns and Work Space are not carried yet — Exam Record 0.1.0 keys
  // presentation by Question and has nowhere to put a Part's — so the
  // imported Exam gives each Part its defaults.
  // Every Section travels, empty ones included, in print order, with its
  // wording in full — an empty string is a part the teacher cleared. A
  // Section has no type. `sectionsOf` has already folded an Exam's legacy
  // per-type wording into its derived Sections.
  const sections = sectionsOf(exam)
  const sectionIndex = new Map(sections.map((section, index) => [section.id, index]))
  // Each Exam Picture Size the teacher set, by the place its picture has
  // among the Question's block pictures (ADR-0050). The record holds the same
  // pictures in the same order as the Question's own document, so a picture
  // is found by counting; were they ever to disagree, the sizes are left out
  // rather than put on the wrong pictures.
  const pictureSizesOf = (question: (typeof printed)[number], index: number): ExamRecordPictureSize[] => {
    const sizes = exam.pictureSizes?.[question.id]
    if (!sizes) return []
    const keys = blockPictureKeysOf(question)
    if (keys.length !== recordBlockPictures(prepared.record.bank.questions[index]!).length) return []
    return keys.flatMap((key, at) => {
      const size = key ? sizes[key] : undefined
      return size !== undefined ? [{ picture: at + 1, size }] : []
    })
  }
  const positions = printed.map((question, questionIndex): ExamRecordPosition => {
    const ids = recordIds.get(question.id)!
    const pictureSizes = pictureSizesOf(question, questionIndex)
    // Only a Work Space the teacher set travels, and every one they set,
    // "None" included whatever the Exam's Paper Style now rules there: a
    // lining style taken after import must not rule lines over it (ADR-0044).
    // The room a style rules is the style's, and the record's `paperStyle`
    // carries it.
    const space = exam.workSpace?.[question.id]
    return {
      question: { bank: ids.bank, question: ids.question },
      section: sectionIndex.get(sectionIdOf(exam, question))!,
      ...(question.type === 'multiple-choice' ? { columns: columnsOf(question) } : {}),
      ...(question.type === 'multiple-choice' || question.type === 'matching'
        ? { answerOrder: orderedChoices(question, arrangement).map(({ id }) => ids.answers.get(id)!) }
        : {}),
      ...(hiddenAnswerIdsOf(question, arrangement).length > 0
        ? { hiddenAnswers: hiddenAnswerIdsOf(question, arrangement).map((id) => ids.answers.get(id)!) }
        : {}),
      // Every Matching position says where its Word Bank prints, and whether
      // the teacher chose it.
      ...(question.type === 'matching' ? { wordBankLayout: wordBankLayoutOf(exam, question) } : {}),
      ...(question.type === 'matching' && exam.wordBankLayoutSet?.[question.id] === true
        ? { wordBankLayoutSet: true }
        : {}),
      ...(takesWorkSpace(question.type) && space && isWorkSpace(space)
        ? { workSpace: { ...space } }
        : {}),
      ...(pictureSizes.length > 0 ? { pictureSizes } : {}),
    }
  })
  const examRecord: ExamRecord = {
    format: EXAM_FORMAT,
    formatVersion: EXAM_FORMAT_VERSION,
    name: exam.title,
    sections: sections.map(({ title, instructions }): ExamRecordSection => ({ title, instructions })),
    ...(exam.headingSize && exam.headingSize !== 'normal' ? { headingSize: exam.headingSize } : {}),
    ...(exam.textSize && exam.textSize !== 'normal' ? { textSize: exam.textSize } : {}),
    ...(exam.paperStyle && exam.paperStyle !== 'standard'
      ? { paperStyle: exam.paperStyle }
      : {}),
    ...(exam.header ? { header: { ...exam.header } } : {}),
    ...(exam.margins ? { margins: { ...exam.margins } } : {}),
    positions,
  }
  return {
    package: {
      format: PACKAGE_FORMAT,
      formatVersion: PACKAGE_FORMAT_VERSION,
      generator: { name: 'Test Parrot', version: QUESTION_BANK_FORMAT_VERSION },
      requiredFeatures: [],
      questionBanks,
      exams: [examRecord],
    },
    files: prepared.files,
  }
}

/** The prepared export with its package recorded, when it carries one. A
 *  package that cannot be built — a Question a bank could not share yet, an
 *  image that will not load — leaves the PDF without one rather than
 *  stopping an export that would otherwise print. */
export async function withExamPackage(
  prepared: PreparedExport,
  source: { exam: Exam; arrangement: Arrangement; ownerOf: QuestionOwner; loadMedia?: QuestionBankMediaLoader },
): Promise<PreparedExport> {
  if (!carriesExamPackage(prepared)) return prepared
  try {
    const carried = await examPackage(source)
    const zip = await writePackageZip(JSON.stringify(carried.package), carried.files)
    return { ...prepared, record: { ...prepared.record, examPackage: zip } }
  } catch (error) {
    console.warn('This PDF will not carry its Exam for import', error)
    return prepared
  }
}
