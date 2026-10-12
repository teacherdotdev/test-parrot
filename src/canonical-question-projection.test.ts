import { expect, test } from 'bun:test'
import { withCanonicalQuestionProjection } from './canonical-question-projection'
import { createExamStore, createMemoryBackend, type AuthoringState, type SavedState } from './exam-store'
import type { Question } from './exam'

function multipleChoice(id: string, choiceIds: string[]): Question {
  return {
    id,
    type: 'multiple-choice',
    columns: 2,
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Original wording' }] },
        {
          type: 'multipleChoice',
          content: choiceIds.map((choiceId) => ({
            type: 'multipleChoiceChoice',
            attrs: { id: choiceId, correct: choiceId === choiceIds[0] },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: choiceId }] }],
          })),
        },
      ],
    },
  }
}

function states(question: Question) {
  const workingCopy = {
    title: 'Biology',
    questionIds: [question.id, 'unrelated'],
    columns: { [question.id]: 4 as const },
    choiceOrder: { [question.id]: ['c', 'a', 'b'], unrelated: ['u2', 'u1'] },
  }
  const working: AuthoringState = {
    questionBank: { questions: [question] },
    workingCopy,
    dirty: true,
  }
  const saved: SavedState = {
    questionBank: { questions: [question] },
    workingCopy: structuredClone(workingCopy),
  }
  return { working, saved }
}

test('canonical wording and correctness changes preserve Exam presentation and savedness', () => {
  const original = multipleChoice('question', ['a', 'b', 'c'])
  const { working, saved } = states(original)
  const edited = multipleChoice('question', ['a', 'b', 'c'])
  ;(edited.doc.content as Array<Record<string, unknown>>)[0] = {
    type: 'paragraph', content: [{ type: 'text', text: 'Edited wording' }],
  }

  const projected = withCanonicalQuestionProjection(working, saved, edited)

  expect(projected.working.questionBank.questions[0]).toEqual(edited)
  expect(projected.working.workingCopy.choiceOrder?.question).toEqual(['c', 'a', 'b'])
  expect(projected.working.workingCopy.columns?.question).toBe(4)
  expect(projected.working.dirty).toBe(true)
  expect(projected.saved?.workingCopy.choiceOrder?.question).toEqual(['c', 'a', 'b'])
})

test('an unrelated Exam Undo cannot restore stale canonical Question Content', () => {
  const original = multipleChoice('question', ['a', 'b', 'c'])
  const { working, saved } = states(original)
  working.dirty = false
  const store = createExamStore({ backend: createMemoryBackend(working), initial: working, saved })
  store.setTitle('Unrelated title edit')
  const edited = multipleChoice('question', ['a', 'b', 'c'])
  ;(edited.doc.content as Array<Record<string, unknown>>)[0] = {
    type: 'paragraph', content: [{ type: 'text', text: 'Canonical edit' }],
  }

  store.syncCanonicalQuestions([edited])
  store.undo()

  expect(store.getState().workingCopy.title).toBe('Biology')
  expect(store.getState().questionBank.questions[0]).toEqual(edited)
})

test('a changed stable choice-ID set clears only that Question arrangement everywhere', () => {
  const original = multipleChoice('question', ['a', 'b', 'c'])
  const { working, saved } = states(original)
  const edited = multipleChoice('question', ['a', 'b', 'new-choice'])

  const projected = withCanonicalQuestionProjection(working, saved, edited)

  expect(projected.working.workingCopy.choiceOrder?.question).toBeUndefined()
  expect(projected.saved?.workingCopy.choiceOrder?.question).toBeUndefined()
  expect(projected.working.workingCopy.choiceOrder?.unrelated).toEqual(['u2', 'u1'])
  expect(projected.working.workingCopy.columns?.question).toBe(4)
  expect(projected.working.dirty).toBe(true)
})
