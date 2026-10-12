import { expect, test } from 'bun:test'
import { createQuestion } from './exam'
import {
  DEFAULT_BANK_TABS_WORKSPACE,
  UNTITLED_QUESTION_BANK,
  closeBankTab,
  createQuestionBankResourceStore,
  isPristineQuestionBank,
  openBankTab,
  updateBankTabFilter,
  type QuestionBankResource,
} from './question-bank-workspaces'

function bank(): QuestionBankResource {
  return {
    id: 'bank-1',
    name: UNTITLED_QUESTION_BANK,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUpdatedAt: '2026-01-01T00:00:00.000Z',
    questions: [],
  }
}

test('only a pristine empty Untitled Question Bank is disposable', () => {
  const empty = bank()
  expect(isPristineQuestionBank(empty)).toBe(true)
  expect(isPristineQuestionBank({ ...empty, name: 'Biology' })).toBe(false)
  expect(isPristineQuestionBank({ ...empty, questions: [createQuestion('open')] })).toBe(false)
  expect(isPristineQuestionBank(null)).toBe(false)
})

test('a bank change becomes visible only after its durable commit', async () => {
  const initial = bank()
  let finish!: (value: QuestionBankResource) => void
  const committed = new Promise<QuestionBankResource>((resolve) => { finish = resolve })
  const store = createQuestionBankResourceStore(initial, () => committed)

  const renaming = store.rename('Biology')
  expect(store.getState()).toBe(initial)

  const durable = { ...initial, name: 'Biology', lastUpdatedAt: '2026-01-02T00:00:00.000Z' }
  finish(durable)
  await renaming
  expect(store.getState()).toBe(durable)
})

test('a failed Question save leaves canonical visible state unchanged for retry', async () => {
  const initial = bank()
  const store = createQuestionBankResourceStore(initial, async () => {
    throw new Error('Storage unavailable')
  })

  await expect(store.createQuestion(createQuestion('multiple-choice'))).rejects.toThrow('Storage unavailable')
  expect(store.getState()).toBe(initial)
  expect(store.getState().questions).toHaveLength(0)
})

test('an existing Question Type cannot be changed', async () => {
  const original = createQuestion('multiple-choice')
  const initial = { ...bank(), questions: [original] }
  const store = createQuestionBankResourceStore(initial, async (change) => {
    if (change.kind === 'update-question' && change.question.type !== original.type) {
      throw new Error('A Question Type cannot be changed after creation.')
    }
    return initial
  })

  await expect(store.updateQuestion({ ...original, type: 'open' })).rejects.toThrow(
    'A Question Type cannot be changed after creation.',
  )
  expect(store.getState()).toBe(initial)
})

test('provenance changes are durable substantive bank updates', async () => {
  const initial = bank()
  let committedChange: Parameters<Parameters<typeof createQuestionBankResourceStore>[1]>[0] | undefined
  const store = createQuestionBankResourceStore(initial, async (change) => {
    committedChange = change
    return {
      ...initial,
      description: 'Course review',
      author: 'Ada Teacher',
      license: { name: 'CC BY', url: 'https://example.test/license' },
      lastUpdatedAt: '2026-01-02T00:00:00.000Z',
    }
  })

  await store.updateProvenance({
    description: 'Course review',
    author: 'Ada Teacher',
    license: { name: 'CC BY', url: 'https://example.test/license' },
  })
  expect(committedChange).toEqual({
    kind: 'update-provenance',
    provenance: {
      description: 'Course review',
      author: 'Ada Teacher',
      license: { name: 'CC BY', url: 'https://example.test/license' },
    },
  })
  expect(store.getState().description).toBe('Course review')
})

test('bank tabs retain independent filters and choose an adjacent tab when closed', () => {
  const first = openBankTab(DEFAULT_BANK_TABS_WORKSPACE, 'bank-a')
  const second = openBankTab(first, 'bank-b')
  const filtered = updateBankTabFilter(second, 'bank-a', {
    search: 'mitosis',
    types: [],
    difficulties: ['hard'],
    topics: ['Biology'],
    sort: 'difficulty',
  })

  expect(filtered.openBankIds).toEqual(['bank-a', 'bank-b'])
  expect(filtered.activeBankId).toBe('bank-b')
  expect(filtered.filters['bank-a']).toEqual({
    search: 'mitosis',
    types: [],
    difficulties: ['hard'],
    topics: ['Biology'],
    sort: 'difficulty',
  })
  expect(filtered.filters['bank-b']).toEqual({
    search: '', types: [], difficulties: [], topics: [], sort: 'newest',
  })

  const focused = openBankTab(filtered, 'bank-a')
  expect(focused.openBankIds).toEqual(['bank-a', 'bank-b'])
  expect(focused.activeBankId).toBe('bank-a')

  const closed = closeBankTab(focused, 'bank-a')
  expect(closed.openBankIds).toEqual(['bank-b'])
  expect(closed.activeBankId).toBe('bank-b')
  expect(closed.filters['bank-a']).toBeUndefined()
})
