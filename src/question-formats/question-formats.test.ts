import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inspectImportValue } from '../package-import'
import { readQuestionFile } from '.'
import { blankAnswers, blocksText, plainBlocks } from './rich-text'
import { toRecord } from './record'
import { BLANK_MARK, type ForeignQuestion } from './types'

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)))

/** A file read, then checked by the import every Test Parrot file goes through. */
async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record, undefined, reading.files)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

describe('Blackboard Test Generator text', () => {
  test('reads a tagged sample as one Multiple Choice question', async () => {
    const { reading, questions } = await read('planets.txt', fixture('bb-generator/tagged-sample.txt'))
    expect(reading.format).toBe('bb-generator')
    expect(reading.issues).toEqual([])
    expect(questions).toHaveLength(1)
    const [question] = questions
    expect(question!.type).toBe('multiple-choice')
    expect(text(question!.stem)).toBe(
      'Which planet is closest to the Sun?',
    )
    expect(question!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['Venus', false],
      ['Earth', false],
      ['Mercury', true],
      ['Mars', false],
    ])
  })

  test('reads the generator’s own sample quiz', async () => {
    const { reading, questions } = await read('sampleQuiz.txt', fixture('bb-generator/oc-sample-quiz.txt'))
    expect(reading.format).toBe('bb-generator')
    expect(reading.found).toBe(6)
    expect(questions.map((question) => question.type)).toEqual([
      'multiple-choice', 'multiple-choice', 'true-false', 'short-answer', 'fill-in-the-blank', 'matching',
    ])
    // Question 1 is Multiple Answer: it comes in with none marked, and says so.
    expect(questions[0]!.choices!.every((choice) => !choice.correct)).toBe(true)
    expect(reading.issues.map((issue) => issue.code)).toContain('multiple-answer')
    expect(questions[2]!.choices!.map((choice) => choice.correct)).toEqual([true, false])
    // The teacher's own underscores are where its one Blank goes.
    expect(text(questions[4]!.stem)).toBe('Two plus two equals _____.')
    expect(blankAnswers(questions[4]!.stem.content)).toEqual(['four / 4'])
    const matching = questions[5]!
    expect(matching.prompts!.map((prompt) => text(prompt.content))).toEqual(['3', '1', '12', '4'])
    expect(matching.wordBank!.map((answer) => text(answer.content))).toEqual(['three', 'one', 'twelve', 'fore'])
    expect(matching.prompts![3]!.answer).toBeUndefined()
  })
})

describe('what a teacher is told', () => {
  test('a note names the question by its place in the whole file', async () => {
    const pasted = 'MC\nNo star here.\nyes\nno\n\nMA\nPick two.\n*one\n*two\nthree\n'
    const { reading } = await read('pasted.txt', new TextEncoder().encode(pasted))
    expect(reading.issues.map((issue) => issue.message.split(':')[0])).toEqual([
      'Question 1 (line 1)',
      'Question 2 (line 6)',
    ])
  })
})

describe('fill in the blank, whatever file it came from', () => {
  const convert = async (...questions: ForeignQuestion[]) => {
    const { record, issues } = await toRecord({ questions, issues: [], found: questions.length }, { bankName: 'Bank' })
    return { questions: record.bank.questions, issues }
  }

  test('each blank mark is a Blank in its place, in order, holding its accepted answers', async () => {
    const { questions, issues } = await convert({
      kind: 'fill-in-blanks',
      stem: plainBlocks(`Frogs lay ${BLANK_MARK} and toads lay ${BLANK_MARK}.`),
      blanks: [{ name: '1', accepted: ['spawn', 'eggs'] }, { name: '2', accepted: ['strings'] }],
    })
    expect(questions[0]!.type).toBe('fill-in-the-blank')
    expect(text(questions[0]!.stem)).toBe('Frogs lay _____ and toads lay _____.')
    expect(blankAnswers(questions[0]!.stem.content)).toEqual(['spawn / eggs', 'strings'])
    expect(issues).toEqual([])
  })

  test('with no marks, the stem’s own underscores are the places when there is one per answer', async () => {
    const { questions } = await convert({ kind: 'fill-in-blank', stem: plainBlocks('Ice melts at ____ degrees.'), accepted: ['zero'] })
    expect(text(questions[0]!.stem)).toBe('Ice melts at _____ degrees.')
    expect(blankAnswers(questions[0]!.stem.content)).toEqual(['zero'])
  })

  test('a question with no place in its sentence for a blank is Short Answer, its accepted answers suggested', async () => {
    const { questions } = await convert(
      { kind: 'fill-in-blank', stem: plainBlocks('Name the largest moon of Saturn.'), accepted: ['Titan', 'titan'] },
      { kind: 'fill-in-blank', stem: plainBlocks('Fill in ___ or ___: the red planet is'), accepted: ['Mars'] },
      {
        kind: 'fill-in-blanks',
        stem: plainBlocks('Name the two moons of Mars.'),
        blanks: [{ name: 'first', accepted: ['Phobos'] }, { name: 'second', accepted: ['Deimos'] }],
      },
    )
    expect(questions.map((question) => question.type)).toEqual(['short-answer', 'short-answer', 'short-answer'])
    expect(text(questions[0]!.suggestedAnswer)).toBe('Titan / titan')
    // Underscores that are not one per answer are the teacher's own text.
    expect(text(questions[1]!.stem)).toBe('Fill in ___ or ___: the red planet is')
    expect(text(questions[1]!.suggestedAnswer)).toBe('Mars')
    expect(text(questions[2]!.suggestedAnswer)).toBe('first: Phobos\nsecond: Deimos')
  })

  test('a blank with no accepted answer is an empty Blank, and the teacher is told', async () => {
    const { questions, issues } = await convert({
      kind: 'fill-in-blanks',
      stem: plainBlocks(`Bees make ${BLANK_MARK} from ${BLANK_MARK}.`),
      blanks: [{ name: '1', accepted: ['honey'] }, { name: '2', accepted: [] }],
    })
    expect(blankAnswers(questions[0]!.stem.content)).toEqual(['honey', ''])
    expect(issues.map((issue) => [issue.severity, issue.code])).toEqual([['warning', 'no-accepted-answer']])
  })

  test('a drop-down blank holds its correct choice, and the teacher is told it was converted', async () => {
    const { questions, issues } = await convert({
      kind: 'fill-in-blank',
      stem: plainBlocks(`A triangle has ${BLANK_MARK} sides.`),
      accepted: ['three'],
      dropdown: true,
    })
    expect(blankAnswers(questions[0]!.stem.content)).toEqual(['three'])
    expect(issues).toEqual([expect.objectContaining({
      severity: 'warning',
      code: 'dropdown-blank',
      message: 'Question 1: Test Parrot has no drop-down blanks, so each came in as a Blank holding its correct choice.',
    })])
  })

  test('a blank mark in a question of another kind prints as a line', async () => {
    const { questions } = await convert({
      kind: 'numeric',
      stem: plainBlocks(`Seven times six is ${BLANK_MARK}.`),
      answers: [{ value: '42' }],
    })
    expect(questions[0]!.type).toBe('short-answer')
    expect(text(questions[0]!.stem)).toBe('Seven times six is _____.')
    expect(JSON.stringify(questions[0]!.stem)).not.toContain(BLANK_MARK)
  })

  test('a Blackboard upload’s Fill in Multiple Blanks puts each Blank at its [name], in the order the text gives', async () => {
    const tsv = 'MC\tWhat is 2 + 2?\t3\tincorrect\t4\tcorrect\n'
      + 'FIB_PLUS\tA [noun] can [verb].\tverb\tfly\tsoar\t\tnoun\tbird\n'
      + 'FIB\tThe opposite of hot is ____.\tcold\n'
    const { reading, questions } = await read('bb.txt', new TextEncoder().encode(tsv))
    expect(reading.format).toBe('bb-tsv')
    expect(questions.map((question) => question.type)).toEqual(['multiple-choice', 'fill-in-the-blank', 'fill-in-the-blank'])
    expect(text(questions[1]!.stem)).toBe('A _____ can _____.')
    expect(blankAnswers(questions[1]!.stem.content)).toEqual(['bird', 'fly / soar'])
    expect(text(questions[2]!.stem)).toBe('The opposite of hot is _____.')
    expect(blankAnswers(questions[2]!.stem.content)).toEqual(['cold'])
  })
})
