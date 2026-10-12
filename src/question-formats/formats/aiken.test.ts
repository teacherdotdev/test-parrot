import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inspectImportValue } from '../../package-import'
import { candidatesFor, readQuestionFile } from '..'
import { blocksText } from '../rich-text'
import { aiken } from './aiken'
import { gift } from './gift'

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${path}`, import.meta.url)))
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record, undefined, reading.files)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

const input = (bytes: Uint8Array) => ({ name: 'x.txt', bytes, text: () => decode(bytes), zip: async () => null })

describe('Aiken', () => {
  test('reads MoodleDocs’ Aiken example', async () => {
    const { reading, proposal, questions } = await read('aiken.txt', fixture('aiken/moodledocs-example.txt'))
    expect(reading.format).toBe('aiken')
    expect(proposal).toBeTruthy()
    expect(reading.issues).toEqual([])
    expect(questions.map((question) => text(question.stem))).toEqual([
      'What is the correct answer to this question?',
      'Which LMS has the most quiz import formats?',
    ])
    expect(questions[0]!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['Is it this one?', false], ['Maybe this answer?', false], ['Possibly this one?', false], ['Must be this one!', true],
    ])
    expect(questions[1]!.choices!.map((choice) => choice.correct)).toEqual([true, false, false, false, false, false])
  })

  test('forgives a wrapped stem, a missing blank line and a loosely written ANSWER, and leaves out what it cannot read', async () => {
    const { reading, questions } = await read('aiken.txt', fixture('aiken/lenient.txt'))
    expect(reading.format).toBe('aiken')
    expect(reading.found).toBe(4)
    expect(questions.map((question) => text(question.stem))).toEqual(['Which planet is known as\nthe red planet?', 'What is 2 + 2?'])
    expect(questions[0]!.choices!.map((choice) => choice.correct)).toEqual([false, true, false])
    expect(reading.issues.map((issue) => [issue.severity, issue.code, issue.line])).toEqual([
      ['warning', 'answer-line', 1],
      ['warning', 'answer-line', 7],
      ['error', 'unreadable-question', 12],
      ['error', 'unreadable-question', 16],
    ])
    expect(reading.issues[3]!.message).toBe('Question 4 (line 16): its ANSWER is E, but it has no answer E.')
  })

  test('is unlikely for a Blackboard Test Generator file', () => {
    expect(aiken.detect(input(fixture('bb-generator/tagged-sample.txt')))).toBe(0)
    expect(aiken.detect(input(fixture('bb-generator/oc-sample-quiz.txt')))).toBe(0)
  })
})

describe('the Blackboard Test Generator’s samples, once Aiken, GIFT and Moodle XML are known', () => {
  test.each(['tagged-sample.txt', 'oc-sample-quiz.txt'])('%s is still read as the generator’s', async (name) => {
    const { reading } = await read(name, fixture(`bb-generator/${name}`))
    expect(reading.format).toBe('bb-generator')
    const candidates = await candidatesFor(input(fixture(`bb-generator/${name}`)))
    expect(candidates[0]!.id).toBe('bb-generator')
    expect(gift.detect(input(fixture(`bb-generator/${name}`)))).toBeLessThan(0.3)
  })
})
