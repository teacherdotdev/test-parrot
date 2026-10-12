import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inspectImportValue } from '../../package-import'
import { readQuestionFile } from '..'
import { blocksText } from '../rich-text'

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${path}`, import.meta.url)))
const encode = (text: string) => new TextEncoder().encode(text)

async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record, undefined, reading.files)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

describe('Brightspace (D2L) question CSV', () => {
  test('reads D2L’s own sample, one question of each of its seven types', async () => {
    const { reading, proposal, questions } = await read('Sample_Question_Import_UTF8.csv', fixture('d2l-csv/sample-question-import.csv'))
    expect(reading.format).toBe('d2l-csv')
    expect(proposal.banks).toHaveLength(1)
    expect(reading.found).toBe(7)
    expect(questions.map((question) => question.type)).toEqual([
      'short-answer', 'short-answer', 'matching', 'multiple-choice', 'true-false', 'multiple-choice', 'short-answer',
    ])
    const [written, short, matching, choice, trueFalse, multiSelect, ordering] = questions

    // Each question's Points row gives its Points, the Matching set's for the set.
    expect(questions.map((question) => question.points)).toEqual([1, 5, 2, 1, 1, 10, 2])

    // Titles, hints and feedback are not part of the question.
    expect(text(written!.stem)).toBe('This is the question text for WR1')
    expect(text(written!.suggestedAnswer)).toBe('This is the answer key text')

    // The full-marks answer is accepted; the half-marks one is not.
    expect(text(short!.suggestedAnswer)).toBe('This is the text for answer 1')

    // Matches are paired with their choices by number, whatever their order.
    expect(matching!.prompts!.map((prompt) => text(prompt.content))).toEqual([
      'This is choice 1 text', 'This is choice 2 text', 'This is choice 3 text',
    ])
    const answerText = (id: string | undefined) => text(matching!.wordBank!.find((answer) => answer.id === id)?.content)
    expect(matching!.prompts!.map((prompt) => answerText(prompt.answer))).toEqual([
      'This matches with choice 1', 'This matches with choice 2', 'This matches with choice 3',
    ])

    // Only the 100% option is correct; the 25% one is not.
    expect(choice!.choices!.map((option) => [text(option.content), option.correct])).toEqual([
      ['This is the correct answer', true],
      ['This is incorrect answer 1', false],
      ['This is incorrect answer 2', false],
      ['This is partially correct', false],
    ])
    expect(trueFalse!.choices!.map((option) => option.correct)).toEqual([true, false])

    // Multi-Select with two right answers comes in unmarked, and says which.
    expect(multiSelect!.choices!.every((option) => !option.correct)).toBe(true)
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(a, c)')

    expect(text(ordering!.suggestedAnswer).split(/\n+/)).toEqual(['This is the text for item 1', 'This is the text for item 2'])

    // Every question names a picture outside the file (O's too).
    expect(reading.issues.filter((issue) => issue.code === 'picture-not-imported')).toHaveLength(7)
    expect(reading.issues.find((issue) => issue.code === 'picture-not-imported')!.message).toBe(
      'Question 1 (line 9): its picture “images/LA1.jpg” is a separate file, so it was not brought in. Add it after importing.',
    )
    expect(reading.issues.filter((issue) => issue.severity === 'error')).toEqual([])
  })

  test('reads HTML question text, and a correct answer weighted below 100', async () => {
    const { reading, questions } = await read('quiz.csv', encode([
      'NewQuestion,MC,,,',
      'QuestionText,<p>Which is <strong>largest</strong>?</p>,HTML,,',
      'Option,0,Mars,,',
      'Option,90,Jupiter,,',
      'Option,40,Saturn,,',
      '',
      'newquestion,MC',
      'QuestionText,Plain text with <brackets>',
      'Option,100,Yes',
      'Option,0,No',
    ].join('\n')))
    expect(reading.format).toBe('d2l-csv')
    expect(text(questions[0]!.stem)).toBe('Which is largest?')
    expect(questions[0]!.stem.content[0]).toMatchObject({ content: [{ text: 'Which is ' }, { text: 'largest', marks: [{ type: 'strong' }] }, { text: '?' }] })
    expect(questions[0]!.choices!.map((option) => option.correct)).toEqual([false, true, false])
    expect(text(questions[1]!.stem)).toBe('Plain text with <brackets>')
  })

  test('leaves out a type it cannot read, and says which question', async () => {
    const { reading, questions } = await read('quiz.csv', encode([
      'NewQuestion,TF',
      'QuestionText,Water is wet.',
      'TRUE,100',
      'FALSE,0',
      'NewQuestion,LK',
      'QuestionText,A Likert question',
    ].join('\n')))
    expect(reading.format).toBe('d2l-csv')
    expect(reading.found).toBe(2)
    expect(questions).toHaveLength(1)
    expect(reading.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      message: 'Question 2 (line 5): “LK” is not a Brightspace question type Test Parrot reads.',
    }))
  })

  test('keeps whole-number Points, and drops fractional, zero or missing ones', async () => {
    const { reading, questions } = await read('quiz.csv', encode([
      'NewQuestion,WR',
      'QuestionText,Describe a volcano.',
      'Points,3',
      'NewQuestion,WR',
      'QuestionText,Describe a glacier.',
      'Points,2.5',
      'NewQuestion,WR',
      'QuestionText,Describe a delta.',
      'Points,0',
      'NewQuestion,MC',
      'QuestionText,Which is a gas?',
      'Option,100,Steam',
      'Option,0,Ice',
    ].join('\n')))
    expect(reading.format).toBe('d2l-csv')
    expect(questions.map((question) => question.points)).toEqual([3, undefined, undefined, undefined])
  })
})
