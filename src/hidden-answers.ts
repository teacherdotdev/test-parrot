// Hidden Answers: the incorrect answers an Exam leaves off a Multiple Choice
// question (ADR-0038).
//
// A Question in its bank keeps every answer it was written with; a position on
// an Exam may show fewer of its incorrect ones. Which ones is Exam
// presentation, like answer order, so it lives in an arrangement beside
// `choiceOrder` and never touches Question Content. Like an order, it is
// tolerated rather than validated: an id that is no longer an incorrect,
// unlocked answer of the question is ignored, and so the rules below are
// applied every time it is read, not only when it is written —
//
// - the correct answer and every Locked Answer always show;
// - at least one incorrect answer always shows;
// - nothing hides while no answer is marked correct, since there would be no
//   telling a distractor from the answer, nor beside an answer that names
//   others by letter, as “Both A and B”, whose letters hiding would change.
//
// The answers shown keep the arrangement's order and close up: a Locked
// Answer last stays last, as “All of the above” must.

import {
  choicesOf,
  movableAnswerIds,
  orderedChoices,
  shuffleSelectedAnswers,
  withAnswersMoved,
  type Arrangement,
  type Choice,
  type Exam,
  type Question,
  type RandomSource,
} from './exam'
import { namesAnswersByLetter } from './locked-answers'
import { plainTextOf } from './question-doc'

/** How many incorrect answers a question may show: from `min` to `max`, which
 *  is all of them. */
export type ShownIncorrectRange = { min: number; max: number }

/** What the sheet says about a question that hides answers. `paused` names
 *  why one the Exam asks to hide answers from shows them all anyway. */
export type AnswerVisibility = {
  incorrect: number
  shown: number
  paused?: 'no-correct-answer' | 'names-letters'
}

type Eligibility =
  | { ok: true; incorrect: Choice[]; hideable: string[]; range: ShownIncorrectRange }
  | { ok: false; incorrect: Choice[]; reason?: AnswerVisibility['paused'] }

function eligibilityOf(question: Question): Eligibility {
  if (question.type !== 'multiple-choice') return { ok: false, incorrect: [] }
  const choices = choicesOf(question)
  const incorrect = choices.filter((choice) => !choice.correct)
  if (choices.length - incorrect.length !== 1) {
    return { ok: false, incorrect, reason: 'no-correct-answer' }
  }
  if (choices.some((choice) => choice.locked && namesAnswersByLetter(plainTextOf(choice.node)))) {
    return { ok: false, incorrect, reason: 'names-letters' }
  }
  const hideable = incorrect.filter((choice) => !choice.locked).map(({ id }) => id)
  const min = Math.max(1, incorrect.length - hideable.length)
  const max = incorrect.length
  if (min >= max) return { ok: false, incorrect }
  return { ok: true, incorrect, hideable, range: { min, max } }
}

/** The answers an arrangement may hide from this question: its incorrect,
 *  unlocked ones, or none when it must show every answer it has. */
export function hideableAnswerIdsOf(question: Question): string[] {
  const eligibility = eligibilityOf(question)
  return eligibility.ok ? eligibility.hideable : []
}

/** Why a Multiple Choice question must show every answer it has, or null
 *  when it may hide some: no answer is marked correct, a Locked Answer names
 *  others by letter, or no incorrect answer is free to hide. */
export function whyEveryAnswerShows(
  question: Question,
): 'no-correct-answer' | 'names-letters' | 'nothing-to-hide' | null {
  const eligibility = eligibilityOf(question)
  if (eligibility.ok) return null
  return eligibility.reason ?? 'nothing-to-hide'
}

/** How many incorrect answers this question may show, or null when it must
 *  show every answer it has. */
export function shownIncorrectRange(question: Question): ShownIncorrectRange | null {
  const eligibility = eligibilityOf(question)
  return eligibility.ok ? eligibility.range : null
}

function requestedHidden(question: Question, arrangement: Arrangement): string[] {
  return arrangement.hiddenAnswers?.[question.id] ?? []
}

/** The answers an arrangement hides from this question, in the order it named
 *  them, once every rule is applied. */
export function hiddenAnswerIdsOf(question: Question, arrangement: Arrangement): string[] {
  const eligibility = eligibilityOf(question)
  if (!eligibility.ok) return []
  const hideable = new Set(eligibility.hideable)
  const hidden = [...new Set(requestedHidden(question, arrangement))].filter((id) => hideable.has(id))
  // Showing too few is read as showing the fewest allowed: the last answers
  // named come back first.
  const most = eligibility.incorrect.length - eligibility.range.min
  return hidden.slice(0, most)
}

/** The answers this question prints in this arrangement, in order: every
 *  answer but the hidden ones, lettered by their place here. */
export function shownChoices(question: Question, arrangement: Arrangement): Choice[] {
  const hidden = new Set(hiddenAnswerIdsOf(question, arrangement))
  const ordered = orderedChoices(question, arrangement)
  return hidden.size === 0 ? ordered : ordered.filter((choice) => !hidden.has(choice.id))
}

/** What to tell the teacher about a question the arrangement asks to hide
 *  answers from, or undefined when it asks nothing of the kind. */
export function answerVisibilityOf(
  question: Question,
  arrangement: Arrangement,
): AnswerVisibility | undefined {
  if (requestedHidden(question, arrangement).length === 0) return undefined
  const eligibility = eligibilityOf(question)
  if (!eligibility.ok) {
    return eligibility.reason
      ? { incorrect: eligibility.incorrect.length, shown: eligibility.incorrect.length, paused: eligibility.reason }
      : undefined
  }
  const hidden = hiddenAnswerIdsOf(question, arrangement).length
  if (hidden === 0) return undefined
  return { incorrect: eligibility.incorrect.length, shown: eligibility.incorrect.length - hidden }
}

/** The sheet's line for a question that hides answers. */
export function answerVisibilityNote(visibility: AnswerVisibility): string {
  if (visibility.paused === 'no-correct-answer') {
    return 'Showing every answer: mark the correct one to hide incorrect answers'
  }
  if (visibility.paused === 'names-letters') {
    return 'Showing every answer: a locked answer names others by letter'
  }
  const hidden = visibility.incorrect - visibility.shown
  return `Showing ${visibility.shown} of ${visibility.incorrect} incorrect answers · ${hidden} hidden`
}

function sample(ids: readonly string[], count: number, random: RandomSource): string[] {
  const pool = [...ids]
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[pool[index], pool[swap]] = [pool[swap]!, pool[index]!]
  }
  return pool.slice(0, count)
}

function withHidden(arrangement: Arrangement, questionId: string, hidden: readonly string[]): Arrangement {
  const hiddenAnswers = { ...(arrangement.hiddenAnswers ?? {}) }
  if (hidden.length > 0) hiddenAnswers[questionId] = [...hidden]
  else delete hiddenAnswers[questionId]
  return { ...arrangement, hiddenAnswers }
}

/**
 * Has each selected eligible question show `count` incorrect answers, clamped
 * to what it allows; `Infinity` shows them all. Hiding more hides answers
 * still showing, at random; showing more brings hidden ones back, at random,
 * so what was already showing stays. A question that cannot hide answers, and
 * one already showing that many, is left alone.
 */
export function withShownIncorrect(
  exam: Exam,
  arrangement: Arrangement,
  questionIds: readonly string[],
  count: number,
  random: RandomSource,
): Arrangement {
  const selected = new Set(questionIds)
  let result = arrangement
  for (const question of exam.questions) {
    if (!selected.has(question.id)) continue
    const eligibility = eligibilityOf(question)
    if (!eligibility.ok) continue
    const { min, max } = eligibility.range
    const target = Math.max(min, Math.min(max, count))
    const toHide = eligibility.incorrect.length - target
    const hidden = hiddenAnswerIdsOf(question, result)
    if (hidden.length === toHide && requestedHidden(question, result).length === toHide) continue
    let next: string[]
    if (hidden.length > toHide) {
      const returning = new Set(sample(hidden, hidden.length - toHide, random))
      next = hidden.filter((id) => !returning.has(id))
    } else {
      const showing = eligibility.hideable.filter((id) => !hidden.includes(id))
      next = [...hidden, ...sample(showing, toHide - hidden.length, random)]
    }
    result = withHidden(result, question.id, next)
  }
  return result
}

function shownSequence(order: readonly string[], hidden: ReadonlySet<string>): string {
  return order.filter((id) => !hidden.has(id)).join('\u0000')
}

/**
 * Vary's Shuffle answers: every selected question's answers shuffled as
 * `shuffleSelectedAnswers` shuffles them, and, for a question that hides some
 * of its incorrect answers, which ones are hidden drawn again too — as many as
 * before, never the correct answer or a Locked Answer. What a student sees
 * changes whenever it can: a draw that shows the same answers in the same
 * order is drawn again, and the shown answers are rotated if every draw does.
 */
export function varySelectedAnswers(
  exam: Exam,
  arrangement: Arrangement,
  questionIds: readonly string[],
  random: RandomSource,
): Arrangement {
  const selected = new Set(questionIds)
  const hiding = exam.questions.filter(
    (question) => selected.has(question.id) && hiddenAnswerIdsOf(question, arrangement).length > 0,
  )
  const hidingIds = new Set(hiding.map(({ id }) => id))
  let result = shuffleSelectedAnswers(
    exam,
    arrangement,
    questionIds.filter((id) => !hidingIds.has(id)),
    random,
  )
  for (const question of hiding) {
    const eligibility = eligibilityOf(question)
    if (!eligibility.ok) continue
    const current = orderedChoices(question, result)
    const hidden = hiddenAnswerIdsOf(question, result)
    const before = shownSequence(current.map(({ id }) => id), new Set(hidden))
    const movable = movableAnswerIds(current)
    let order = current.map(({ id }) => id)
    let nextHidden = hidden
    for (let attempt = 0; attempt < 20; attempt += 1) {
      nextHidden = sample(eligibility.hideable, hidden.length, random)
      order = withAnswersMoved(current, sample(movable, movable.length, random))
      if (shownSequence(order, new Set(nextHidden)) !== before) break
    }
    if (shownSequence(order, new Set(nextHidden)) === before) {
      // Every draw came out the same: rotate the shown answers that may move.
      const hiddenSet = new Set(nextHidden)
      const lockedIds = new Set(current.filter((choice) => choice.locked).map(({ id }) => id))
      const slots = order.flatMap((id, index) => (hiddenSet.has(id) || lockedIds.has(id) ? [] : [index]))
      if (slots.length > 1) {
        const rotated = [...slots.slice(1), slots[0]!].map((slot) => order[slot]!)
        order = [...order]
        slots.forEach((slot, index) => {
          order[slot] = rotated[index]!
        })
      }
    }
    result = withHidden(
      { ...result, choiceOrder: { ...result.choiceOrder, [question.id]: order } },
      question.id,
      nextHidden,
    )
  }
  return result
}
