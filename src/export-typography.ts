// The exam sheet's type, one table for every adapter.
//
// Print is the reference presentation, so these are the CSS pixel sizes
// `styles.css` gives `.exam-page` and its furniture; `export-typography.test.ts`
// holds the stylesheet to them. The PDF draws them at the page's own 0.75pt per
// px. Word sizes type in whole half-points, so DOCX takes the half-point at or
// below each size: never larger than the text the plan measured, and never more
// than a quarter point smaller.

import type { CSSProperties } from 'react'
import type { HeadingSize, TextSize } from './section-headings'

export const EXAM_FONT = 'Georgia'

export const EXAM_TYPE_PX = {
  /** `.exam-page`: stems, choices, prompts, instructions, the identity line. */
  body: 15,
  /** `.exam-title` on a first page. */
  title: 26,
  /** `.section-title` and `.answer-key-section`. */
  sectionTitle: 17,
  /** `.answer-key-heading`: the key's "Answer Section". */
  answerKeyHeading: 20,
  /** `.page-footer` and `.doc-figure figcaption`. */
  small: 13,
} as const

export type ExamTypeRole = keyof typeof EXAM_TYPE_PX

// How the body text is spaced, as multiples of its own size so every text size
// keeps the same proportions. The lines of one paragraph sit close and a new
// paragraph opens a clear gap, so a paragraph break reads as one rather than as
// one more line; a list's items sit nearly as close as the lines within them.
// Print sets these on `.exam-page` and its question text, the PDF spaces its
// lines and blocks by them, and DOCX sets them on its body paragraphs.

/** A line of body text, as a multiple of the type's size. Was 1.45, then 1.3. */
export const BODY_LINE_HEIGHT = 1.2

/** A line of a heading — a section title, the Answer Key's "Answer Section"
 *  and its section titles — as a multiple of its size. Was 1.3, the body's,
 *  and tightened with it. A section's directions are body text, at the body's. */
export const HEADING_LINE_HEIGHT = 1.2

/** A line of the Exam title, which may wrap onto several. Was 1.2: the title
 *  sits a step tighter than the other headings, as it did before. */
export const TITLE_LINE_HEIGHT = 1.1

/** The gap between two paragraphs of a question's text — or between a
 *  paragraph and a list — in ems. Print's own paragraph spacing, now stated. */
export const PARAGRAPH_GAP_EM = 1

/** The gap between two items of a bulleted or numbered list, in ems. Each item
 *  used to open a paragraph gap of its own. */
export const LIST_ITEM_GAP_EM = 0.2

/** The room inside a table cell around what it holds, in CSS px: above and
 *  below, and either side. A cell's first and last paragraphs open no
 *  paragraph gap of their own, so a row of one line is a line and this
 *  padding in print, the PDF and DOCX alike. */
export const TABLE_CELL_PADDING_PX = { y: 5, x: 8 } as const

const POINTS_PER_PX = 0.75

/** A role's size in PDF points. */
export function pointsOf(role: ExamTypeRole): number {
  return EXAM_TYPE_PX[role] * POINTS_PER_PX
}

/** A role's size in Word half-points, rounded down to a whole one. */
export function halfPointsOf(role: ExamTypeRole): number {
  return Math.floor(pointsOf(role) * 2)
}

/** A section heading and its directions, at each size an Exam can print its
 *  headings. `'normal'` is the sheet's own type, so an Exam that never chose a
 *  size prints exactly as before. */
export const SECTION_HEADING_PX: Record<HeadingSize, { title: number; instructions: number }> = {
  small: { title: 15, instructions: 13 },
  normal: { title: EXAM_TYPE_PX.sectionTitle, instructions: EXAM_TYPE_PX.body },
  large: { title: 21, instructions: 17 },
}

/** The Exam title at each heading size: the heading size sets every heading
 *  on the Exam, its name included. Each fits the first page's fixed title band. */
export const TITLE_PX: Record<HeadingSize, number> = {
  small: 22,
  normal: EXAM_TYPE_PX.title,
  large: 30,
}

/** The body type — stems, answers, answer-key lines — at each text size. Print
 *  sets it on a page's content with a relative line height, so lines grow with
 *  it, and the PDF scales its line pitch by the same ratio. */
export const BODY_PX: Record<TextSize, number> = {
  small: 13,
  normal: EXAM_TYPE_PX.body,
  large: 17,
}

/** How much larger than today's body type an Exam's text prints. */
export function bodyScale(size: TextSize = 'normal'): number {
  return BODY_PX[size] / EXAM_TYPE_PX.body
}

export function titlePoints(size: HeadingSize = 'normal'): number {
  return TITLE_PX[size] * POINTS_PER_PX
}

export function titleHalfPoints(size: HeadingSize = 'normal'): number {
  return Math.floor(titlePoints(size) * 2)
}

export function bodyPoints(size: TextSize = 'normal'): number {
  return BODY_PX[size] * POINTS_PER_PX
}

export function bodyHalfPoints(size: TextSize = 'normal'): number {
  return Math.floor(bodyPoints(size) * 2)
}

/** A section heading's sizes in PDF points. */
export function sectionHeadingPoints(size: HeadingSize = 'normal'): { title: number; instructions: number } {
  const px = SECTION_HEADING_PX[size]
  return { title: px.title * POINTS_PER_PX, instructions: px.instructions * POINTS_PER_PX }
}

/** A section heading's sizes in Word half-points, rounded down like the rest. */
export function sectionHeadingHalfPoints(size: HeadingSize = 'normal'): { title: number; instructions: number } {
  const points = sectionHeadingPoints(size)
  return { title: Math.floor(points.title * 2), instructions: Math.floor(points.instructions * 2) }
}

/** The inline type a section heading prints at in print, on an Exam that chose
 *  a size; nothing at all for `'normal'`, which the stylesheet already says. */
export function sectionHeadingStyles(size: HeadingSize | undefined): {
  title?: { fontSize: number }
  instructions?: { fontSize: number }
} {
  if (!size || size === 'normal') return {}
  const px = SECTION_HEADING_PX[size]
  return { title: { fontSize: px.title }, instructions: { fontSize: px.instructions } }
}

/** The type a page's content prints at in print, on an Exam that chose a text
 *  size; nothing for normal, which the stylesheet already says. The header and
 *  footer are furniture and keep the sheet's own type. */
export function pageContentStyle(textSize: TextSize | undefined): CSSProperties | undefined {
  return textSize && textSize !== 'normal' ? { fontSize: BODY_PX[textSize] } : undefined
}
