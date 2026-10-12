// What a question's context menu on the sheet offers for how many incorrect
// answers show (ADR-0038), decided apart from the menu's drawing so it can be
// read and tested on its own.
//
// The menu groups how a question's answers print under "Answer format" —
// Answer columns, Incorrect answers shown and, for a Matching question, its
// Word Bank — and the shuffles under "Vary". "Incorrect answers shown" is
// there for every Multiple Choice question, so a teacher can find it, and
// disabled with the reason when none of the questions it would act on can
// hide an answer.

import { hiddenAnswerIdsOf, shownIncorrectRange, whyEveryAnswerShows, type ShownIncorrectRange } from './hidden-answers'
import type { Arrangement, Question } from './exam'

export type ShownIncorrectMenu =
  | { disabled: false; range: ShownIncorrectRange; shown: number }
  | { disabled: true; hint: string }

const HINTS: Record<NonNullable<ReturnType<typeof whyEveryAnswerShows>>, string> = {
  'no-correct-answer': 'Mark a correct answer first',
  'names-letters': 'An answer names others by letter',
  'nothing-to-hide': 'No incorrect answer can be hidden',
}

/** The "Incorrect answers shown" entry for a menu raised on `question`,
 *  acting on `actedOn` (the selection when `question` is in it): the range
 *  and current count of the first question that may hide answers — `question`
 *  itself when it can — or, when none can, why not. Absent when `question` is
 *  not Multiple Choice. */
export function shownIncorrectMenuOf(
  question: Question,
  actedOn: readonly Question[],
  arrangement: Arrangement,
): ShownIncorrectMenu | null {
  if (question.type !== 'multiple-choice') return null
  const candidates = [question, ...actedOn.filter((other) => other.id !== question.id && other.type === 'multiple-choice')]
  for (const candidate of candidates) {
    const range = shownIncorrectRange(candidate)
    if (range) {
      return { disabled: false, range, shown: range.max - hiddenAnswerIdsOf(candidate, arrangement).length }
    }
  }
  // A missing correct answer is the reason a teacher can most readily fix, so
  // it is the one named when it is any question's.
  const reasons = candidates.map(whyEveryAnswerShows)
  const reason = reasons.find((why) => why === 'no-correct-answer') ?? reasons[0] ?? 'nothing-to-hide'
  return { disabled: true, hint: HINTS[reason] }
}

/** Each count of incorrect answers a question may show, all of them first,
 *  with how the menu says it. */
export function shownIncorrectChoices(range: ShownIncorrectRange): { count: number; label: string }[] {
  const choices: { count: number; label: string }[] = []
  for (let count = range.max; count >= range.min; count -= 1) {
    choices.push({
      count,
      label: count === range.max ? `Show all ${count} incorrect answers` : `Show ${count} of ${range.max} incorrect`,
    })
  }
  return choices
}
