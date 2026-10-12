import { expect, test } from 'bun:test'
import { createAuthoringState } from './exam-store'
import { isPristineExam, resourceUsageOf } from './exam-workspaces'

test('bank usage merges saved and Working Copy references into one Exam row', () => {
  const working = createAuthoringState()
  working.workingCopy.title = 'Biology midterm'
  working.workingCopy.questionIds = ['working-question']
  const saved = {
    questionBank: working.questionBank,
    workingCopy: { ...working.workingCopy, questionIds: ['saved-question'] },
  }

  expect(resourceUsageOf(
    { id: 'exam-1', createdAt: '', lastOpenedAt: '' },
    working,
    saved,
    new Set(['working-question', 'saved-question']),
  )).toEqual({
    examId: 'exam-1',
    title: 'Biology midterm',
    saved: true,
    workingCopy: true,
  })
  expect(resourceUsageOf(
    { id: 'exam-1', createdAt: '', lastOpenedAt: '' },
    working,
    saved,
    new Set(['unrelated']),
  )).toBeNull()
})

test('only an untouched Untitled Exam without Export Records is disposable', () => {
  const empty = createAuthoringState()
  empty.workingCopy.title = 'Untitled Exam'
  const saved = { questionBank: empty.questionBank, workingCopy: empty.workingCopy }
  expect(isPristineExam(empty, saved, { records: [] })).toBe(true)

  expect(isPristineExam({ ...empty, workingCopy: { ...empty.workingCopy, title: 'Named Exam' } }, saved, { records: [] })).toBe(false)
  expect(isPristineExam({ ...empty, questionBank: { questions: [{} as never] } }, saved, { records: [] })).toBe(true)
  expect(isPristineExam(empty, saved, { records: [{}] })).toBe(false)
  expect(isPristineExam(null, saved, { records: [] })).toBe(false)
  expect(isPristineExam(empty, null, { records: [] })).toBe(false)
  expect(isPristineExam({ ...empty, dirty: true }, saved, { records: [] })).toBe(false)
})
