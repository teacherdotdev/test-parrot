import { choiceIdOf, choiceNodesOf } from './question-doc'
import { answeringPartsOf, type Question } from './exam'
import type { AuthoringState, SavedState } from './exam-store'
import type { ExamWorkingCopy, QuestionBank } from './question-bank'

function choiceIds(question: Question | undefined): string[] {
  if (!question || question.type !== 'multiple-choice') return []
  return choiceNodesOf(question.doc).map(choiceIdOf)
}

export function sameStableChoiceIds(left: Question | undefined, right: Question): boolean {
  const before = choiceIds(left)
  const after = choiceIds(right)
  return before.length === after.length && before.every((id) => after.includes(id))
}

function withQuestion(bank: QuestionBank, question: Question): QuestionBank {
  if (!bank.questions.some((candidate) => candidate.id === question.id)) return bank
  return {
    questions: bank.questions.map((candidate) => candidate.id === question.id ? question : candidate),
  }
}

function withoutChoiceArrangement(draft: ExamWorkingCopy, questionId: string): ExamWorkingCopy {
  if (!draft.choiceOrder?.[questionId] && !draft.hiddenAnswers?.[questionId]) return draft
  const choiceOrder = { ...(draft.choiceOrder ?? {}) }
  delete choiceOrder[questionId]
  // Which answers it hid goes with the order: neither describes new answers.
  const hiddenAnswers = { ...(draft.hiddenAnswers ?? {}) }
  delete hiddenAnswers[questionId]
  const { hiddenAnswers: _previous, ...rest } = draft
  void _previous
  return {
    ...rest,
    ...(draft.choiceOrder ? { choiceOrder } : {}),
    ...(Object.keys(hiddenAnswers).length > 0 ? { hiddenAnswers } : {}),
  }
}

/** The ids of the Parts and Subparts whose answers changed identity between two
 *  revisions of a Multipart question — one added, removed, or given a different set of choices.
 *  Their answer arrangements no longer describe anything, exactly as a
 *  question's does not. */
function partsWithNewChoices(left: Question | undefined, right: Question): string[] {
  const before = new Map((left ? answeringPartsOf(left) : []).map((part) => [part.id, part]))
  return answeringPartsOf(right).flatMap((part) => {
    const prior = before.get(part.id)
    const same = prior
      && prior.choices.length === part.choices.length
      && prior.choices.every((choice) => part.choices.some(({ id }) => id === choice.id))
    return same ? [] : [part.id]
  })
}

function withoutPartArrangements(draft: ExamWorkingCopy, partIds: readonly string[]): ExamWorkingCopy {
  return partIds.reduce(withoutChoiceArrangement, draft)
}

/** Apply one already-durable canonical edit to one Exam projection. This is not
 * an Exam command: dirty state and all unrelated Working Copy presentation are
 * retained exactly, and a changed choice identity set merely drops the now
 * incompatible answer arrangement. */
export function withCanonicalQuestionProjection(
  working: AuthoringState,
  saved: SavedState | null,
  question: Question,
): { working: AuthoringState; saved: SavedState | null } {
  const prior = working.questionBank.questions.find((candidate) => candidate.id === question.id)
    ?? saved?.questionBank.questions.find((candidate) => candidate.id === question.id)
  const stableChoices = sameStableChoiceIds(prior, question)
  const changedParts = partsWithNewChoices(prior, question)
  const nextWorkingBank = withQuestion(working.questionBank, question)
  const nextSavedBank = saved ? withQuestion(saved.questionBank, question) : null
  const project = (draft: ExamWorkingCopy) => withoutPartArrangements(
    stableChoices ? draft : withoutChoiceArrangement(draft, question.id),
    changedParts,
  )
  return {
    working: {
      ...working,
      questionBank: nextWorkingBank,
      workingCopy: project(working.workingCopy),
    },
    saved: saved ? {
      ...saved,
      questionBank: nextSavedBank!,
      workingCopy: project(saved.workingCopy),
    } : null,
  }
}
