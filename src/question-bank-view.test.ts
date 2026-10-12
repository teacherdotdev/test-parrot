// Browsing the Question Bank: what a teacher sees after typing in the search
// box and choosing filter values. Asserted as bank results rather than as
// component state, so the rules survive whatever the pane looks like.

import { describe, expect, test } from 'bun:test'
import { createQuestion, type Difficulty, type Question, type QuestionType } from './exam'
import { createQuestionBank, withQuestionBanked, type QuestionBank } from './question-bank'
import { paragraph, text } from './export-fixtures'
import {
  NO_FILTER,
  browseQuestionBank,
  isFilterActive,
  topicOptions,
  type QuestionBankFilter,
} from './question-bank-view'

let counter = 0

function question(
  stem: string,
  extra: {
    type?: QuestionType
    difficulty?: Difficulty
    topics?: string[]
    choices?: string[]
  } = {},
): Question {
  counter += 1
  const content: Record<string, unknown>[] = [paragraph(text(stem))]
  if (extra.choices) {
    content.push(paragraph(), {
      type: 'multipleChoice',
      content: extra.choices.map((label, index) => ({
        type: 'multipleChoiceChoice',
        attrs: { correct: index === 0, id: `c${counter}-${index}` },
        content: [paragraph(text(label))],
      })),
    })
  }
  return {
    ...createQuestion(extra.type ?? 'open'),
    id: `q${counter}`,
    type: extra.type ?? 'open',
    doc: { type: 'doc', content },
    ...(extra.difficulty ? { difficulty: extra.difficulty } : {}),
    ...(extra.topics ? { topics: extra.topics } : {}),
  }
}

function banked(...questions: Question[]): QuestionBank {
  return questions.reduce(withQuestionBanked, createQuestionBank())
}

function filter(overrides: Partial<QuestionBankFilter>): QuestionBankFilter {
  return { ...NO_FILTER, ...overrides }
}

const idsOf = (questions: readonly Question[]) => questions.map((one) => one.id)

describe('the Question Bank a teacher browses', () => {
  test('shows the newest Question Bank record first', () => {
    const [first, second, third] = [
      question('Written first'),
      question('Written second'),
      question('Written third'),
    ]

    expect(idsOf(browseQuestionBank(banked(first, second, third), NO_FILTER))).toEqual([
      third.id,
      second.id,
      first.id,
    ])
  })

  test('shows the oldest Question Bank record first when sorted by Oldest', () => {
    const [first, second, third] = [
      question('Written first'),
      question('Written second'),
      question('Written third'),
    ]

    expect(idsOf(browseQuestionBank(banked(first, second, third), filter({ sort: 'oldest' })))).toEqual([
      first.id,
      second.id,
      third.id,
    ])
  })

  test('keeps oldest-first order among the questions a filter leaves', () => {
    const [first, second, third] = [
      question('Photosynthesis in leaves'),
      question('Mitosis'),
      question('Photosynthesis at night'),
    ]

    expect(
      idsOf(browseQuestionBank(banked(first, second, third), filter({ search: 'photo', sort: 'oldest' }))),
    ).toEqual([first.id, third.id])
  })

  test('keeps that order while filtering, rather than rewriting it', () => {
    const [first, second, third] = [
      question('Photosynthesis in leaves'),
      question('Mitosis'),
      question('Photosynthesis at night'),
    ]

    const shown = browseQuestionBank(
      banked(first, second, third),
      filter({ search: 'photosynthesis' }),
    )

    expect(idsOf(shown)).toEqual([third.id, first.id])
  })

  test('is empty when nothing has been written into it', () => {
    expect(browseQuestionBank(createQuestionBank(), NO_FILTER)).toEqual([])
  })

  test('sorts by Question Type, Difficulty, or first alphabetical Topic', () => {
    const shortAnswer = question('Short answer', {
      difficulty: 'hard',
      topics: ['Geometry'],
    })
    const multipleChoice = question('Multiple choice', {
      type: 'multiple-choice',
      difficulty: 'easy',
      topics: ['Algebra'],
    })
    const unspecified = question('Unspecified')
    const bank = banked(shortAnswer, multipleChoice, unspecified)

    expect(idsOf(browseQuestionBank(bank, filter({ sort: 'type' })))).toEqual([
      multipleChoice.id,
      unspecified.id,
      shortAnswer.id,
    ])
    expect(idsOf(browseQuestionBank(bank, filter({ sort: 'difficulty' })))).toEqual([
      multipleChoice.id,
      shortAnswer.id,
      unspecified.id,
    ])
    expect(idsOf(browseQuestionBank(bank, filter({ sort: 'topic' })))).toEqual([
      multipleChoice.id,
      shortAnswer.id,
      unspecified.id,
    ])
  })
})

describe('stem search', () => {
  test('matches the stem whatever the casing', () => {
    const question1 = question('Which GAS do plants take in?')

    expect(idsOf(browseQuestionBank(banked(question1), filter({ search: 'gas do' }))))
      .toEqual([question1.id])
    expect(browseQuestionBank(banked(question1), filter({ search: 'nitrogen' })))
      .toEqual([])
  })

  test('ignores surrounding whitespace in the search itself', () => {
    const question1 = question('Cell division')

    expect(idsOf(browseQuestionBank(banked(question1), filter({ search: '  division  ' }))))
      .toEqual([question1.id])
    expect(idsOf(browseQuestionBank(banked(question1), filter({ search: '   ' }))))
      .toEqual([question1.id])
  })

  test('does not reach answer choices or their correctness', () => {
    const question1 = question('Which is a mammal?', {
      type: 'multiple-choice',
      choices: ['Whale', 'Shark'],
    })

    expect(browseQuestionBank(banked(question1), filter({ search: 'whale' }))).toEqual([])
    expect(idsOf(browseQuestionBank(banked(question1), filter({ search: 'mammal' }))))
      .toEqual([question1.id])
  })
})

describe('filter values', () => {
  const multipleChoice = question('Multiple choice, easy, Algebra', {
    type: 'multiple-choice',
    difficulty: 'easy',
    topics: ['Algebra'],
  })
  const shortAnswer = question('Short answer, hard, Geometry', {
    difficulty: 'hard',
    topics: ['Geometry', 'Algebra'],
  })
  const unclassified = question('Short answer, no Difficulty, no Topics')
  const bank = banked(multipleChoice, shortAnswer, unclassified)

  test('combine with OR inside one category', () => {
    expect(idsOf(browseQuestionBank(bank, filter({ difficulties: ['easy', 'hard'] }))))
      .toEqual([shortAnswer.id, multipleChoice.id])
    expect(idsOf(browseQuestionBank(bank, filter({ types: ['open', 'multiple-choice'] }))))
      .toEqual([unclassified.id, shortAnswer.id, multipleChoice.id])
  })

  test('reach a question left without a Difficulty', () => {
    expect(idsOf(browseQuestionBank(bank, filter({ difficulties: ['unspecified'] }))))
      .toEqual([unclassified.id])
    expect(
      idsOf(browseQuestionBank(bank, filter({ difficulties: ['unspecified', 'easy'] }))),
    ).toEqual([unclassified.id, multipleChoice.id])
  })

  test('match a Topic exactly, on any of the question’s Topics', () => {
    expect(idsOf(browseQuestionBank(bank, filter({ topics: ['Algebra'] }))))
      .toEqual([shortAnswer.id, multipleChoice.id])
    expect(browseQuestionBank(bank, filter({ topics: ['algebra'] }))).toEqual([])
    expect(browseQuestionBank(bank, filter({ topics: ['Alg'] }))).toEqual([])
  })

  test('combine with AND across categories and the search', () => {
    expect(
      idsOf(
        browseQuestionBank(
          bank,
          filter({ types: ['open'], difficulties: ['easy', 'hard'], topics: ['Algebra'] }),
        ),
      ),
    ).toEqual([shortAnswer.id])
    expect(
      browseQuestionBank(
        bank,
        filter({ types: ['multiple-choice'], topics: ['Geometry'] }),
      ),
    ).toEqual([])
    expect(
      browseQuestionBank(bank, filter({ search: 'Geometry', types: ['multiple-choice'] })),
    ).toEqual([])
  })

  test('restore the whole bank once they are cleared', () => {
    expect(idsOf(browseQuestionBank(bank, NO_FILTER))).toEqual([
      unclassified.id,
      shortAnswer.id,
      multipleChoice.id,
    ])
    expect(isFilterActive(NO_FILTER)).toBe(false)
    expect(isFilterActive(filter({ search: '  ' }))).toBe(false)
    expect(isFilterActive(filter({ search: 'gas' }))).toBe(true)
    expect(isFilterActive(filter({ topics: ['Algebra'] }))).toBe(true)
  })
})

describe('the Topic dropdown', () => {
  test('offers the exact trimmed Topics the Question Bank currently holds', () => {
    const bank = banked(
      question('One', { topics: ['Cell division', 'Algebra'] }),
      question('Two', { topics: ['Algebra'] }),
      question('Three'),
    )

    expect(topicOptions(bank)).toEqual(['Algebra', 'Cell division'])
  })

  test('keeps two spellings of one subject apart', () => {
    const options = topicOptions(
      banked(question('One', { topics: ['Algebra'] }), question('Two', { topics: ['algebra'] })),
    )

    expect(options).toHaveLength(2)
    expect(options).toContain('Algebra')
    expect(options).toContain('algebra')
  })
})
