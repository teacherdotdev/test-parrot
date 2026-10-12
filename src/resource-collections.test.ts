import { expect, test } from 'bun:test'
import {
  filterExamCollection,
  filterQuestionBankCollection,
  homePreview,
  questionBankCollection,
} from './resource-collections'
import type { RecentExam } from './exam-workspaces'
import type { QuestionBankCollectionItem } from './resource-collections'

const exam = (id: string, title: string): RecentExam => ({
  id,
  title,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
  questionCount: 0,
  preview: null,
  unsaved: false,
})

const bank = (
  id: string,
  name: string,
  topics: string[],
  questionContent = 'content that must not be searchable',
): QuestionBankCollectionItem => ({
  id,
  name,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUpdatedAt: '2026-01-01T00:00:00.000Z',
  questionCount: 1,
  topics,
  usage: [],
  // Compile-time guard: collection items deliberately carry no Question Content.
  ...({ questionContent } as object),
})

test('Exam collection search matches names case-insensitively', () => {
  const exams = [exam('1', 'Cell Biology'), exam('2', 'Organic Chemistry')]
  expect(filterExamCollection(exams, ' biology ')).toEqual([exams[0]])
  expect(filterExamCollection(exams, '')).toEqual(exams)
})

test('Question Bank collection search matches names and Topics, not Question Content', () => {
  const banks = [
    bank('1', 'Biology', ['Cell division'], 'hidden mitochondria stem'),
    bank('2', 'Chemistry', ['Atomic structure'], 'hidden biology stem'),
  ]
  expect(filterQuestionBankCollection(banks, 'atomic')).toEqual([banks[1]])
  expect(filterQuestionBankCollection(banks, 'biology')).toEqual([banks[0]])
  expect(filterQuestionBankCollection(banks, 'mitochondria')).toEqual([])
})

test('bank collection summaries include current Exam usage', async () => {
  const summaries = [bank('1', 'Biology', ['Cells'])]
  const collection = await questionBankCollection(
    summaries,
    { read: async () => ({ questions: [{ id: 'question-1' }] }) } as never,
    {
      resourceUsage: async (ids: string[]) => [
        { examId: ids[0], title: 'Midterm', saved: true, workingCopy: false },
      ],
    } as never,
  )
  expect(collection[0]?.usage).toEqual([
    { examId: 'question-1', title: 'Midterm', saved: true, workingCopy: false },
  ])
})

test('Home previews only the leading resources while full collections retain all', () => {
  const resources = Array.from({ length: 9 }, (_, index) =>
    exam(String(index), `Exam ${index}`),
  )
  expect(homePreview(resources)).toEqual(resources.slice(0, 6))
  expect(resources).toHaveLength(9)
})
