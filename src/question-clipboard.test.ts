// Cmd/Ctrl-C and Cmd/Ctrl-V for Questions: what a copy carries, what a paste
// reads back, and what a paste into a bank or onto an Exam brings in.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createQuestion, duplicateQuestion, type Question } from './exam'
import { createQuestionBankWorkspaceService } from './question-bank-workspaces'
import {
  pastedSummary,
  questionIdsInClipboard,
  questionsToAdd,
  withQuestionMarker,
} from './question-clipboard'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

describe('what a copy carries', () => {
  test('the content another document reads, with the Questions named beside it', () => {
    const html = withQuestionMarker('<div><p>Which gas do plants take in?</p></div>', ['q1', 'q2'])
    expect(html).toEndWith('<div><p>Which gas do plants take in?</p></div>')
    expect(questionIdsInClipboard(html)).toEqual(['q1', 'q2'])
  })

  test('survives a clipboard that rewrites the HTML around it', () => {
    const html = withQuestionMarker('<p>x</p>', ['a"b', 'c'])
    const rewrapped = `<html><body><!--StartFragment-->${html}<!--EndFragment--></body></html>`
    expect(questionIdsInClipboard(rewrapped)).toEqual(['a"b', 'c'])
  })

  test('anything else pasted is not a copy of Questions', () => {
    expect(questionIdsInClipboard('<p>Some text from a web page</p>')).toBeNull()
    expect(questionIdsInClipboard('<span data-test-parrot-questions="not json"></span>')).toBeNull()
    expect(questionIdsInClipboard(withQuestionMarker('', []))).toBeNull()
  })
})

describe('a paste onto an Exam', () => {
  test('adds only the Questions it does not already hold, in copied order', () => {
    const located = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(questionsToAdd(located, new Set(['b']))).toEqual([{ id: 'a' }, { id: 'c' }])
  })

  test('says what it did', () => {
    expect(pastedSummary(2, 0, 2)).toBe('Pasted 2 questions.')
    expect(pastedSummary(1, 1, 2)).toBe('Pasted 1 question; 1 already on this exam.')
    expect(pastedSummary(1, 0, 3)).toBe('Pasted 1 question; 2 no longer in this browser.')
    expect(pastedSummary(0, 2, 2)).toBe('Those questions are already on this exam.')
    expect(pastedSummary(0, 0, 0)).toBe('Nothing to paste: the copied questions aren’t in this browser.')
  })
})

describe('a paste into a Question Bank', () => {
  async function bankWith(service: ReturnType<typeof createQuestionBankWorkspaceService>, questions: Question[]) {
    const bank = await service.create()
    for (const question of questions) await service.commit(bank.id, { kind: 'create-question', question })
    return bank.id
  }

  test('finds copied Questions wherever they live, skipping ones gone', async () => {
    const service = createQuestionBankWorkspaceService()
    const first = createQuestion('open')
    const second = createQuestion('multiple-choice')
    const one = await bankWith(service, [first])
    const two = await bankWith(service, [second])
    const located = await service.locateQuestions([second.id, 'gone', first.id])
    expect(located.map(({ bankId, question }) => [bankId, question.id])).toEqual([[two, second.id], [one, first.id]])
  })

  test('adds new Questions like them at the end, leaving the originals where they were', async () => {
    const service = createQuestionBankWorkspaceService()
    const original = createQuestion('multiple-choice')
    const source = await bankWith(service, [original])
    const target = await bankWith(service, [createQuestion('open')])
    const copies = (await service.locateQuestions([original.id])).map(({ question }) => duplicateQuestion(question))
    const updated = await service.commit(target, { kind: 'create-questions', questions: copies })
    expect(updated.questions).toHaveLength(2)
    expect(updated.questions[1]!.id).toBe(copies[0]!.id)
    expect(updated.questions[1]!.id).not.toBe(original.id)
    expect(updated.questions[1]!.type).toBe('multiple-choice')
    expect((await service.read(source))!.questions.map(({ id }) => id)).toEqual([original.id])
  })

  test('into the bank they came from, as Duplicate does', async () => {
    const service = createQuestionBankWorkspaceService()
    const original = createQuestion('true-false')
    const bank = await bankWith(service, [original])
    const copies = [duplicateQuestion(original)]
    const updated = await service.commit(bank, { kind: 'create-questions', questions: copies })
    expect(updated.questions.map(({ id }) => id)).toEqual([original.id, copies[0]!.id])
  })
})
