import { describe, expect, test } from 'bun:test'
import { inspectImportValue } from '../../package-import'
import { readQuestionFile } from '..'
import { blocksText } from '../rich-text'
import { xlsx } from './test-xlsx'

const encode = (text: string) => new TextEncoder().encode(text)

async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record, undefined, reading.files)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

/** Kahoot's template: a title and instructions, then the header on row 8. */
const template = (rows: (string | number | null)[][]) =>
  xlsx({
    name: 'Sheet1',
    rows: [
      [null, 'Quiz template'],
      { row: 2, cells: [null, 'Add questions, at least two answer alternatives, time limit and choose correct answers (at least one).'] },
      {
        row: 8,
        cells: [
          null,
          'Question - max 120 characters',
          'Answer 1 - max 75 characters',
          'Answer 2 - max 75 characters',
          'Answer 3 - max 75 characters',
          'Answer 4 - max 75 characters',
          'Time limit (sec) – 5, 10, 20, 30, 60, 90, 120, or 240 secs',
          'Correct answer(s) - choose at least one',
        ],
      },
      ...rows.map((cells, index) => ({ row: 9 + index, cells })),
    ],
  })

describe('Kahoot spreadsheet', () => {
  test('reads Kahoot’s template: numbered correct answers, one or several', async () => {
    const bytes = await template([
      [1, 'What is the capital of France?', 'London', 'Paris', 'Rome', 'Berlin', 20, 2],
      [2, 'Which are prime?', '2', '4', '5', null, 30, '1,3'],
      [3, 'The earth is flat.', 'True', 'False', null, null, 10, 2],
      [4, 'Only one answer?', 'Yes', null, null, null, 20, 1],
      [5, null, null, null, null, null, null, null],
    ])
    const { reading, proposal, questions } = await read('kahoot.xlsx', bytes)
    expect(reading.format).toBe('kahoot')
    expect(proposal.banks).toHaveLength(1)
    // The template's numbered but empty rows are not questions.
    expect(reading.found).toBe(4)
    expect(questions.map((question) => question.type)).toEqual(['multiple-choice', 'multiple-choice', 'true-false'])
    const [capital, prime, flat] = questions
    expect(text(capital!.stem)).toBe('What is the capital of France?')
    expect(capital!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['London', false], ['Paris', true], ['Rome', false], ['Berlin', false],
    ])
    // Two correct answers: unmarked, with a note naming them.
    expect(prime!.choices!.map((choice) => text(choice.content))).toEqual(['2', '4', '5'])
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(a, c)')
    expect(flat!.choices!.map((choice) => choice.correct)).toEqual([false, true])
    expect(reading.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      message: 'Question 4 (line 12): Kahoot questions need at least two answers, and this one has one.',
    }))
  })

  test('reads the same columns saved as a CSV', async () => {
    const { reading, questions } = await read('kahoot.csv', encode([
      'Kahoot quiz,,,,,,',
      'Question,Answer 1,Answer 2,Answer 3,Answer 4,Time limit,Correct answer(s)',
      'Largest planet?,Mars,Jupiter,,,20,2',
    ].join('\n')))
    expect(reading.format).toBe('kahoot')
    expect(questions[0]!.choices!.map((choice) => choice.correct)).toEqual([false, true])
  })
})
