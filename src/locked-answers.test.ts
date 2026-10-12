import { describe, expect, test } from 'bun:test'
import { isLocked, readsAsLocked } from './locked-answers'

describe('an answer locked by its wording', () => {
  test.each([
    'All of the above',
    'all of the above.',
    'ALL OF THE ABOVE',
    '  All  of the   above!  ',
    'None of the above',
    'All the above',
    'All of these',
    'None of these',
    'None of the answers',
    'All of the above answers',
    'Both of the above',
    'Neither of the above',
    'Neither of them',
    'All of the choices listed',
    'All of the above are correct',
    'Both A and B',
    'Both (A) and (C)',
    'A and B only',
    'Only A and B',
    'A, B, and C',
    'A, B and C',
    'A & B',
    'Neither A nor B',
    'Answers B or D',
    'Both a and c are correct.',
    '“None of the above”',
  ])('“%s” is locked', (text) => {
    expect(readsAsLocked(text)).toBe(true)
  })

  test.each([
    'All',
    'None',
    'Both',
    'Paris',
    'All mammals have hair',
    'None of the planets has rings',
    'Above the clouds',
    'I and II only',
    'I, II and III',
    'x and y',
    'A',
    'A only',
    'Plan A and Plan B',
    '',
  ])('“%s” moves', (text) => {
    expect(readsAsLocked(text)).toBe(false)
  })

  test("the teacher's decision outranks the wording either way", () => {
    expect(isLocked(false, 'All of the above')).toBe(false)
    expect(isLocked(true, 'Paris')).toBe(true)
    expect(isLocked(null, 'All of the above')).toBe(true)
    expect(isLocked(undefined, 'Paris')).toBe(false)
  })
})
