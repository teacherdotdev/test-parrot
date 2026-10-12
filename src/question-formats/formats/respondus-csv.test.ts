import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inspectImportValue } from '../../package-import'
import { readQuestionFile } from '..'
import { blankAnswers, blocksText } from '../rich-text'

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${path}`, import.meta.url)))
const encode = (text: string) => new TextEncoder().encode(text)

async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record, undefined, reading.files)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

describe('Respondus CSV', () => {
  test('reads each type, with correct answers as a letter, a number, true or false, and a list', async () => {
    const { reading, proposal, questions } = await read('respondus.csv', fixture('respondus-csv/sample.csv'))
    expect(reading.format).toBe('respondus-csv')
    expect(proposal.banks).toHaveLength(1)
    // The header row is not a question.
    expect(reading.found).toBe(7)
    expect(questions.map((question) => question.type)).toEqual([
      'multiple-choice', 'true-false', 'multiple-choice', 'fill-in-the-blank', 'short-answer', 'multiple-choice', 'true-false',
    ])
    const [capital, sun, primes, water, essay, planets, moon] = questions
    // The Points column gives each question's Points.
    expect(questions.map((question) => question.points)).toEqual([1, 1, 2, 1, 5, 1, 1])
    expect(text(capital!.stem)).toBe('What is the capital of France?')
    expect(capital!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['London', false], ['Berlin', false], ['Paris', true], ['Madrid', false],
    ])
    expect(sun!.choices!.map((choice) => choice.correct)).toEqual([true, false])
    // MR with two answers comes in unmarked, and says which they were.
    expect(primes!.choices!.every((choice) => !choice.correct)).toBe(true)
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(a, c)')
    // Its own underscores are where its Blank goes.
    expect(text(water!.stem)).toBe('The chemical formula for water is _____.')
    expect(blankAnswers(water!.stem.content)).toEqual(['H2O / H₂O'])
    expect(text(essay!.stem)).toBe('Explain, in a paragraph, why the sky is blue.')
    expect(text(essay!.suggestedAnswer)).toBe('Rayleigh scattering of sunlight.')
    expect(text(planets!.stem)).toBe('Which planet is largest?')
    expect(planets!.choices!.map((choice) => choice.correct)).toEqual([false, true, false])
    expect(moon!.choices!.map((choice) => choice.correct)).toEqual([false, true])
  })

  test('leaves out a row whose correct answer names an empty choice', async () => {
    const { reading, questions } = await read('quiz.csv', encode([
      'MC,,1,Pick one,D,Yes,No',
      'MC,,1,Pick another,A,Up,Down',
    ].join('\n')))
    expect(reading.format).toBe('respondus-csv')
    expect(questions).toHaveLength(1)
    expect(reading.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      message: 'Question 1 (line 1): its correct answer “D” names choice 4, which is empty.',
    }))
  })

  test('a Blackboard upload file is still Blackboard’s', async () => {
    const { reading } = await read('bb.txt', encode('MC\tWhat is 2 + 2?\t3\tincorrect\t4\tcorrect\nTF\tThe sky is blue.\ttrue\n'))
    expect(reading.format).toBe('bb-tsv')
    const score = (id: string) => reading.candidates.find((candidate) => candidate.id === id)?.score ?? 0
    expect(score('respondus-csv')).toBeLessThan(0.5)
    expect(score('flashcards')).toBe(0)
    expect(score('spreadsheet')).toBe(0)
  })

  test('drops Points that are fractional, zero or missing', async () => {
    const { reading, questions } = await read('respondus.csv', encode([
      'ES,Clouds,1.5,Describe a cloud.',
      'ES,Rain,0,Describe rain.',
      'ES,Snow,,Describe snow.',
      'ES,Wind,3,Describe wind.',
    ].join('\n')))
    expect(reading.format).toBe('respondus-csv')
    expect(questions.map((question) => question.points)).toEqual([undefined, undefined, undefined, 3])
  })
})
