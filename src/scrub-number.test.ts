import { describe, expect, test } from 'bun:test'
import {
  SCRUB_THRESHOLD_PX,
  scrubRaw,
  scrubValue,
  startsScrub,
  steppedValue,
  type ScrubRange,
} from './scrub-number'

// The Margins panel's range: half an inch to an inch and a half, in steps of
// a twentieth, a tenth with Shift.
const MARGINS: ScrubRange = { min: 0.5, max: 1.5, step: 0.05, coarseStep: 0.1 }

/** A drag from `start` by each move in turn, Shift held or not on each. */
function drag(start: number, moves: readonly (readonly [number, boolean])[]): number {
  let raw = start
  let shown = start
  for (const [dx, shift] of moves) {
    raw = scrubRaw(raw, dx, shift, MARGINS)
    shown = scrubValue(raw, shift, MARGINS)
  }
  return shown
}

describe('scrubbing a number field', () => {
  test('a press is a drag only once it travels a few pixels sideways', () => {
    expect(startsScrub(0)).toBe(false)
    expect(startsScrub(SCRUB_THRESHOLD_PX - 1)).toBe(false)
    expect(startsScrub(SCRUB_THRESHOLD_PX)).toBe(true)
    expect(startsScrub(-SCRUB_THRESHOLD_PX)).toBe(true)
  })

  test('moves a hundredth of an inch a pixel, shown on the field’s step', () => {
    expect(drag(0.75, [[10, false]])).toBe(0.85)
    expect(drag(0.75, [[-10, false]])).toBe(0.65)
    // Two pixels is a fiftieth: still nearer the step it started on.
    expect(drag(0.75, [[2, false]])).toBe(0.75)
    expect(drag(0.75, [[3, false]])).toBe(0.8)
  })

  test('moves ten times as far with Shift, on tenths', () => {
    expect(drag(0.75, [[3, true]])).toBe(1.1)
    expect(drag(0.5, [[1, true]])).toBe(0.6)
  })

  test('changes rate where Shift is pressed, without jumping', () => {
    // 0.75 + 0.10 fine, then + 0.20 coarse.
    expect(drag(0.75, [[10, false], [2, true]])).toBe(1.1)
    // Releasing Shift goes back to hundredths from where the value stands.
    expect(drag(0.5, [[2, true], [5, false]])).toBe(0.75)
  })

  test('stays between the least and the most, and turns back at once', () => {
    expect(drag(0.75, [[500, false]])).toBe(1.5)
    expect(drag(0.75, [[-500, true]])).toBe(0.5)
    // Far past the end and back: the way back starts at the end, not past it.
    expect(drag(1.4, [[300, false], [-10, false]])).toBe(1.4)
  })

  test('arrow keys step by the step, or the coarse step with Shift, in range', () => {
    expect(steppedValue(0.75, 1, false, MARGINS)).toBe(0.8)
    expect(steppedValue(0.75, -1, true, MARGINS)).toBe(0.65)
    expect(steppedValue(1.5, 1, false, MARGINS)).toBe(1.5)
    expect(steppedValue(0.5, -1, true, MARGINS)).toBe(0.5)
  })
})
