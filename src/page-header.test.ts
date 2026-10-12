import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_HEADER,
  headerLineOf,
  isExamHeader,
  sameExamHeader,
  withHeaderLine,
} from './page-header'

describe('page header lines', () => {
  test('an untouched Exam prints the default blanks', () => {
    expect(headerLineOf(undefined, 'first')).toBe(DEFAULT_HEADER.first)
    expect(headerLineOf(undefined, 'later')).toBe(DEFAULT_HEADER.later)
  })

  test('stores only departures from the default', () => {
    const header = withHeaderLine(undefined, 'first', 'Student: ____  Period: ____')
    expect(header).toEqual({ first: 'Student: ____  Period: ____' })
    expect(headerLineOf(header, 'later')).toBe(DEFAULT_HEADER.later)
    expect(withHeaderLine(header, 'first', DEFAULT_HEADER.first)).toBeUndefined()
    expect(withHeaderLine(header, 'first', null)).toBeUndefined()
  })

  test('a cleared line is kept, and prints nothing', () => {
    const header = withHeaderLine(undefined, 'later', '')
    expect(header).toEqual({ later: '' })
    expect(headerLineOf(header, 'later')).toBe('')
  })

  test('reads only lines this build can print', () => {
    expect(isExamHeader({ first: 'Name', later: '' })).toBe(true)
    expect(isExamHeader({ middle: 'Name' })).toBe(false)
    expect(isExamHeader({ first: 3 })).toBe(false)
    expect(isExamHeader([])).toBe(false)
  })

  test('absent and empty agree', () => {
    expect(sameExamHeader(undefined, {})).toBe(true)
    expect(sameExamHeader({ first: 'A' }, { first: 'A' })).toBe(true)
    expect(sameExamHeader({ first: 'A' }, { first: 'B' })).toBe(false)
  })
})
