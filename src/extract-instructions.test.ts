import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { EXAM_FORMAT_VERSION } from './package-import'
import { QUESTION_BANK_FORMAT, QUESTION_BANK_FORMAT_VERSION } from './question-bank-export'
import { inspectQuestionBankRecordValue } from './question-bank-import'

// The instructions an assistant converts a test by (`public/extract.md`) show
// it what to write in JSON examples. An assistant copies an example's shape,
// so every example must be one Test Parrot would import.

const instructions = await Bun.file(join(import.meta.dir, '..', 'public', 'extract.md')).text()
const examples = [...instructions.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]!) as Record<string, unknown>)

type Json = Record<string, unknown>
const paragraph = (text: string): Json => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (content: unknown[]): Json => ({ type: 'document', content })

/** A record whose one Question is `question`, to inspect it as an import would. */
const recordOf = (question: Json) => ({
  format: QUESTION_BANK_FORMAT,
  formatVersion: QUESTION_BANK_FORMAT_VERSION,
  generator: { name: 'Instructions test', version: '1' },
  requiredFeatures: [],
  bank: { name: 'Examples', questions: [question] },
  media: [],
})

/** An example of any size as a whole Question: a Question as it is, a Part
 *  in a Multipart question, rich text in a Short Answer stem. */
function asQuestion(example: Json): Json | null {
  const id = typeof example.id === 'string' ? example.id : ''
  if (/^q\d+$/.test(id)) return example
  if (/^q\d+-s\d+$/.test(id)) {
    return { id: id.replace(/-s\d+$/, ''), type: 'multipart', stem: doc([paragraph('Material')]), parts: [example] }
  }
  if (/^q\d+-c\d+$/.test(id)) {
    const other = { id: id.replace(/-c\d+$/, '-c9'), content: doc([paragraph('Other')]), correct: false }
    return { id: id.replace(/-c\d+$/, ''), type: 'multiple-choice', stem: doc([paragraph('Which?')]), choices: [example, other] }
  }
  const stem = (content: unknown[]) => ({ id: 'q1', type: 'short-answer', stem: doc(content) })
  switch (example.type) {
    case 'document':
      return stem(example.content as unknown[])
    case 'text':
    case 'inline-math':
      return stem([{ type: 'paragraph', content: [example] }])
    case 'paragraph':
    case 'table':
    case 'side-by-side':
    case 'block-image':
      return stem([example])
    default:
      return null
  }
}

describe('the JSON examples in the conversion instructions', () => {
  test('name the current Question Bank Record version wherever they name one', () => {
    const versions = examples.flatMap((example) => {
      if (example.format === QUESTION_BANK_FORMAT) return [example.formatVersion]
      const banks = (example.questionBanks ?? []) as { record: Json }[]
      return banks.map((bank) => bank.record.formatVersion)
    })
    expect(versions.length).toBeGreaterThanOrEqual(2)
    expect(new Set(versions)).toEqual(new Set([QUESTION_BANK_FORMAT_VERSION]))
    expect(instructions).not.toMatch(/question-bank\/0\.[0-9]\.0\//)
    expect(instructions).not.toMatch(/Question Bank Record `0\.[0-9]\.0`/)
  })

  test('each import as Question Bank Record content', async () => {
    let checked = 0
    for (const example of examples) {
      if (typeof example.format === 'string') continue
      const question = asQuestion(example)
      if (!question) throw new Error(`An example the test cannot place: ${JSON.stringify(example).slice(0, 120)}`)
      await inspectQuestionBankRecordValue(recordOf(question)).catch((error: Error) => {
        throw new Error(`${error.message}\nin the example ${JSON.stringify(example).slice(0, 200)}`)
      })
      checked += 1
    }
    expect(checked).toBeGreaterThanOrEqual(10)
  })

  test('centre a figure, its caption and a table the source prints centred', () => {
    const centred = JSON.stringify(examples.filter((example) => JSON.stringify(example).includes('"align"')))
    expect(centred).toContain('"type":"block-image","pending":{"image":5},"alt":"A leaf seen through a hand lens","align":"center"')
    expect(centred).toContain('"type":"paragraph","align":"center","content":[{"type":"text","text":"Fig. 1.1"')
    expect(centred).toContain('"type":"table","align":"center"')
    // Nothing teaches an alignment Test Parrot does not have.
    expect(JSON.stringify(examples)).not.toMatch(/"align":"(?!center")/)
  })

  test('name the current Exam Record version wherever they name one', () => {
    const versions = examples.flatMap((example) => ((example.exams ?? []) as Json[]).map((exam) => exam.formatVersion))
    expect(versions.length).toBeGreaterThanOrEqual(1)
    expect(new Set(versions)).toEqual(new Set([EXAM_FORMAT_VERSION]))
  })

  test('ask for the Exam Board style on an exam-board paper, so its Points print', async () => {
    expect(instructions).toContain('Record `"paperStyle": "exam-board"` when the source is an exam-board paper')
    const example = './formats/package/0.1.0/examples/exam-board-paper.json'
    expect(instructions).toContain(example)
    const paper = await Bun.file(join(import.meta.dir, '..', 'public', example)).json() as { exams: Json[] }
    expect(paper.exams[0]!.paperStyle).toBe('exam-board')
  })

  test('show Points on what a student answers and a Part holding Subparts', () => {
    const written = JSON.stringify(examples)
    expect(written).toContain('"points":')
    expect(written).toContain('"subparts":')
  })
})
