// The Question Bank and Working Copy operations, at the level a teacher's action
// reduces to. The store composes these into atomic authoring actions; what is
// asserted here is the part that has to hold however they are composed —
// including the tolerance rules that keep a Question Bank and a Working Copy
// usable when they disagree.

import { describe, expect, test } from 'bun:test'
import { createQuestion, DEFAULT_EXAM_TITLE } from './exam'
import {
  bankQuestionById,
  createWorkingCopy,
  createQuestionBank,
  isInWorkingCopy,
  withQuestionBanked,
  withChoiceOrder,
  withReferenceAdded,
  withReferenceOrder,
  withReferencesRemoved,
  withSectionLayout,
} from './question-bank'

const ids = ['q1', 'q2', 'q3']

function draftOf(questionIds: readonly string[] = ids) {
  return questionIds.reduce(
    (draft, id) => withReferenceAdded(draft, id),
    createWorkingCopy(),
  )
}

describe('a new Question Bank and Working Copy', () => {
  test('are empty, and the exam is untitled', () => {
    expect(createQuestionBank().questions).toEqual([])
    expect(createWorkingCopy().questionIds).toEqual([])
    expect(createWorkingCopy().title).toBe(DEFAULT_EXAM_TITLE)
    expect(createWorkingCopy('Chem Unit 3').title).toBe('Chem Unit 3')
  })
})

describe('banking Question Content', () => {
  test('stores each question once, keeping its identity', () => {
    const question = createQuestion('open')
    const bank = withQuestionBanked(createQuestionBank(), question)

    expect(bank.questions).toEqual([question])
    expect(bankQuestionById(bank, question.id)).toBe(question)
    expect(bankQuestionById(bank, 'unknown')).toBeUndefined()
  })

  test('replaces content in place rather than banking a second record', () => {
    const question = createQuestion('open')
    const edited = { ...question, columns: 2 as const }
    const bank = withQuestionBanked(
      withQuestionBanked(createQuestionBank(), question),
      edited,
    )

    expect(bank.questions).toEqual([edited])
  })

  test('keeps the authoring order, so a new question is the last one banked', () => {
    const [first, second] = [createQuestion('open'), createQuestion('open')]
    const bank = [first!, second!].reduce(withQuestionBanked, createQuestionBank())

    expect(bank.questions.map((question) => question.id)).toEqual([
      first!.id,
      second!.id,
    ])
  })
})

describe('referencing from the Working Copy', () => {
  test('adds a reference at the end, or immediately after a given one', () => {
    expect(draftOf().questionIds).toEqual(ids)
    expect(withReferenceAdded(draftOf(), 'q4', 'q1').questionIds).toEqual([
      'q1',
      'q4',
      'q2',
      'q3',
    ])
  })

  test('adds a reference immediately before a given one', () => {
    expect(withReferenceAdded(draftOf(), 'q4', 'q2', 'before').questionIds).toEqual([
      'q1',
      'q4',
      'q2',
      'q3',
    ])
    // The placement the first position needs, and the one no "after" can say.
    expect(withReferenceAdded(draftOf(), 'q4', 'q1', 'before').questionIds).toEqual([
      'q4',
      ...ids,
    ])
  })

  test('appends when the question it would sit beside is not on the Working Copy', () => {
    expect(withReferenceAdded(draftOf(), 'q4', 'elsewhere').questionIds).toEqual([
      ...ids,
      'q4',
    ])
    expect(withReferenceAdded(draftOf(), 'q4', 'elsewhere', 'before').questionIds).toEqual([
      ...ids,
      'q4',
    ])
  })

  test('holds a reference at most once, and adding it again is not a move', () => {
    const draft = draftOf()
    expect(withReferenceAdded(draft, 'q1', 'q3')).toBe(draft)
    expect(isInWorkingCopy(draft, 'q1')).toBe(true)
    expect(isInWorkingCopy(draft, 'q9')).toBe(false)
  })

  test('Removes references and their answer arrangements, and leaves an unreferenced Remove alone', () => {
    const draft = withChoiceOrder(draftOf(), {
      q1: ['a', 'b'], q2: ['c', 'd'], q3: ['e', 'f'],
    })
    const removed = withReferencesRemoved(draft, ['q1', 'q3'])
    expect(removed.questionIds).toEqual(['q2'])
    expect(removed.choiceOrder).toEqual({ q2: ['c', 'd'] })
    expect(withReferencesRemoved(draft, ['q9'])).toBe(draft)
  })
})

describe('reordering the Working Copy', () => {
  test('takes the given order', () => {
    expect(withReferenceOrder(draftOf(), ['q3', 'q1', 'q2']).questionIds).toEqual([
      'q3',
      'q1',
      'q2',
    ])
  })

  test('ignores ids the Working Copy does not reference', () => {
    expect(withReferenceOrder(draftOf(), ['q3', 'stranger', 'q1', 'q2']).questionIds)
      .toEqual(['q3', 'q1', 'q2'])
  })

  test('keeps a reference the new order forgot, so a reorder never Removes one', () => {
    // A reference the Question Bank cannot resolve never reaches the derived
    // ordering, so a move computed from that ordering comes back without it.
    // It stays on the Working Copy rather than disappearing behind a drag.
    expect(withReferenceOrder(draftOf(), ['q3', 'q1']).questionIds).toEqual([
      'q3',
      'q1',
      'q2',
    ])
  })

  test('an order that changes nothing is the same Working Copy', () => {
    const draft = draftOf()
    expect(withReferenceOrder(draft, ids)).toBe(draft)
  })
})

describe('writing back Sections', () => {
  test('Remove clears a question’s Exam-owned column layout and its Section placement', () => {
    const draft = {
      ...draftOf(),
      columns: { q1: 4 as const, q2: 1 as const },
      sectionOf: { q1: 'A', q2: 'A', q3: 'B' },
    }
    const removed = withReferencesRemoved(draft, ['q1'])
    expect(removed.columns).toEqual({ q2: 1 })
    expect(removed.sectionOf).toEqual({ q2: 'A', q3: 'B' })
  })

  test('stores every Section, every placement and the order, and keeps the legacy per-type wording', () => {
    const draft = { ...draftOf(), sectionHeadings: { open: { title: 'Essays' } } }
    const laidOut = withSectionLayout(draft, {
      sections: [{ id: 'open', title: 'Essays', instructions: '' }, { id: 'B', title: 'Short Answer', instructions: '' }],
      sectionOf: { q1: 'open', q2: 'B', q3: 'open' },
      questionOrder: ['q1', 'q3', 'q2'],
    })
    expect(laidOut).toEqual({
      ...createWorkingCopy(),
      questionIds: ['q1', 'q3', 'q2'],
      sections: [{ id: 'open', title: 'Essays', instructions: '' }, { id: 'B', title: 'Short Answer', instructions: '' }],
      sectionOf: { q1: 'open', q2: 'B', q3: 'open' },
      // Kept, for a Section begun later for a type the Exam has none of.
      sectionHeadings: { open: { title: 'Essays' } },
    })
  })
})
