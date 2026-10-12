// How far in from each edge of the sheet an Exam's pages print.
//
// Every page used to print three quarters of an inch in from every edge. An
// Exam may set its own Page Margins from the Format menu: one value for all
// four sides, or each side on its own (ADR-0039). Like its heading and text
// sizes, they are this Exam's presentation, saved, undone and exported with it.
//
// Margins are in inches, the unit a teacher sets them in; the Layout Plan
// turns them into the CSS pixels it packs in (`pageSizeOf` in export-plan.ts).
// Only a departure from the default is stored: an Exam whose four sides are
// all the default stores nothing, so every Exam made before stays as it was.

/** One edge of the sheet, in the order CSS and the Format menu list them. */
export type MarginSide = 'top' | 'right' | 'bottom' | 'left'

export const MARGIN_SIDES: readonly MarginSide[] = ['top', 'right', 'bottom', 'left']

export const MARGIN_SIDE_LABELS: Record<MarginSide, string> = {
  top: 'Top',
  right: 'Right',
  bottom: 'Bottom',
  left: 'Left',
}

/** An Exam's margins, in inches, every side stated. */
export type PageMargins = Record<MarginSide, number>

/** Today's margin on every side, and the margin of an Exam that never set one. */
export const DEFAULT_MARGIN = 0.75
/** The narrowest margin: the question's handles still fit beside it on the
 *  sheet, and a printer's unprintable edge is clear of it. */
export const MIN_MARGIN = 0.5
export const MAX_MARGIN = 1.5
/** What a scrubbed or stepped margin moves by, and what a typed value rounds to. */
export const MARGIN_STEP = 0.05

export const DEFAULT_MARGINS: PageMargins = {
  top: DEFAULT_MARGIN,
  right: DEFAULT_MARGIN,
  bottom: DEFAULT_MARGIN,
  left: DEFAULT_MARGIN,
}

const PX_PER_INCH = 96

/** A margin in the CSS pixels the Layout Plan packs in. Whole hundredths, so a
 *  step never leaves a floating-point tail in a plan. */
export function marginPx(inches: number): number {
  return Math.round(inches * PX_PER_INCH * 100) / 100
}

/** A typed or dragged value, kept in range and on a step. */
export function clampMargin(inches: number): number {
  if (!Number.isFinite(inches)) return DEFAULT_MARGIN
  const stepped = Math.round(inches / MARGIN_STEP) * MARGIN_STEP
  return Math.round(Math.min(MAX_MARGIN, Math.max(MIN_MARGIN, stepped)) * 100) / 100
}

/** The one reader: the Exam's margins where it has some, the default elsewhere. */
export function marginsOf(margins: PageMargins | undefined): PageMargins {
  return margins ? { ...margins } : { ...DEFAULT_MARGINS }
}

/** The one value every side shares, or `null` when they differ — what the
 *  combined control shows as "Mixed". */
export function uniformMarginOf(margins: PageMargins | undefined): number | null {
  const [first, ...rest] = MARGIN_SIDES.map((side) => marginsOf(margins)[side])
  return rest.every((value) => value === first) ? first! : null
}

/** `margins` with `sides` set to `inches`, clamped, and kept to a departure from
 *  the default: an Exam with all four sides at the default stores nothing. */
export function withMargin(
  margins: PageMargins | undefined,
  sides: readonly MarginSide[],
  inches: number,
): PageMargins | undefined {
  const next = marginsOf(margins)
  const value = clampMargin(inches)
  for (const side of sides) next[side] = value
  return MARGIN_SIDES.every((side) => next[side] === DEFAULT_MARGIN) ? undefined : next
}

/** Whether a stored value is margins this build can print — the single guard
 *  storage and import share. Every side must be stated and in range. */
export function isPageMargins(value: unknown): value is PageMargins {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === MARGIN_SIDES.length
    && MARGIN_SIDES.every((side) => {
      const inches = record[side]
      return typeof inches === 'number' && inches >= MIN_MARGIN && inches <= MAX_MARGIN
    })
}

/** Whether two Exams print the same margins. Absent and the default agree. */
export function sameMargins(left: PageMargins | undefined, right: PageMargins | undefined): boolean {
  const first = marginsOf(left)
  const second = marginsOf(right)
  return MARGIN_SIDES.every((side) => first[side] === second[side])
}
