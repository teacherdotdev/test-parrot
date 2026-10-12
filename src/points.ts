// Points: what answering something is worth (ADR-0042).
//
// Points are stored only on what a student answers — a Multiple Choice,
// True/False, Short Answer or Matching Question, or a Part or Subpart that
// answers — and everything larger is counted from them here: a Multipart
// question's Points and an Exam's total are sums, never stored, so they can
// never disagree with their parts.
//
// Unpointed is not zero. Something with no Points adds nothing to a sum, and a
// sum over nothing with Points is no Points at all rather than 0, so an Exam whose
// Questions nobody has given Points shows no total.

import { answeringPartsOf, type Question } from './exam'
import { readPoints, type ProseMirrorJSON } from './question-doc'

export { parsePointsInput, readPoints } from './question-doc'

/** Whether Points are set on the Question itself, rather than counted from its
 *  Parts: every Question Type but Multipart. */
export function pointsOnQuestion(question: Pick<Question, 'type'>): boolean {
  return question.type !== 'multipart'
}

/** The sum of whichever of `values` are Points; `undefined` when none is. */
export function sumOfPoints(values: readonly (number | undefined)[]): number | undefined {
  let total: number | undefined
  for (const value of values) {
    if (value !== undefined) total = (total ?? 0) + value
  }
  return total
}

/** What a Question is worth: its own Points, or for a Multipart question the
 *  sum of its answering Parts' and Subparts'. `undefined` when nothing in it
 *  is marked. A Multipart question's own `points`, should a stored one carry
 *  any, is never read. */
export function pointsOfQuestion(question: Question): number | undefined {
  if (!pointsOnQuestion(question)) {
    return sumOfPoints(answeringPartsOf(question).map((part) => part.points))
  }
  return readPoints(question.points)
}

/** Points written as a count a teacher reads: "1 point", "24 points". */
export function pointsLabel(points: number): string {
  return `${points} ${points === 1 ? 'point' : 'points'}`
}

/** A question with its own Points set to `points`, or cleared by `null`. */
export function withQuestionPoints(question: Question, points: number | null): Question {
  const next: Question = { ...question }
  if (points === null || !pointsOnQuestion(question)) delete next.points
  else next.points = points
  return next
}

/** A Multipart question with the Part or Subpart `partId` given `points`, or
 *  cleared by `null`. Only a Part or Subpart that answers takes Points: a Part
 *  holding Subparts, an id the question does not hold, or a question of any
 *  other type comes back unchanged. */
export function withPartPoints(question: Question, partId: string, points: number | null): Question {
  if (!answeringPartsOf(question).some(({ id }) => id === partId)) return question
  const visit = (node: ProseMirrorJSON): ProseMirrorJSON => {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>
    if (
      (node.type === 'multipartPart' || node.type === 'multipartSubpart')
      && attrs.id === partId
    ) {
      const { points: _previous, ...rest } = attrs
      void _previous
      return { ...node, attrs: points === null ? rest : { ...rest, points } }
    }
    return Array.isArray(node.content)
      ? { ...node, content: (node.content as ProseMirrorJSON[]).map(visit) }
      : node
  }
  return { ...question, doc: visit(question.doc) }
}
