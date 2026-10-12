import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inspectImportValue } from '../../package-import'
import { readQuestionFile } from '..'
import { blocksText } from '../rich-text'
import { xlsx } from './test-xlsx'

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${path}`, import.meta.url)))
const encode = (text: string) => new TextEncoder().encode(text)

async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record, undefined, reading.files)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

describe('Spreadsheet of questions', () => {
  test('reads a teacher’s table by its headers, whatever form the correct answer takes', async () => {
    const { reading, proposal, questions } = await read('questions.csv', fixture('spreadsheet/questions.csv'))
    expect(reading.format).toBe('spreadsheet')
    expect(proposal.banks).toHaveLength(1)
    expect(reading.found).toBe(6)
    expect(questions.map((question) => question.type)).toEqual([
      'multiple-choice', 'multiple-choice', 'true-false', 'short-answer', 'multiple-choice',
    ])
    const [sum, even, water, ocean, gas] = questions
    // A letter.
    expect(sum!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['3', false], ['4', true], ['5', false], ['6', false],
    ])
    expect(sum!.topics).toEqual(['Arithmetic'])
    // A list: two correct answers, unmarked, with a note naming them.
    expect(even!.choices!.every((choice) => !choice.correct)).toBe(true)
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(a, c)')
    // True, with no options: True/False.
    expect(water!.choices!.map((choice) => choice.correct)).toEqual([true, false])
    // An answer with no options is accepted.
    expect(text(ocean!.suggestedAnswer)).toBe('Pacific')
    // The answer's own text.
    expect(gas!.choices!.map((choice) => choice.correct)).toEqual([false, true, false])
    // A number naming an empty option.
    expect(reading.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      message: 'Question 6 (line 7): its correct answer “3” is not one of its options, their letter or their number.',
    }))
  })

  test('reads an .xlsx whose options are the wrong answers, the right one apart', async () => {
    const bytes = await xlsx({
      rows: [
        ['My chemistry quiz'],
        ['Prompt', 'Correct Answer', 'Incorrect Answer 1', 'Incorrect Answer 2', 'Tags'],
        ['Symbol for gold?', 'Au', 'Ag', 'Gd', 'chemistry; elements'],
        ['Number of protons in carbon?', 6, 12, 8, 'chemistry'],
      ],
    })
    const { reading, questions } = await read('chem.xlsx', bytes)
    expect(reading.format).toBe('spreadsheet')
    expect(questions[0]!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['Au', true], ['Ag', false], ['Gd', false],
    ])
    expect(questions[0]!.topics).toEqual(['chemistry', 'elements'])
    expect(questions[1]!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['6', true], ['12', false], ['8', false],
    ])
  })

  test('reads a type column, and numbered options', async () => {
    const { reading, questions } = await read('quiz.csv', encode([
      'Question Text,Question Type,Choice 1,Choice 2,Choice 3,Answer',
      'Describe the water cycle.,Essay,,,,Evaporation then condensation then rain',
      'Pick the mammal.,MC,Shark,Whale,Trout,2',
      'Is ice cold?,T/F,,,,T',
      'Match these.,Matching,,,,',
    ].join('\n')))
    expect(reading.format).toBe('spreadsheet')
    expect(questions.map((question) => question.type)).toEqual(['short-answer', 'multiple-choice', 'true-false'])
    expect(text(questions[0]!.suggestedAnswer)).toBe('Evaporation then condensation then rain')
    expect(questions[1]!.choices!.map((choice) => choice.correct)).toEqual([false, true, false])
    expect(reading.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      message: 'Question 4 (line 5): Test Parrot does not read “Matching” questions from a spreadsheet.',
    }))
  })

  test('a table with no question column is not a spreadsheet of questions', async () => {
    await expect(read('grades.csv', encode('Name,Score,Grade\nAda,98,A\nBob,71,C\n'))).rejects.toThrow('could not find questions')
  })

  test('keeps a whole number in a Points or Marks column as Points', async () => {
    const { reading, questions } = await read('quiz.csv', encode([
      'Question,Option A,Option B,Answer,Marks',
      'Pick the mammal.,Shark,Whale,B,2',
      'Pick the bird.,Robin,Trout,A,0.5',
      'Pick the fish.,Trout,Robin,A,',
    ].join('\n')))
    expect(reading.format).toBe('spreadsheet')
    expect(questions.map((question) => question.points)).toEqual([2, undefined, undefined])
  })
})
