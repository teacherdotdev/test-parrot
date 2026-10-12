// What a drag gesture across the authoring workspace means.
//
// One gesture spans two panes. A Question Bank question is *composed* onto the
// Working Copy; a Working Copy question is *moved* within it. Either way a drop
// only ever Inserts: before or after a rendered question, at the end of an
// empty Question Section, or into a new Section of its own.
//
// A Question Section holds Questions of any type, so every line between two
// questions, in any Section, is somewhere a question can go.
//
// And a drop is never aimed. Released anywhere over the Working Copy, a gesture
// lands at the legal insertion line nearest the pointer. The one exception is
// a new Section, which is only ever made on purpose: when the nearest line is
// the foot of a Section — below its last question — a "new Section" target
// opens beneath it, and only a release over that open target — or, when it is
// open at the foot of the whole Exam, anywhere below it — makes one. The
// target opens rather than appearing at once, so the sheet does
// not jump under the pointer, and it says what it will do before it does it.
// The only release that changes nothing is one outside the Working Copy,
// which is how a gesture is abandoned.
//
// This is the whole of the geometry, kept pure and away from the DOM so the
// rule can be read and tested on its own. `use-workspace-drag.ts` is what
// reads the rendered questions out of the real page and turns an intent into
// exactly one call to the store.

import type { QuestionPlacement, QuestionType } from './exam'

/** Where a drag started, and what it is carrying. */
export type DragSource =
  | {
      pane: 'question-bank'
      /** The unused Question Bank records being composed onto the Working Copy,
       *  in the order they appeared in the filtered bank. A single-row drag
       *  carries a one-item list through this same boundary. */
      questionIds: readonly string[]
      type: QuestionType
    }
  | {
      pane: 'exam-draft'
      /** Every question the gesture picked up — a selection moves together. */
      questionIds: readonly string[]
      type: QuestionType
    }

/** A horizontal insertion line, in viewport coordinates. */
export type DropEdge = { y: number; left: number; right: number }

/** A box on the page, in viewport coordinates. */
export type DropBox = { top: number; bottom: number; left: number; right: number }

/** A rendered question as a gesture sees it: the Section it is in, and the
 *  line above it and the line below it. A question split across sheets has
 *  its `before` edge on its first piece and its `after` edge on its last. */
export type DropCandidate = {
  questionId: string
  sectionId: string
  before: DropEdge
  after: DropEdge
}

/** An empty Question Section as a gesture sees it: the box it offers to drop
 *  into. No new Section is ever opened beneath one. */
export type EmptySection = {
  sectionId: string
  box: DropBox
}

/** Everything on the Working Copy a gesture can land on, in page order. */
export type DropField = {
  candidates: readonly DropCandidate[]
  emptySections: readonly EmptySection[]
  /** The new-Section target currently open, and the box it takes up — so that
   *  moving onto it keeps it open, and a release over it makes a Section. */
  openNewSection: { afterSectionId: string; box: DropBox } | null
}

/** What releasing now would do — and, equally, what the workspace draws.
 *  `null` is a release that changes nothing.
 *
 *  `opensBelow` names the Section whose new-Section target is open beneath
 *  it. An `insert` at the foot of a Section carries it; so does a
 *  `new-section` intent, which is not `armed` until the pointer is over the
 *  open target itself. Only an armed one makes a Section when released. */
export type DropIntent =
  | {
      kind: 'insert'
      targetQuestionId: string
      placement: QuestionPlacement
      opensBelow: string | null
    }
  | { kind: 'section-end'; sectionId: string; opensBelow: string | null }
  | { kind: 'new-section'; afterSectionId: string | null; armed: boolean; opensBelow: string | null }

/** What one rendered question draws while a gesture is in flight: an insertion
 *  line on one of its edges, or nothing. */
export type QuestionDropState = QuestionPlacement | null

/** The intent as the question it names should draw it. Every other question on
 *  the page draws nothing. */
export function dropStateOf(
  intent: DropIntent | null,
  questionId: string,
): QuestionDropState {
  return intent?.kind === 'insert' && intent.targetQuestionId === questionId
    ? intent.placement
    : null
}

/** Whether releasing now would do anything at all. An open new-Section target
 *  the pointer is not over promises nothing yet. */
export function landsOnRelease(intent: DropIntent | null): boolean {
  return intent !== null && (intent.kind !== 'new-section' || intent.armed)
}

/** How far the pointer is from an insertion line: straight up or down when it
 *  is over the line's span, and to the line's nearer end when it is beside it. */
function distanceTo(edge: DropEdge, point: { x: number; y: number }): number {
  const dx = Math.max(edge.left - point.x, 0, point.x - edge.right)
  return Math.hypot(dx, point.y - edge.y)
}

function isInside(box: DropBox, point: { x: number; y: number }): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom
}

/**
 * Where releasing at `point` would land.
 *
 * `point` is `null` when the pointer is not over the Working Copy at all.
 */
export function dropIntent(
  source: DragSource,
  field: DropField,
  point: { x: number; y: number } | null,
): DropIntent | null {
  if (!point) return null
  const { candidates, emptySections, openNewSection } = field

  // Over the open new-Section target, a release makes a Section.
  if (openNewSection && isInside(openNewSection.box, point)) {
    return {
      kind: 'new-section',
      afterSectionId: openNewSection.afterSectionId,
      armed: true,
      opensBelow: openNewSection.afterSectionId,
    }
  }

  // An Exam with nothing on it yet has no line to aim at: the whole Working
  // Copy is the target, and the question starts its first Section.
  if (candidates.length === 0 && emptySections.length === 0) {
    return source.pane === 'question-bank'
      ? { kind: 'new-section', afterSectionId: null, armed: true, opensBelow: null }
      : null
  }

  // A question cannot be placed relative to itself, and a gesture carrying
  // several cannot be placed relative to any of its own members.
  const carried = new Set(source.questionIds)
  const others = candidates.filter((candidate) => !carried.has(candidate.questionId))

  // Below a target open at the foot of the whole Exam — nothing left beneath
  // it to land on but the questions being carried — a release makes the
  // Section too, however far down. Going lower there can mean nothing else,
  // whereas between Sections going lower means the next Section, and the
  // nearest line below decides as usual.
  if (
    openNewSection
    && point.y > openNewSection.box.bottom
    && others.every(({ before }) => before.y < openNewSection.box.bottom)
    && emptySections.every(({ box }) => box.top < openNewSection.box.bottom)
  ) {
    return {
      kind: 'new-section',
      afterSectionId: openNewSection.afterSectionId,
      armed: true,
      opensBelow: openNewSection.afterSectionId,
    }
  }

  // The foot of each Section: the line below its last question that is not
  // being carried. A new Section can be opened there, whatever its type.
  const feet = new Map<string, DropCandidate>()
  for (const candidate of others) feet.set(candidate.sectionId, candidate)
  const footOf = new Set([...feet.values()].map(({ questionId }) => questionId))

  let nearest: DropIntent | null = null
  let nearestDistance = Infinity
  const consider = (distance: number, intent: DropIntent) => {
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = intent
    }
  }

  for (const candidate of others) {
    consider(distanceTo(candidate.before, point), {
      kind: 'insert',
      targetQuestionId: candidate.questionId,
      placement: 'before',
      opensBelow: null,
    })
    consider(distanceTo(candidate.after, point), {
      kind: 'insert',
      targetQuestionId: candidate.questionId,
      placement: 'after',
      opensBelow: footOf.has(candidate.questionId) ? candidate.sectionId : null,
    })
  }
  for (const empty of emptySections) {
    const middle: DropEdge = {
      y: (empty.box.top + empty.box.bottom) / 2,
      left: empty.box.left,
      right: empty.box.right,
    }
    const distance = isInside(empty.box, point) ? 0 : distanceTo(middle, point)
    // An empty Section takes what is dropped on it, and offers no new Section
    // beneath it: it is the new Section a drop there would otherwise make.
    consider(distance, { kind: 'section-end', sectionId: empty.sectionId, opensBelow: null })
  }

  // Still close to an open target, it stays open: moving down onto it must not
  // close it on the way.
  if (openNewSection && nearest && (nearest as DropIntent).opensBelow === null) {
    const target = openNewSection.box
    const reach = distanceTo({ y: target.top, left: target.left, right: target.right }, point)
    if (reach <= nearestDistance) {
      return {
        kind: 'new-section',
        afterSectionId: openNewSection.afterSectionId,
        armed: false,
        opensBelow: openNewSection.afterSectionId,
      }
    }
  }
  return nearest
}
