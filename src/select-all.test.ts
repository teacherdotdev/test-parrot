import { describe, expect, test } from 'bun:test'
import { distinctIds, isSelectAllKey, selectAllPane, type SelectAllKey } from './select-all'

const press = (key: string, held: Partial<Omit<SelectAllKey, 'key'>> = {}): SelectAllKey => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...held,
})

describe('isSelectAllKey', () => {
  test('Cmd-A and Ctrl-A, whatever the case of the letter', () => {
    expect(isSelectAllKey(press('a', { metaKey: true }))).toBe(true)
    expect(isSelectAllKey(press('a', { ctrlKey: true }))).toBe(true)
    expect(isSelectAllKey(press('A', { metaKey: true }))).toBe(true)
  })

  test('not a bare A, nor with Shift or Option held, nor another letter', () => {
    expect(isSelectAllKey(press('a'))).toBe(false)
    expect(isSelectAllKey(press('a', { metaKey: true, shiftKey: true }))).toBe(false)
    expect(isSelectAllKey(press('a', { ctrlKey: true, altKey: true }))).toBe(false)
    expect(isSelectAllKey(press('s', { metaKey: true }))).toBe(false)
  })
})

describe('selectAllPane', () => {
  const both = ['question-bank', 'exam-draft'] as const

  test('the pane last touched, while it is still there', () => {
    expect(selectAllPane(both, 'question-bank')).toBe('question-bank')
    expect(selectAllPane(both, 'exam-draft')).toBe('exam-draft')
  })

  test('the Exam draft until a pane has been touched', () => {
    expect(selectAllPane(both, null)).toBe('exam-draft')
  })

  test('the Exam draft once the touched bank has gone', () => {
    expect(selectAllPane(['exam-draft'], 'question-bank')).toBe('exam-draft')
  })

  test('the bank when it is all there is, as on the Question Bank page', () => {
    expect(selectAllPane(['question-bank'], null)).toBe('question-bank')
  })

  test('nothing when no pane is mounted', () => {
    expect(selectAllPane([], 'exam-draft')).toBeNull()
  })
})

test('distinctIds keeps the first showing of a Question listed on the test and the answer key', () => {
  expect(distinctIds(['q1', 'q2', 'q1', 'q3', 'q2'])).toEqual(['q1', 'q2', 'q3'])
})
