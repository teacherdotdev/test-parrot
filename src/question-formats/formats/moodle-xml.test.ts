import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inspectImportValue } from '../../package-import'
import { readQuestionFile } from '..'
import { blankAnswers, blocksText } from '../rich-text'
import { categoryTopic, moodleXml } from './moodle-xml'

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${path}`, import.meta.url)))
const encode = (text: string) => new TextEncoder().encode(text)

async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record, undefined, reading.files)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

const quiz = (questions: string) => encode(`<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n${questions}\n</quiz>`)

describe('Moodle XML', () => {
  test('reads an export with every core type, its categories, tags and picture', async () => {
    const { reading, proposal, questions } = await read('questions.xml', fixture('moodle-xml/every-type.xml'))
    expect(reading.format).toBe('moodle-xml')
    expect(proposal).toBeTruthy()
    // Ten questions; the description is not one, and drag-and-drop is left out.
    expect(reading.found).toBe(10)
    expect(questions.map((question) => question.type)).toEqual([
      'multiple-choice', 'multiple-choice', 'true-false', 'short-answer', 'matching',
      'short-answer', 'short-answer', 'fill-in-the-blank', 'short-answer',
    ])

    const [cell, primes, sun, capital, matching, essay, pi, cloze, ordering] = questions
    // A <defaultgrade> of 1.0000000 is one point; a question with none is unpointed.
    expect(questions.map((question) => question.points)).toEqual([1, 1, 1, undefined, undefined, undefined, undefined, undefined, undefined])
    expect(text(cell!.stem)).toBe('Which organelle makes ATP?')
    expect(cell!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['Nucleus', false], ['Mitochondrion', true], ['Ribosome', false],
    ])
    expect(cell!.topics).toEqual(['Chapter 1', 'energy'])
    expect(reading.record.media).toHaveLength(1)
    expect(JSON.stringify(cell!.stem)).toContain(reading.record.media[0]!.id)

    // `<single>false` with two answers worth 50 each: Multiple Answer.
    expect(primes!.choices!.every((choice) => !choice.correct)).toBe(true)
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(a, b)')

    expect(sun!.choices!.map((choice) => choice.correct)).toEqual([false, true])
    expect(text(capital!.suggestedAnswer)).toBe('Paris / paris, France')
    expect(matching!.prompts!.map((prompt) => text(prompt.content))).toEqual(['Canada', 'Italy'])
    expect(matching!.wordBank!.map((answer) => text(answer.content))).toEqual(['Ottawa', 'Rome', 'Sydney'])
    expect(text(essay!.suggestedAnswer)).toBe('Light energy becomes chemical energy.')
    expect(essay!.topics).toEqual(['Chapter 2'])
    expect(text(pi!.suggestedAnswer)).toBe('3.14 (± 0.01)')
    expect(text(cloze!.stem)).toBe('The capital of France is _____, of Italy _____, and pi is _____.')
    // Each embedded answer is a Blank where it stood; the drop-down holds its
    // right choice, and the teacher is told.
    expect(blankAnswers(cloze!.stem.content)).toEqual(['Paris', 'Rome / Roma', '3.14 (± 0.01)'])
    expect(reading.issues.find((issue) => issue.code === 'dropdown-blank')?.message).toMatch(/^Question \d+ \(line \d+\): Test Parrot has no drop-down blanks/)
    expect(text(ordering!.suggestedAnswer).split(/\n+/)).toEqual(['Mercury', 'Venus', 'Earth'])

    const codes = reading.issues.map((issue) => [issue.severity, issue.code])
    expect(codes).toContainEqual(['info', 'description-skipped'])
    expect(codes).toContainEqual(['error', 'unsupported-type'])
    expect(reading.issues.find((issue) => issue.code === 'unsupported-type')!.message).toMatch(/^Question 9 \(line \d+\): /)
  })

  test('reads a Moodle 1.9 picture, and says when a picture is only a web address', async () => {
    const { reading, questions } = await read('old.xml', fixture('moodle-xml/legacy-image.xml'))
    expect(reading.format).toBe('moodle-xml')
    expect(questions).toHaveLength(2)
    expect(reading.record.media).toHaveLength(1)
    expect(JSON.stringify(questions[0]!.stem)).toContain(reading.record.media[0]!.id)
    expect(text(questions[1]!.stem)).toBe('Which shape is shown?')
    expect(reading.issues.map((issue) => issue.code)).toEqual(['picture-missing'])
  })

  test('with one right answer and none worth 100, the answer worth most is right', async () => {
    const { questions } = await read('q.xml', quiz(`
      <question type="multichoice">
        <questiontext format="plain_text"><text>Pick the best.</text></questiontext>
        <single>true</single>
        <answer fraction="50"><text>Good</text></answer>
        <answer fraction="90"><text>Best</text></answer>
        <answer fraction="0"><text>Bad</text></answer>
      </question>`))
    expect(questions[0]!.choices!.map((choice) => choice.correct)).toEqual([false, true, false])
  })

  test('a text without HTML markup keeps its angle brackets when it says it is plain text', async () => {
    const { questions } = await read('q.xml', quiz(`
      <question type="essay">
        <questiontext format="plain_text"><text>Is 3 &lt;b&gt; 2?</text></questiontext>
      </question>`))
    expect(text(questions[0]!.stem)).toBe('Is 3 <b> 2?')
  })

  test('a file that is not well formed is reported, not thrown', () => {
    const result = moodleXml.parse({ name: 'bad.xml', bytes: new Uint8Array(), text: () => '<quiz><question type="essay">', zip: async () => null })
    expect(result).toMatchObject({ questions: [], found: 0 })
    expect((result as { issues: { code: string }[] }).issues[0]!.code).toBe('unreadable-file')
  })

  test('a category’s topic is its last part that is not one of Moodle’s own', () => {
    expect(categoryTopic('$course$/top/Chapter 1')).toBe('Chapter 1')
    expect(categoryTopic('$cat1$/Top/Default for Biology/Cells')).toBe('Cells')
    expect(categoryTopic('$course$/top/Default for Biology')).toBeNull()
    expect(categoryTopic('$course$/Units//Measures')).toBe('Units/Measures')
  })

  test('is not detected in a file with no <quiz>', () => {
    const input = (source: string) => ({ name: 'x.xml', bytes: new Uint8Array(), text: () => source, zip: async () => null })
    expect(moodleXml.detect(input('<questestinterop><item/></questestinterop>'))).toBe(0)
    expect(moodleXml.detect(input('1. What is 2 + 2?\n*a) 4\nb) 5'))).toBe(0)
  })

  test('keeps a whole-number <defaultgrade> as Points, a Matching set’s for the set, and drops any other', async () => {
    const { questions } = await read('q.xml', quiz(`
      <question type="essay">
        <questiontext format="html"><text>Describe the water cycle.</text></questiontext>
        <defaultgrade>4.0000000</defaultgrade>
      </question>
      <question type="essay">
        <questiontext format="html"><text>Describe a cloud.</text></questiontext>
        <defaultgrade>0.5000000</defaultgrade>
      </question>
      <question type="essay">
        <questiontext format="html"><text>Describe rain.</text></questiontext>
        <defaultgrade>0</defaultgrade>
      </question>
      <question type="matching">
        <questiontext format="html"><text>Match each animal to its home.</text></questiontext>
        <defaultgrade>3</defaultgrade>
        <subquestion format="html"><text>Bee</text><answer><text>Hive</text></answer></subquestion>
        <subquestion format="html"><text>Fox</text><answer><text>Den</text></answer></subquestion>
      </question>`))
    expect(questions.map((question) => [question.type, question.points])).toEqual([
      ['short-answer', 4], ['short-answer', undefined], ['short-answer', undefined], ['matching', 3],
    ])
  })
})
