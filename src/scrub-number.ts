// The arithmetic of a scrubbable number field, the kind a design tool puts in
// its inspector: press on the field's label, or on the field before it has
// focus, and drag sideways to change the value; a press that never moves far
// enough to be a drag is a click, and focuses the field for typing.
//
// Pure, so the gesture in `margins-panel.tsx` holds only pointer bookkeeping.
// A drag accumulates a raw value pixel by pixel, at the fine rate or, while
// Shift is held, ten times it, so pressing or releasing Shift mid-drag changes
// the rate from there on rather than jumping. What the field shows and sets is
// that raw value snapped to the field's step — or to the coarse step while
// Shift is held — and kept in range.

/** How far a value moves per pixel of drag, and per pixel while Shift is held. */
export const SCRUB_PER_PX = 0.01
export const SCRUB_SHIFT_PER_PX = 0.1

/** How far the pointer must travel sideways before a press is a drag rather
 *  than a click. A hand pressing to click wobbles a pixel or two. */
export const SCRUB_THRESHOLD_PX = 3

export type ScrubRange = {
  min: number
  max: number
  /** The step a value snaps to. */
  step: number
  /** The step a value snaps to while Shift is held. */
  coarseStep: number
}

/** Whether a press has travelled far enough sideways to be a drag. */
export function startsScrub(dx: number): boolean {
  return Math.abs(dx) >= SCRUB_THRESHOLD_PX
}

/** The raw value after the pointer moves `dx` pixels from where it last was,
 *  kept in range so that turning back moves the value at once. */
export function scrubRaw(raw: number, dx: number, shift: boolean, range: ScrubRange): number {
  const next = raw + dx * (shift ? SCRUB_SHIFT_PER_PX : SCRUB_PER_PX)
  return Math.min(range.max, Math.max(range.min, next))
}

/** What the field shows and sets for a raw value: snapped to its step, or to
 *  the coarse step while Shift is held, in range, with no float's tail. */
export function scrubValue(raw: number, shift: boolean, range: ScrubRange): number {
  const step = shift ? range.coarseStep : range.step
  const snapped = Math.round(raw / step) * step
  const kept = Math.min(range.max, Math.max(range.min, snapped))
  return Math.round(kept * 1000) / 1000
}

/** The value an arrow key steps to: one step, or one coarse step with Shift. */
export function steppedValue(
  value: number,
  direction: 1 | -1,
  shift: boolean,
  range: ScrubRange,
): number {
  return scrubValue(value + direction * (shift ? range.coarseStep : range.step), false, range)
}
