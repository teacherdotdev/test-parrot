import { describe, expect, test } from 'bun:test'
import { orderedChoices, type Arrangement, type Exam, type Question } from './exam'
import {
  answerVisibilityOf,
  hiddenAnswerIdsOf,
  shownChoices,
  shownIncorrectRange,
  varySelectedAnswers,
  withShownIncorrect,
} from './hidden-answers'
import { seededRandom } from './export-versions'
import type { ProseMirrorJSON } from './question-doc'

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

// Five incorrect answers, a correct one, and a locked incorrect one last.
const capitals = multipleChoice('q1', [
  answer('a', 'Lyon'),
  answer('b', 'Paris', { correct: true }),
  answer('c', 'Nice'),
  answer('d', 'Lille'),
  answer('e', 'Nantes'),
  answer('f', 'None of the above'),
])
const exam: Exam = { title: 'Capitals', questions: [capitals] }
const arrangement = (hiddenAnswers: Record<string, string[]> = {}, choiceOrder: Record<string, string[]> = {}): Arrangement => ({
  id: 'w',
  letter: 'A',
  questionOrder: ['q1'],
  choiceOrder,
  hiddenAnswers,
})
const ids = (choices: { id: string }[]) => choices.map(({ id }) => id)

describe('how many incorrect answers a question may show', () => {
  test('from one, or every locked incorrect answer, up to all of them', () => {
    expect(shownIncorrectRange(capitals)).toEqual({ min: 1, max: 5 })
    const twoLocked = multipleChoice('q2', [
      answer('a', 'Lyon'),
      answer('b', 'Paris', { correct: true }),
      answer('c', 'Nice', { locked: true }),
      answer('d', 'None of the above'),
    ])
    expect(shownIncorrectRange(twoLocked)).toEqual({ min: 2, max: 3 })
    // Every incorrect answer locked: there is nothing to hide.
    const allLocked = multipleChoice('q3', [
      answer('a', 'Lyon', { locked: true }),
      answer('b', 'Paris', { correct: true }),
      answer('c', 'None of the above'),
    ])
    expect(shownIncorrectRange(allLocked)).toBeNull()
  })

  test('nothing is hidden from a question with no correct answer marked', () => {
    const unmarked = multipleChoice('q1', [answer('a', 'Lyon'), answer('b', 'Paris'), answer('c', 'Nice')])
    expect(shownIncorrectRange(unmarked)).toBeNull()
    expect(hiddenAnswerIdsOf(unmarked, arrangement({ q1: ['a'] }))).toEqual([])
    expect(answerVisibilityOf(unmarked, arrangement({ q1: ['a'] }))).toEqual({
      incorrect: 3,
      shown: 3,
      paused: 'no-correct-answer',
    })
  })

  test('nothing is hidden beside an answer that names others by letter', () => {
    const lettered = multipleChoice('q1', [
      answer('a', 'Lyon'),
      answer('b', 'Paris'),
      answer('c', 'Nice'),
      answer('d', 'Both A and B', { correct: true }),
    ])
    expect(shownIncorrectRange(lettered)).toBeNull()
    expect(answerVisibilityOf(lettered, arrangement({ q1: ['c'] }))?.paused).toBe('names-letters')
  })
})

describe('the answers a question shows', () => {
  test('the correct answer and locked answers are never hidden, and at least one incorrect answer shows', () => {
    const asked = arrangement({ q1: ['a', 'b', 'c', 'd', 'e', 'f'] })
    // Paris is correct and None of the above locked: neither hides. Hiding
    // every other incorrect one leaves the locked one, which is enough.
    expect(hiddenAnswerIdsOf(capitals, asked)).toEqual(['a', 'c', 'd', 'e'])
    expect(ids(shownChoices(capitals, asked))).toEqual(['b', 'f'])
  })

  test('with no locked incorrect answer, the last one hidden is shown again', () => {
    const plain = multipleChoice('q1', [answer('a', 'Lyon'), answer('b', 'Paris', { correct: true }), answer('c', 'Nice')])
    expect(hiddenAnswerIdsOf(plain, arrangement({ q1: ['a', 'c'] }))).toEqual(['a'])
  })

  test('shown answers keep the arrangement order and close up, a last locked answer staying last', () => {
    const asked = arrangement({ q1: ['c', 'e'] }, { q1: ['e', 'd', 'c', 'b', 'a', 'f'] })
    expect(ids(shownChoices(capitals, asked))).toEqual(['d', 'b', 'a', 'f'])
    expect(answerVisibilityOf(capitals, asked)).toEqual({ incorrect: 5, shown: 3 })
  })

  test('an Exam that hides nothing reads as before', () => {
    expect(answerVisibilityOf(capitals, arrangement())).toBeUndefined()
    expect(ids(shownChoices(capitals, arrangement()))).toEqual(ids(orderedChoices(capitals, arrangement())))
  })
})

describe('choosing how many incorrect answers show', () => {
  test('hides that many more at random, clamped to what the question allows', () => {
    const two = withShownIncorrect(exam, arrangement(), ['q1'], 2, seededRandom(1))
    expect(hiddenAnswerIdsOf(capitals, two)).toHaveLength(3)
    expect(hiddenAnswerIdsOf(capitals, two)).not.toContain('b')
    expect(hiddenAnswerIdsOf(capitals, two)).not.toContain('f')
    const zero = withShownIncorrect(exam, arrangement(), ['q1'], 0, seededRandom(1))
    expect(answerVisibilityOf(capitals, zero)).toEqual({ incorrect: 5, shown: 1 })
  })

  test('showing more keeps what was already shown', () => {
    const two = withShownIncorrect(exam, arrangement(), ['q1'], 2, seededRandom(3))
    const shownBefore = ids(shownChoices(capitals, two))
    const four = withShownIncorrect(exam, two, ['q1'], 4, seededRandom(4))
    for (const id of shownBefore) expect(ids(shownChoices(capitals, four))).toContain(id)
    expect(answerVisibilityOf(capitals, four)).toEqual({ incorrect: 5, shown: 4 })
  })

  test('all of them clears the question', () => {
    const two = withShownIncorrect(exam, arrangement(), ['q1'], 2, seededRandom(3))
    const all = withShownIncorrect(exam, two, ['q1'], Infinity, seededRandom(3))
    expect(all.hiddenAnswers).toEqual({})
  })

  test('applies to each eligible question of a selection, clamped to each', () => {
    const small = multipleChoice('q2', [answer('g', 'Rome', { correct: true }), answer('h', 'Milan'), answer('i', 'Turin')])
    const both: Exam = { title: 'Capitals', questions: [capitals, small] }
    const base: Arrangement = { ...arrangement(), questionOrder: ['q1', 'q2'] }
    const three = withShownIncorrect(both, base, ['q1', 'q2'], 3, seededRandom(2))
    expect(answerVisibilityOf(capitals, three)).toEqual({ incorrect: 5, shown: 3 })
    // q2 has only two incorrect answers: showing three is showing them all.
    expect(answerVisibilityOf(small, three)).toBeUndefined()
  })
})

describe('Shuffle answers on a question that hides some', () => {
  test('keeps the correct and locked answers, keeps the count, and draws again which show', () => {
    const two = withShownIncorrect(exam, arrangement(), ['q1'], 2, seededRandom(5))
    const seen = new Set<string>()
    let current = two
    for (let round = 0; round < 12; round += 1) {
      const next = varySelectedAnswers(exam, current, ['q1'], seededRandom(round + 10))
      const shown = ids(shownChoices(capitals, next))
      expect(shown).toContain('b')
      expect(shown.at(-1)).toBe('f')
      expect(answerVisibilityOf(capitals, next)).toEqual({ incorrect: 5, shown: 2 })
      // Every shuffle visibly varies the question.
      expect(shown).not.toEqual(ids(shownChoices(capitals, current)))
      seen.add([...shown].sort().join())
      current = next
    }
    // More than one set of distractors came up.
    expect(seen.size).toBeGreaterThan(1)
  })
})
