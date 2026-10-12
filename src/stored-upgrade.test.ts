import { describe, expect, test } from 'bun:test'
import { createMemoryBackend, loadExamStore, type AuthoringState } from './exam-store'
import { upgradeStoredQuestion } from './stored-upgrade'
import { questionOf } from './question-bank-workspaces'
import { pointsOfQuestion } from './points'
import type { Question } from './exam'
import type { ProseMirrorJSON } from './question-doc'

const child = (node: ProseMirrorJSON, index: number) =>
  (node.content as ProseMirrorJSON[])[index]!

const shortAnswer: Question = {
  id: 'q1',
  type: 'open',
  columns: 1,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep me' }] }] },
}

// A Multipart question as the build that still called the type Stimulus stored it.
const stimulus = {
  id: 's1',
  type: 'stimulus',
  columns: 2,
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Read the passage' }] },
      {
        type: 'stimulusParts',
        content: [{
          type: 'stimulusPart',
          attrs: { id: 'p1' },
          content: [
            { type: 'stimulusPartStem', content: [{ type: 'paragraph' }] },
            { type: 'suggestedAnswer', content: [{ type: 'paragraph' }] },
          ],
        }],
      },
    ],
  },
} as unknown as Question

describe('a question stored by an earlier build', () => {
  test('a Stimulus question reads as the Multipart question it now is', () => {
    const upgraded = upgradeStoredQuestion(stimulus)
    expect(upgraded.type).toBe('multipart')
    const parts = child(upgraded.doc, 1)
    const part = child(parts, 0)
    expect(parts.type).toBe('multipartParts')
    expect(part.type).toBe('multipartPart')
    expect(part.attrs).toEqual({ id: 'p1' })
    expect(child(part, 0).type).toBe('multipartPartStem')
    // Everything that was not renamed is kept exactly.
    expect(child(upgraded.doc, 0)).toEqual(child(stimulus.doc, 0))
    expect(child(part, 1)).toEqual({
      type: 'suggestedAnswer',
      content: [{ type: 'paragraph' }],
    })
  })

  test('a current question is returned untouched', () => {
    expect(upgradeStoredQuestion(shortAnswer)).toBe(shortAnswer)
  })
})

describe('a draft stored by an earlier build', () => {
  const draft = (workingCopy: Record<string, unknown>, questions: unknown[] = [shortAnswer]) =>
    ({
      dirty: true,
      questionBank: { questions },
      workingCopy: { title: 'My exam', questionIds: questions.map((q) => (q as Question).id), ...workingCopy },
    }) as unknown as AuthoringState

  test('keeps its questions when its page header is the withdrawn rich-text one', async () => {
    const backend = createMemoryBackend(draft({
      header: { differentFirstPage: false, first: [{ type: 'paragraph' }], later: [] },
      headingSize: 'large',
    }))
    const store = await loadExamStore(backend)
    const { workingCopy, questionBank } = store.getState()
    expect(workingCopy.title).toBe('My exam')
    expect(workingCopy.questionIds).toEqual(['q1'])
    expect(questionBank.questions).toEqual([shortAnswer])
    // Only the setting it cannot read is dropped; the default header prints.
    expect(workingCopy.header).toBeUndefined()
    expect(workingCopy.headingSize).toBe('large')
  })

  test('keeps a Stimulus question, as Multipart', async () => {
    const store = await loadExamStore(createMemoryBackend(draft({}, [stimulus])))
    expect(store.getState().questionBank.questions.map(({ type }) => type)).toEqual(['multipart'])
  })

  test('is still refused when it is not a draft at all', async () => {
    const store = await loadExamStore(
      createMemoryBackend({ dirty: true, questionBank: {}, workingCopy: 'nope' } as unknown as AuthoringState),
    )
    expect(store.getState().workingCopy.questionIds).toEqual([])
  })
})

describe('Points in a stored Question', () => {
  test('a question stored before Points existed reads as unpointed, needing no upgrade', () => {
    const read = questionOf({ ...shortAnswer, bankId: 'b' })
    expect('points' in read).toBe(false)
    expect(pointsOfQuestion(read)).toBeUndefined()
  })

  test('stored Points are read back, and anything that is not Points is dropped', () => {
    expect(questionOf({ ...shortAnswer, points: 3, bankId: 'b' }).points).toBe(3)
    expect('points' in questionOf({ ...shortAnswer, points: 0, bankId: 'b' })).toBe(false)
    expect('points' in questionOf({ ...shortAnswer, points: 1.5, bankId: 'b' })).toBe(false)
  })
})

// A build of this branch, before they were called Points, stored them as
// `marks`, on a question and on a Part's or Subpart's node.
describe('Points stored as `marks`', () => {
  const answer = { type: 'suggestedAnswer', content: [{ type: 'paragraph' }] }
  const stem = { type: 'multipartPartStem', content: [{ type: 'paragraph' }] }
  const multipart = {
    id: 'm1',
    type: 'multipart',
    columns: 2,
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        {
          type: 'multipartParts',
          content: [
            { type: 'multipartPart', attrs: { id: 'a', columns: 2, marks: 2 }, content: [stem, answer] },
            {
              type: 'multipartPart',
              attrs: { id: 'b', columns: 2 },
              content: [stem, {
                type: 'multipartSubparts',
                content: [{ type: 'multipartSubpart', attrs: { id: 'b-i', columns: 2, marks: 3 }, content: [stem, answer] }],
              }],
            },
          ],
        },
      ],
    },
  } as Question

  test('a question’s `marks` reads as its Points', () => {
    const stored = { ...shortAnswer, marks: 3 } as Question
    expect(questionOf({ ...stored, bankId: 'b' }).points).toBe(3)
    expect(upgradeStoredQuestion(stored)).toEqual({ ...shortAnswer, points: 3 })
  })

  test('a Part’s and a Subpart’s `marks` read as their Points', () => {
    const read = questionOf({ ...multipart, bankId: 'b' })
    expect(pointsOfQuestion(read)).toBe(5)
    expect(JSON.stringify(read.doc)).not.toContain('"marks"')
  })
})
