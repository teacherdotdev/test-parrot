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

describe('Respondus Standard Format', () => {
  test('reads every kind the guide shows, starred answers marking the correct ones', async () => {
    const { reading, proposal, questions } = await read('respondus.txt', fixture('respondus/standard-format.txt'))
    expect(reading.format).toBe('respondus')
    expect(proposal.banks[0]!.summary).toBeDefined()
    expect(reading.found).toBe(10)
    expect(questions.map((question) => question.type)).toEqual([
      'multiple-choice', 'true-false', 'short-answer', 'short-answer', 'matching', 'short-answer',
      'multiple-choice', 'fill-in-the-blank', 'multiple-choice',
    ])
    const [speed, trueFalse, essay, blank, matching, order, several, blanks, planet] = questions

    // Its `Points: 2.5` is not a whole number, so no question has Points.
    expect(questions.every((question) => question.points === undefined)).toBe(true)

    // Feedback and titles are not part of the question.
    expect(text(speed!.stem)).toBe('Who determined the exact speed of light?')
    expect(speed!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['Albert Einstein', false], ['Albert Michelson', true], ['Thomas Edison', false], ['Guglielmo Marconi', false],
    ])
    expect(trueFalse!.choices!.map((choice) => choice.correct)).toEqual([true, false])

    expect(text(essay!.stem)).toBe('How is the Michelson-Morely experiment related to Albert\nEinstein\'s theory of relativity?')
    expect(text(essay!.suggestedAnswer)).toStartWith('In 1887, Albert Michelson and Edward Morely carried out experiments')
    // Its sentence has no place for a blank, so it stays Short Answer.
    expect(text(blank!.suggestedAnswer)).toBe('Zworykin / Vladimir Zworykin / Vladimir Kosma Zworykin')

    expect(matching!.prompts!.map((prompt) => text(prompt.content))).toEqual(['Michelson-Morely', 'Einstein', 'Marconi'])
    expect(matching!.wordBank!.map((answer) => text(answer.content))).toEqual(['Speed of light', 'Theory of Relativity', 'radio waves'])

    expect(text(order!.suggestedAnswer).replace(/\n+/g, '\n')).toBe('George Washington\nJohn Adams\nThomas Jefferson')

    // Multiple Answer: comes in with none marked, and the teacher is told which were.
    expect(several!.choices!.every((choice) => !choice.correct)).toBe(true)
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(b, d)')

    expect(text(blanks!.stem)).toBe('A _____ by any other _____ would smell as\n_____.')
    expect(blankAnswers(blanks!.stem.content)).toEqual(['rose / red flower', 'name', 'sweet / good'])

    // A picture Respondus reads from a folder is left out, and said so.
    expect(text(planet!.stem)).toBe('Which planet is shown?')
    expect(reading.issues.find((issue) => issue.code === 'picture-left-out')?.message).toStartWith('Question 10 (line 65):')

    const unsupported = reading.issues.find((issue) => issue.code === 'unsupported-type')
    expect(unsupported?.severity).toBe('error')
    expect(unsupported?.message).toBe('Question 9 (line 63): Test Parrot cannot read Respondus questions of type “JUM”, so it was left out.')
  })

  test('takes correct answers from the Answers: list at the end, and never guesses A', async () => {
    const { reading, questions } = await read('key.txt', fixture('respondus/answer-key.txt'))
    expect(reading.format).toBe('respondus')
    expect(reading.found).toBe(7)
    expect(questions).toHaveLength(6)
    const [speed, trueFalse, essay, blank, several, gas] = questions
    expect(speed!.choices!.map((choice) => choice.correct)).toEqual([false, true, false, false])
    expect(trueFalse!.type).toBe('true-false')
    expect(trueFalse!.choices!.map((choice) => choice.correct)).toEqual([true, false])
    expect(text(essay!.suggestedAnswer)).toBe(
      'In 1887, Albert Michelson and Edward Morely carried out experiments to detect the change in speed of light.',
    )
    expect(text(blank!.suggestedAnswer)).toBe('Zworykin / Vladimir Zworykin')
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(b, d)')
    expect(several!.type).toBe('multiple-choice')
    expect(gas!.choices!.map((choice) => choice.correct)).toEqual([false, true])

    const missing = reading.issues.find((issue) => issue.code === 'no-correct-answer')
    expect(missing?.severity).toBe('error')
    expect(missing?.message).toStartWith('Question 7 (line 26): no answer is marked correct.')
  })

  test('a plain numbered file with no Respondus markers is left to the Blackboard Test Generator', async () => {
    const { reading } = await read('plain.txt', encode('1. What is 2 + 3?\na) 4\n*b) 5\n\n2. What is 2 + 2?\n*a) 4\nb) 5\n'))
    expect(reading.format).toBe('bb-generator')
  })

  test('one Respondus marker, a Points: line, is enough to read it as Respondus', async () => {
    const { reading, questions } = await read('points.txt', encode('Points: 2\n1. What is 2 + 3?\na) 4\n*b) 5\n2. What is 2 + 2?\n*a) 4\nb) 5\n'))
    expect(reading.format).toBe('respondus')
    expect(questions).toHaveLength(2)
    expect(reading.issues).toEqual([])
  })

  test('keeps a whole-number Points line as the Points of every question after it', async () => {
    const { reading, questions } = await read('respondus.txt', encode([
      '1) What colour is a ripe lemon?',
      'a. Blue',
      '*b. Yellow',
      '',
      'Points: 2',
      '2) What colour is grass?',
      '*a. Green',
      'b. Red',
      '',
      'Type: E',
      '3) Describe a rainbow.',
      '',
      'Points: 0',
      '4) What colour is snow?',
      '*a. White',
      'b. Black',
    ].join('\n')))
    expect(reading.format).toBe('respondus')
    expect(questions.map((question) => question.points)).toEqual([undefined, 2, 2, undefined])
  })
})
