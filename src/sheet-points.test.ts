import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionView } from './exam-page'
import { buildExportDocument, type QuestionItem } from './export-plan'
import { FIXTURES } from './export-fixtures'
import type { Selection } from './use-selection'

// Points on the exam sheet (ADR-0042, ADR-0045): like Question Metadata, they
// show only where the Paper Style prints them, and there the printed `[n]` is
// what a teacher clicks to change them.

const noop = () => {}
const selection: Selection = {
  selectedIds: new Set(),
  isSelected: () => false,
  selectOne: noop,
  toggle: noop,
  select: noop,
  selectAll: noop,
  clear: noop,
}

function sheetQuestions(fixtureName: string): QuestionItem[] {
  const fixture = FIXTURES.find((item) => item.name === fixtureName)!
  return buildExportDocument(fixture.exam, fixture.arrangement, { test: true, answerKey: false })
    .test.filter((item): item is QuestionItem => item.kind === 'question')
}

function sheetMarkup(item: QuestionItem): string {
  return renderToStaticMarkup(
    createElement(QuestionView, {
      item,
      sectionId: 'section',
      selected: false,
      orderedIds: [item.question.id],
      selection,
      onEdit: noop,
      onOpenMenu: noop,
      onSetWorkSpace: noop,
      onSetPoints: noop,
      maxWorkSpace: 600,
      workSpaceSizing: {
        shownHeight: () => null,
        isSizing: () => false,
        onPreview: noop,
        onRelease: noop,
      },
      dragging: false,
      dropped: false,
      dropState: null,
      onDragStart: noop,
      onDragMove: noop,
      onDrop: noop,
      onDragEnd: noop,
    }),
  )
}

/** The labels of every control on the sheet that edits Points. */
function pointsControls(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*aria-label="(Points for [^"]*)"[^>]*>([^<]*)<\/button>/g)]
    .map((match) => `${match[1]} ${match[2]}`)
}

describe('Points on the exam sheet', () => {
  test('a Paper Style that prints no Points shows none, and offers no control for them', () => {
    for (const item of sheetQuestions('a paper with points')) {
      const markup = sheetMarkup(item)
      expect(markup).not.toMatch(/[Pp]oints?\b/)
      expect(markup).not.toMatch(/\[\d+\]/)
    }
  })

  test('under Exam Board each printed [n] edits the Points of what it follows', () => {
    const items = sheetQuestions('a paper with points in the exam board paper style')
    expect(items.flatMap((item) => pointsControls(sheetMarkup(item)))).toEqual([
      'Points for question 1: 1 point [1]',
      'Points for question 2: 1 point [1]',
      'Points for question 3–4: 2 points [2]',
      'Points for question 5: 3 points [3]',
      'Points for question 6 part a: 2 points [2]',
      'Points for question 6 part b (i): 1 point [1]',
      'Points for question 6 part b (ii): 6 points [6]',
    ])
  })

  test('an [n] that ends a ruled Work Space is the control at the end of its last rule', () => {
    const items = sheetQuestions('a paper with points in the exam board paper style')
    const lastRule = (markup: string) =>
      /<div class="work-space-line work-space-line--points"[^>]*>.*?<\/div>/s.exec(markup)?.[0] ?? ''
    // The Short Answer question's dotted lines carry its [3] on the last one.
    expect(lastRule(sheetMarkup(items[3]!))).toContain('aria-label="Points for question 5: 3 points"')
    // A Multiple Choice question has no rule, so its [1] stands on its own line.
    expect(sheetMarkup(items[0]!)).not.toContain('work-space-line--points')
    expect(sheetMarkup(items[0]!)).toMatch(/<p class="points-after"><button[^>]*aria-label="Points for question 1/)
  })

  test('a Multipart question’s printed total is the sum of its Parts, and not a control', () => {
    const multipart = sheetQuestions('a paper with points in the exam board paper style').at(-1)!
    const markup = sheetMarkup(multipart)
    expect(markup).toContain('<p class="points-after">[Total: 9]</p>')
  })
})
