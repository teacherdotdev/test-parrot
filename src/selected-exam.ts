// The compatibility boundary between Question Bank authoring and the export
// pipeline.
//
// Rendering, pagination and export all speak the older vocabulary: an `Exam`
// holding questions, plus a `Arrangement` holding an ordering. Authoring speaks the
// newer one: a Question Bank of canonical content, and a Working Copy of ordered
// references into it. This module is the whole of the translation, and it is
// deliberately narrow and disposable — when export-only immutable Arrangements
// arrive (ADR-0003), this is the piece that goes, not the model behind it.
//
// The split between the two halves is what keeps repagination cheap. The
// derived `Exam` carries the *content*: the referenced questions in Question
// Bank order, so its identity survives a pure reordering. The derived `Arrangement`
// carries the *arrangement*: the Working Copy's question and recorded answer
// orders. An absent answer order means answers print in the authored order.
// Nothing downstream can tell the difference between this and an edited
// Arrangement, and nothing here writes anything back.

import { isExamHeader, sameExamHeader } from './page-header'
import { isPageMargins, sameMargins } from './page-margins'
import { DEFAULT_PAPER_STYLE, isPaperStyle } from './paper-style'
import {
  DEFAULT_HEADING_SIZE,
  isHeadingSize,
  isTextSize,
  DEFAULT_TEXT_SIZE,
  isSectionHeadings,
  sameSectionHeadings,
} from './section-headings'
import {
  columnsOf,
  readExamSection,
  isWordBankLayout,
  isWorkSpace,
  sameSectionOf,
  sameSections,
  answeringPartsOf,
  presentationIdsOf,
  type ColumnSetting,
  type Exam,
  type Arrangement,
  type Question,
  type WordBankLayout,
  type WorkSpace,
} from './exam'
import type { ProseMirrorJSON } from './question-doc'
import { bankQuestionById, type ExamWorkingCopy, type QuestionBank } from './question-bank'

function sameStrings(
  left: Readonly<Record<string, string | true>> | undefined,
  right: Readonly<Record<string, string | true>> | undefined,
): boolean {
  const entries = Object.entries(left ?? {})
  return entries.length === Object.keys(right ?? {}).length
    && entries.every(([key, value]) => right?.[key] === value)
}

function sameWorkSpace(
  left: Record<string, WorkSpace> | undefined,
  right: Record<string, WorkSpace> | undefined,
): boolean {
  const entries = Object.entries(left ?? {})
  const other = right ?? {}
  return entries.length === Object.keys(other).length
    && entries.every(([questionId, space]) => {
      const match = other[questionId]
      return match !== undefined
        && match.height === space.height
        && match.style === space.style
        && match.fill === space.fill
    })
}

/** A Multipart question with this Exam's answer columns written onto its Multiple
 *  Choice Parts and Subparts, as a question's own `columns` is overridden: the
 *  nodes carry the layout each starts with, and the Working Copy the layout this
 *  Exam gives it. The same question comes back when nothing differs, so a
 *  consumer comparing by identity sees no change. */
function withPartColumns(
  question: Question,
  columns: Record<string, ColumnSetting>,
): Question {
  const parts = answeringPartsOf(question)
  if (!parts.some((part) => columns[part.id] !== undefined && columns[part.id] !== part.columns)) {
    return question
  }
  const withColumns = (node: ProseMirrorJSON): ProseMirrorJSON => {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>
    const id = typeof attrs.id === 'string' ? attrs.id : ''
    const own = columns[id] === undefined ? node : { ...node, attrs: { ...attrs, columns: columns[id] } }
    // A Part that holds Subparts has its columns set on each Subpart.
    return !Array.isArray(own.content)
      ? own
      : {
          ...own,
          content: (own.content as ProseMirrorJSON[]).map((child) =>
            child.type !== 'multipartSubparts' || !Array.isArray(child.content)
              ? child
              : { ...child, content: (child.content as ProseMirrorJSON[]).map(withColumns) },
          ),
        }
  }
  const content = Array.isArray(question.doc.content)
    ? (question.doc.content as ProseMirrorJSON[])
    : []
  return {
    ...question,
    doc: {
      ...question.doc,
      content: content.map((node) =>
        node.type !== 'multipartParts' || !Array.isArray(node.content)
          ? node
          : {
              ...node,
              content: (node.content as ProseMirrorJSON[]).map(withColumns),
            },
      ),
    },
  }
}

/** The `Exam` plus ordering that one Working Copy currently amounts to. */
export type SelectedExam = {
  exam: Exam
  arrangement: Arrangement
}

/** The Arrangement identity the Working Copy presents itself under. A Working Copy is
 *  not a Arrangement, so this is a fixed label rather than a stored one: export
 *  relabels every published Arrangement from A anyway. */
export const EXAM_DRAFT_VERSION_ID = 'exam-draft'
export const EXAM_DRAFT_VERSION_LETTER = 'A'

/**
 * The Working Copy as rendering and export see it: the referenced Question Bank
 * records and nothing else, arranged in Working Copy order.
 *
 * `previous` is an optimisation, not a cache with a lifetime: when the derived
 * content or the derived ordering is unchanged, the object from last time is
 * returned rather than an equal copy, so a consumer that re-measures whenever
 * the exam changes is not made to re-measure by a reorder — or by a render.
 */
export function selectedExam(
  bank: QuestionBank,
  draft: ExamWorkingCopy,
  previous?: SelectedExam | null,
): SelectedExam {
  const referenced = new Set(draft.questionIds)
  const bankedQuestions = bank.questions.filter((question) => referenced.has(question.id))
  // Column layout belongs to this Exam Working Copy. Preserve a canonical
  // Question's authored/default layout only until this Exam specifies one.
  const columns = draft.columns ?? {}
  const questions = bankedQuestions.map((question) =>
    question.type === 'multipart'
      ? withPartColumns(question, columns)
      : columns[question.id] === undefined || columns[question.id] === columnsOf(question)
        ? question
        : { ...question, columns: columns[question.id]! },
  )
  // Work space is this Exam's presentation too. Only referenced questions —
  // and the Parts of referenced Multipart questions — carry one, and only a
  // readable record, so nothing downstream has to guard.
  const presented = new Set(bankedQuestions.flatMap(presentationIdsOf))
  const workSpace: Record<string, WorkSpace> = {}
  for (const [id, space] of Object.entries(draft.workSpace ?? {})) {
    if (presented.has(id) && isWorkSpace(space)) workSpace[id] = space
  }
  const hasAnyWorkSpace = Object.keys(workSpace).length > 0
  // So is where a Matching question's Word Bank prints: only a referenced
  // Matching question's, and only a choice other than Auto.
  const matchingIds = new Set(
    bankedQuestions.filter((question) => question.type === 'matching').map(({ id }) => id),
  )
  const wordBankLayout: Record<string, WordBankLayout> = {}
  for (const [id, layout] of Object.entries(draft.wordBankLayout ?? {})) {
    if (matchingIds.has(id) && isWordBankLayout(layout)) wordBankLayout[id] = layout
  }
  const hasAnyWordBankLayout = Object.keys(wordBankLayout).length > 0
  // And which of them the teacher chose: only a referenced Matching question's.
  const wordBankLayoutSet: Record<string, true> = {}
  for (const [id, set] of Object.entries(draft.wordBankLayoutSet ?? {})) {
    if (matchingIds.has(id) && set === true) wordBankLayoutSet[id] = true
  }
  const hasAnyWordBankLayoutSet = Object.keys(wordBankLayoutSet).length > 0
  // How wide this Exam prints a referenced question's pictures (ADR-0050):
  // only readable sizes, kept to a share of the container.
  const pictureSizes: Record<string, Record<string, number>> = {}
  for (const [id, sizes] of Object.entries(draft.pictureSizes ?? {})) {
    if (!referenced.has(id) || typeof sizes !== 'object' || sizes === null) continue
    const readable = Object.fromEntries(Object.entries(sizes).filter(([key, size]) =>
      key !== '' && typeof size === 'number' && Number.isFinite(size) && size > 0 && size <= 1))
    if (Object.keys(readable).length > 0) pictureSizes[id] = readable
  }
  const hasAnyPictureSizes = Object.keys(pictureSizes).length > 0
  // Section wording and size are this Exam's presentation too, carried only
  // when readable and only when they say something other than the default.
  const sectionHeadings =
    draft.sectionHeadings && isSectionHeadings(draft.sectionHeadings)
      && Object.keys(draft.sectionHeadings).length > 0
      ? draft.sectionHeadings
      : undefined
  // Sections are this Exam's structure: every readable stored Section, empty
  // ones included, and the placement of each question it still references.
  const sections = Array.isArray(draft.sections)
    ? draft.sections.flatMap((value) => {
        const section = readExamSection(value)
        return section ? [section] : []
      })
    : undefined
  const sectionOf: Record<string, string> = {}
  for (const [id, section] of Object.entries(draft.sectionOf ?? {})) {
    if (referenced.has(id) && typeof section === 'string') sectionOf[id] = section
  }
  const hasAnySectionOf = Object.keys(sectionOf).length > 0
  const headingSize =
    isHeadingSize(draft.headingSize) && draft.headingSize !== DEFAULT_HEADING_SIZE
      ? draft.headingSize
      : undefined
  const textSize =
    isTextSize(draft.textSize) && draft.textSize !== DEFAULT_TEXT_SIZE ? draft.textSize : undefined
  const paperStyle =
    isPaperStyle(draft.paperStyle) && draft.paperStyle !== DEFAULT_PAPER_STYLE
      ? draft.paperStyle
      : undefined
  const header =
    isExamHeader(draft.header) && Object.keys(draft.header).length > 0 ? draft.header : undefined
  const margins =
    isPageMargins(draft.margins) && !sameMargins(draft.margins, undefined) ? draft.margins : undefined
  const exam: Exam =
    previous
    && previous.exam.title === draft.title
    && previous.exam.questions.length === questions.length
    && previous.exam.questions.every((question, index) => question === questions[index])
    && sameWorkSpace(previous.exam.workSpace, hasAnyWorkSpace ? workSpace : undefined)
    && sameStrings(previous.exam.wordBankLayout, hasAnyWordBankLayout ? wordBankLayout : undefined)
    && sameStrings(previous.exam.wordBankLayoutSet, hasAnyWordBankLayoutSet ? wordBankLayoutSet : undefined)
    && JSON.stringify(previous.exam.pictureSizes ?? null) === JSON.stringify(hasAnyPictureSizes ? pictureSizes : null)
    && sameSections(previous.exam.sections, sections)
    && (previous.exam.sections === undefined) === (sections === undefined)
    && sameSectionOf(previous.exam.sectionOf, hasAnySectionOf ? sectionOf : undefined)
    && sameSectionHeadings(previous.exam.sectionHeadings, sectionHeadings)
    && previous.exam.headingSize === headingSize
    && sameExamHeader(previous.exam.header, header)
    && previous.exam.textSize === textSize
    && previous.exam.paperStyle === paperStyle
    && previous.exam.margins === margins
      ? previous.exam
      : {
          title: draft.title,
          questions,
          ...(hasAnyWorkSpace ? { workSpace } : {}),
          ...(hasAnyWordBankLayout ? { wordBankLayout } : {}),
          ...(hasAnyWordBankLayoutSet ? { wordBankLayoutSet } : {}),
          ...(hasAnyPictureSizes ? { pictureSizes } : {}),
          ...(sections ? { sections } : {}),
          ...(hasAnySectionOf ? { sectionOf } : {}),
          ...(sectionHeadings ? { sectionHeadings } : {}),
          ...(headingSize ? { headingSize } : {}),
          ...(textSize ? { textSize } : {}),
          ...(paperStyle ? { paperStyle } : {}),
          ...(header ? { header } : {}),
          ...(margins ? { margins } : {}),
        }

  // Only ids the bank can resolve: an ordering may tolerate a stranger, but an
  // Working Copy referencing content that is not there is not something export
  // should have to reason about.
  const questionOrder = draft.questionIds.filter((id) => bankQuestionById(bank, id))
  const choiceOrder = draft.choiceOrder ?? {}
  const sameChoiceOrder = (left: Record<string, string[]>, right: Record<string, string[]>) => {
    const entries = Object.entries(left)
    return entries.length === Object.keys(right).length
      && entries.every(([questionId, choices]) =>
        right[questionId]?.length === choices.length
        && right[questionId].every((choiceId, index) => choiceId === choices[index]),
      )
  }
  const hiddenAnswers = draft.hiddenAnswers ?? {}
  const arrangement: Arrangement =
    previous
    && previous.arrangement.questionOrder.length === questionOrder.length
    && previous.arrangement.questionOrder.every((id, index) => id === questionOrder[index])
    && sameChoiceOrder(previous.arrangement.choiceOrder, choiceOrder)
    && sameChoiceOrder(previous.arrangement.hiddenAnswers ?? {}, hiddenAnswers)
      ? previous.arrangement
      : {
          id: EXAM_DRAFT_VERSION_ID,
          letter: EXAM_DRAFT_VERSION_LETTER,
          questionOrder,
          // With no recorded order answers print as authored. Selection-scoped
          // answer shuffling records only this presentation state, never
          // changes the canonical Question Content in the Question Bank.
          choiceOrder,
          // Likewise the incorrect answers a question hides (ADR-0038).
          ...(Object.keys(hiddenAnswers).length > 0 ? { hiddenAnswers } : {}),
        }

  return previous && exam === previous.exam && arrangement === previous.arrangement
    ? previous
    : { exam, arrangement }
}
