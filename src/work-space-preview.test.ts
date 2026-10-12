import { describe, expect, test } from 'bun:test'
import { buildExportDocument, type PlannedWorkSpace, type QuestionItem } from './export-plan'
import {
  createQuestion,
  laidWorkSpaceHeight,
  storedWorkSpaceHeight,
  workSpaceRowsOf,
  type Exam,
  type PaperStyle,
} from './exam'
import {
  dragged,
  NO_WORK_SPACE_PREVIEWS,
  released,
  settled,
  shownHeight,
  type SheetState,
} from './work-space-preview'

// Dragging a Work Space's handle on the sheet shows the height it is dragged
// to before the Exam stores it. A release stores it, and the sheet shows the
// stored height once it has repaginated, a moment later. Until then the drag's
// height must stay: dropping it on release drew the space at its old height,
// then at its new one, which flickered.

const planned = (height: number): PlannedWorkSpace => ({
  height,
  style: 'lines',
  lines: Math.round(height / 32),
  fill: false,
  pitch: 32,
  firstRow: 24,
})

// Exams stand in by identity, as a store hands out a new one per change.
const before = { exam: 'before' }
const after = { exam: 'after' }
const later = { exam: 'later' }
const sheet = (exam: object, plannedFrom: object): SheetState => ({ exam, plannedFrom })

/** A drag at `q1` from 88 to 248, released on a sheet planned from the Exam it began on. */
const releasedAt248 = () =>
  released(dragged(NO_WORK_SPACE_PREVIEWS, 'q1', 248), 'q1', true, sheet(before, before))

describe('a Work Space drag on the sheet', () => {
  test('shows the height it is dragged to, whatever the plan draws', () => {
    const previews = dragged(NO_WORK_SPACE_PREVIEWS, 'q1', 120)
    expect(shownHeight(previews, 'q1', planned(88), sheet(before, before))).toBe(120)
    expect(shownHeight(previews, 'q2', planned(88), sheet(before, before))).toBeNull()
  })

  test('released and stored, it keeps its height until the sheet is planned from the stored Exam', () => {
    const previews = releasedAt248()
    // The Exam has stored 248, but the sheet still draws the plan it had.
    expect(shownHeight(previews, 'q1', planned(88), sheet(after, before))).toBe(248)
    // The repaginated sheet draws the stored height itself.
    expect(shownHeight(previews, 'q1', planned(248), sheet(after, after))).toBeNull()
  })

  test('a question drawn afresh over the old plan still shows the released height', () => {
    // The old plan's space handed over as a new object — a re-render, a new
    // page, a question remounted — is still the old plan: identity says
    // nothing about which height the sheet has caught up with.
    const previews = releasedAt248()
    expect(shownHeight(previews, 'q1', planned(88), sheet(after, before))).toBe(248)
    expect(shownHeight(previews, 'q1', { ...planned(88) }, sheet(after, before))).toBe(248)
  })

  test('gives way once the plan draws the released height, or the sheet is planned from a later Exam', () => {
    const previews = releasedAt248()
    expect(shownHeight(previews, 'q1', planned(248), sheet(after, before))).toBeNull()
    // An edit since then: whatever that plan draws is the Exam's own.
    expect(shownHeight(previews, 'q1', planned(216), sheet(later, after))).toBeNull()
  })

  test('gives way at once when the Exam did not take the release', () => {
    // Nothing was stored — or it was undone — so the Exam is the one the drag
    // was released on, and what the plan draws is right.
    expect(shownHeight(releasedAt248(), 'q1', planned(88), sheet(before, before))).toBeNull()
  })

  test('released with nothing to store, it shows what the plan draws at once', () => {
    const previews = released(dragged(NO_WORK_SPACE_PREVIEWS, 'q1', 88), 'q1', false, sheet(before, before))
    expect(shownHeight(previews, 'q1', planned(88), sheet(before, before))).toBeNull()
    expect(previews.size).toBe(0)
    expect(released(NO_WORK_SPACE_PREVIEWS, 'q1', true, sheet(before, before))).toBe(NO_WORK_SPACE_PREVIEWS)
  })

  test('a drag at one position leaves the others alone', () => {
    const previews = dragged(releasedAt248(), 'part-b', 120)
    expect(shownHeight(previews, 'q1', planned(88), sheet(after, before))).toBe(248)
    expect(shownHeight(previews, 'part-b', planned(88), sheet(after, before))).toBe(120)
  })

  test('the sheet lets go of the releases it has caught up with', () => {
    const previews = dragged(releasedAt248(), 'part-b', 120)
    expect(settled(previews, sheet(after, before))).toBe(previews)
    const caughtUp = settled(previews, sheet(after, after))
    expect([...caughtUp.keys()]).toEqual(['part-b'])
  })
})

// The rule compares the drag's height with the height the plan draws, so the
// two must be laid out alike: a drag shows `laidWorkSpaceHeight` of the rows it
// stores, and the repaginated plan must draw exactly that, under every Paper
// Style and with Points on the last rule.
describe('a released drag and the plan of what it stored', () => {
  const styles: PaperStyle[] = ['standard', 'condensed', 'exam-board']
  for (const paperStyle of styles) {
    for (const points of [undefined, 3]) {
      test(`agree on its height under ${paperStyle}${points ? ' with Points on the last rule' : ''}`, () => {
        const rows = workSpaceRowsOf(paperStyle)
        for (const dragTo of [0, 40, 88, 130, 248, 400]) {
          const stored = storedWorkSpaceHeight(dragTo, rows)
          const shown = laidWorkSpaceHeight(stored, rows)
          const question = { ...createQuestion('open'), ...(points ? { points } : {}) }
          const exam: Exam = {
            title: 'Work space',
            questions: [question],
            paperStyle,
            workSpace: { [question.id]: { height: stored, style: 'lines', fill: false } },
          }
          const item = buildExportDocument(
            exam,
            { id: 'a', letter: 'A', questionOrder: [question.id], choiceOrder: {} },
            { test: true, answerKey: false },
          ).test.find((each): each is QuestionItem => each.kind === 'question')!
          expect(item.workSpace?.height ?? 0).toBe(shown)
        }
      })
    }
  }
})
