// The Question Bank and the Working Copy.
//
// The Question Bank holds every canonical question exactly once. The Working Copy
// holds an ordered list of *references* into it — never copies — so editing
// Question Content changes it everywhere it is referenced, and Removing a
// question from the Working Copy leaves its Question Bank record untouched.
//
// A question id appears at most once in a Working Copy: a Working Copy is a
// selection, not a bag. Everything here is pure and total; the store in
// `exam-store.ts` is what makes these operations atomic, undoable and durable,
// and `selected-exam.ts` is what turns the pair into the `Exam` that rendering
// and export consume.

import { DEFAULT_EXAM_TITLE, type Question, type QuestionPlacement } from './exam'

/** Canonical Question Content, stored once per question. */
export type QuestionBank = {
  questions: Question[]
}

/** The mutable selection a teacher is preparing for export: the exam's name and
 *  the ordered Question Bank references on it. Not a Arrangement. */
export type ExamWorkingCopy = {
  title: string
  questionIds: string[]
  /** Answer-column layout is an Exam arrangement, not canonical Question
   * Content: the same Question may be laid out differently in another Exam. */
  columns?: Record<string, import('./exam').ColumnSetting>
  /** Room for a student's work below a Short Answer question, keyed by
   *  Question Bank record id. Exam presentation like `columns`, so it is set
   *  on the exam sheet and never in the question editor. Absent means none. */
  workSpace?: Record<string, import('./exam').WorkSpace>
  /** Where each Matching question's Word Bank prints on this Exam, keyed by
   *  Question Bank record id: Beside or Above, stored for every Matching
   *  position as it arrives. Exam presentation like `columns`. */
  wordBankLayout?: Record<string, import('./exam').WordBankLayout>
  /** The Matching positions whose layout the teacher chose from the sheet,
   *  which a change of Paper Style leaves where they are (ADR-0044). A
   *  layout given on arrival is not one. */
  wordBankLayoutSet?: Record<string, true>
  /** How wide this Exam prints a question's block pictures, keyed by Question
   *  Bank record id and then by picture: Exam presentation like `workSpace`,
   *  set on the sheet, never changing the Question. Absent means as authored. */
  pictureSizes?: Record<string, Record<string, number>>
  /** The Working Copy's answer arrangement, keyed by Question Bank record id.
   *  Absent means authored order, preserving compatibility with drafts stored
   *  before answer shuffling existed. */
  choiceOrder?: Record<string, string[]>
  /** The incorrect answers each Multiple Choice question leaves off on this
   *  Exam, keyed by Question Bank record id: Exam presentation like
   *  `choiceOrder` (ADR-0038). Absent shows every answer. */
  hiddenAnswers?: Record<string, string[]>
  /** This Exam's Question Sections, in print order, and which one each
   *  referenced question belongs to. Absent on a Working Copy written before
   *  Sections were stored, which then reads as one Section per type
   *  (`sectionsOf` in exam.ts); the first structural edit stores them. */
  sections?: import('./exam').ExamSection[]
  sectionOf?: Record<string, string>
  /** The rewording a Working Copy written before Sections were stored gave
   *  each type's one Section, and the size every heading prints at. Exam
   *  presentation like `workSpace`; absent means the defaults. */
  sectionHeadings?: import('./section-headings').SectionHeadings
  headingSize?: import('./section-headings').HeadingSize
  textSize?: import('./section-headings').TextSize
  /** How every question on this Exam prints; absent means Standard. */
  paperStyle?: import('./paper-style').PaperStyle
  /** This Exam's own test-page header lines; absent means the default. */
  header?: import('./page-header').ExamHeader
  /** This Exam's Page Margins, in inches; absent means the default. */
  margins?: import('./page-margins').PageMargins
}

export function createQuestionBank(): QuestionBank {
  return { questions: [] }
}

export function createWorkingCopy(title: string = DEFAULT_EXAM_TITLE): ExamWorkingCopy {
  return { title, questionIds: [], choiceOrder: {} }
}

export function bankQuestionById(
  bank: QuestionBank,
  questionId: string,
): Question | undefined {
  return bank.questions.find((question) => question.id === questionId)
}

/** Whether the Working Copy currently references this Question Bank record. */
export function isInWorkingCopy(draft: ExamWorkingCopy, questionId: string): boolean {
  return draft.questionIds.includes(questionId)
}

/** Adds a canonical question, or replaces the content of one already banked.
 *  New questions land at the end: the bank's stored order is the order the
 *  questions were authored in. */
export function withQuestionBanked(
  bank: QuestionBank,
  question: Question,
): QuestionBank {
  const known = bank.questions.some((item) => item.id === question.id)
  return {
    questions: known
      ? bank.questions.map((item) => (item.id === question.id ? question : item))
      : [...bank.questions, question],
  }
}

/**
 * Adds one reference to the Working Copy, beside `targetQuestionId` when that
 * question is already on it and at the end otherwise.
 *
 * `placement` says which side of the target the reference lands on. `'before'`
 * exists because it is the only way to name the first position in a Question
 * Section: there is no question there to sit after.
 *
 * A question already referenced is left exactly where it is: a reference occurs
 * at most once, so adding one twice is not a move.
 */
export function withReferenceAdded(
  draft: ExamWorkingCopy,
  questionId: string,
  targetQuestionId?: string | null,
  placement: QuestionPlacement = 'after',
): ExamWorkingCopy {
  if (isInWorkingCopy(draft, questionId)) return draft
  const index = targetQuestionId
    ? draft.questionIds.indexOf(targetQuestionId)
    : -1
  const questionIds = [...draft.questionIds]
  questionIds.splice(
    index < 0 ? questionIds.length : placement === 'before' ? index : index + 1,
    0,
    questionId,
  )
  return { ...draft, questionIds }
}

/** Removes references from the Working Copy. The Question Bank is not this
 *  function's business: Remove excludes, it never deletes. `partIds` are the
 *  Parts of any Multipart question among them — only the bank knows what they are — whose
 *  answer order, columns and work space this Exam set under their own ids. */
export function withReferencesRemoved(
  draft: ExamWorkingCopy,
  questionIds: readonly string[],
  partIds: readonly string[] = [],
): ExamWorkingCopy {
  const removing = new Set(questionIds)
  const remaining = draft.questionIds.filter((id) => !removing.has(id))
  if (remaining.length === draft.questionIds.length) return draft

  // A removed question no longer has an arrangement on this Working Copy. This
  // also means adding it again starts from its canonical authored answer order.
  const choiceOrder = draft.choiceOrder
    ? { ...draft.choiceOrder }
    : undefined
  const hiddenAnswers = draft.hiddenAnswers
    ? { ...draft.hiddenAnswers }
    : undefined
  const columns = draft.columns
    ? { ...draft.columns }
    : undefined
  const workSpace = draft.workSpace
    ? { ...draft.workSpace }
    : undefined
  const wordBankLayout = draft.wordBankLayout
    ? { ...draft.wordBankLayout }
    : undefined
  const wordBankLayoutSet = draft.wordBankLayoutSet
    ? { ...draft.wordBankLayoutSet }
    : undefined
  const sectionOf = draft.sectionOf
    ? { ...draft.sectionOf }
    : undefined
  const pictureSizes = draft.pictureSizes
    ? { ...draft.pictureSizes }
    : undefined
  for (const id of [...removing, ...partIds]) {
    delete pictureSizes?.[id]
    delete wordBankLayoutSet?.[id]
    delete choiceOrder?.[id]
    delete hiddenAnswers?.[id]
    delete columns?.[id]
    delete workSpace?.[id]
    delete wordBankLayout?.[id]
    delete sectionOf?.[id]
  }
  return {
    ...draft,
    questionIds: remaining,
    ...(choiceOrder ? { choiceOrder } : {}),
    ...(hiddenAnswers ? { hiddenAnswers } : {}),
    ...(columns ? { columns } : {}),
    ...(workSpace ? { workSpace } : {}),
    ...(wordBankLayout ? { wordBankLayout } : {}),
    ...(wordBankLayoutSet ? { wordBankLayoutSet } : {}),
    ...(sectionOf ? { sectionOf } : {}),
    ...(pictureSizes ? { pictureSizes } : {}),
  }
}

/** The Working Copy with a structural edit's Sections written back: every
 *  Section stored, every question placed, and its references in the order the
 *  Sections print them. The legacy per-type wording stays: the Sections made
 *  from it no longer read it, but a Section begun later for a type the Exam
 *  had none of starts from what the teacher wrote for that type. */
export function withSectionLayout(
  draft: ExamWorkingCopy,
  layout: import('./exam').SectionLayout,
): ExamWorkingCopy {
  return {
    ...withReferenceOrder(draft, layout.questionOrder),
    sections: layout.sections,
    sectionOf: layout.sectionOf,
  }
}

/** The Working Copy's references reordered wholesale — how a move records its
 *  result. Ids the draft does not reference are ignored, and references the
 *  new order forgets keep their place at the end, so a reorder can never
 *  silently Remove a question. */
export function withReferenceOrder(
  draft: ExamWorkingCopy,
  questionIds: readonly string[],
): ExamWorkingCopy {
  const referenced = new Set(draft.questionIds)
  const ordered: string[] = []
  for (const id of questionIds) {
    if (referenced.delete(id)) ordered.push(id)
  }
  for (const id of draft.questionIds) {
    if (referenced.delete(id)) ordered.push(id)
  }
  if (ordered.every((id, index) => id === draft.questionIds[index])) return draft
  return { ...draft, questionIds: ordered }
}

/** Records which incorrect answers each question hides, without changing
 *  canonical Question Content. A question with none hidden has no entry, and
 *  an Exam that hides nothing has no `hiddenAnswers` at all. */
export function withHiddenAnswers(
  draft: ExamWorkingCopy,
  hiddenAnswers: Record<string, string[]>,
): ExamWorkingCopy {
  const next = Object.fromEntries(
    Object.entries(hiddenAnswers).filter(([, ids]) => ids.length > 0),
  )
  const current = draft.hiddenAnswers ?? {}
  if (
    Object.keys(current).length === Object.keys(next).length
    && Object.entries(next).every(([questionId, ids]) =>
      current[questionId]?.length === ids.length
      && current[questionId].every((id, index) => id === ids[index]),
    )
  ) return draft
  const { hiddenAnswers: _previous, ...rest } = draft
  void _previous
  return Object.keys(next).length > 0 ? { ...rest, hiddenAnswers: next } : rest
}

/** Records a new answer arrangement without changing canonical Question
 * Content. A missing order and an explicit empty order mean the same thing. */
export function withChoiceOrder(
  draft: ExamWorkingCopy,
  choiceOrder: Record<string, string[]>,
): ExamWorkingCopy {
  const current = draft.choiceOrder ?? {}
  const currentEntries = Object.entries(current)
  const nextEntries = Object.entries(choiceOrder)
  if (
    currentEntries.length === nextEntries.length
    && nextEntries.every(([questionId, choices]) =>
      current[questionId]?.length === choices.length
      && current[questionId].every((choiceId, index) => choiceId === choices[index]),
    )
  ) return draft
  return { ...draft, choiceOrder }
}

