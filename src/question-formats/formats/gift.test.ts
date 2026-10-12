import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inspectImportValue } from '../../package-import'
import { readQuestionFile } from '..'
import { blankAnswers, blocksText } from '../rich-text'
import { gift } from './gift'

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${path}`, import.meta.url)))
const encode = (text: string) => new TextEncoder().encode(text)

async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record, undefined, reading.files)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

const input = (source: string) => ({ name: 'x.txt', bytes: encode(source), text: () => source, zip: async () => null })

describe('Moodle GIFT', () => {
  test('reads every example on MoodleDocs’ GIFT page', async () => {
    const { reading, proposal, questions } = await read('examples.gift', fixture('gift/moodledocs-examples.gift'))
    expect(reading.format).toBe('gift')
    expect(proposal).toBeTruthy()
    expect(reading.found).toBe(37)
    expect(questions).toHaveLength(37)
    expect(reading.issues.filter((issue) => issue.severity === 'error')).toEqual([])

    const byStem = (stem: string) => questions.filter((question) => text(question.stem) === stem)
    const choices = (question: (typeof questions)[number]) =>
      question.choices!.map((choice) => [text(choice.content), choice.correct])

    // True/False, both spellings, and with feedback.
    expect(questions[0]!.type).toBe('true-false')
    expect(text(questions[0]!.stem)).toBe('1+1=2')
    expect(questions[0]!.choices!.map((choice) => choice.correct)).toEqual([true, false])
    expect(byStem('The sun rises in the West.')[0]!.choices!.map((choice) => choice.correct)).toEqual([false, true])
    expect(byStem('42 is the Absolute Answer to everything.')[0]!.choices!.map((choice) => choice.correct)).toEqual([false, true])

    // Multiple choice, feedback dropped.
    expect(choices(questions[1]!)).toEqual([['yellow', true], ['red', false], ['blue', false]])
    expect(choices(byStem("Who is buried in Grant's tomb in New York City?")[0]!)).toEqual([
      ['Grant', true], ['No one', false], ['Napoleon', false], ['Churchill', false], ['Mother Teresa', false],
    ])

    // Fill in the blank: a missing word's Blank stands where its braces did.
    // A short answer has no place in its sentence for one, so it stays one.
    expect(questions[2]!.type).toBe('fill-in-the-blank')
    expect(text(questions[2]!.stem)).toBe('Two plus _____ equals four.')
    expect(blankAnswers(questions[2]!.stem.content)).toEqual(['two / 2'])
    expect(text(byStem("Who's buried in Grant's tomb?").find((question) => question.type === 'short-answer')!.suggestedAnswer))
      .toBe('Grant / Ulysses S. Grant / Ulysses Grant')

    // Matching.
    const countries = byStem('Match the following countries with their corresponding capitals.')[0]!
    expect(countries.prompts!.map((prompt) => text(prompt.content))).toEqual(['Canada', 'Italy', 'Japan', 'India'])
    expect(countries.wordBank!.map((answer) => text(answer.content))).toEqual(['Ottawa', 'Rome', 'Tokyo', 'New Delhi'])

    // Numerical: tolerance, a range, and several answers.
    expect(text(questions[4]!.suggestedAnswer)).toBe('3 (± 2)')
    expect(text(questions[5]!.suggestedAnswer)).toBe('3 (± 2)')
    expect(text(questions[6]!.suggestedAnswer)).toBe('1822 / 1822 (± 2)')
    expect(text(byStem('What is the value of pi (to 3 decimal places)? _____.')[1]!.suggestedAnswer)).toBe('3.1415 (± 0.0005)')

    // Essay.
    expect(byStem('Write a short biography of Dag Hammarskjöld.')[0]!.type).toBe('short-answer')

    // Missing word: the braces become a blank.
    expect(choices(byStem('Moodle costs _____ to download from moodle.org.')[0]!)).toEqual([
      ['lots of money', false], ['nothing', true], ['a small amount', false],
    ])
    expect(byStem('Since _____ the town of Hastings England has been "famous with visitors".')).toHaveLength(1)

    // Escapes: `\=` and `\~` are the characters themselves.
    expect(choices(byStem('Which answer equals 5?')[0]!)).toEqual([['= 2 + 2', false], ['= 2 + 3', true], ['= 2 + 4', false]])
    expect(choices(byStem('Which of the following is NOT a control character for the GIFT import format?')[0]!)).toEqual([
      ['~', false], ['=', false], ['#', false], ['{', false], ['}', false], ['\\', true],
    ])

    // Weights: a lone `=` among weighted `~` is the right one; weights with no
    // `=` make Multiple Answer, which comes in with none marked.
    expect(choices(byStem('Difficult question.')[0]!)).toEqual([
      ['wrong answer', false], ['half credit answer', false], ['full credit answer', true],
    ])
    const entombed = byStem("What two people are entombed in Grant's tomb?")
    expect(entombed).toHaveLength(3)
    expect(entombed.every((question) => question.choices!.every((choice) => !choice.correct))).toBe(true)
    expect(reading.issues.filter((issue) => issue.code === 'multiple-answer')).toHaveLength(3)

    // Categories become topics; `[markdown]` text is kept as written.
    expect(questions[0]!.topics).toEqual(['harry'])
    const markdown = byStem('The *American holiday of Thanksgiving* is celebrated on the _____ Thursday of November.')[0]!
    expect(markdown.topics).toEqual(['mycategory'])
  })

  test('a question with no braces is a description, skipped and noted', async () => {
    const { reading, questions } = await read('q.gift', encode('::Intro:: The next questions are about Grant.\n\n::Q1:: Grant was a general. {T}\n'))
    expect(questions).toHaveLength(1)
    expect(reading.found).toBe(1)
    expect(reading.issues.map((issue) => [issue.severity, issue.code])).toEqual([['info', 'description-skipped']])
  })

  test('general feedback after #### is not an answer, and [html] text is read as HTML', async () => {
    const { questions } = await read('q.gift', encode('::Q:: [html]<p>What is <b>2 + 2</b>?</p> { =4 ~3 ~5 ####Count on your fingers. }\n\n::R:: Sky colour? {=blue ~green}'))
    expect(text(questions[0]!.stem)).toBe('What is 2 + 2?')
    expect(JSON.stringify(questions[0]!.stem)).toContain('strong')
    expect(questions[0]!.choices!.map((choice) => text(choice.content))).toEqual(['4', '3', '5'])
  })

  test('a broken question is left out with its line, and the rest still come in', async () => {
    const { reading, questions } = await read('q.gift', encode('::A:: One? {=1 ~2\n\n::B:: Two? {#two}\n\n::C:: Three? {=3 ~4}\n'))
    expect(questions).toHaveLength(1)
    expect(reading.found).toBe(3)
    expect(reading.issues.map((issue) => issue.message)).toEqual([
      'Question 1 (line 1): its answers start with “{” but never end with “}”.',
      'Question 2 (line 3): its numerical answer “two” is not a number, a number:tolerance, or a range such as 1..5.',
    ])
  })

  test('a missing word is a Blank where its braces stood, holding every accepted answer', async () => {
    const { reading, questions } = await read('q.gift', encode(
      '::A:: A spider has {=eight =8} legs.\n\n'
      + '::B:: The planet nearest the sun is {=Mercury ~Venus ~Mars}.\n\n'
      + '::C:: Lightning is a form of {} energy.\n',
    ))
    const [legs, planet, empty] = questions
    expect(legs!.type).toBe('fill-in-the-blank')
    expect(text(legs!.stem)).toBe('A spider has _____ legs.')
    expect(blankAnswers(legs!.stem.content)).toEqual(['eight / 8'])
    // Wrong choices make it Multiple Choice, its blank a line.
    expect(planet!.type).toBe('multiple-choice')
    expect(text(planet!.stem)).toBe('The planet nearest the sun is _____.')
    expect(JSON.stringify(planet!.stem)).not.toContain('"blank"')
    // Empty braces are an essay, never a Blank.
    expect(empty!.type).toBe('short-answer')
    expect(reading.issues.filter((issue) => issue.code === 'no-accepted-answer')).toEqual([])
  })

  test('LaTeX and code braces are not GIFT', () => {
    expect(gift.detect(input('Solve \\frac{1}{2} + x = 3.\n\nWhat is $x^{2}$ when x = 3?\n\nfunction f() { return 1 }'))).toBeLessThan(0.3)
    expect(gift.detect(input('1. What is 2 + 2?\n*a) 4\nb) 5'))).toBe(0)
  })
})
