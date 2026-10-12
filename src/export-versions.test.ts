import { describe, expect, test } from 'bun:test'
import { orderedChoices, type Arrangement, type Exam, type Question } from './exam'
import { maxVersionCount, seededRandom, shuffledArrangements } from './export-versions'
import { shownChoices } from './hidden-answers'
import type { ProseMirrorJSON } from './question-doc'

function answer(id: string, text: string, locked?: boolean): ProseMirrorJSON {
  return {
    type: 'multipleChoiceChoice',
    attrs: { correct: id === 'a', id, ...(locked === undefined ? {} : { locked }) },
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

const planets = multipleChoice('q1', [
  answer('a', 'Mercury'),
  answer('b', 'Venus'),
  answer('c', 'Earth'),
  answer('d', 'All of the above'),
])
const exam: Exam = { title: 'Planets', questions: [planets] }
const arrangement: Arrangement = { id: 'w', letter: 'A', questionOrder: ['q1'], choiceOrder: {} }
const answersOnly = { questions: false, answers: true }

let next = 0
const createId = () => `v${(next += 1)}`

describe('Versions around a Locked Answer', () => {
  test('only the unlocked answers count toward how many Versions there can be', () => {
    // 3! arrangements of Mercury, Venus and Earth, less the Working Copy's own.
    expect(maxVersionCount(exam, arrangement, answersOnly)).toBe(5)
  })

  test('every Version keeps the locked answer at its letter and shuffles the rest', () => {
    const versions = shuffledArrangements({
      exam,
      arrangement,
      shuffle: answersOnly,
      count: 5,
      random: seededRandom(7),
      createId,
    })
    const orders = versions.map((version) => orderedChoices(planets, version).map(({ id }) => id))
    for (const order of orders) expect(order[3]).toBe('d')
    // Five distinct Versions, none of them the Working Copy's arrangement.
    expect(new Set(orders.map((order) => order.join())).size).toBe(5)
    expect(orders.map((order) => order.join())).not.toContain('a,b,c,d')
    // What a Version stores already has the lock in place.
    for (const version of versions) expect(version.choiceOrder.q1![3]).toBe('d')
  })

  test('an unlocked "All of the above" shuffles like any other answer', () => {
    const unlocked = multipleChoice('q1', [
      answer('a', 'Mercury'),
      answer('b', 'Venus'),
      answer('c', 'Earth'),
      answer('d', 'All of the above', false),
    ])
    expect(maxVersionCount({ title: 'Planets', questions: [unlocked] }, arrangement, answersOnly)).toBe(23)
  })

  test('a Version of a question that hides answers hides as many, draws which, and never hides the correct or locked ones', () => {
    const cities = multipleChoice('q1', [
      answer('a', 'Paris'), // correct: see `answer`
      answer('b', 'Lyon'),
      answer('c', 'Nice'),
      answer('d', 'Lille'),
      answer('e', 'None of the above'),
    ])
    const hiding: Arrangement = { ...arrangement, hiddenAnswers: { q1: ['b', 'c'] } }
    const cityExam: Exam = { title: 'Cities', questions: [cities] }
    // Choose 2 of Lyon, Nice and Lille to hide, then order Paris and the one
    // left: 3 × 2 shown arrangements, less the Working Copy's own.
    expect(maxVersionCount(cityExam, hiding, answersOnly)).toBe(5)
    const versions = shuffledArrangements({
      exam: cityExam,
      arrangement: hiding,
      shuffle: answersOnly,
      count: 5,
      random: seededRandom(11),
      createId,
    })
    const shown = versions.map((version) => shownChoices(cities, version).map(({ id }) => id))
    for (const answers of shown) {
      expect(answers).toHaveLength(3)
      expect(answers).toContain('a')
      expect(answers.at(-1)).toBe('e')
    }
    expect(new Set(shown.map((answers) => answers.join())).size).toBe(5)
    expect(shown.map((answers) => answers.join())).not.toContain('a,d,e')
  })

  test('a Version keeps the Working Copy’s hidden answers when answers are not shuffled', () => {
    const hiding: Arrangement = { ...arrangement, questionOrder: ['q1', 'q2'], hiddenAnswers: { q1: ['b'] } }
    const two: Exam = { title: 'Planets', questions: [planets, multipleChoice('q2', [answer('a', 'Yes'), answer('b', 'No')])] }
    const [version] = shuffledArrangements({
      exam: two,
      arrangement: hiding,
      shuffle: { questions: true, answers: false },
      count: 1,
      random: seededRandom(3),
      createId,
    })
    expect(version!.hiddenAnswers).toEqual({ q1: ['b'] })
  })

  test('a question with every answer but one locked offers nothing to shuffle', () => {
    const fixed = multipleChoice('q1', [
      answer('a', 'Mercury'),
      answer('b', 'Venus', true),
      answer('c', 'Both A and B'),
    ])
    expect(maxVersionCount({ title: 'Planets', questions: [fixed] }, arrangement, answersOnly)).toBe(0)
  })
})
