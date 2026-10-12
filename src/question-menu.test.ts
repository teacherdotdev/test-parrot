// The Incorrect answers shown entry of a question's context menu: there for
// every Multiple Choice question, enabled while some question it acts on may
// hide an answer, and otherwise disabled with the reason.

import { describe, expect, test } from 'bun:test'
import type { Arrangement, Question } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import { shownIncorrectChoices, shownIncorrectMenuOf } from './question-menu'

function answer(id: string, text: string, { correct = false, locked }: { correct?: boolean; locked?: boolean } = {}): ProseMirrorJSON {
  return {
    type: 'multipleChoiceChoice',
    attrs: { correct, id, ...(locked === undefined ? {} : { locked }) },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

function multipleChoice(id: string, answers: ProseMirrorJSON[]): Question {
  return {
    id,
    type: 'multiple-choice',
    doc: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'multipleChoice', content: answers }] },
    columns: 2,
  }
}

const marked = multipleChoice('marked', [
  answer('a', 'Lyon'),
  answer('b', 'Paris', { correct: true }),
  answer('c', 'Nice'),
  answer('d', 'Lille'),
])
const unmarked = multipleChoice('unmarked', [answer('e', 'Red'), answer('f', 'Blue'), answer('g', 'Green')])
const shortAnswer: Question = { id: 'open', type: 'open', doc: { type: 'doc', content: [{ type: 'paragraph' }] }, columns: 2 }
const arrangement = (hiddenAnswers: Record<string, string[]> = {}): Arrangement => ({
  id: 'w',
  letter: 'A',
  questionOrder: [],
  choiceOrder: {},
  hiddenAnswers,
})

describe('the Incorrect answers shown entry', () => {
  test('offers every count, all first, for a question with a correct answer', () => {
    expect(shownIncorrectMenuOf(marked, [marked], arrangement({ marked: ['c'] }))).toEqual({
      disabled: false,
      range: { min: 1, max: 3 },
      shown: 2,
    })
    expect(shownIncorrectChoices({ min: 1, max: 3 }).map(({ label }) => label)).toEqual([
      'Show all 3 incorrect answers',
      'Show 2 of 3 incorrect',
      'Show 1 of 3 incorrect',
    ])
  })

  test('is disabled, asking for a correct answer, when no question it acts on has one', () => {
    expect(shownIncorrectMenuOf(unmarked, [unmarked], arrangement())).toEqual({
      disabled: true,
      hint: 'Mark a correct answer first',
    })
  })

  test('is enabled for a selection in which any question may hide answers', () => {
    expect(shownIncorrectMenuOf(unmarked, [unmarked, marked], arrangement())).toMatchObject({ disabled: false, shown: 3 })
  })

  test('says why when every answer must show for another reason', () => {
    const allLocked = multipleChoice('locked', [answer('a', 'Lyon', { locked: true }), answer('b', 'Paris', { correct: true })])
    expect(shownIncorrectMenuOf(allLocked, [allLocked], arrangement())).toEqual({
      disabled: true,
      hint: 'No incorrect answer can be hidden',
    })
  })

  test('is absent from a question that is not Multiple Choice', () => {
    expect(shownIncorrectMenuOf(shortAnswer, [shortAnswer, marked], arrangement())).toBeNull()
  })
})
