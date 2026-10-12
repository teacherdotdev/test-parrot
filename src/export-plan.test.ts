import { describe, expect, test } from 'bun:test'
import { DEFAULT_HEADER } from './page-header'
import {
  CHOICE_AREA_WIDTH,
  CHOICE_INDENT,
  FOOTER_HEIGHT,
  HEADER_HEIGHT,
  headerHeightOf,
  PAGE_CONTENT_WIDTH,
  PAGE_HEIGHT,
  PAGE_MARGIN,
  PAGE_WIDTH,
  SECTION_INSTRUCTIONS,
  SECTION_TITLE,
  pageContentHeight,
  readStoredLayoutPlan,
  isAnswerKeyHeader,
  buildExportDocument,
  numberLabelOf,
  planExport,
  printsNumberLine,
  questionIndentOf,
  unmeasured,
  STUDENT_TEST,
  type ColumnCount,
  type Measure,
  type ExportContentSelection,
  type LayoutPlan,
  type PlannedPage,
  type PageItem,
  type QuestionItem,
  type PlannedQuestion,
} from './export-plan'
import {
  DEFAULT_COLUMNS,
  laidWorkSpaceHeight,
  rowsIn,
  storedWorkSpaceHeight,
  workSpaceRows,
  type Exam,
  type Question,
  type Arrangement,
} from './exam'
import { TITLE_LINE_HEIGHT, TITLE_PX } from './export-typography'
import type { ProseMirrorJSON } from './question-doc'
import { exportDocumentFingerprint } from './export-fingerprint'

function choice(id: string, correct = false): ProseMirrorJSON {
  return {
    type: 'multipleChoiceChoice',
    attrs: { correct, id },
    content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
  }
}

function multipleChoice(
  id: string,
  choiceIds: string[],
  correctId = '',
): Question {
  return {
    id,
    type: 'multiple-choice',
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `stem ${id}` }] },
        {
          type: 'multipleChoice',
          content: choiceIds.map((cid) => choice(cid, cid === correctId)),
        },
      ],
    },
    columns: DEFAULT_COLUMNS,
  }
}

function trueFalse(id: string, correct: 'true' | 'false' | null = null): Question {
  return {
    id,
    type: 'true-false',
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `stem ${id}` }] },
        {
          type: 'multipleChoice',
          content: [
            choice(`${id}-t`, correct === 'true'),
            choice(`${id}-f`, correct === 'false'),
          ],
        },
      ],
    },
    columns: DEFAULT_COLUMNS,
  }
}

// A matching set: `matches` is each item's answer id in item order, '' for an
// unmatched one; `bankIds` the Word Bank in authored order.
function matching(id: string, matches: string[], bankIds: string[]): Question {
  return {
    id,
    type: 'matching',
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `stem ${id}` }] },
        {
          type: 'matching',
          content: [
            ...matches.map((answer, index) => ({
              type: 'matchingPrompt',
              attrs: { id: `${id}-p${index + 1}`, answer },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: `item ${index + 1}` }] }],
            })),
            ...bankIds.map((bankId) => ({
              type: 'matchingAnswer',
              attrs: { id: bankId },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: bankId }] }],
            })),
          ],
        },
      ],
    },
    columns: DEFAULT_COLUMNS,
  }
}

function open(id: string): Question {
  return {
    id,
    type: 'open',
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
    },
    columns: DEFAULT_COLUMNS,
  }
}

function examOf(questions: Question[]): Exam {
  return { title: 'Chemistry Unit 3', questions }
}

function arrangementOf(
  questionOrder: string[] = [],
  choiceOrder: Record<string, string[]> = {},
): Arrangement {
  return { id: 'v1', letter: 'A', questionOrder, choiceOrder }
}

const WHOLE_DOCUMENT: ExportContentSelection = { test: true, answerKey: true }

/** The planner's whole interface, in the shape these tests read it: a plan's
 *  pages for one arrangement, with both documents selected. */
function planPages(
  exam: Exam,
  arrangement: Arrangement,
  measure: Measure,
): PlannedPage[] {
  return planExport({ exam, arrangement, selection: WHOLE_DOCUMENT, measure }).pages
}

function render(exam: Exam, arrangement: Arrangement = arrangementOf()): PlannedPage[] {
  return testPages(planPages(exam, arrangement, unmeasured))
}

function testPages(pages: PlannedPage[]): PlannedPage[] {
  return pages.filter((page) => !isAnswerKeyHeader(page.header))
}

function itemsOf(pages: PlannedPage[]): PageItem[] {
  return pages.flatMap((page) => page.items)
}

function headings(pages: PlannedPage[]): PageItem[] {
  return itemsOf(pages).filter((item) => item.kind === 'section-heading')
}

function plannedQuestions(pages: PlannedPage[]): PlannedQuestion[] {
  return itemsOf(pages).flatMap((item) =>
    item.kind === 'question' ? [item.question] : [],
  )
}

/** The grid read row by row, with an empty cell written as a dash. */
function gridRows(question: PlannedQuestion): string[][] {
  return (question.grid?.cells ?? []).map((row) =>
    row.map((cell) => (cell ? `${cell.letter}${cell.id}` : '-')),
  )
}

describe('pages', () => {
  test('an exam that fits renders as a single first page', () => {
    const pages = render(examOf([multipleChoice('q1', ['a', 'b'])]))
    expect(pages).toHaveLength(1)
    expect(pages[0]!.number).toBe(1)
    expect(pages[0]!.header).toBe('first')
  })

  test('an empty exam still renders a blank page', () => {
    const pages = render(examOf([]))
    expect(pages).toHaveLength(1)
    expect(headings(pages)).toHaveLength(0)
    expect(itemsOf(pages)).toEqual([])
  })

  test('rendering leaves the exam and the arrangement untouched', () => {
    const exam = examOf([multipleChoice('q1', ['a', 'b']), open('q2')])
    const arrangement = arrangementOf(['q2', 'q1'], { q1: ['b', 'a'] })
    const before = JSON.stringify({ exam, arrangement })
    render(exam, arrangement)
    expect(JSON.stringify({ exam, arrangement })).toBe(before)
  })
})

describe('sections', () => {
  test('on an Exam that stores none, are derived from question type in fixed order, whatever the ordering says', () => {
    const exam = examOf([open('q1'), multipleChoice('q2', ['a', 'b'])])
    const pages = render(exam, arrangementOf(['q1', 'q2']))
    expect(headings(pages)).toEqual([
      {
        kind: 'section-heading',
        sectionId: 'multiple-choice',
        title: 'Multiple Choice',
        instructions: SECTION_INSTRUCTIONS['multiple-choice'],
        keepWithNext: true,
      },
      {
        kind: 'section-heading',
        sectionId: 'open',
        title: 'Short Answer',
        instructions: SECTION_INSTRUCTIONS.open,
        keepWithNext: true,
      },
    ])
  })

  test('carry a hardcoded instruction line', () => {
    const pages = render(examOf([multipleChoice('q1', ['a', 'b'])]))
    const [heading] = headings(pages)
    expect(heading).toMatchObject({
      title: SECTION_TITLE['multiple-choice'],
      instructions: expect.any(String),
    })
    expect(SECTION_INSTRUCTIONS['multiple-choice'].length).toBeGreaterThan(0)
    expect(SECTION_INSTRUCTIONS.open.length).toBeGreaterThan(0)
  })

  test('true/false prints between multiple choice and short answer, with its own directions', () => {
    const exam = examOf([
      open('q1'),
      trueFalse('q2'),
      multipleChoice('q3', ['a', 'b']),
    ])
    const pages = render(exam, arrangementOf(['q1', 'q2', 'q3']))
    expect(headings(pages).map((heading) => heading.kind === 'section-heading' && heading.title))
      .toEqual(['Multiple Choice', 'True/False', 'Short Answer'])
    expect(headings(pages)[1]).toMatchObject({
      instructions: SECTION_INSTRUCTIONS['true-false'],
    })
    // The complaint that started this: each section says what to do with its
    // own questions rather than borrowing the Multiple Choice line.
    expect(SECTION_INSTRUCTIONS['true-false']).not.toBe(
      SECTION_INSTRUCTIONS['multiple-choice'],
    )
  })

  test('matching prints between true/false and short answer, with its own directions', () => {
    const exam = examOf([
      open('q1'),
      matching('x1', [''], ['a', 'b']),
      trueFalse('q2'),
      multipleChoice('q3', ['a', 'b']),
    ])
    const pages = render(exam, arrangementOf(['q1', 'x1', 'q2', 'q3']))
    expect(headings(pages).map((heading) => heading.kind === 'section-heading' && heading.title))
      .toEqual(['Multiple Choice', 'True/False', 'Matching', 'Short Answer'])
    expect(headings(pages)[2]).toMatchObject({
      instructions: SECTION_INSTRUCTIONS.matching,
    })
  })

  test('a section with no questions is omitted, heading and all', () => {
    const pages = render(examOf([multipleChoice('q1', ['a', 'b'])]))
    expect(headings(pages)).toHaveLength(1)
    expect(headings(pages)[0]).toMatchObject({ sectionId: 'multiple-choice' })
  })

  test('the printable item stream contains no editing-only insertion controls', () => {
    const pages = render(examOf([multipleChoice('q1', ['a', 'b']), open('q2')]))
    expect(itemsOf(pages).map((item) => item.kind)).toEqual([
      'section-heading',
      'question',
      'section-heading',
      'question',
    ])
  })
})

describe('questions', () => {
  test('are numbered continuously across sections', () => {
    const exam = examOf([
      open('o1'),
      multipleChoice('m1', ['a', 'b']),
      open('o2'),
      multipleChoice('m2', ['c', 'd']),
    ])
    const rendered = plannedQuestions(render(exam))
    expect(rendered.map((question) => [question.id, question.number])).toEqual([
      ['m1', 1],
      ['m2', 2],
      ['o1', 3],
      ['o2', 4],
    ])
  })

  test('appear in the order the arrangement puts them in, within their section', () => {
    const exam = examOf([
      multipleChoice('m1', ['a', 'b']),
      multipleChoice('m2', ['c', 'd']),
      open('o1'),
    ])
    const rendered = plannedQuestions(render(exam, arrangementOf(['m2', 'o1', 'm1'])))
    expect(rendered.map((question) => question.id)).toEqual(['m2', 'm1', 'o1'])
    expect(rendered.map((question) => question.number)).toEqual([1, 2, 3])
  })

  test('a matching set takes one number per item, and numbering continues past it', () => {
    const exam = examOf([
      multipleChoice('m1', ['a', 'b']),
      matching('x1', ['', '', ''], ['a', 'b', 'c']),
      matching('x2', [''], ['a', 'b']),
      open('o1'),
    ])
    const rendered = plannedQuestions(render(exam))
    expect(rendered.map((question) => [question.id, question.number])).toEqual([
      ['m1', 1],
      ['x1', 2],
      ['x2', 5],
      ['o1', 6],
    ])
    expect(rendered[1]!.matching!.prompts.map((prompt) => prompt.number)).toEqual([2, 3, 4])
    expect(numberLabelOf(rendered[1]!)).toBe('2–4')
    expect(numberLabelOf(rendered[2]!)).toBe('5')
    expect(numberLabelOf(rendered[3]!)).toBe('6')
  })

  test('a matching set prints its numbers on its items, not beside its stem', () => {
    const [item] = itemsOf(render(examOf([matching('x1', [''], ['a', 'b'])]))).filter(
      (candidate): candidate is QuestionItem => candidate.kind === 'question',
    )
    expect(item!.numbered).toBe(true)
    expect(printsNumberLine(item!)).toBe(false)
    expect(item!.question.marks).toEqual([])
    expect(item!.question.grid).toBeNull()
    expect(item!.question.choices).toEqual([])
    expect(item!.question.stem).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'stem x1' }] },
    ])
  })

  test('a matching set letters its word bank by the arrangement, and each item by the answer it names', () => {
    const exam = examOf([matching('x1', ['b', '', 'gone'], ['a', 'b', 'c'])])
    const [rendered] = plannedQuestions(render(exam, arrangementOf(['x1'], { x1: ['c', 'b', 'a'] })))
    expect(rendered!.matching!.bank.map((answer) => `${answer.letter}${answer.id}`)).toEqual([
      'Ac',
      'Bb',
      'Ca',
    ])
    // Unmatched, and matched to an answer the bank no longer holds, both print
    // no letter.
    expect(rendered!.matching!.prompts.map((prompt) => prompt.letter)).toEqual(['B', null, null])
  })

  test('a word bank of up to five answers prints beside its items; a longer one above them, in two columns', () => {
    const beside = plannedQuestions(render(examOf([matching('x1', [''], ['a', 'b', 'c', 'd', 'e'])])))
    expect(beside[0]!.matching!.bankGrid).toBeNull()

    const above = plannedQuestions(
      render(examOf([matching('x2', [''], ['a', 'b', 'c', 'd', 'e', 'f', 'g'])])),
    )
    const grid = above[0]!.matching!.bankGrid!
    expect(grid.columns).toBe(2)
    expect(grid.rows).toBe(4)
    // Column-major: A–D down the left, E–G down the right, one cell empty.
    expect(grid.cells.map((row) => row.map((cell) => cell?.letter ?? '-'))).toEqual([
      ['A', 'E'],
      ['B', 'F'],
      ['C', 'G'],
      ['D', '-'],
    ])
  })

  test('neither multiple choice nor short answer prints anything before its number', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b']), open('o1')])
    const rendered = plannedQuestions(render(exam))
    expect(rendered.map((question) => question.marks)).toEqual([[], []])
  })

  test('true/false prints a T and an F to circle before its number, and no choice grid', () => {
    const [rendered] = plannedQuestions(render(examOf([trueFalse('t1', 'true')])))
    expect(rendered!.marks).toEqual(['T', 'F'])
    // The pair is stated by the section's directions, so the statement stands
    // alone on the page.
    expect(rendered!.grid).toBeNull()
    expect(rendered!.stem).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'stem t1' }] },
    ])
  })

  test('true/false answers are lettered the way a student writes them', () => {
    const [rendered] = plannedQuestions(render(examOf([trueFalse('t1', 'false')])))
    expect(rendered!.choices.map((answer) => answer.letter)).toEqual(['T', 'F'])
  })

  test('the stem is the question document without its choice list', () => {
    const rendered = plannedQuestions(render(examOf([multipleChoice('m1', ['a', 'b'])])))
    expect(rendered[0]!.stem).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'stem m1' }] },
    ])
  })

  test('ignores the single trailing blank paragraph before multiple-choice answers', () => {
    const question = multipleChoice('m1', ['a', 'b'])
    const choiceList = (question.doc.content as ProseMirrorJSON[]).at(-1)!
    question.doc.content = [
      { type: 'paragraph', content: [{ type: 'text', text: 'Question' }] },
      { type: 'paragraph' },
      choiceList,
    ]

    const [rendered] = plannedQuestions(render(examOf([question])))
    expect(rendered!.stem).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Question' }] },
    ])
  })

  test('preserves additional blank paragraphs the teacher added before the answers', () => {
    const question = multipleChoice('m1', ['a', 'b'])
    const choiceList = (question.doc.content as ProseMirrorJSON[]).at(-1)!
    question.doc.content = [
      { type: 'paragraph', content: [{ type: 'text', text: 'Question' }] },
      { type: 'paragraph' },
      { type: 'paragraph' },
      choiceList,
    ]

    const [rendered] = plannedQuestions(render(examOf([question])))
    expect(rendered!.stem).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Question' }] },
      { type: 'paragraph' },
    ])
  })

  test('a short-answer question has no choices and no grid', () => {
    const rendered = plannedQuestions(render(examOf([open('o1')])))
    expect(rendered[0]!.choices).toEqual([])
    expect(rendered[0]!.grid).toBeNull()
  })
})

describe('choice letters', () => {
  test('follow the arrangement ordering rather than authoring order', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c', 'd'], 'a')])
    const arrangement = arrangementOf(['m1'], { m1: ['c', 'd', 'a', 'b'] })
    const [question] = plannedQuestions(render(exam, arrangement))
    expect(question!.choices.map((c) => [c.letter, c.id])).toEqual([
      ['A', 'c'],
      ['B', 'd'],
      ['C', 'a'],
      ['D', 'b'],
    ])
  })

  test('the correct answer keeps its letter position, whatever the ordering', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c', 'd'], 'a')])
    const arrangement = arrangementOf(['m1'], { m1: ['c', 'd', 'a', 'b'] })
    const [question] = plannedQuestions(render(exam, arrangement))
    const correct = question!.choices.find((c) => c.correct)
    expect(correct).toMatchObject({ id: 'a', letter: 'C' })
  })

  test('a choice the ordering has never heard of is lettered last', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c'])])
    const arrangement = arrangementOf(['m1'], { m1: ['c', 'gone', 'a'] })
    const [question] = plannedQuestions(render(exam, arrangement))
    expect(question!.choices.map((c) => [c.letter, c.id])).toEqual([
      ['A', 'c'],
      ['B', 'a'],
      ['C', 'b'],
    ])
  })
})

// These tests are about `layOutGrid`'s column-major mechanics, not about
// auto-resolution — each question pins an explicit column count so the
// result doesn't depend on the injected (unmeasured, in this describe block)
// `Measure`.
describe('the choice grid', () => {
  test('fills column-major over ceil(n / 2) rows at two columns', () => {
    const exam = examOf([
      { ...multipleChoice('m1', ['a', 'b', 'c', 'd']), columns: 2 as const },
    ])
    const [question] = plannedQuestions(render(exam))
    expect(question!.grid!.columns).toBe(2)
    expect(question!.grid!.rows).toBe(2)
    expect(gridRows(question!)).toEqual([
      ['Aa', 'Cc'],
      ['Bb', 'Dd'],
    ])
  })

  test('an odd count leaves the last cell of the second column empty', () => {
    const exam = examOf([
      { ...multipleChoice('m1', ['a', 'b', 'c', 'd', 'e']), columns: 2 as const },
    ])
    const [question] = plannedQuestions(render(exam))
    expect(question!.grid!.rows).toBe(3)
    expect(gridRows(question!)).toEqual([
      ['Aa', 'Dd'],
      ['Bb', 'Ee'],
      ['Cc', '-'],
    ])
  })

  test('three choices lay out down the first column first', () => {
    const exam = examOf([{ ...multipleChoice('m1', ['a', 'b', 'c']), columns: 2 as const }])
    const [question] = plannedQuestions(render(exam))
    expect(gridRows(question!)).toEqual([
      ['Aa', 'Cc'],
      ['Bb', '-'],
    ])
  })

  test('two choices sit side by side on one row', () => {
    const exam = examOf([{ ...multipleChoice('m1', ['a', 'b']), columns: 2 as const }])
    const [question] = plannedQuestions(render(exam))
    expect(gridRows(question!)).toEqual([['Aa', 'Bb']])
  })

  test('an explicit column count overrides the automatic one', () => {
    const one = { ...multipleChoice('m1', ['a', 'b', 'c']), columns: 1 as const }
    const four = { ...multipleChoice('m2', ['a', 'b', 'c', 'd', 'e']), columns: 4 as const }
    const [first, second] = plannedQuestions(render(examOf([one, four])))
    expect(gridRows(first!)).toEqual([['Aa'], ['Bb'], ['Cc']])
    expect(second!.grid!.columns).toBe(4)
    expect(second!.grid!.rows).toBe(2)
    expect(gridRows(second!)).toEqual([
      ['Aa', 'Cc', 'Ee', '-'],
      ['Bb', 'Dd', '-', '-'],
    ])
  })

  test('letters carry into the grid in arrangement order', () => {
    const exam = examOf([
      { ...multipleChoice('m1', ['a', 'b', 'c', 'd']), columns: 2 as const },
    ])
    const arrangement = arrangementOf(['m1'], { m1: ['d', 'c', 'b', 'a'] })
    const [question] = plannedQuestions(render(exam, arrangement))
    expect(gridRows(question!)).toEqual([
      ['Ad', 'Cb'],
      ['Bc', 'Da'],
    ])
  })
})

describe('answer columns', () => {
  function columnsOfPlan(question: Question): ColumnCount {
    const pages = planPages(examOf([question]), arrangementOf(), unmeasured)
    return plannedQuestions(pages)[0]!.grid!.columns
  }

  for (const columns of [1, 2, 4] as const) {
    test(`a question set to ${columns} is drawn in ${columns}`, () => {
      expect(columnsOfPlan({ ...multipleChoice('m1', ['a', 'b', 'c', 'd']), columns }))
        .toBe(columns)
    })
  }

  test('a stored question whose setting predates the plain count reads as the default', () => {
    // `'auto'` was a fourth setting once: the count was measured rather than
    // chosen. Records written then are still in browsers.
    const legacy = {
      ...multipleChoice('m1', ['a', 'b', 'c', 'd']),
      columns: 'auto' as unknown as Question['columns'],
    }
    expect(columnsOfPlan(legacy)).toBe(DEFAULT_COLUMNS)
  })

  test('the setting survives a content edit', () => {
    const original: Question = { ...multipleChoice('m1', ['a', 'b']), columns: 1 as const }
    const edited: Question = {
      ...original,
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'edited stem' }] },
          {
            type: 'multipleChoice',
            content: ['a', 'b', 'c', 'd'].map((id) => choice(id)),
          },
        ],
      },
    }
    expect(columnsOfPlan(original)).toBe(1)
    expect(columnsOfPlan(edited)).toBe(1)
  })
})

// Packing, driven entirely by stubbed heights: no DOM is involved, and the
// numbers below are chosen against the real content boxes so the assertions
// stay honest if the page furniture is ever resized.
describe('page geometry', () => {
  test('no question leaves room for an answer blank; a True/False question leaves room for its marks', () => {
    expect(questionIndentOf({ type: 'open' })).toBe(40)
    expect(questionIndentOf({ type: 'multiple-choice' })).toBe(40)
    expect(questionIndentOf({ type: 'multipart' })).toBe(40)
    expect(questionIndentOf({ type: 'true-false' })).toBe(70)
  })

  test('is US Letter at 96dpi with three-quarter-inch margins', () => {
    expect([PAGE_WIDTH, PAGE_HEIGHT]).toEqual([816, 1056])
    expect(PAGE_MARGIN).toBe(72)
    expect(PAGE_CONTENT_WIDTH).toBe(672)
    // A Multiple Choice question's answers are set in from its stem.
    expect(CHOICE_INDENT).toBe(18)
    expect(CHOICE_AREA_WIDTH).toBe(632 - CHOICE_INDENT)
  })

  test('subtracts the header and footer from the content box', () => {
    const box = PAGE_HEIGHT - 2 * PAGE_MARGIN
    expect(pageContentHeight('first')).toBe(box - HEADER_HEIGHT.first - FOOTER_HEIGHT)
    expect(pageContentHeight('later')).toBe(box - HEADER_HEIGHT.later - FOOTER_HEIGHT)
  })

  test('leaves the first page shorter, because its header carries the title too', () => {
    expect(pageContentHeight('first')).toBeLessThan(pageContentHeight('later'))
  })

  test('continuation headers leave extra clearance before page content', () => {
    expect(HEADER_HEIGHT.later).toBe(42)
    expect(HEADER_HEIGHT['answer-key-later']).toBe(42)
  })
})

describe('answer key', () => {
  function keyItems(exam: Exam, arrangement: Arrangement = arrangementOf()): PageItem[] {
    return planPages(exam, arrangement, unmeasured)
      .filter((page) => isAnswerKeyHeader(page.header))
      .flatMap((page) => page.items)
  }

  test('correct letters follow the current arrangement and carry Question Metadata', () => {
    const question = {
      ...multipleChoice('m1', ['a', 'b', 'c'], 'a'),
      difficulty: 'hard' as const,
      topics: ['Cells', 'Division'],
    }
    const exam = examOf([question])
    const arrangement = arrangementOf(['m1'], { m1: ['c', 'a', 'b'] })
    expect(keyItems(exam, arrangement)).toContainEqual({
      kind: 'answer-key-entry',
      number: 1,
      letter: 'B',
      difficulty: 'hard',
      topics: ['Cells', 'Division'],
    })
  })

  test('a question that hides incorrect answers prints only the rest, lettered as they print, and its key agrees', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b', 'c', 'd', 'e'], 'd')])
    const arrangement = {
      ...arrangementOf(['m1'], { m1: ['e', 'a', 'b', 'c', 'd'] }),
      hiddenAnswers: { m1: ['a', 'c'] },
    }
    const [question] = plannedQuestions(render(exam, arrangement))
    expect(question!.choices.map((c) => [c.letter, c.id])).toEqual([
      ['A', 'e'],
      ['B', 'b'],
      ['C', 'd'],
    ])
    expect(gridRows(question!).flat().filter((cell) => cell !== '-')).toHaveLength(3)
    expect(question!.answerVisibility).toEqual({ incorrect: 4, shown: 2 })
    expect(keyItems(exam, arrangement)).toContainEqual(
      expect.objectContaining({ kind: 'answer-key-entry', number: 1, letter: 'C' }),
    )
  })

  test('starts fresh after the test and restarts footer numbering at one', () => {
    const pages = planPages(
      examOf([open('o1'), open('o2')]),
      arrangementOf(),
      {
        itemHeight: (item) => item.kind === 'question' ? 500 : 0,
      },
    )
    const firstKey = pages.findIndex((page) => page.header === 'answer-key')
    expect(firstKey).toBeGreaterThan(0)
    expect(pages[firstKey - 1]!.header).not.toBe('answer-key')
    expect(pages[firstKey]!.number).toBe(1)
  })

  test('records a true/false answer as T or F under its own grouping', () => {
    const items = keyItems(
      examOf([trueFalse('t1', 'true'), trueFalse('t2', 'false')]),
      arrangementOf(['t1', 't2']),
    )
    expect(items).toEqual([
      { kind: 'answer-key-heading' },
      { kind: 'answer-key-section', sectionId: 'true-false', title: 'True/False' },
      { kind: 'answer-key-entry', number: 1, letter: 'T' },
      { kind: 'answer-key-entry', number: 2, letter: 'F' },
    ])
  })

  test('lists a true/false question with no correct answer marked as blank', () => {
    expect(keyItems(examOf([trueFalse('t1')]))).toContainEqual({
      kind: 'answer-key-entry',
      number: 1,
      letter: null,
    })
  })

  test('records one line per matching item, each under its own number', () => {
    const exam = examOf([
      multipleChoice('m1', ['a', 'b'], 'b'),
      matching('x1', ['b', ''], ['a', 'b']),
    ])
    const items = keyItems(exam, arrangementOf(['m1', 'x1'], { x1: ['b', 'a'] }))
    expect(items).toEqual([
      { kind: 'answer-key-heading' },
      { kind: 'answer-key-section', sectionId: 'multiple-choice', title: 'Multiple Choice' },
      { kind: 'answer-key-entry', number: 1, letter: 'B' },
      { kind: 'answer-key-section', sectionId: 'matching', title: 'Matching' },
      { kind: 'answer-key-entry', number: 2, letter: 'A' },
      { kind: 'answer-key-entry', number: 3, letter: null },
    ])
  })

  test('prints a Short Answer question’s Suggested Answer under its blank, never on the test', () => {
    const answer = [{ type: 'paragraph', content: [{ type: 'text', text: 'Chlorophyll breaks down.' }] }]
    const exam = examOf([
      { ...open('o1'), suggestedAnswer: { type: 'doc', content: answer } },
      // A blank answer is no answer: the key gives the question its line alone.
      { ...open('o2'), suggestedAnswer: { type: 'doc', content: [{ type: 'paragraph' }] } },
    ])
    const pages = planPages(exam, arrangementOf(['o1', 'o2']), unmeasured)
    const entries = pages
      .filter((page) => isAnswerKeyHeader(page.header))
      .flatMap((page) => page.items)
      .filter((item) => item.kind === 'answer-key-entry')
    expect(entries).toEqual([
      { kind: 'answer-key-entry', number: 1, letter: null, suggestedAnswer: answer },
      { kind: 'answer-key-entry', number: 2, letter: null },
    ])
    const printed = exportDocumentFingerprint(
      buildExportDocument(exam, arrangementOf(['o1', 'o2']), STUDENT_TEST),
    )
    expect(printed.test.join('\n')).not.toContain('Chlorophyll')
    expect(printed.answerKey).toContain('para Chlorophyll breaks down.')
  })

  test('lists free-response questions with a blank answer', () => {
    expect(keyItems(examOf([open('o1')]))).toContainEqual({
      kind: 'answer-key-entry',
      number: 1,
      letter: null,
    })
  })

  test('carries the title header and answer-section groupings on key pages', () => {
    const keyPages = planPages(
      examOf([multipleChoice('m1', ['a'], 'a'), open('o1')]),
      arrangementOf(),
      unmeasured,
    ).filter((page) => isAnswerKeyHeader(page.header))
    expect(keyPages.every((page) => isAnswerKeyHeader(page.header))).toBe(true)
    expect(keyPages[0]!.items).toEqual([
      { kind: 'answer-key-heading' },
      { kind: 'answer-key-section', sectionId: 'multiple-choice', title: 'Multiple Choice' },
      { kind: 'answer-key-entry', number: 1, letter: 'A' },
      { kind: 'answer-key-section', sectionId: 'open', title: 'Short Answer' },
      { kind: 'answer-key-entry', number: 2, letter: null },
    ])
  })

  test('repeats the title only on the first answer-key page', () => {
    const keyPages = planPages(
      examOf([open('o1'), open('o2'), open('o3')]),
      arrangementOf(),
      {
        // Just over half a page each, taken from the geometry rather than
        // written out, so one entry per page stays one entry per page if the
        // margins or the furniture are ever resized.
        itemHeight: (item) =>
          item.kind === 'answer-key-entry'
            ? pageContentHeight('answer-key-later') * 0.6
            : 0,
      },
    ).filter((page) => page.header.startsWith('answer-key'))

    expect(keyPages.length).toBeGreaterThan(1)
    expect(keyPages.map((page) => page.header)).toEqual([
      'answer-key',
      'answer-key-later',
      'answer-key-later',
    ])
    expect(keyPages.map((page) => page.number)).toEqual([1, 2, 3])
  })

  test('lists a question only once when its test rendering is split', () => {
    const question: Question = {
      ...open('o1'),
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
        ],
      },
    }
    const pages = planPages(
      examOf([question]),
      arrangementOf(),
      {
        itemHeight: (item) => item.kind === 'question' ? item.stem.length * 500 : 0,
      },
    )
    const entries = pages.flatMap((page) =>
      page.items.filter((item) => item.kind === 'answer-key-entry'),
    )
    expect(entries).toEqual([{ kind: 'answer-key-entry', number: 1, letter: null }])
  })
})

describe('content selection', () => {
  test('plans only the selected test and answer-key streams', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b'], 'a')])
    const arrangement = arrangementOf(['m1'])

    const testOnly = planExport({
      exam,
      arrangement,
      selection: { test: true, answerKey: false },
      measure: unmeasured,
    }).pages
    const keyOnly = planExport({
      exam,
      arrangement,
      selection: { test: false, answerKey: true },
      measure: unmeasured,
    }).pages

    expect(testOnly.length).toBeGreaterThan(0)
    expect(testOnly.every((page) => !isAnswerKeyHeader(page.header))).toBe(true)
    expect(keyOnly.length).toBeGreaterThan(0)
    expect(keyOnly.every((page) => isAnswerKeyHeader(page.header))).toBe(true)
  })

  test('numbers a standalone answer key from page one', () => {
    const exam = examOf([multipleChoice('m1', ['a', 'b'], 'a')])
    const keyOnly = planExport({
      exam,
      arrangement: arrangementOf(['m1']),
      selection: { test: false, answerKey: true },
      measure: unmeasured,
    })

    expect(keyOnly.pages[0]!.number).toBe(1)
    expect(keyOnly.pages[0]!.breakBefore).toBe(false)
  })
})

describe('page packing', () => {
  const FIRST_BOX = pageContentHeight('first')
  const LATER_BOX = pageContentHeight('later')

  /** An open question with `blocks` top-level paragraphs in its stem. */
  function tall(id: string, blocks: number): Question {
    return {
      id,
      type: 'open',
      doc: {
        type: 'doc',
        content: Array.from({ length: blocks }, (_unused, index) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: `${id} block ${index}` }],
        })),
      },
      columns: 2,
    }
  }

  /** A multiple-choice question with `blocks` stem paragraphs and two choices. */
  function tallChoice(id: string, blocks: number): Question {
    return {
      ...multipleChoice(id, ['a', 'b']),
      doc: {
        type: 'doc',
        content: [
          ...Array.from({ length: blocks }, (_unused, index) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: `${id} block ${index}` }],
          })),
          {
            type: 'multipleChoice',
            content: ['a', 'b'].map((cid) => choice(cid)),
          },
        ],
      },
    }
  }

  // Every stem block of question `id` is `blockHeight[id]` tall and its grid is
  // `gridHeight[id]` tall, so a piece's height follows from what it carries —
  // which is what makes splitting testable without a DOM. Section headings
  // take `chrome`.
  function stubHeights(
    blockHeight: Record<string, number>,
    gridHeight: Record<string, number> = {},
    chrome = 0,
  ): Measure {
    return {
      itemHeight: (item) => {
        if (item.kind !== 'question') return chrome
        const perBlock = blockHeight[item.question.id] ?? 0
        const grid = item.grid ? (gridHeight[item.question.id] ?? 0) : 0
        return item.stem.length * perBlock + grid
      },
    }
  }

  function questionItems(pages: PlannedPage[]): QuestionItem[] {
    return itemsOf(pages).flatMap((item) => (item.kind === 'question' ? [item] : []))
  }

  function pageShape(pages: PlannedPage[]): string[][] {
    return pages.map((page) =>
      page.items.map((item) =>
        item.kind === 'question' ? `q:${item.question.id}` : item.kind,
      ),
    )
  }

  test('a question that fits in the remaining space stays on the page, whole', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1)])
    const third = Math.floor(FIRST_BOX / 3)
    const pages = testPages(planPages(exam, arrangementOf(), stubHeights({ o1: third, o2: third })))
    expect(pageShape(pages)).toEqual([['section-heading', 'q:o1', 'q:o2']])
    expect(questionItems(pages).every((item) => item.numbered)).toBe(true)
  })

  test('a question that does not fit moves to the next page whole rather than straddling', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1)])
    const tooTall = Math.ceil(FIRST_BOX * 0.6)
    const pages = testPages(planPages(exam, arrangementOf(), stubHeights({ o1: tooTall, o2: tooTall })))
    expect(pageShape(pages)).toEqual([
      ['section-heading', 'q:o1'],
      ['q:o2'],
    ])
    // Whole means whole: the moved question still carries its number line and
    // every one of its stem blocks.
    const moved = questionItems(pages)[1]!
    expect(moved.numbered).toBe(true)
    expect(moved.stem).toHaveLength(1)
  })

  test('a question taller than a full content box splits at top-level block boundaries', () => {
    const exam = examOf([tall('o1', 10)])
    // Ten 100px blocks is 1000px: more than either content box.
    const pages = testPages(planPages(exam, arrangementOf(), stubHeights({ o1: 100 })))
    expect(pages).toHaveLength(2)
    const pieces = questionItems(pages)
    expect(pieces).toHaveLength(2)
    expect(pieces.map((piece) => piece.stem.length)).toEqual([
      Math.floor(FIRST_BOX / 100),
      10 - Math.floor(FIRST_BOX / 100),
    ])
    // The blocks come out in order, each printed exactly once.
    expect(pieces.flatMap((piece) => piece.stem)).toEqual(pieces[0]!.question.stem)
  })

  test('only the first piece of a split question carries the number line', () => {
    const pages = planPages(examOf([tall('o1', 10)]), arrangementOf(), stubHeights({ o1: 100 }))
    expect(questionItems(pages).map((piece) => piece.numbered)).toEqual([true, false])
  })

  test('a split never leaves a question number alone at the foot of a page', () => {
    // o1 all but fills page one; o2 is far too tall to fit anywhere whole, so
    // it must split — but its first piece cannot start in the 44px left over.
    const exam = examOf([tall('o1', 1), tall('o2', 12)])
    const pages = planPages(
      exam,
      arrangementOf(),
      stubHeights({ o1: FIRST_BOX - 44, o2: 100 }),
    )
    expect(pages[0]!.items.map((item) => item.kind)).toEqual([
      'section-heading',
      'question',
    ])
    for (const piece of questionItems(pages)) {
      if (piece.numbered) expect(piece.stem.length + (piece.grid ? 1 : 0)).toBeGreaterThan(0)
    }
  })

  test('a choice grid is never split, and travels whole on the last piece', () => {
    // Eight 100px stem blocks plus a 200px grid: 1000px in all.
    const exam = examOf([tallChoice('m1', 8)])
    const pages = planPages(exam, arrangementOf(), stubHeights({ m1: 100 }, { m1: 200 }))
    const pieces = questionItems(pages)
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.map((piece) => piece.grid !== null)).toEqual(
      pieces.map((_piece, index) => index === pieces.length - 1),
    )
    expect(pieces.at(-1)!.grid).toEqual(pieces[0]!.question.grid)
  })

  /** A matching set whose stem is `blocks` paragraphs long. */
  function tallSet(id: string, blocks: number): Question {
    const set = matching(id, ['', ''], ['a', 'b'])
    return {
      ...set,
      doc: {
        ...set.doc,
        content: [
          ...Array.from({ length: blocks }, (_unused, index) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: `${id} block ${index}` }],
          })),
          (set.doc.content as ProseMirrorJSON[]).at(-1)!,
        ],
      },
    }
  }

  test('a matching set is never split: its directions, items and word bank move together', () => {
    // The set opens the paper; the open question after it fills most of a
    // page. Neither the set's three stem blocks nor its columns come apart.
    const exam = examOf([tall('o1', 1), tallSet('x1', 3)])
    const pages = testPages(planPages(exam, arrangementOf(['o1', 'x1']), {
      itemHeight: (item) => {
        if (item.kind !== 'question') return 40
        if (item.question.id === 'o1') return Math.floor(FIRST_BOX * 0.8)
        return item.stem.length * 60 + (item.matching ? 300 : 0)
      },
    }))
    expect(pageShape(pages)).toEqual([
      ['section-heading', 'q:x1'],
      ['section-heading', 'q:o1'],
    ])
    const [piece] = questionItems(pages)
    expect(piece!.stem).toHaveLength(3)
    expect(piece!.matching).not.toBeNull()
  })

  test('a matching set that opens its section moves to the next page with its heading, whole', () => {
    // A multiple-choice question takes most of the first page. The Matching
    // heading and its set do not fit under it; the heading must not stay
    // behind with only the set's directions, nor alone.
    const exam = examOf([tallChoice('m1', 1), tallSet('x1', 2)])
    const pages = testPages(planPages(
      exam,
      arrangementOf(['m1', 'x1']),
      {
        itemHeight: (item) => {
          if (item.kind !== 'question') return 40
          if (item.question.id === 'm1') return Math.floor(FIRST_BOX * 0.85)
          return item.stem.length * 60 + (item.matching ? 300 : 0)
        },
      },
    ))
    expect(pageShape(pages)).toEqual([
      ['section-heading', 'q:m1'],
      ['section-heading', 'q:x1'],
    ])
    const set = questionItems(pages).find((item) => item.question.id === 'x1')!
    expect(set.stem).toHaveLength(2)
    expect(set.matching).not.toBeNull()
  })

  // A set too long for any page used to overflow its page whole, and print
  // clipped whatever ran past the foot. It breaks between its items instead,
  // and every piece carries the whole Word Bank, so no page of items is left
  // without the answers it is matched against.
  describe('a matching set taller than a page', () => {
    const bank = ['a1', 'a2', 'a3', 'a4']
    const long = matching('x1', Array.from({ length: 30 }, () => 'a1'), bank)
    // 100px an item, 200px for the bank beside them, 60px a stem block.
    const measure = {
      itemHeight: (item: PageItem) => {
        if (item.kind !== 'question') return 40
        return item.stem.length * 60 + (item.matching ? item.matching.prompts.length * 100 + 200 : 0)
      },
    }
    const pages = testPages(planPages(examOf([long]), arrangementOf(['x1']), measure))
    const pieces = questionItems(pages)

    test('breaks between its items onto as many pages as it needs', () => {
      expect(pieces.length).toBeGreaterThan(1)
      expect(pieces.map((piece) => piece.question.id).every((id) => id === 'x1')).toBe(true)
      // Every item exactly once, in order.
      expect(pieces.flatMap((piece) => piece.matching!.prompts.map((prompt) => prompt.number))).toEqual(
        Array.from({ length: 30 }, (_unused, index) => index + 1),
      )
    })

    test('fits every piece on its page', () => {
      for (const page of pages) {
        const used = page.items.reduce((sum, item) => sum + measure.itemHeight(item), 0)
        expect(used).toBeLessThanOrEqual(pageContentHeight(page.header))
      }
    })

    test('prints the whole Word Bank with every piece', () => {
      for (const piece of pieces) {
        expect(piece.matching!.bank.map((answer) => answer.id)).toEqual(pieces[0]!.matching!.bank.map((answer) => answer.id))
        expect(piece.matching!.bank).toHaveLength(bank.length)
      }
    })

    test('keeps its directions with its first items, and only there', () => {
      expect(pieces[0]!.stem).toHaveLength(1)
      expect(pieces[0]!.numbered).toBe(true)
      for (const piece of pieces.slice(1)) {
        expect(piece.stem).toEqual([])
        expect(piece.numbered).toBe(false)
      }
    })
  })

  test('the header variant is first on page one and later on every page after', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1), tall('o3', 1)])
    const perPage = Math.ceil(FIRST_BOX * 0.9)
    const pages = testPages(planPages(
      exam,
      arrangementOf(),
      stubHeights({ o1: perPage, o2: perPage, o3: perPage }),
    ))
    expect(pages.map((page) => page.header)).toEqual(['first', 'later', 'later'])
  })

  test('footers are numbered from one, in order', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1), tall('o3', 1)])
    const perPage = Math.ceil(FIRST_BOX * 0.9)
    const pages = testPages(planPages(
      exam,
      arrangementOf(),
      stubHeights({ o1: perPage, o2: perPage, o3: perPage }),
    ))
    expect(pages.map((page) => page.number)).toEqual([1, 2, 3])
  })

  test('later pages are taller, so a question that overflows page one can fit page two whole', () => {
    const exam = examOf([tall('o1', 1), tall('o2', 1)])
    // Taller than the first page's box, shorter than a later page's.
    const between = LATER_BOX
    const pages = testPages(planPages(exam, arrangementOf(), stubHeights({ o1: 10, o2: between })))
    expect(pageShape(pages)).toEqual([
      ['section-heading', 'q:o1'],
      ['q:o2'],
    ])
    expect(questionItems(pages)[1]!.stem).toHaveLength(1)
  })

  test('section headings take up room too', () => {
    const exam = examOf([tall('o1', 1)])
    const pages = testPages(planPages(
      exam,
      arrangementOf(),
      stubHeights({ o1: FIRST_BOX - 10 }, {}, 70),
    ))
    expect(pageShape(pages)).toEqual([
      ['section-heading'],
      ['q:o1'],
    ])
  })

  test('a section heading moves with its first question instead of being orphaned', () => {
    const chrome = 70
    const exam = examOf([tallChoice('m1', 1), tall('o1', 1)])
    const pages = testPages(planPages(
      exam,
      arrangementOf(),
      stubHeights(
        {
          // Leave enough room for the Short Answer heading, but not its first
          // question, after the Multiple Choice section.
          m1: FIRST_BOX - 2 * chrome - 10,
          o1: 100,
        },
        {},
        chrome,
      ),
    ))

    expect(pageShape(pages)).toEqual([
      ['section-heading', 'q:m1'],
      ['section-heading', 'q:o1'],
    ])
  })

  test('an unsplit question carries the whole question, so the page is the only thing that changed', () => {
    const pages = render(examOf([multipleChoice('m1', ['a', 'b'])]))
    const [item] = questionItems(pages)
    expect(item!.stem).toEqual(item!.question.stem)
    expect(item!.grid).toEqual(item!.question.grid)
    expect(item!.numbered).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The planning interface
//
// Everything below reads the plan the way an Export Adapter does: as a
// self-contained description of a document, with no exam, arrangement or `Measure`
// in reach.

describe('the Layout Plan', () => {
  const exam = examOf([multipleChoice('m1', ['a', 'b'], 'a'), open('o1')])
  const arrangement = { ...arrangementOf(['m1', 'o1']), letter: 'C' }

  function planOf(selection: ExportContentSelection = WHOLE_DOCUMENT) {
    return planExport({ exam, arrangement, selection, measure: unmeasured })
  }

  test('carries the document metadata an adapter needs', () => {
    const plan = planOf()
    expect(plan.title).toBe('Chemistry Unit 3')
    expect(plan.arrangement).toEqual({ id: 'v1', letter: 'C' })
  })

  test('is cut to US Letter at the geometry packing used', () => {
    expect(planOf().pageSize).toEqual({
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      margins: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN },
      contentWidth: PAGE_CONTENT_WIDTH,
    })
  })

  test('takes the Exam’s own margins, and packs and measures against them', () => {
    const margins = { top: 1.5, right: 1, bottom: 1.5, left: 1.25 }
    const widths = new Set<number | undefined>()
    const measure: Measure = {
      itemHeight: (item, layout) => {
        widths.add(layout?.contentWidth)
        return item.kind === 'question' ? 180 : 0
      },
    }
    const questions = ['a', 'b', 'c', 'd', 'e'].map((id) => open(id))
    const narrow = planExport({
      exam: { ...examOf(questions), margins },
      arrangement: arrangementOf(questions.map(({ id }) => id)),
      selection: STUDENT_TEST,
      measure,
    })
    expect(narrow.pageSize).toEqual({
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      margins: { top: 144, right: 96, bottom: 144, left: 120 },
      contentWidth: PAGE_WIDTH - 96 - 120,
    })
    expect([...widths]).toEqual([PAGE_WIDTH - 96 - 120])
    // 1056 - 288 = 768 tall; less the first page's header and the footer
    // leaves 648, which holds three 180px questions where today's 744 holds four.
    expect(pageContentHeight('first', narrow.pageSize)).toBe(768 - HEADER_HEIGHT.first - FOOTER_HEIGHT)
    expect(narrow.pages.map((page) => page.items.filter((item) => item.kind === 'question').length))
      .toEqual([3, 2])
    const usual = planExport({
      exam: examOf(questions),
      arrangement: arrangementOf(questions.map(({ id }) => id)),
      selection: STUDENT_TEST,
      measure,
    })
    expect(usual.pages.map((page) => page.items.filter((item) => item.kind === 'question').length))
      .toEqual([4, 1])
  })

  test('a plan an Export Record kept from before margins could be set reads as the same sheet', () => {
    const stored = { ...planOf(), pageSize: { width: 816, height: 1056, margin: 72, contentWidth: 672 } }
    expect(readStoredLayoutPlan(stored as unknown as LayoutPlan).pageSize).toEqual(planOf().pageSize)
  })

  test('a plan recorded before the Paper Style was renamed keeps its style', () => {
    const stored = { ...planOf(), questionStyle: 'condensed' }
    const read = readStoredLayoutPlan(stored as unknown as LayoutPlan)
    expect(read.paperStyle).toBe('condensed')
    expect(read).not.toHaveProperty('questionStyle')
  })

  test('marks an explicit break before every page but the first', () => {
    const pages = planOf().pages
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.map((page) => page.breakBefore)).toEqual([
      false,
      ...pages.slice(1).map(() => true),
    ])
  })

  test('names each page’s stream, so the key is a document rather than a tail', () => {
    const pages = planOf().pages
    expect(pages.map((page) => page.stream)).toEqual(['test', 'answer-key'])
    expect(pages.map((page) => page.furniture.pageNumber)).toEqual([1, 1])
  })

  test('decides page furniture once, for both adapters to print', () => {
    const [testPage, keyPage] = planOf().pages
    expect(testPage!.furniture).toEqual({
      identityFields: ['Name', 'Class', 'Date'],
      identityLine: DEFAULT_HEADER.first,
      title: 'Chemistry Unit 3',
      arrangementLabel: '',
      pageNumber: 1,
    })
    // The key is the teacher's copy: nothing for a student to fill in.
    expect(keyPage!.furniture.identityFields).toEqual([])
    expect(keyPage!.furniture.identityLine).toBeUndefined()
    expect(keyPage!.furniture.arrangementLabel).toBe('')
  })

  test('names a shuffled Version on every page of the test and the key', () => {
    const tall: Measure = {
      itemHeight: (item) => (item.kind === 'question' ? 600 : 0),
    }
    const plan = planExport({
      exam,
      arrangement,
      selection: WHOLE_DOCUMENT,
      measure: tall,
      version: 'Curly Fox',
    })
    expect(plan.arrangement.version).toBe('Curly Fox')
    expect(new Set(plan.pages.map((page) => page.stream))).toEqual(new Set(['test', 'answer-key']))
    expect(plan.pages.length).toBeGreaterThan(2)
    expect(plan.pages.every((page) => page.furniture.arrangementLabel === 'Curly Fox')).toBe(true)
  })

  test('drops the title on a continuation page but never the arrangement', () => {
    const tall: Measure = {
      itemHeight: (item) => (item.kind === 'question' ? 600 : 0),
    }
    const pages = planExport({
      exam,
      arrangement,
      selection: { test: true, answerKey: false },
      measure: tall,
    }).pages
    expect(pages.length).toBe(2)
    expect(pages[1]!.furniture).toEqual({
      identityFields: ['Name'],
      identityLine: DEFAULT_HEADER.later,
      title: null,
      arrangementLabel: '',
      pageNumber: 2,
    })
  })

  test('lays out only the documents the selection asks for', () => {
    expect(planOf({ test: true, answerKey: false }).pages.map((page) => page.stream))
      .toEqual(['test'])
    expect(planOf({ test: false, answerKey: true }).pages.map((page) => page.stream))
      .toEqual(['answer-key'])
    expect(planOf({ test: false, answerKey: false }).pages).toEqual([])
  })

  test('reports the selection it was planned for', () => {
    expect(planOf(STUDENT_TEST).selection).toEqual({ test: true, answerKey: false })
  })
})

describe('the Export Document', () => {
  const exam = examOf([multipleChoice('m1', ['a', 'b'], 'b'), open('o1')])
  const arrangement = arrangementOf(['m1', 'o1'])

  test('derives both documents whatever the selection', () => {
    const document = buildExportDocument(exam, arrangement, STUDENT_TEST)
    expect(document.test.length).toBeGreaterThan(0)
    expect(document.answerKey.length).toBeGreaterThan(0)
    expect(document.selection).toEqual(STUDENT_TEST)
  })

  test('derives the key from the numbered, lettered questions the test shows', () => {
    const document = buildExportDocument(exam, arrangement, STUDENT_TEST)
    expect(document.answerKey).toEqual([
      { kind: 'answer-key-heading' },
      {
        kind: 'answer-key-section',
        sectionId: 'multiple-choice',
        title: SECTION_TITLE['multiple-choice'],
      },
      { kind: 'answer-key-entry', number: 1, letter: 'B' },
      { kind: 'answer-key-section', sectionId: 'open', title: SECTION_TITLE.open },
      { kind: 'answer-key-entry', number: 2, letter: null },
    ])
  })
})

describe('work space', () => {
  const LATER_BOX = pageContentHeight('later')
  const FIRST_BOX = pageContentHeight('first')

  /** An open question with `blocks` top-level paragraphs in its stem. */
  function openBlocks(id: string, blocks: number): Question {
    return {
      ...open(id),
      doc: {
        type: 'doc',
        content: Array.from({ length: blocks }, (_unused, index) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: `${id} block ${index}` }],
        })),
      },
    }
  }

  // Every stem block is `block` tall, a section heading `heading` tall, and a
  // piece carrying a work space is that much taller — the height the print
  // markup gives it, since the space is drawn at exactly its planned height.
  function measured(block: number, heading = 0): Measure {
    return {
      itemHeight: (item) => {
        if (item.kind !== 'question') return heading
        return item.stem.length * block + (item.workSpace?.height ?? 0)
      },
    }
  }

  function questionItems(pages: PlannedPage[]): QuestionItem[] {
    return itemsOf(pages).flatMap((item) => (item.kind === 'question' ? [item] : []))
  }

  function pageShape(pages: PlannedPage[]): string[][] {
    return pages.map((page) =>
      page.items.map((item) =>
        item.kind === 'question' ? `q:${item.question.id}` : item.kind,
      ),
    )
  }

  function snap(height: number): number {
    return Math.floor(height / 32) * 32
  }

  test('a Short Answer question carries the room its Exam gives it, its first row shorter than the pitch', () => {
    const exam: Exam = {
      ...examOf([open('q1'), open('q2')]),
      workSpace: {
        q1: { height: 160, style: 'lines', fill: false },
        q2: { height: 96, style: 'blank', fill: false },
      },
    }
    const [first, second] = questionItems(render(exam))
    // Five rows: the first 24px, so its rule sits close under the stem, and
    // four more a 32px pitch apart.
    expect(first!.workSpace).toEqual({ height: 152, style: 'lines', lines: 5, fill: false, pitch: 32, firstRow: 24 })
    // Blank room is laid out in the same rows, so switching never moves a thing.
    expect(second!.workSpace).toEqual({ height: 88, style: 'blank', lines: 0, fill: false, pitch: 32, firstRow: 24 })
  })

  test('a Short Answer question with no room still carries a zero-height space to drag open', () => {
    const [item] = questionItems(render(examOf([open('q1')])))
    expect(item!.workSpace).toMatchObject({ height: 0, style: 'blank', lines: 0, fill: false })
  })

  test('no other Question Type carries a work space, even when the Exam names one', () => {
    const exam: Exam = {
      ...examOf([multipleChoice('mc', ['a', 'b']), trueFalse('tf')]),
      workSpace: { mc: { height: 160, style: 'lines', fill: false } },
    }
    for (const item of questionItems(render(exam))) {
      expect(item.workSpace).toBeNull()
      expect(item.question.workSpace).toBeNull()
    }
  })

  test('the room counts toward packing, so a question moves on whole with its space', () => {
    // Two blocks of stem and 400px of room is 600px: the second question no
    // longer fits under the first on the first page.
    const exam: Exam = {
      ...examOf([openBlocks('q1', 2), openBlocks('q2', 2)]),
      workSpace: {
        q1: { height: 400, style: 'blank', fill: false },
        q2: { height: 400, style: 'blank', fill: false },
      },
    }
    const pages = testPages(planPages(exam, arrangementOf(), measured(100)))
    expect(pageShape(pages)).toEqual([['section-heading', 'q:q1'], ['q:q2']])
  })

  test('a space that fills its page grows to the foot of it, and the next question starts a new page', () => {
    const exam: Exam = {
      ...examOf([openBlocks('q1', 1), openBlocks('q2', 1), openBlocks('q3', 1)]),
      workSpace: { q1: { height: 64, style: 'lines', fill: true } },
    }
    const pages = testPages(planPages(exam, arrangementOf(), measured(100, 50)))
    expect(pageShape(pages)).toEqual([['section-heading', 'q:q1'], ['q:q2', 'q:q3']])
    const [filled] = questionItems(pages)
    const expected = 64 + Math.floor(FIRST_BOX - 50 - 100 - 64 - 1)
    expect(filled!.workSpace!.height).toBe(expected)
    expect(filled!.workSpace!.lines).toBe(1 + Math.floor((expected - 24) / 32))
    expect(50 + 100 + filled!.workSpace!.height).toBeLessThanOrEqual(FIRST_BOX)
  })

  test('a filling space that does not fit where it is moves on whole and fills the next page', () => {
    const exam: Exam = {
      ...examOf([openBlocks('q1', 1), openBlocks('q2', 1), openBlocks('q3', 1)]),
      workSpace: {
        q1: { height: snap(FIRST_BOX - 200), style: 'blank', fill: false },
        q2: { height: 192, style: 'blank', fill: true },
      },
    }
    const pages = testPages(planPages(exam, arrangementOf(), measured(100)))
    expect(pageShape(pages)).toEqual([['section-heading', 'q:q1'], ['q:q2'], ['q:q3']])
    const second = questionItems(pages)[1]!
    expect(100 + second.workSpace!.height).toBeGreaterThan(LATER_BOX - 2)
    expect(100 + second.workSpace!.height).toBeLessThanOrEqual(LATER_BOX)
  })

  test('the last question on the test may fill its page without adding a blank one', () => {
    const exam: Exam = {
      ...examOf([openBlocks('q1', 1)]),
      workSpace: { q1: { height: 0, style: 'blank', fill: true } },
    }
    expect(testPages(planPages(exam, arrangementOf(), measured(100)))).toHaveLength(1)
  })

  test('a question too tall for any page keeps its space on its last piece', () => {
    const exam: Exam = {
      ...examOf([openBlocks('q1', 12)]),
      workSpace: { q1: { height: 128, style: 'lines', fill: false } },
    }
    const pieces = questionItems(testPages(planPages(exam, arrangementOf(), measured(100))))
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.slice(0, -1).every((piece) => piece.workSpace === null)).toBe(true)
    expect(pieces.at(-1)!.workSpace).toMatchObject({ height: 120, style: 'lines', lines: 4, fill: false })
  })

  test('the answer key is unaffected by work space', () => {
    const exam: Exam = {
      ...examOf([openBlocks('q1', 1)]),
      workSpace: { q1: { height: 64, style: 'lines', fill: true } },
    }
    const key = planPages(exam, arrangementOf(), measured(100))
      .filter((page) => isAnswerKeyHeader(page.header))
    expect(itemsOf(key).map((item) => item.kind)).toEqual([
      'answer-key-heading', 'answer-key-section', 'answer-key-entry',
    ])
  })
})

describe('section headings as the Exam words them', () => {
  const headingsOf = (exam: Exam) =>
    itemsOf(render(exam)).filter((item) => item.kind === 'section-heading')

  test('print the defaults, at no stated size, on an Exam that changed nothing', () => {
    expect(headingsOf(examOf([open('o1')]))).toEqual([{
      kind: 'section-heading',
      sectionId: 'open',
      title: 'Short Answer',
      instructions: 'Answer the following questions in the space provided. Show all work.',
      keepWithNext: true,
    }])
  })

  test('print the Exam’s own wording and size', () => {
    const exam: Exam = {
      ...examOf([open('o1')]),
      sectionHeadings: { open: { title: 'Essays', instructions: '' } },
      headingSize: 'large',
    }
    expect(headingsOf(exam)).toEqual([{
      kind: 'section-heading',
      sectionId: 'open',
      title: 'Essays',
      instructions: '',
      keepWithNext: true,
      size: 'large',
    }])
  })

  test('keep a heading cleared of both in the plan, so the sheet can restore it', () => {
    const exam: Exam = {
      ...examOf([open('o1')]),
      sectionHeadings: { open: { title: '', instructions: '' } },
    }
    expect(headingsOf(exam)).toHaveLength(1)
  })

  test('name the answer key’s groups as the test does, or by place when cleared', () => {
    const exam: Exam = {
      ...examOf([open('o1'), multipleChoice('m1', ['a', 'b'], 'a')]),
      sectionHeadings: {
        open: { title: '' },
        'multiple-choice': { title: 'Choose One' },
      },
    }
    const titles = planPages(exam, arrangementOf(), unmeasured)
      .filter((page) => isAnswerKeyHeader(page.header))
      .flatMap((page) => page.items)
      .flatMap((item) => (item.kind === 'answer-key-section' ? [item.title] : []))
    expect(titles).toEqual(['Choose One', 'Section 1'])
  })
})

describe('stored Question Sections', () => {
  // Two Sections worded for Multiple Choice around one worded for Short
  // Answer, and an emptied True/False one after them all.
  const exam: Exam = {
    ...examOf([
      multipleChoice('m1', ['a', 'b'], 'a'),
      open('o1'),
      multipleChoice('m2', ['a', 'b'], 'b'),
    ]),
    sections: [
      { id: 'A', title: 'Warm Up', instructions: SECTION_INSTRUCTIONS['multiple-choice'] },
      { id: 'B', title: SECTION_TITLE.open, instructions: SECTION_INSTRUCTIONS.open },
      { id: 'C', title: '', instructions: SECTION_INSTRUCTIONS['multiple-choice'] },
      { id: 'D', title: SECTION_TITLE['true-false'], instructions: SECTION_INSTRUCTIONS['true-false'] },
    ],
    sectionOf: { m1: 'A', o1: 'B', m2: 'C' },
  }
  const arrangement = arrangementOf(['m1', 'o1', 'm2'])

  test('print in the Exam’s own order, numbered straight through, each under its own wording', () => {
    const pages = render(exam, arrangement)
    expect(
      headings(pages).map((item) =>
        item.kind === 'section-heading' ? [item.sectionId, item.title] : [],
      ),
    ).toEqual([
      ['A', 'Warm Up'],
      ['B', 'Short Answer'],
      ['C', ''],
      ['D', 'True/False'],
    ])
    expect(plannedQuestions(pages).map(({ id, number }) => [id, number])).toEqual([
      ['m1', 1],
      ['o1', 2],
      ['m2', 3],
    ])
  })

  test('a Section of mixed types prints under one heading, in the arrangement’s order', () => {
    const mixed: Exam = {
      ...exam,
      questions: [...exam.questions, trueFalse('t1', 'false')],
      sections: exam.sections!.slice(0, 1),
      sectionOf: { m1: 'A', o1: 'A', m2: 'A', t1: 'A' },
    }
    const pages = render(mixed, arrangementOf(['o1', 't1', 'm2', 'm1']))
    expect(
      headings(pages).map((item) => (item.kind === 'section-heading' ? item.sectionId : null)),
    ).toEqual(['A'])
    expect(plannedQuestions(pages).map(({ id, number }) => [id, number])).toEqual([
      ['o1', 1],
      ['t1', 2],
      ['m2', 3],
      ['m1', 4],
    ])
    expect(buildExportDocument(mixed, arrangementOf(['o1', 't1', 'm2', 'm1']), WHOLE_DOCUMENT).answerKey)
      .toEqual([
        { kind: 'answer-key-heading' },
        { kind: 'answer-key-section', sectionId: 'A', title: 'Warm Up' },
        { kind: 'answer-key-entry', number: 1, letter: null },
        { kind: 'answer-key-entry', number: 2, letter: 'F' },
        { kind: 'answer-key-entry', number: 3, letter: 'B' },
        { kind: 'answer-key-entry', number: 4, letter: 'A' },
      ])
  })

  test('an empty Section prints its heading and directions, but has no group in the answer key', () => {
    const document = buildExportDocument(exam, arrangement, WHOLE_DOCUMENT)
    expect(
      document.test.some((item) => item.kind === 'section-heading' && item.sectionId === 'D'),
    ).toBe(true)
    expect(
      document.answerKey.some((item) => item.kind === 'answer-key-section' && item.sectionId === 'D'),
    ).toBe(false)
  })

  test('the sheet and the export plan an empty Section alike, marked as empty', () => {
    const sheet = planExport({
      exam,
      arrangement,
      selection: STUDENT_TEST,
      measure: unmeasured,
    })
    const planned = sheet.pages
      .flatMap((page) => page.items)
      .flatMap((item) => (item.kind === 'section-heading' ? [item] : []))
    expect(planned.map(({ sectionId }) => sectionId)).toEqual(['A', 'B', 'C', 'D'])
    expect(planned.filter(({ empty }) => empty).map(({ sectionId }) => sectionId)).toEqual(['D'])
    expect(planned.at(-1)).toMatchObject({
      sectionId: 'D',
      title: 'True/False',
      instructions: 'Circle T if the statement is true and F if it is false.',
    })
  })

  test('the answer key groups by Section, under the test’s titles or, when cleared, by place', () => {
    const document = buildExportDocument(exam, arrangement, WHOLE_DOCUMENT)
    expect(document.answerKey).toEqual([
      { kind: 'answer-key-heading' },
      { kind: 'answer-key-section', sectionId: 'A', title: 'Warm Up' },
      { kind: 'answer-key-entry', number: 1, letter: 'A' },
      { kind: 'answer-key-section', sectionId: 'B', title: 'Short Answer' },
      { kind: 'answer-key-entry', number: 2, letter: null },
      { kind: 'answer-key-section', sectionId: 'C', title: 'Section 1' },
      { kind: 'answer-key-entry', number: 3, letter: 'B' },
    ])
  })

  test('each cleared heading is named by its place among the cleared ones', () => {
    const cleared: Exam = {
      ...exam,
      sections: [
        { id: 'A', title: '', instructions: '' },
        { id: 'B', title: 'Essays', instructions: '' },
        { id: 'C', title: '', instructions: SECTION_INSTRUCTIONS['multiple-choice'] },
      ],
    }
    const groups = buildExportDocument(cleared, arrangement, WHOLE_DOCUMENT).answerKey
      .flatMap((item) => (item.kind === 'answer-key-section' ? [[item.sectionId, item.title]] : []))
    expect(groups).toEqual([
      ['A', 'Section 1'],
      ['B', 'Essays'],
      ['C', 'Section 2'],
    ])
  })

  test('two adjacent Sections worded alike are still two groups in the key', () => {
    const adjacent: Exam = {
      ...exam,
      sections: [
        { id: 'A', title: SECTION_TITLE['multiple-choice'], instructions: '' },
        { id: 'C', title: 'Bonus', instructions: '' },
        { id: 'B', title: SECTION_TITLE.open, instructions: '' },
      ],
    }
    const groups = buildExportDocument(adjacent, arrangement, WHOLE_DOCUMENT).answerKey
      .flatMap((item) => (item.kind === 'answer-key-section' ? [[item.sectionId, item.title]] : []))
    expect(groups).toEqual([
      ['A', 'Multiple Choice'],
      ['C', 'Bonus'],
      ['B', 'Short Answer'],
    ])
  })
})

describe('a title that wraps', () => {
  // Every item 100px tall, and a title of `lines` lines.
  const wrapping = (lines: number): Measure => ({ itemHeight: () => 100, titleLines: () => lines })
  const exam = (count: number): Exam => ({
    ...examOf(Array.from({ length: count }, (_unused, index) => open(`q${index}`))),
    title: 'A title long enough that the sheet must set it on more than one line',
  })

  test('grows the header of every page that prints it by a title line for each line past the first', () => {
    const pages = planPages(exam(1), arrangementOf(), wrapping(3))
    const growth = Math.ceil(2 * TITLE_PX.normal * TITLE_LINE_HEIGHT)
    for (const page of pages) {
      const printsTitle = page.header === 'first' || page.header === 'answer-key'
      expect(page.furniture.titleLines).toBe(printsTitle ? 3 : undefined)
      expect(headerHeightOf(page.header, page.furniture)).toBe(HEADER_HEIGHT[page.header] + (printsTitle ? growth : 0))
    }
    // At a larger heading size, each line is taller.
    const large = planExport({
      exam: { ...exam(1), headingSize: 'large' },
      arrangement: arrangementOf(),
      selection: WHOLE_DOCUMENT,
      measure: wrapping(2),
    }).pages[0]!
    expect(headerHeightOf(large.header, large.furniture)).toBe(HEADER_HEIGHT.first + Math.ceil(TITLE_PX.large * TITLE_LINE_HEIGHT))
  })

  test('leaves its first page, and the key’s, less room to pack, so what follows moves on', () => {
    // Items exactly as tall as fill a first page's room eight times over.
    const height = pageContentHeight('first') / 8
    const measure = (lines: number): Measure => ({ itemHeight: () => height, titleLines: () => lines })
    expect(testPages(planPages(exam(12), arrangementOf(), measure(1)))[0]!.items).toHaveLength(8)
    expect(testPages(planPages(exam(12), arrangementOf(), measure(3)))[0]!.items).toHaveLength(7)
    // Later pages, which do not print it, keep their room.
    expect(pageContentHeight('later', undefined, 60)).toBe(pageContentHeight('later'))
    expect(pageContentHeight('first', undefined, 60)).toBe(pageContentHeight('first') - 60)
    expect(pageContentHeight('answer-key', undefined, 60)).toBe(pageContentHeight('answer-key') - 60)
  })

  test('changes nothing on one line, or when nothing measures it', () => {
    for (const measure of [wrapping(1), { itemHeight: () => 100 }]) {
      const [first] = planPages(exam(1), arrangementOf(), measure)
      expect(first!.furniture).not.toHaveProperty('titleLines')
      expect(headerHeightOf(first!.header, first!.furniture)).toBe(HEADER_HEIGHT.first)
    }
  })
})

describe('a Work Space’s rows', () => {
  const rows = workSpaceRows()

  test('lie a pitch apart, the first a quarter shorter, so its rule sits close under the question', () => {
    expect(rows).toEqual({ pitch: 32, first: 24 })
    expect(workSpaceRows(24)).toEqual({ pitch: 24, first: 18 })
    expect(laidWorkSpaceHeight(0, rows)).toBe(0)
    expect(laidWorkSpaceHeight(32, rows)).toBe(24)
    expect(laidWorkSpaceHeight(96, rows)).toBe(24 + 32 + 32)
    expect(laidWorkSpaceHeight(96, workSpaceRows(24))).toBe(18 + 24 + 24)
  })

  test('count back from a height on the page, which is how a dragged height is stored', () => {
    for (const pitch of [32, 24]) {
      const laid = workSpaceRows(pitch)
      for (const stored of [0, 32, 64, 96, 320]) {
        expect(storedWorkSpaceHeight(laidWorkSpaceHeight(stored, laid), laid)).toBe(stored)
        expect(rowsIn(laidWorkSpaceHeight(stored, laid), laid)).toBe(stored / 32)
      }
    }
    // A drag snaps to the nearest whole row, and no further than the page allows.
    expect(storedWorkSpaceHeight(24 + 32 + 10, rows)).toBe(64)
    expect(storedWorkSpaceHeight(24 + 32 + 20, rows)).toBe(96)
    expect(storedWorkSpaceHeight(5, rows)).toBe(0)
    expect(storedWorkSpaceHeight(10_000, rows, 24 + 32 * 9)).toBe(320)
  })
})
