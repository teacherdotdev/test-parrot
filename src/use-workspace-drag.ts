// One drag gesture, across both panes of the authoring workspace.
//
// Dragging spans the Question Bank and the Working Copy, so the gesture cannot
// belong to either of them: this is the coordinator both panes share. A pane
// says what a gesture is carrying and hands over the elements to draw; this
// finds what is under the pointer, asks `workspace-drag.ts` what releasing
// there would mean, and — on release — makes exactly one call to the store.
//
// Pointer capture, not native HTML drag-and-drop. `dragstart` surrenders the
// system cursor and the drag image to the browser, which then ignores even a
// computed `cursor: grabbing`; a captured pointer plus a page-owned preview
// keeps the closed hand, the exact source markup and the grab offset. That is
// the behaviour the Working Copy already had, and it is preserved here rather
// than replaced.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dropIntent,
  landsOnRelease,
  type DragSource,
  type DropBox,
  type DropCandidate,
  type DropField,
  type DropIntent,
  type EmptySection,
} from './workspace-drag'
import type { QuestionType } from './exam'

/** What a pane hands over when a gesture passes its movement threshold. */
export type DragGesture = {
  /** The elements the page-owned preview is cloned from. */
  elements: readonly HTMLElement[]
  /** The box the gesture was lifted from: the preview's size and its origin. */
  bounds: DOMRect
  /** Where the pointer went down, so the preview keeps its grab offset. */
  point: { x: number; y: number }
}

export type WorkspaceDrag = {
  /** What is being dragged, if anything. Rendering reads this to know a
   *  gesture is in flight and which Question Section it can reach. */
  source: DragSource | null
  /** What releasing now would do — and what the workspace draws. */
  intent: DropIntent | null
  /** Lifted questions, dimmed in place while the preview follows the pointer. */
  draggedQuestionIds: ReadonlySet<string>
  /** What a completed reorder moved: feedback belongs to the question that
   *  moved, not to whichever one is under the stationary pointer. */
  droppedQuestionIds: ReadonlySet<string>
  clearDropFeedback: () => void
  begin: (source: DragSource, gesture: DragGesture) => void
  move: (point: { x: number; y: number }) => void
  drop: () => void
  cancel: () => void
}

/** The Working Copy pane, and the questions rendered in it. A release anywhere
 *  inside the pane lands; one anywhere else is abandoned. Kept next to the
 *  reader so the markup and the reader cannot drift. */
export const DROP_ZONE_SELECTOR = '[data-drop-zone]'
const QUESTION_PIECE_SELECTOR = '.exam-question[data-question-id]'
/** An empty Question Section's heading on the sheet, which is where a gesture
 *  drops into it. */
export const EMPTY_SECTION_SELECTOR = '[data-empty-section]'
/** The new-Section target, while it is open beneath a Section. */
export const NEW_SECTION_SELECTOR = '[data-new-section-after]'

function boxOf(bounds: DOMRect): DropBox {
  return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right }
}

/** Everything a gesture can land on in the Working Copy, read out of the real
 *  page — or `null` when the pointer is not over the Working Copy at all. */
function fieldAt(point: { x: number; y: number }): DropField | null {
  const under = document.elementFromPoint(point.x, point.y)
  const zone =
    under?.closest<HTMLElement>(DROP_ZONE_SELECTOR)
    // The open target is drawn over the sheet, and belongs to it.
    ?? (under?.closest(NEW_SECTION_SELECTOR)
      ? document.querySelector<HTMLElement>(DROP_ZONE_SELECTOR)
      : null)
  if (!zone) return null
  // A question split across sheets renders one piece per sheet, in page order,
  // and only its numbered piece names its type. Its line above is on the first
  // piece and its line below on the last.
  const byId = new Map<
    string,
    { type?: QuestionType; sectionId?: string; first: DOMRect; last: DOMRect }
  >()
  for (const piece of zone.querySelectorAll<HTMLElement>(QUESTION_PIECE_SELECTOR)) {
    const questionId = piece.dataset.questionId!
    const bounds = piece.getBoundingClientRect()
    const type = piece.dataset.dropTarget as QuestionType | undefined
    const sectionId = piece.dataset.sectionId
    const seen = byId.get(questionId)
    if (seen) {
      seen.last = bounds
      seen.type ??= type
      seen.sectionId ??= sectionId
    } else {
      byId.set(questionId, { type, sectionId, first: bounds, last: bounds })
    }
  }
  const candidates: DropCandidate[] = [...byId].flatMap(
    ([questionId, { type, sectionId, first, last }]) =>
      type && sectionId
        ? [{
            questionId,
            sectionId,
            before: { y: first.top, left: first.left, right: first.right },
            after: { y: last.bottom, left: last.left, right: last.right },
          }]
        : [],
  )
  const emptySections: EmptySection[] = [
    ...zone.querySelectorAll<HTMLElement>(EMPTY_SECTION_SELECTOR),
  ].flatMap((element) => {
    const { sectionId } = element.dataset
    return sectionId
      ? [{
          sectionId,
          box: boxOf(element.getBoundingClientRect()),
        }]
      : []
  })
  const open = document.querySelector<HTMLElement>(NEW_SECTION_SELECTOR)
  return {
    candidates,
    emptySections,
    openNewSection: open
      ? {
          afterSectionId: open.dataset.newSectionAfter!,
          box: boxOf(open.getBoundingClientRect()),
        }
      : null,
  }
}

/** How long a gesture's line rests at the foot of a Section before the target
 *  that makes a new Section opens there: long enough that passing by does not
 *  open it, short enough that aiming at it does not feel like waiting. */
const NEW_SECTION_DELAY_MS = 200

/** How close to the Exam's top or bottom edge the pointer has to be before a
 *  gesture scrolls it, and how fast it goes at the very edge. */
const AUTOSCROLL_EDGE = 72
const AUTOSCROLL_MAX_SPEED = 18

/** What scrolls the Exam: its own lane, or — on a layout narrow enough to
 *  stack the panes — the page itself. */
function examScroller(): { element: Element; top: number; bottom: number } | null {
  const lane = document.querySelector('.editor-output')
  if (lane && /auto|scroll/.test(getComputedStyle(lane).overflowY)) {
    const bounds = lane.getBoundingClientRect()
    return { element: lane, top: bounds.top, bottom: bounds.bottom }
  }
  const page = document.scrollingElement
  return page ? { element: page, top: 0, bottom: window.innerHeight } : null
}

/** How far to scroll the Exam this frame for a pointer at `y`: nothing in the
 *  middle, faster the deeper into an edge band it is, and full speed past the
 *  edge — a pointer over the document bar is still asking to go up. */
function autoscrollStep(y: number, top: number, bottom: number): number {
  const edge = Math.min(AUTOSCROLL_EDGE, (bottom - top) / 4)
  if (y < top + edge) {
    return -AUTOSCROLL_MAX_SPEED * Math.min(1, (top + edge - y) / edge)
  }
  if (y > bottom - edge) {
    return AUTOSCROLL_MAX_SPEED * Math.min(1, (y - (bottom - edge)) / edge)
  }
  return 0
}

function sameIntent(a: DropIntent | null, b: DropIntent | null): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind || a.opensBelow !== b.opensBelow) return false
  if (a.kind === 'insert' && b.kind === 'insert') {
    return a.targetQuestionId === b.targetQuestionId && a.placement === b.placement
  }
  if (a.kind === 'section-end' && b.kind === 'section-end') return a.sectionId === b.sectionId
  if (a.kind === 'new-section' && b.kind === 'new-section') {
    return a.afterSectionId === b.afterSectionId && a.armed === b.armed
  }
  return true
}

/** What the preview says it would do, in the teacher's words. A release that
 *  would change nothing says nothing: the cursor already says it. */
function intentLabel(intent: DropIntent | null): string {
  if (!landsOnRelease(intent)) return ''
  return intent!.kind === 'new-section' ? 'New section' : 'Insert'
}

/** The intent as the root's `data-drag-intent` says it, for the cursor. */
function intentName(intent: DropIntent | null): string {
  return landsOnRelease(intent) ? intent!.kind : 'none'
}

/** The page-owned counterpart to the browser's drag image: the real markup,
 *  cloned, stripped of the attributes that would make a copy answer as a drop
 *  target or duplicate an element id. */
function createPreview(gesture: DragGesture, source: DragSource): HTMLElement {
  const preview = document.createElement('div')
  preview.className = 'question-drag-preview'
  preview.setAttribute('aria-hidden', 'true')
  preview.setAttribute('inert', '')
  preview.dataset.pane = source.pane
  preview.dataset.count = String(gesture.elements.length)
  for (const element of gesture.elements) {
    const clone = element.cloneNode(true) as HTMLElement
    clone.classList.remove(
      'exam-question--selected',
      'exam-question--dragging',
      'exam-question--dropped',
    )
    clone.removeAttribute('data-question-id')
    clone.removeAttribute('data-drop-target')
    clone.removeAttribute('data-drop')
    clone.removeAttribute('aria-current')
    clone.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'))
    preview.append(clone)
  }
  const computed = getComputedStyle(gesture.elements[0] ?? document.body)
  Object.assign(preview.style, {
    left: `${gesture.bounds.left}px`,
    top: `${gesture.bounds.top}px`,
    width: `${gesture.bounds.width}px`,
    color: computed.color,
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    lineHeight: computed.lineHeight,
  })
  return preview
}

export function useWorkspaceDrag(
  onDrop: (source: DragSource, intent: DropIntent) => void,
): WorkspaceDrag {
  // The gesture is held in refs as well as state: pointer events fire far more
  // often than a render is worth, and `drop` has to read the very latest
  // decision rather than whatever the last commit happened to paint.
  const sourceRef = useRef<DragSource | null>(null)
  const intentRef = useRef<DropIntent | null>(null)
  const preview = useRef<{
    element: HTMLElement
    offsetX: number
    offsetY: number
  } | null>(null)
  // Where the pointer last was, so the Exam can keep scrolling — and what is
  // under the pointer keep being re-read — while the pointer holds still.
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const autoscrollFrame = useRef<number | null>(null)
  const [source, setSource] = useState<DragSource | null>(null)
  const [intent, setIntent] = useState<DropIntent | null>(null)
  const [droppedQuestionIds, setDroppedQuestionIds] = useState<ReadonlySet<string>>(
    new Set(),
  )

  // The Section whose new-Section target is open, and the one about to open
  // once the line has rested at its foot for `NEW_SECTION_DELAY_MS`.
  const openedBelow = useRef<string | null>(null)
  const opening = useRef<{ sectionId: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const relocate = useRef<() => void>(() => {})

  const clearArtifacts = useCallback(() => {
    if (opening.current) clearTimeout(opening.current.timer)
    opening.current = null
    openedBelow.current = null
    if (autoscrollFrame.current !== null) cancelAnimationFrame(autoscrollFrame.current)
    autoscrollFrame.current = null
    pointer.current = null
    preview.current?.element.remove()
    preview.current = null
    const root = document.documentElement
    root.classList.remove('question-drag-active')
    delete root.dataset.dragPane
    delete root.dataset.dragSection
    delete root.dataset.dragIntent
  }, [])

  // A gesture that outlives its component would leave the cursor stuck in a
  // closed hand over a page that is no longer dragging anything.
  useEffect(() => clearArtifacts, [clearArtifacts])

  const paint = useCallback((wanted: DropIntent | null) => {
    // A target the geometry would open beneath a Section waits until the line
    // has rested there; one the line has left closes at once.
    const below = wanted?.opensBelow ?? null
    if (below !== openedBelow.current) {
      if (below === null) {
        openedBelow.current = null
      } else if (opening.current?.sectionId !== below) {
        if (opening.current) clearTimeout(opening.current.timer)
        opening.current = {
          sectionId: below,
          timer: setTimeout(() => {
            opening.current = null
            openedBelow.current = below
            relocate.current()
          }, NEW_SECTION_DELAY_MS),
        }
      }
    }
    if (below === null || below === openedBelow.current) {
      if (opening.current) clearTimeout(opening.current.timer)
      opening.current = null
    }
    const next: DropIntent | null =
      wanted && wanted.opensBelow !== openedBelow.current
        ? { ...wanted, opensBelow: openedBelow.current }
        : wanted
    intentRef.current = next
    document.documentElement.dataset.dragIntent = intentName(next)
    if (preview.current) {
      preview.current.element.dataset.intent = intentName(next)
      preview.current.element.dataset.intentLabel = intentLabel(next)
    }
    // Pointer movement is continuous; only a change in what would happen is
    // worth a re-render.
    setIntent((current) => (sameIntent(current, next) ? current : next))
  }, [])

  const begin = useCallback(
    (nextSource: DragSource, gesture: DragGesture) => {
      clearArtifacts()
      const element = createPreview(gesture, nextSource)
      document.body.append(element)
      const root = document.documentElement
      root.classList.add('question-drag-active')
      root.dataset.dragPane = nextSource.pane
      // The Question Section the gesture can reach, so compatible positions can
      // announce themselves before the pointer is over one.
      root.dataset.dragSection = nextSource.type
      // Where the preview sits under the pointer. A reorder keeps the grab
      // offset, so the question stays exactly where it was picked up and the
      // gesture reads as moving the thing itself. A bank row is instead
      // carried centred on the pointer: it is a different width from the
      // position it is aimed at, so honouring the grab offset would leave the
      // card hanging off to one side of the cursor and make the teacher aim
      // with an edge they cannot see.
      const centred = nextSource.pane === 'question-bank'
      preview.current = {
        element,
        offsetX: centred
          ? gesture.bounds.width / 2
          : gesture.point.x - gesture.bounds.left,
        offsetY: centred
          ? gesture.bounds.height / 2
          : gesture.point.y - gesture.bounds.top,
      }
      sourceRef.current = nextSource
      setSource(nextSource)
      setDroppedQuestionIds(new Set())
      paint(null)
    },
    [clearArtifacts, paint],
  )

  /** Re-reads what releasing at `point` would do. */
  const locate = useCallback(
    (point: { x: number; y: number }) => {
      const current = sourceRef.current
      if (!current) return
      const field = fieldAt(point)
      paint(
        dropIntent(
          current,
          field ?? { candidates: [], emptySections: [], openNewSection: null },
          field ? point : null,
        ),
      )
    },
    [paint],
  )
  useEffect(() => {
    relocate.current = () => {
      if (pointer.current) locate(pointer.current)
    }
  }, [locate])

  // Hovering near the Exam's top or bottom edge scrolls it, wherever the drag
  // started — a bank question bound for page six should not have to be
  // dropped on page one and dragged again. Scrolling moves the page under a
  // still pointer, so what is under it is read again whenever the Exam moves.
  const autoscroll = useCallback(() => {
    autoscrollFrame.current = null
    const point = pointer.current
    if (!point || !sourceRef.current) return
    const scroller = examScroller()
    if (scroller) {
      const step = autoscrollStep(point.y, scroller.top, scroller.bottom)
      const before = scroller.element.scrollTop
      if (step !== 0) scroller.element.scrollTop = before + step
      if (scroller.element.scrollTop !== before) locate(point)
    }
    autoscrollFrame.current = requestAnimationFrame(autoscroll)
  }, [locate])

  const move = useCallback(
    (point: { x: number; y: number }) => {
      pointer.current = point
      if (autoscrollFrame.current === null) {
        autoscrollFrame.current = requestAnimationFrame(autoscroll)
      }
      const held = preview.current
      if (held) {
        held.element.style.left = `${point.x - held.offsetX}px`
        held.element.style.top = `${point.y - held.offsetY}px`
      }
      locate(point)
    },
    [autoscroll, locate],
  )

  const finish = useCallback(() => {
    sourceRef.current = null
    intentRef.current = null
    clearArtifacts()
    setSource(null)
    setIntent(null)
  }, [clearArtifacts])

  const drop = useCallback(() => {
    const current = sourceRef.current
    const landing = intentRef.current
    finish()
    if (!current || !landing || !landsOnRelease(landing)) return
    onDrop(current, landing)
    // Feedback for a reorder belongs to the questions that moved. A
    // composition's incoming question is revealed and highlighted instead,
    // because it may not have been on the page at all a moment ago.
    if (current.pane === 'exam-draft') {
      setDroppedQuestionIds(new Set(current.questionIds))
    }
  }, [finish, onDrop])

  const clearDropFeedback = useCallback(() => setDroppedQuestionIds(new Set()), [])

  return {
    source,
    intent,
    draggedQuestionIds: source ? new Set(source.questionIds) : EMPTY,
    droppedQuestionIds,
    clearDropFeedback,
    begin,
    move,
    drop,
    cancel: finish,
  }
}

const EMPTY: ReadonlySet<string> = new Set()
