import { describe, expect, test } from 'bun:test'
import {
  dropIntent,
  landsOnRelease,
  type DragSource,
  type DropCandidate,
  type DropField,
} from './workspace-drag'

const fromQuestionBank: DragSource = {
  pane: 'question-bank',
  questionIds: ['bank-1'],
  type: 'multiple-choice',
}

const severalFromQuestionBank: DragSource = {
  pane: 'question-bank',
  questionIds: ['bank-1', 'bank-2'],
  type: 'multiple-choice',
}

const fromExamWorkingCopy: DragSource = {
  pane: 'exam-draft',
  questionIds: ['q2'],
  type: 'multiple-choice',
}

const shortAnswerFromQuestionBank: DragSource = {
  pane: 'question-bank',
  questionIds: ['bank-3'],
  type: 'open',
}

/** A rendered question on a sheet spanning x 100–700, from `top` to `bottom`. */
function rendered(
  questionId: string,
  sectionId: string,
  top: number,
  bottom: number,
): DropCandidate {
  return {
    questionId,
    sectionId,
    before: { y: top, left: 100, right: 700 },
    after: { y: bottom, left: 100, right: 700 },
  }
}

function field(
  candidates: DropCandidate[],
  extra: Partial<DropField> = {},
): DropField {
  return { candidates, emptySections: [], openNewSection: null, ...extra }
}

// A Multiple Choice Section of two questions, a Short Answer Section of two,
// then a second Multiple Choice Section of one, down one sheet.
const page = field([
  rendered('q1', 'mc', 100, 300),
  rendered('q2', 'mc', 326, 526),
  rendered('s1', 'sa', 600, 700),
  rendered('s2', 'sa', 726, 826),
  rendered('q3', 'mc-2', 900, 1000),
])

describe('a Question Bank question released over the Working Copy', () => {
  test('inserts before a question when nearer its top', () => {
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 150 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'before',
      opensBelow: null,
    })
  })

  test('inserts after a question when nearer its bottom, and never replaces it', () => {
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 210 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'after',
      opensBelow: null,
    })
  })

  test('reaches a later Section as readily as the first', () => {
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 910 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q3',
      placement: 'before',
      opensBelow: null,
    })
  })

  test('lands inside a Section of Short Answer questions, at the nearest line', () => {
    // Between s1 and s2: a Multiple Choice question goes there like any other.
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 710 })).toEqual({
      kind: 'insert',
      targetQuestionId: 's1',
      placement: 'after',
      opensBelow: null,
    })
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 590 })).toMatchObject({
      kind: 'insert',
      targetQuestionId: 's1',
      placement: 'before',
    })
  })

  test('opens a new-Section target at the foot of a Section, below its last question', () => {
    expect(dropIntent(fromQuestionBank, page, { x: 400, y: 520 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q2',
      placement: 'after',
      opensBelow: 'mc',
    })
  })

  test('at the foot of a Section of another type, inserts after its last question and opens a new-Section target', () => {
    const intent = dropIntent(fromQuestionBank, page, { x: 400, y: 830 })
    expect(intent).toEqual({
      kind: 'insert',
      targetQuestionId: 's2',
      placement: 'after',
      opensBelow: 'sa',
    })
    expect(landsOnRelease(intent)).toBe(true)
  })

  test('makes a new Section only when released over the open target', () => {
    const open = field(page.candidates, {
      openNewSection: {
        afterSectionId: 'sa',
        box: { top: 832, bottom: 884, left: 100, right: 700 },
      },
    })
    const intent = dropIntent(fromQuestionBank, open, { x: 400, y: 860 })
    expect(intent).toEqual({
      kind: 'new-section',
      afterSectionId: 'sa',
      armed: true,
      opensBelow: 'sa',
    })
    expect(landsOnRelease(intent)).toBe(true)
  })

  test('below a target open at the foot of the Exam, a release still makes a Section, however far down', () => {
    const open = field(page.candidates, {
      openNewSection: {
        afterSectionId: 'mc-2',
        box: { top: 1006, bottom: 1058, left: 100, right: 700 },
      },
    })
    for (const point of [{ x: 400, y: 1070 }, { x: 400, y: 1600 }, { x: 40, y: 1200 }]) {
      const intent = dropIntent(fromQuestionBank, open, point)
      expect(intent).toEqual({
        kind: 'new-section',
        afterSectionId: 'mc-2',
        armed: true,
        opensBelow: 'mc-2',
      })
      expect(landsOnRelease(intent)).toBe(true)
    }
  })

  test('below a target open between Sections, going lower lands in the next Section', () => {
    const open = field(page.candidates, {
      openNewSection: {
        afterSectionId: 'sa',
        box: { top: 832, bottom: 884, left: 100, right: 700 },
      },
    })
    expect(dropIntent(fromQuestionBank, open, { x: 400, y: 895 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q3',
      placement: 'before',
      opensBelow: null,
    })
  })

  test('below a target open above an empty Section at the foot of the Exam, the empty Section takes the drop', () => {
    const open = field(page.candidates, {
      emptySections: [
        { sectionId: 'empty', box: { top: 1100, bottom: 1156, left: 100, right: 700 } },
      ],
      openNewSection: {
        afterSectionId: 'mc-2',
        box: { top: 1006, bottom: 1058, left: 100, right: 700 },
      },
    })
    expect(dropIntent(fromQuestionBank, open, { x: 400, y: 1120 })).toEqual({
      kind: 'section-end',
      sectionId: 'empty',
      opensBelow: null,
    })
  })

  test('drops into any empty Section, whatever the question’s type', () => {
    const withEmpty = field(page.candidates, {
      emptySections: [
        { sectionId: 'empty-1', box: { top: 1100, bottom: 1156, left: 100, right: 700 } },
        { sectionId: 'empty-2', box: { top: 1250, bottom: 1306, left: 100, right: 700 } },
      ],
    })
    for (const source of [fromQuestionBank, shortAnswerFromQuestionBank]) {
      expect(dropIntent(source, withEmpty, { x: 400, y: 1120 })).toEqual({
        kind: 'section-end',
        sectionId: 'empty-1',
        opensBelow: null,
      })
      expect(dropIntent(source, withEmpty, { x: 400, y: 1270 })).toEqual({
        kind: 'section-end',
        sectionId: 'empty-2',
        opensBelow: null,
      })
    }
  })

  test('a Short Answer question reaches every line, beside a question of any type', () => {
    expect(dropIntent(shortAnswerFromQuestionBank, page, { x: 400, y: 150 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'before',
      opensBelow: null,
    })
    expect(dropIntent(shortAnswerFromQuestionBank, page, { x: 400, y: 610 })).toMatchObject({
      kind: 'insert',
      targetQuestionId: 's1',
      placement: 'before',
    })
    expect(dropIntent(shortAnswerFromQuestionBank, page, { x: 400, y: 990 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q3',
      placement: 'after',
      opensBelow: 'mc-2',
    })
  })

  test('starts the first Section of an Exam with nothing on it', () => {
    expect(dropIntent(fromQuestionBank, field([]), { x: 400, y: 150 })).toEqual({
      kind: 'new-section',
      afterSectionId: null,
      armed: true,
      opensBelow: null,
    })
  })

  test('a gesture carrying several is placed like one', () => {
    expect(dropIntent(severalFromQuestionBank, page, { x: 400, y: 150 })).toMatchObject({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'before',
    })
  })

  test('outside the Working Copy, a release changes nothing', () => {
    expect(dropIntent(fromQuestionBank, page, null)).toBeNull()
  })
})

describe('a Working Copy question moved within it', () => {
  test('is never placed relative to itself, and the foot of its Section is the question above it', () => {
    // q2 is being carried: the line below q1 is the foot of its Section now.
    expect(dropIntent(fromExamWorkingCopy, page, { x: 400, y: 380 })).toEqual({
      kind: 'insert',
      targetQuestionId: 'q1',
      placement: 'after',
      opensBelow: 'mc',
    })
  })

  test('carrying the last question, below the target open at the foot of the Exam makes a Section of it', () => {
    // s2 and q3 are carried: the foot of the Exam is now the line below s1,
    // and the carried pieces below it are not somewhere to land.
    const carrying: DragSource = { pane: 'exam-draft', questionIds: ['s2', 'q3'], type: 'open' }
    const open = field(page.candidates, {
      openNewSection: {
        afterSectionId: 'sa',
        box: { top: 706, bottom: 758, left: 100, right: 700 },
      },
    })
    expect(dropIntent(carrying, open, { x: 400, y: 950 })).toMatchObject({
      kind: 'new-section',
      afterSectionId: 'sa',
      armed: true,
    })
  })

  test('an Exam with nothing on it offers a move nothing', () => {
    expect(dropIntent(fromExamWorkingCopy, field([]), { x: 400, y: 150 })).toBeNull()
  })
})
