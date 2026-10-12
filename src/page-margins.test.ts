import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_MARGIN,
  DEFAULT_MARGINS,
  MAX_MARGIN,
  MIN_MARGIN,
  clampMargin,
  isPageMargins,
  marginPx,
  marginsOf,
  sameMargins,
  uniformMarginOf,
  withMargin,
} from './page-margins'

describe('Page Margins', () => {
  test('an Exam that never set its margins prints today’s three quarters of an inch', () => {
    expect(DEFAULT_MARGIN).toBe(0.75)
    expect(marginsOf(undefined)).toEqual(DEFAULT_MARGINS)
    expect(marginPx(DEFAULT_MARGIN)).toBe(72)
  })

  test('one value sets all four sides, and the default is stored as nothing', () => {
    const all = withMargin(undefined, ['top', 'right', 'bottom', 'left'], 1)
    expect(all).toEqual({ top: 1, right: 1, bottom: 1, left: 1 })
    expect(uniformMarginOf(all)).toBe(1)
    expect(withMargin(all, ['top', 'right', 'bottom', 'left'], DEFAULT_MARGIN)).toBeUndefined()
  })

  test('one side set on its own makes the combined value mixed', () => {
    const margins = withMargin(undefined, ['left'], 1.25)
    expect(margins).toEqual({ top: 0.75, right: 0.75, bottom: 0.75, left: 1.25 })
    expect(uniformMarginOf(margins)).toBeNull()
    expect(uniformMarginOf(undefined)).toBe(DEFAULT_MARGIN)
  })

  test('a typed value is kept in range and on the margins’ step', () => {
    expect(clampMargin(0.1)).toBe(MIN_MARGIN)
    expect(clampMargin(9)).toBe(MAX_MARGIN)
    expect(clampMargin(0.83)).toBe(0.85)
    expect(clampMargin(Number.NaN)).toBe(DEFAULT_MARGIN)
    expect(marginPx(0.85)).toBe(81.6)
  })

  test('reads only whole, in-range margins', () => {
    expect(isPageMargins({ top: 1, right: 1, bottom: 1, left: 0.5 })).toBe(true)
    expect(isPageMargins({ top: 1, right: 1, bottom: 1 })).toBe(false)
    expect(isPageMargins({ top: 1, right: 1, bottom: 1, left: 0.25 })).toBe(false)
    expect(isPageMargins({ top: 1, right: 1, bottom: 1, left: '1' })).toBe(false)
    expect(isPageMargins({ top: 1, right: 1, bottom: 1, left: 1, gutter: 1 })).toBe(false)
    expect(isPageMargins([])).toBe(false)
  })

  test('absent and the default agree', () => {
    expect(sameMargins(undefined, { ...DEFAULT_MARGINS })).toBe(true)
    expect(sameMargins(undefined, withMargin(undefined, ['top'], 1))).toBe(false)
  })
})
