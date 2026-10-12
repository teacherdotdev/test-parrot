// Where a matching set's Word Bank prints: where its position stores, beside
// its Items or above them in columns. A position takes its layout when it
// arrives on an Exam or the Exam changes style — beside its Items whenever it
// fits, measured, and above them otherwise, or above under Classic — and the
// Layout Plan reads it from then on. Read through the planner's own interface.

import { describe, expect, test } from 'bun:test'
import {
  CONDENSED_MATCHING_PROMPTS_MIN_WIDTH,
  MATCHING_BANK_INSET,
  MATCHING_BANK_WIDTH,
  MATCHING_INDENT,
  MATCHING_PROMPTS_MIN_WIDTH,
  PAGE_CONTENT_WIDTH,
  pageSizeOf,
  planExport,
  type MatchingSet,
  type Measure,
  type PlannedBankAnswer,
  wordBankLayoutFor,
} from './export-plan'
import { DEFAULT_COLUMNS, type Arrangement, type Exam, type Question } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import type { TextSize } from './section-headings'

const paragraph = (text: string): ProseMirrorJSON => ({ type: 'paragraph', content: [{ type: 'text', text }] })

/** A matching set of `items` Items and `answers` Word Bank answers. */
function matching(id: string, items: number, answers: number): Question {
  const bank = Array.from({ length: answers }, (_unused, index) => `${id}-w${index + 1}`)
  return {
    id,
    type: 'matching',
    columns: DEFAULT_COLUMNS,
    doc: {
      type: 'doc',
      content: [
        paragraph(`directions ${id}`),
        {
          type: 'matching',
          content: [
            ...Array.from({ length: items }, (_unused, index) => ({
              type: 'matchingPrompt',
              attrs: { id: `${id}-p${index + 1}`, answer: bank[index % answers] },
              content: [paragraph(`item ${index + 1}`)],
            })),
            ...bank.map((answer) => ({ type: 'matchingAnswer', attrs: { id: answer }, content: [paragraph(answer)] })),
          ],
        },
      ],
    },
  }
}

const ARRANGEMENT: Arrangement = { id: 'v1', letter: 'A', questionOrder: [], choiceOrder: {} }

/** Every answer `width` wide on one line at normal text, a fifth wider at large. */
function widths(width: number | ((answer: PlannedBankAnswer) => number)): Measure {
  return {
    itemHeight: () => 0,
    bankAnswerWidth: (answer, textSize?: TextSize) =>
      (typeof width === 'number' ? width : width(answer)) * (textSize === 'large' ? 1.2 : 1),
  }
}

function setOf(exam: Exam, measure: Measure): MatchingSet {
  const plan = planExport({ exam, arrangement: ARRANGEMENT, selection: { test: true, answerKey: false }, measure })
  const item = plan.pages.flatMap((page) => page.items).find((each) => each.kind === 'question')
  if (item?.kind !== 'question' || !item.matching) throw new Error('no matching set planned')
  return item.matching
}

const exam = (question: Question, extra: Partial<Exam> = {}): Exam => ({ title: 'Matching', questions: [question], ...extra })
const beside = (set: MatchingSet) => set.bankGrid === null

/** The widest answer that still fits beside the Items, on today's sheet. */
const FITS = PAGE_CONTENT_WIDTH - MATCHING_INDENT - MATCHING_PROMPTS_MIN_WIDTH - MATCHING_BANK_INSET

/** Where a Matching position's Word Bank goes when it takes a layout, with
 *  every answer measured as `widths` says. */
const placed = (
  question: Question,
  width: number | ((answer: PlannedBankAnswer) => number),
  settings: Partial<Exam> = {},
) => wordBankLayoutFor(question, settings, widths(width).bankAnswerWidth)

describe('the Word Bank layout a Matching position takes', () => {
  test('is beside its Items whenever its widest answer fits, however many answers it has', () => {
    // Seven answers once went above by count alone.
    expect(placed(matching('m', 6, 7), 100)).toBe('beside')
    expect(placed(matching('m', 6, 7), FITS)).toBe('beside')
    expect(placed(matching('m', 6, 7), FITS + 1)).toBe('above')
  })

  test('is above its Items when one answer is too wide to stand beside them', () => {
    expect(placed(matching('m', 3, 3), ({ id }) => (id === 'm-w2' ? 400 : 60))).toBe('above')
  })

  test('is measured at the Exam’s text size', () => {
    const width = Math.floor(FITS / 1.1)
    expect(placed(matching('m', 3, 3), width)).toBe('beside')
    expect(placed(matching('m', 3, 3), width, { textSize: 'large' })).toBe('above')
  })

  test('leaves the Items less room on a page with deeper side margins', () => {
    const margins = { top: 0.75, right: 1.5, bottom: 0.75, left: 1.5 }
    const narrow = pageSizeOf(margins).contentWidth - MATCHING_INDENT - MATCHING_PROMPTS_MIN_WIDTH - MATCHING_BANK_INSET
    expect(narrow).toBeLessThan(FITS)
    expect(placed(matching('m', 3, 3), narrow, { margins })).toBe('beside')
    expect(placed(matching('m', 3, 3), narrow + 1, { margins })).toBe('above')
  })

  test('is beside more often under Condensed, whose Items may narrow further', () => {
    const width = FITS + (MATCHING_PROMPTS_MIN_WIDTH - CONDENSED_MATCHING_PROMPTS_MIN_WIDTH)
    expect(placed(matching('m', 3, 3), width)).toBe('above')
    expect(placed(matching('m', 3, 3), width, { paperStyle: 'condensed' })).toBe('beside')
  })

  test('is above when its bank is far taller than its Items, rather than repeat beside every piece', () => {
    expect(placed(matching('m', 2, 12), 60)).toBe('above')
    expect(placed(matching('m', 6, 12), 60)).toBe('beside')
  })

  test('falls back to its count when nothing can measure it', () => {
    expect(wordBankLayoutFor(matching('m', 3, 5), {})).toBe('beside')
    expect(wordBankLayoutFor(matching('m', 3, 6), {})).toBe('above')
  })

  test('is always above under Classic', () => {
    expect(placed(matching('m', 3, 3), 60, { paperStyle: 'classic' })).toBe('above')
    expect(wordBankLayoutFor(matching('m', 3, 3), { paperStyle: 'classic' })).toBe('above')
  })
})

describe('a Word Bank on the sheet', () => {
  test('prints where its position stores, never measured again at layout', () => {
    // Too wide to fit, yet stored beside: it stays beside.
    expect(beside(setOf(exam(matching('m', 6, 7), { wordBankLayout: { m: 'beside' } }), widths(FITS + 100)))).toBe(true)
    // Narrow enough to fit, yet stored above: it stays above, in columns.
    expect(setOf(exam(matching('m', 3, 3), { wordBankLayout: { m: 'above' } }), widths(40)).bankGrid?.columns).toBe(2)
  })

  test('without a stored layout, goes where its count puts it, however it measures', () => {
    expect(beside(setOf(exam(matching('m', 6, 7)), widths(100)))).toBe(false)
    expect(beside(setOf(exam(matching('m', 3, 3)), widths(FITS + 100)))).toBe(true)
    expect(beside(setOf(exam(matching('m', 3, 3), { paperStyle: 'classic' }), widths(60)))).toBe(false)
  })

  test('widens its column beside for a wide answer, and keeps today’s column otherwise', () => {
    expect(setOf(exam(matching('m', 3, 3)), widths(100)).bankWidth).toBeUndefined()
    expect(setOf(exam(matching('m', 3, 3)), widths(280)).bankWidth).toBe(280 + MATCHING_BANK_INSET)
  })
})

describe('a Word Bank the teacher placed', () => {
  test('stands beside its Items when put there, in the widest column they allow, however wide its answers', () => {
    const set = setOf(exam(matching('m', 3, 3), { wordBankLayout: { m: 'beside' } }), widths(600))
    expect(beside(set)).toBe(true)
    expect(set.bankWidth).toBe(PAGE_CONTENT_WIDTH - MATCHING_INDENT - MATCHING_PROMPTS_MIN_WIDTH)
    // A narrow bank keeps today's column.
    expect(setOf(exam(matching('m', 3, 3), { wordBankLayout: { m: 'beside' } }), widths(60)).bankWidth).toBeUndefined()
  })

  test('stands above its Items when put there, however well it would fit beside them', () => {
    expect(beside(setOf(exam(matching('m', 3, 3), { wordBankLayout: { m: 'above' } }), widths(40)))).toBe(false)
    expect(beside(setOf(exam(matching('m', 3, 3), { wordBankLayout: { m: 'above' } }), { itemHeight: () => 0 }))).toBe(false)
  })

  test('wins over its Paper Style and over its count', () => {
    expect(beside(setOf(exam(matching('m', 3, 3), { paperStyle: 'classic', wordBankLayout: { m: 'beside' } }), widths(60))))
      .toBe(true)
    expect(beside(setOf(exam(matching('m', 2, 12), { wordBankLayout: { m: 'beside' } }), { itemHeight: () => 0 })))
      .toBe(true)
  })

  test('is never wider than the room the Items leave, nor narrower than today’s column', () => {
    const set = setOf(exam(matching('m', 3, 3), { wordBankLayout: { m: 'beside' } }), widths(250))
    expect(set.bankWidth).toBe(250 + MATCHING_BANK_INSET)
    expect(set.bankWidth!).toBeGreaterThan(MATCHING_BANK_WIDTH)
  })
})
