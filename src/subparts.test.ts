import { describe, expect, test } from 'bun:test'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import {
  answeringPartsOf,
  duplicateQuestion,
  partById,
  partsOf,
  presentationIdsOf,
  shuffleSelectedAnswers,
  DEFAULT_COLUMNS,
  type Arrangement,
  type Exam,
  type Question,
} from './exam'
import { cleanDocument, type ProseMirrorJSON } from './question-doc'
import {
  buildExportDocument,
  pageContentHeight,
  planExport,
  subpartLabelAt,
  STUDENT_TEST,
  type AnswerKeyEntryItem,
  type Measure,
  type QuestionItem,
} from './export-plan'
import { ANSWER_RULE, copyBlocksOf, copyTextOf } from './question-copy'
import { searchableText } from './stem-preview'
import { readingOfQuestion } from './question-reading-content'
import { createMemoryBackend, loadExamStore, type AuthoringState, type SavedState } from './exam-store'
import {
  addPart,
  addSubparts,
  deleteSubpart,
  movePartTo,
  partKindOf,
  setPartKind,
} from './multipart'

// A Part that holds Subparts, one level deep (ADR-0043): invented material
// throughout, as every fixture in this repository is.

function paragraph(text: string): ProseMirrorJSON {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function choice(id: string, correct = false): ProseMirrorJSON {
  return { type: 'multipleChoiceChoice', attrs: { id, correct }, content: [paragraph(id)] }
}

function answering(
  type: 'multipartPart' | 'multipartSubpart',
  id: string,
  answer: ProseMirrorJSON,
  columns = 2,
): ProseMirrorJSON {
  return {
    type,
    attrs: { id, columns },
    content: [{ type: 'multipartPartStem', content: [paragraph(`stem ${id}`)] }, answer],
  }
}

const mc = (...ids: string[]): ProseMirrorJSON => ({
  type: 'multipleChoice',
  content: ids.map((id, index) => choice(id, index === 0)),
})
const sa = (text?: string): ProseMirrorJSON => ({
  type: 'suggestedAnswer',
  content: [text ? paragraph(text) : { type: 'paragraph' }],
})

function holding(id: string, subparts: ProseMirrorJSON[]): ProseMirrorJSON {
  return {
    type: 'multipartPart',
    attrs: { id, columns: 2 },
    content: [
      { type: 'multipartPartStem', content: [paragraph(`lead-in ${id}`)] },
      { type: 'multipartSubparts', content: subparts },
    ],
  }
}

function multipart(id: string, parts: ProseMirrorJSON[]): Question {
  return {
    id,
    type: 'multipart',
    columns: DEFAULT_COLUMNS,
    doc: { type: 'doc', content: [paragraph('A table of results.'), { type: 'multipartParts', content: parts }] },
  }
}

function arrangementOf(questionOrder: string[], choiceOrder: Record<string, string[]> = {}): Arrangement {
  return { id: 'v', letter: 'A', questionOrder, choiceOrder }
}

/** A pond survey: Part a answers; Part b leads in to three Subparts. */
const survey = () =>
  multipart('q', [
    answering('multipartPart', 'a', mc('a1', 'a2')),
    holding('b', [
      answering('multipartSubpart', 'b-i', mc('bi1', 'bi2', 'bi3'), 1),
      answering('multipartSubpart', 'b-ii', sa('More frogs in spring.')),
      answering('multipartSubpart', 'b-iii', sa()),
    ]),
  ])

describe('a Part that holds Subparts', () => {
  test('reads as a lead-in with its Subparts, each answering as a Part does', () => {
    const [a, b] = partsOf(survey())
    expect(a).toMatchObject({ id: 'a', type: 'multiple-choice', subparts: [] })
    expect(b!.type).toBe('subparts')
    expect(b!.stem).toEqual([paragraph('lead-in b')])
    expect(b!.choices).toEqual([])
    expect(b!.suggestedAnswer).toBeUndefined()
    expect(b!.subparts.map((subpart) => [subpart.id, subpart.type, subpart.columns])).toEqual([
      ['b-i', 'multiple-choice', 1],
      ['b-ii', 'open', 2],
      ['b-iii', 'open', 2],
    ])
    expect(b!.subparts[1]!.suggestedAnswer).toEqual({ type: 'doc', content: [paragraph('More frogs in spring.')] })
    expect(b!.subparts[2]!.suggestedAnswer).toBeUndefined()
  })

  test('what a student answers is each answering Part, and each Subpart in place of its Part', () => {
    expect(answeringPartsOf(survey()).map(({ id }) => id)).toEqual(['a', 'b-i', 'b-ii', 'b-iii'])
  })

  test('files presentation under every Part and Subpart', () => {
    expect(presentationIdsOf(survey())).toEqual(['q', 'a', 'b', 'b-i', 'b-ii', 'b-iii'])
  })

  test('finds a Subpart by its id, and never the Part that holds it', () => {
    const exam: Exam = { title: 'T', questions: [survey()] }
    expect(partById(exam, 'b-ii')?.part.type).toBe('open')
    expect(partById(exam, 'b')).toBeUndefined()
  })

  test('Vary shuffles a Multiple Choice Subpart’s answers under its own id, and never moves Subparts', () => {
    const exam: Exam = { title: 'T', questions: [survey()] }
    const shuffled = shuffleSelectedAnswers(exam, arrangementOf(['q']), ['q'], () => 0)
    expect(Object.keys(shuffled.choiceOrder).sort()).toEqual(['a', 'b-i'])
    expect([...shuffled.choiceOrder['b-i']!].sort()).toEqual(['bi1', 'bi2', 'bi3'])
    expect(shuffled.choiceOrder['b-i']).not.toEqual(['bi1', 'bi2', 'bi3'])
  })

  test('a duplicate gives every Subpart and its answers fresh ids', () => {
    const copy = partsOf(duplicateQuestion(survey()))[1]!
    expect(copy.type).toBe('subparts')
    expect(copy.subparts).toHaveLength(3)
    expect(copy.subparts.map(({ id }) => id)).not.toContain('b-i')
    expect(copy.subparts[0]!.choices.map(({ id }) => id)).not.toContain('bi1')
  })

  test('a stored document cleans to the same shape, and an empty Subparts box loads as a Multiple Choice Part', () => {
    expect(cleanDocument(survey().doc)).toEqual(survey().doc)
    const cleaned = cleanDocument(multipart('q', [holding('b', [])]).doc)
    const [part] = partsOf({ ...survey(), doc: cleaned })
    expect(part?.type).toBe('multiple-choice')
    expect(part?.subparts).toEqual([])
  })

  test('a Subpart never holds Subparts of its own: a nested box is dropped on load', () => {
    const nested = answering('multipartSubpart', 'b-i', {
      type: 'multipartSubparts',
      content: [answering('multipartSubpart', 'deep', sa())],
    })
    const cleaned = cleanDocument(multipart('q', [holding('b', [nested])]).doc)
    const [part] = partsOf({ ...survey(), doc: cleaned })
    expect(part?.subparts.map(({ id, type }) => [id, type])).toEqual([['b-i', 'multiple-choice']])
  })
})

describe('editing Subparts', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'multipartParts' },
      text: { group: 'inline' },
      paragraph: { group: 'block', content: 'inline*' },
      multipleChoiceChoice: {
        content: 'paragraph block*',
        attrs: { correct: { default: false }, id: { default: '' } },
      },
      multipleChoice: { content: 'multipleChoiceChoice+' },
      suggestedAnswer: { content: 'block+' },
      multipartPartStem: { content: 'block+' },
      multipartPart: {
        content: 'multipartPartStem (multipleChoice | suggestedAnswer | multipartSubparts)',
        attrs: { id: { default: '' }, columns: { default: 2 } },
      },
      multipartSubpart: {
        content: 'multipartPartStem (multipleChoice | suggestedAnswer)',
        attrs: { id: { default: '' }, columns: { default: 2 } },
      },
      multipartSubparts: { content: 'multipartSubpart+' },
      multipartParts: { content: 'multipartPart*' },
    },
  })

  function editorWith(part: ProseMirrorJSON) {
    let state = EditorState.create({
      schema,
      doc: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'multipartParts', content: [part] }] }),
    })
    const view = {
      get state() { return state },
      dispatch(transaction: Parameters<typeof state.apply>[0]) { state = state.apply(transaction) },
    }
    // The document's one Part sits just inside the Parts box; its Subparts
    // box, when it has one, just after its stem.
    const part0 = () => view.state.doc.nodeAt(1)!
    const boxAt = () => 1 + 1 + part0().firstChild!.nodeSize
    const subpartAt = (index: number) => {
      let pos = boxAt() + 1
      for (let i = 0; i < index; i += 1) pos += part0().lastChild!.child(i).nodeSize
      return pos
    }
    return { view, part: part0, boxAt, subpartAt }
  }

  test('Add Subparts makes the Part a lead-in, and its answers Subpart (i), losing nothing typed', () => {
    const { view, part } = editorWith(answering('multipartPart', 'p', mc('x', 'y'), 4))
    expect(addSubparts(view, 1)).toBe(true)
    expect(partKindOf(part())).toBe('subparts')
    expect(part().firstChild!.textContent).toBe('stem p')
    const box = part().lastChild!
    expect(box.type.name).toBe('multipartSubparts')
    expect(box.childCount).toBe(1)
    const first = box.firstChild!
    expect(partKindOf(first)).toBe('multiple-choice')
    expect(first.lastChild!.textContent).toBe('xy')
    expect(first.firstChild!.textContent).toBe('')
    // Subpart (i) carries on as what the Part was, so what an Exam set for
    // it follows; the Part becomes something new.
    expect(first.attrs).toEqual({ id: 'p', columns: 4 })
    expect(part().attrs.id).not.toBe('p')
    // The cursor is in Subpart (i)'s stem.
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(view.state.selection.$from.node(-1).type.name).toBe('multipartPartStem')
    expect(view.state.selection.$from.node(-2).type.name).toBe('multipartSubpart')
    expect(addSubparts(view, 1)).toBe(false)
  })

  test('a Part that holds Subparts has no kind of answer to switch, but its Subparts do', () => {
    const { view, part, subpartAt } = editorWith(holding('p', [answering('multipartSubpart', 's1', mc('x', 'y'))]))
    expect(setPartKind(view, 1, 'open')).toBe(false)
    expect(setPartKind(view, subpartAt(0), 'open')).toBe(true)
    expect(partKindOf(part().lastChild!.firstChild!)).toBe('open')
  })

  test('Subparts are added after the last, and move among themselves', () => {
    const { view, part, boxAt, subpartAt } = editorWith(holding('p', [answering('multipartSubpart', 's1', sa())]))
    expect(addPart(view, boxAt(), 'multiple-choice')).toBe(true)
    expect(addPart(view, boxAt(), 'open')).toBe(true)
    const kinds = () => Array.from({ length: part().lastChild!.childCount }, (_, i) => partKindOf(part().lastChild!.child(i)))
    expect(kinds()).toEqual(['open', 'multiple-choice', 'open'])
    expect(part().lastChild!.child(1).type.name).toBe('multipartSubpart')
    expect(movePartTo(view, subpartAt(1), 0)).toBe(true)
    expect(kinds()).toEqual(['multiple-choice', 'open', 'open'])
    expect(part().lastChild!.child(1).attrs.id).toBe('s1')
  })

  test('deleting a Subpart leaves the rest; deleting the last makes the Part answer with its answers', () => {
    const { view, part, subpartAt } = editorWith(holding('p', [
      answering('multipartSubpart', 's1', mc('x', 'y'), 1),
      answering('multipartSubpart', 's2', sa('Warmer water.')),
    ]))
    expect(deleteSubpart(view, subpartAt(0))).toBe(true)
    expect(part().lastChild!.childCount).toBe(1)
    expect(deleteSubpart(view, subpartAt(0))).toBe(true)
    expect(partKindOf(part())).toBe('open')
    expect(part().lastChild!.textContent).toBe('Warmer water.')
    expect(part().firstChild!.textContent).toBe('lead-in p')
    expect(part().attrs).toEqual({ id: 's2', columns: 2 })
  })

  test('adding Subparts and removing the only one gives back the Part as it was', () => {
    const original = answering('multipartPart', 'p', mc('x', 'y'), 4)
    const { view, part, subpartAt } = editorWith(original)
    addSubparts(view, 1)
    deleteSubpart(view, subpartAt(0))
    expect(part().toJSON()).toEqual(schema.nodeFromJSON(original).toJSON())
  })
})

describe('Subparts on the paper', () => {
  const exam = (): Exam => ({
    title: 'T',
    questions: [survey()],
    workSpace: { 'b-ii': { height: 96, style: 'lines', fill: false } },
  })
  const document = () =>
    buildExportDocument(exam(), arrangementOf(['q'], { 'b-i': ['bi3', 'bi1', 'bi2'] }), { test: true, answerKey: true })
  const planned = () =>
    document().test.flatMap((item) => (item.kind === 'question' ? [item.question] : []))[0]!

  test('are numbered i, ii, iii, iv… in lowercase roman numerals', () => {
    expect(Array.from({ length: 12 }, (_, index) => subpartLabelAt(index))).toEqual([
      'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii',
    ])
  })

  test('print beneath their Part’s lead-in, each as a Part of its kind prints', () => {
    const [a, b] = planned().parts!
    expect(a).toMatchObject({ letter: 'a', type: 'multiple-choice', subparts: [] })
    expect(b).toMatchObject({ letter: 'b', type: 'subparts', stem: [paragraph('lead-in b')], grid: null, workSpace: null })
    expect(b!.choices).toEqual([])
    expect(b!.subparts.map((subpart) => [subpart.label, subpart.type])).toEqual([
      ['i', 'multiple-choice'],
      ['ii', 'open'],
      ['iii', 'open'],
    ])
    // Answers in the order recorded under the Subpart's own id, in its own columns.
    expect(b!.subparts[0]!.choices.map((choice) => [choice.letter, choice.id])).toEqual([
      ['A', 'bi3'],
      ['B', 'bi1'],
      ['C', 'bi2'],
    ])
    expect(b!.subparts[0]!.grid?.columns).toBe(1)
    // Work Space as this Exam sets it for the Subpart's own id.
    expect(b!.subparts[0]!.workSpace).toBeNull()
    expect(b!.subparts[1]!.workSpace).toMatchObject({ style: 'lines', lines: 3 })
    expect(b!.subparts[1]!.suggestedAnswer).toEqual([paragraph('More frogs in spring.')])
  })

  test('take one Answer Key line each, labelled with their place under their Part', () => {
    const entry = document().answerKey.find(
      (item): item is AnswerKeyEntryItem => item.kind === 'answer-key-entry',
    )!
    expect(entry.letter).toBeNull()
    expect(entry.parts).toEqual([
      { letter: 'a', answer: 'A' },
      { letter: 'b (i)', answer: 'B', subpart: true },
      { letter: 'b (ii)', answer: null, suggestedAnswer: [paragraph('More frogs in spring.')], subpart: true },
      { letter: 'b (iii)', answer: null, subpart: true },
    ])
  })
})

describe('Subparts across pages', () => {
  const box = pageContentHeight('first')
  // Each stem block, Part lead-in and answering Part or Subpart is given a height.
  const measureOf = (block: number, each: number): Measure => ({
    itemHeight: (item) =>
      item.kind === 'question'
        ? item.stem.length * block
          + (item.parts ?? []).reduce(
            (sum, part) => sum + (part.continued ? 0 : each) + part.subparts.length * each,
            0,
          )
        : 0,
  })
  // A piece's Parts as `a(i,ii)`; a piece continued from an earlier page as `…(iii)`.
  const pieces = (question: Question, measure: Measure, workSpace?: Exam['workSpace']) =>
    planExport({
      exam: { title: 'T', questions: [question], ...(workSpace ? { workSpace } : {}) },
      arrangement: arrangementOf([question.id]),
      selection: STUDENT_TEST,
      measure,
    }).pages.map((page) =>
      page.items.flatMap((item) =>
        item.kind === 'question'
          ? [(item.parts ?? []).map((part) => {
              const labels = part.subparts.map((subpart) => subpart.label).join(',')
              return `${part.continued ? '…' : part.letter}${labels ? `(${labels})` : ''}`
            })]
          : [],
      ),
    )
  const lab = () =>
    multipart('q', [
      holding('a', [
        answering('multipartSubpart', 'a-i', sa()),
        answering('multipartSubpart', 'a-ii', sa()),
        answering('multipartSubpart', 'a-iii', sa()),
        answering('multipartSubpart', 'a-iv', sa()),
      ]),
    ])

  test('moves whole when it fits on a page', () => {
    expect(pieces(lab(), measureOf(10, 10))).toEqual([[['a(i,ii,iii,iv)']]])
  })

  test('breaks between Subparts, keeping the stem and lead-in with Subpart (i)', () => {
    // A third of a page each: the stem, lead-in and Subpart (i) fill two
    // thirds, and the rest go on together without the lead-in again.
    const each = Math.floor(box / 3)
    expect(pieces(lab(), measureOf(1, each))).toEqual([
      [['a(i)']],
      [['…(ii,iii,iv)']],
    ])
  })

  test('a Subpart that fills its page ends it, and the Subparts after it go on the next page', () => {
    expect(pieces(lab(), measureOf(10, 10), { 'a-ii': { height: 32, style: 'blank', fill: true } })).toEqual([
      [['a(i,ii)']],
      [['…(iii,iv)']],
    ])
  })

  test('the last Subpart that fills its page grows to its foot', () => {
    const plan = planExport({
      exam: { title: 'T', questions: [lab()], workSpace: { 'a-iv': { height: 32, style: 'lines', fill: true } } },
      arrangement: arrangementOf(['q']),
      selection: STUDENT_TEST,
      measure: measureOf(10, 10),
    })
    const item = plan.pages[0]!.items.find((candidate): candidate is QuestionItem => candidate.kind === 'question')!
    expect(item.parts?.[0]!.subparts.at(-1)!.workSpace!.height).toBeGreaterThan(box - 100)
  })
})

describe('Subparts elsewhere', () => {
  test('Copy pastes a Part’s lead-in, then its Subparts numbered beneath it, each laid out under its own id', () => {
    expect(copyTextOf([copyBlocksOf(survey(), { parts: { 'b-ii': { lines: 1 } } })])).toBe([
      'A table of results.',
      'a. stem a',
      '    A. a1',
      '    B. a2',
      'b. lead-in b',
      '    i. stem b-i',
      '        A. bi1',
      '        B. bi2',
      '        C. bi3',
      '    ii. stem b-ii',
      `        ${ANSWER_RULE}`,
      '    iii. stem b-iii',
    ].join('\n'))
  })

  test('a stem search reaches a Subpart’s stem', () => {
    expect(searchableText(survey())).toContain('stem b-iii')
  })

  test('the reading shows a Part’s Subparts with their own answers', () => {
    const [, b] = readingOfQuestion(survey()).parts!
    expect(b).toMatchObject({ letter: 'b', typeLabel: 'Subparts', stem: [paragraph('lead-in b')] })
    expect(b!.choices).toBeUndefined()
    expect(b!.subparts!.map((subpart) => [subpart.letter, subpart.typeLabel])).toEqual([
      ['i', 'Multiple choice'],
      ['ii', 'Short answer'],
      ['iii', 'Short answer'],
    ])
  })
})

describe('Subparts on the Working Copy', () => {
  async function storeWith(question: Question) {
    const store = await loadExamStore(
      createMemoryBackend<AuthoringState>(null),
      createMemoryBackend<SavedState>(),
    )
    store.createInQuestionBank(question)
    store.addToWorkingCopy(question)
    await store.whenSettled()
    return store
  }

  test('sets answer columns on a Multiple Choice Subpart and work space on a Short Answer one, never on their Part', async () => {
    const store = await storeWith(survey())
    store.setQuestionColumns(['b-i'], 4)
    store.setQuestionWorkSpace(['b-iii'], { height: 64, style: 'lines' })
    store.setQuestionColumns(['b'], 1)
    store.setQuestionWorkSpace(['b'], { height: 64 })
    const { workingCopy } = store.getState()
    expect(workingCopy.columns).toMatchObject({ 'b-i': 4 })
    expect(workingCopy.columns?.b).toBeUndefined()
    expect(workingCopy.workSpace).toEqual({ 'b-iii': { height: 64, style: 'lines', fill: false } })
    const { exam } = store.selectedExam()
    expect(partsOf(exam.questions[0]!)[1]!.subparts[0]!.columns).toBe(4)
  })

  test('Remove forgets what this Exam set for its Subparts', async () => {
    const store = await storeWith(survey())
    store.setQuestionColumns(['b-i'], 4)
    store.setQuestionWorkSpace(['b-iii'], { height: 64 })
    store.shuffleSelectedAnswers(['q'])
    expect(store.getState().workingCopy.choiceOrder?.['b-i']).toBeDefined()
    store.removeFromWorkingCopy(['q'])
    const { workingCopy } = store.getState()
    expect(workingCopy.columns?.['b-i']).toBeUndefined()
    expect(workingCopy.workSpace?.['b-iii']).toBeUndefined()
    expect(workingCopy.choiceOrder?.['b-i']).toBeUndefined()
  })

  test('Duplicate copies each Subpart’s presentation onto the copy’s Subparts', async () => {
    const store = await storeWith(survey())
    store.setQuestionColumns(['b-i'], 4)
    store.setQuestionWorkSpace(['b-iii'], { height: 64 })
    store.duplicateInWorkingCopy('q')
    const { workingCopy, questionBank } = store.getState()
    const copy = questionBank.questions.find(({ id }) => id !== 'q')!
    const [first, , third] = partsOf(copy)[1]!.subparts
    expect(workingCopy.columns?.[first!.id]).toBe(4)
    expect(workingCopy.workSpace?.[third!.id]).toMatchObject({ height: 64 })
  })
})
