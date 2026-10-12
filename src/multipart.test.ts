import { describe, expect, test } from 'bun:test'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import {
  createQuestion,
  duplicateQuestion,
  partsOf,
  presentationIdsOf,
  shuffleSelectedAnswers,
  DEFAULT_COLUMNS,
  type Arrangement,
  type Exam,
  type Question,
} from './exam'
import {
  buildExportDocument,
  planExport,
  pageContentHeight,
  STUDENT_TEST,
  type AnswerKeyEntryItem,
  type Measure,
  type QuestionItem,
} from './export-plan'
import { cleanDocument, stemNodesOf, type ProseMirrorJSON } from './question-doc'
import { searchableText, stemPreview } from './stem-preview'
import { createMemoryBackend, loadExamStore, type AuthoringState, type SavedState } from './exam-store'
import { movePartTo, partKindOf, setPartKind, type SetAsideAnswers } from './multipart'

function paragraph(text: string): ProseMirrorJSON {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function choice(id: string, correct = false): ProseMirrorJSON {
  return { type: 'multipleChoiceChoice', attrs: { id, correct }, content: [paragraph(id)] }
}

function mcPart(id: string, choiceIds: string[], correctId = ''): ProseMirrorJSON {
  return {
    type: 'multipartPart',
    attrs: { id, columns: 2 },
    content: [
      { type: 'multipartPartStem', content: [paragraph(`part ${id}`)] },
      { type: 'multipleChoice', content: choiceIds.map((cid) => choice(cid, cid === correctId)) },
    ],
  }
}

function saPart(id: string, answer?: string): ProseMirrorJSON {
  return {
    type: 'multipartPart',
    attrs: { id, columns: 2 },
    content: [
      { type: 'multipartPartStem', content: [paragraph(`part ${id}`)] },
      { type: 'suggestedAnswer', content: [answer ? paragraph(answer) : { type: 'paragraph' }] },
    ],
  }
}

function multipart(id: string, material: ProseMirrorJSON[], parts: ProseMirrorJSON[]): Question {
  return {
    id,
    type: 'multipart',
    columns: DEFAULT_COLUMNS,
    doc: { type: 'doc', content: [...material, { type: 'multipartParts', content: parts }] },
  }
}

function open(id: string): Question {
  return { id, type: 'open', columns: DEFAULT_COLUMNS, doc: { type: 'doc', content: [paragraph(id)] } }
}

function arrangementOf(questionOrder: string[], choiceOrder: Record<string, string[]> = {}): Arrangement {
  return { id: 'v', letter: 'A', questionOrder, choiceOrder }
}

const aldmere = () =>
  multipart('s1', [paragraph('The power of the Kingdom was fading.'), paragraph('Source: Aldmere')], [
    mcPart('s1-a', ['a1', 'a2', 'a3', 'a4'], 'a4'),
    saPart('s1-b', 'Its harbors silted up.'),
  ])

describe('a Multipart question', () => {
  test('starts with one blank Multiple Choice Part', () => {
    const question = createQuestion('multipart')
    const parts = partsOf(question)
    expect(parts).toHaveLength(1)
    expect(parts[0]!.type).toBe('multiple-choice')
    expect(parts[0]!.choices.length).toBeGreaterThanOrEqual(2)
  })

  test('reads its Parts in authored order, each by the answer component it holds', () => {
    const parts = partsOf(aldmere())
    expect(parts.map((part) => [part.id, part.type])).toEqual([
      ['s1-a', 'multiple-choice'],
      ['s1-b', 'open'],
    ])
    expect(parts[0]!.choices.find((item) => item.correct)?.id).toBe('a4')
    expect(parts[1]!.suggestedAnswer).toEqual({ type: 'doc', content: [paragraph('Its harbors silted up.')] })
  })

  test('its stem is the Multipart question alone, without the Parts box', () => {
    expect(stemNodesOf(aldmere().doc)).toEqual([
      paragraph('The power of the Kingdom was fading.'),
      paragraph('Source: Aldmere'),
    ])
  })

  test('files its presentation under its own id and each of its Parts', () => {
    expect(presentationIdsOf(aldmere())).toEqual(['s1', 's1-a', 's1-b'])
  })

  test('a duplicate gives every Part and every Part answer a fresh id', () => {
    const copy = duplicateQuestion(aldmere())
    const original = partsOf(aldmere())
    const copied = partsOf(copy)
    expect(copied).toHaveLength(2)
    for (const [index, part] of copied.entries()) {
      expect(part.id).not.toBe(original[index]!.id)
      expect(part.type).toBe(original[index]!.type)
    }
    expect(copied[0]!.choices.map((item) => item.id)).not.toContain('a1')
  })

  test('a Part that lost its answer component loads as a Multiple Choice Part', () => {
    const cleaned = cleanDocument({
      type: 'doc',
      content: [{
        type: 'multipartParts',
        content: [{ type: 'multipartPart', attrs: { id: 'p' }, content: [] }],
      }],
    })
    const question: Question = { ...aldmere(), doc: cleaned }
    const [part] = partsOf(question)
    expect(part?.type).toBe('multiple-choice')
    expect(part?.choices).toHaveLength(2)
  })

  test('a Multipart question with no Parts is still a Multipart question', () => {
    expect(partsOf(multipart('s0', [paragraph('Just a passage.')], []))).toEqual([])
  })

  test('Vary shuffles each Multiple Choice Part’s answers under the Part’s own id', () => {
    const exam: Exam = { title: 'T', questions: [aldmere()] }
    const shuffled = shuffleSelectedAnswers(exam, arrangementOf(['s1']), ['s1'], () => 0)
    expect(Object.keys(shuffled.choiceOrder)).toEqual(['s1-a'])
    expect([...shuffled.choiceOrder['s1-a']!].sort()).toEqual(['a1', 'a2', 'a3', 'a4'])
    expect(shuffled.choiceOrder['s1-a']).not.toEqual(['a1', 'a2', 'a3', 'a4'])
  })

  test('the Question Bank row counts its Parts, and search reaches their stems', () => {
    expect(stemPreview(aldmere())).toMatchObject({ text: 'The power of the Kingdom was fading. Source: Aldmere', parts: 2 })
    expect(searchableText(aldmere())).toContain('part s1-b')
    expect(stemPreview(open('o1')).parts).toBeUndefined()
  })

  test('with no shared material, the Question Bank row is named by its first Part', () => {
    const asked = multipart('s2', [{ type: 'paragraph' }], [saPart('s2-a'), mcPart('s2-b', ['b1', 'b2'])])
    expect(stemPreview(asked)).toMatchObject({ text: 'part s2-a', parts: 2 })
  })
})

describe('a Multipart question on the paper', () => {
  const exam: Exam = { title: 'T', questions: [open('o1'), aldmere(), open('o2')] }
  const document = () => buildExportDocument(exam, arrangementOf(['o1', 's1', 'o2'], { 's1-a': ['a4', 'a1', 'a2', 'a3'] }), { test: true, answerKey: true })
  const planned = () =>
    document().test.flatMap((item) => (item.kind === 'question' ? [item.question] : []))

  test('on an Exam that stores no Sections, prints last, in a Multipart section of its own, under one number', () => {
    const headings = document().test.flatMap((item) => (item.kind === 'section-heading' ? [item.sectionId] : []))
    expect(headings).toEqual(['open', 'multipart'])
    expect(planned().map((question) => [question.id, question.number])).toEqual([
      ['o1', 1],
      ['o2', 2],
      ['s1', 3],
    ])
  })

  test('letters its Parts beneath its number, each printed as a question of its kind', () => {
    const question = planned().find(({ id }) => id === 's1')!
    expect(question.marks).toEqual([])
    // Neither kind prints an answer blank: each is set in by its letter alone.
    expect(question.parts?.map((part) => [part.letter, part.type])).toEqual([
      ['a', 'multiple-choice'],
      ['b', 'open'],
    ])
    expect(question.parts?.some((part) => 'answerBlank' in part)).toBe(false)
    expect(question.parts?.[0]!.grid).not.toBeNull()
    expect(question.parts?.[1]!.grid).toBeNull()
    expect(question.parts?.[1]!.workSpace).not.toBeNull()
  })

  test('letters a Part’s answers by the order recorded under the Part’s id', () => {
    const part = planned().find(({ id }) => id === 's1')!.parts![0]!
    expect(part.choices.map((item) => [item.letter, item.id])).toEqual([
      ['A', 'a4'],
      ['B', 'a1'],
      ['C', 'a2'],
      ['D', 'a3'],
    ])
  })

  test('takes one Answer Key entry, with a line per Part', () => {
    const entries = document().answerKey.filter(
      (item): item is AnswerKeyEntryItem => item.kind === 'answer-key-entry',
    )
    const entry = entries.find((item) => item.number === 3)!
    expect(entry.letter).toBeNull()
    expect(entry.parts).toEqual([
      { letter: 'a', answer: 'A' },
      { letter: 'b', answer: null, suggestedAnswer: [paragraph('Its harbors silted up.')] },
    ])
  })

  test('a Short Answer Part’s work space is the one this Exam sets for that Part', () => {
    const withSpace: Exam = { ...exam, workSpace: { 's1-b': { height: 96, style: 'lines', fill: false } } }
    const doc = buildExportDocument(withSpace, arrangementOf(['o1', 's1', 'o2']), STUDENT_TEST)
    const question = doc.test.flatMap((item) => (item.kind === 'question' ? [item.question] : []))
      .find(({ id }) => id === 's1')!
    expect(question.parts?.[1]!.workSpace).toMatchObject({ height: 88, style: 'lines', lines: 3 })
  })
})

describe('a Multipart question across pages', () => {
  const box = pageContentHeight('first')
  // Each stem block and each Part is given a height; a piece is their sum.
  const measureOf = (block: number, part: number): Measure => ({
    itemHeight: (item) =>
      item.kind === 'question' ? item.stem.length * block + (item.parts?.length ?? 0) * part : 0,
  })
  const pieces = (question: Question, measure: Measure, workSpace?: Exam['workSpace']) =>
    planExport({
      exam: { title: 'T', questions: [question], ...(workSpace ? { workSpace } : {}) },
      arrangement: arrangementOf([question.id]),
      selection: STUDENT_TEST,
      measure,
    }).pages.map((page) =>
      page.items.flatMap((item) =>
        item.kind === 'question'
          ? [{ stem: item.stem.length, numbered: item.numbered, parts: item.parts?.map((part) => part.letter) }]
          : [],
      ),
    )
  const three = () =>
    multipart('s', [paragraph('one'), paragraph('two')], [
      mcPart('p1', ['x', 'y']),
      mcPart('p2', ['x2', 'y2']),
      mcPart('p3', ['x3', 'y3']),
    ])

  test('moves whole when it fits on a page', () => {
    expect(pieces(three(), measureOf(10, 10))).toEqual([
      [{ stem: 2, numbered: true, parts: ['a', 'b', 'c'] }],
    ])
  })

  test('breaks only between its Parts, keeping the stem with Part a', () => {
    const part = Math.floor(box / 3)
    expect(pieces(three(), measureOf(part / 2, part))).toEqual([
      [{ stem: 2, numbered: true, parts: ['a', 'b'] }],
      [{ stem: 0, numbered: false, parts: ['c'] }],
    ])
  })

  test('splits the stem only when it cannot share a page with Part a', () => {
    expect(pieces(three(), measureOf(Math.floor(box * 0.6), 40))).toEqual([
      [{ stem: 1, numbered: true, parts: [] }],
      [{ stem: 1, numbered: false, parts: ['a', 'b', 'c'] }],
    ])
  })

  test('a Part that fills its page ends it, and the Parts after it go on the next page', () => {
    const question = multipart('s', [paragraph('one')], [saPart('p1'), mcPart('p2', ['x', 'y'])])
    expect(
      pieces(question, measureOf(10, 10), { p1: { height: 32, style: 'blank', fill: true } }),
    ).toEqual([
      [{ stem: 1, numbered: true, parts: ['a'] }],
      [{ stem: 0, numbered: false, parts: ['b'] }],
    ])
  })

  test('a Part that fills its page grows to its foot', () => {
    const question = multipart('s', [paragraph('one')], [saPart('p1')])
    const plan = planExport({
      exam: { title: 'T', questions: [question], workSpace: { p1: { height: 32, style: 'lines', fill: true } } },
      arrangement: arrangementOf(['s']),
      selection: STUDENT_TEST,
      measure: measureOf(10, 10),
    })
    const item = plan.pages[0]!.items.find((candidate): candidate is QuestionItem => candidate.kind === 'question')!
    expect(item.parts?.[0]!.workSpace!.height).toBeGreaterThan(box - 100)
  })
})

describe('a Multipart question on the Working Copy', () => {
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

  test('sets answer columns on a Multiple Choice Part, and work space on a Short Answer Part', async () => {
    const store = await storeWith(aldmere())
    store.setQuestionColumns(['s1-a'], 4)
    store.setQuestionWorkSpace(['s1-b'], { height: 64, style: 'lines' })
    // Neither applies to a Part of the other kind.
    store.setQuestionColumns(['s1-b'], 1)
    store.setQuestionWorkSpace(['s1-a'], { height: 64 })
    const { workingCopy } = store.getState()
    expect(workingCopy.columns).toMatchObject({ 's1-a': 4 })
    expect(workingCopy.columns?.['s1-b']).toBeUndefined()
    expect(workingCopy.workSpace).toEqual({ 's1-b': { height: 64, style: 'lines', fill: false } })
    const { exam } = store.selectedExam()
    expect(partsOf(exam.questions[0]!)[0]!.columns).toBe(4)
    expect(exam.workSpace).toEqual({ 's1-b': { height: 64, style: 'lines', fill: false } })
  })

  test('Remove forgets what this Exam set for its Parts', async () => {
    const store = await storeWith(aldmere())
    store.setQuestionColumns(['s1-a'], 4)
    store.setQuestionWorkSpace(['s1-b'], { height: 64 })
    store.shuffleSelectedAnswers(['s1'])
    store.removeFromWorkingCopy(['s1'])
    const { workingCopy } = store.getState()
    expect(workingCopy.columns?.['s1-a']).toBeUndefined()
    expect(workingCopy.workSpace?.['s1-b']).toBeUndefined()
    expect(workingCopy.choiceOrder?.['s1-a']).toBeUndefined()
  })

  test('Duplicate copies each Part’s presentation onto the copy’s Parts', async () => {
    const store = await storeWith(aldmere())
    store.setQuestionColumns(['s1-a'], 1)
    store.setQuestionWorkSpace(['s1-b'], { height: 64 })
    store.duplicateInWorkingCopy('s1')
    const { workingCopy, questionBank } = store.getState()
    const copy = questionBank.questions.find(({ id }) => id !== 's1')!
    const [copiedMc, copiedSa] = partsOf(copy)
    expect(workingCopy.columns?.[copiedMc!.id]).toBe(1)
    expect(workingCopy.workSpace?.[copiedSa!.id]).toMatchObject({ height: 64 })
  })

})

describe('switching a Part between Multiple Choice and Short Answer', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'multipartParts' },
      text: { group: 'inline' },
      paragraph: { group: 'block', content: 'inline*' },
      image: { group: 'inline', inline: true, atom: true },
      multipleChoiceChoice: {
        content: 'paragraph block*',
        attrs: { correct: { default: false }, id: { default: '' } },
      },
      multipleChoice: { content: 'multipleChoiceChoice+' },
      suggestedAnswer: { content: 'block+' },
      multipartPartStem: { content: 'block+' },
      multipartPart: {
        content: 'multipartPartStem (multipleChoice | suggestedAnswer)',
        attrs: { id: { default: '' }, columns: { default: 2 } },
      },
      multipartParts: { content: 'multipartPart*' },
    },
  })

  function editorWith(answer: ProseMirrorJSON) {
    let state = EditorState.create({
      schema,
      doc: schema.nodeFromJSON({
        type: 'doc',
        content: [{
          type: 'multipartParts',
          content: [{
            type: 'multipartPart',
            attrs: { id: 'p1', columns: 1 },
            content: [{ type: 'multipartPartStem', content: [paragraph('Which region?')] }, answer],
          }],
        }],
      }),
    })
    const view = {
      get state() { return state },
      dispatch(transaction: Parameters<typeof state.apply>[0]) { state = state.apply(transaction) },
    }
    // The document's one Part sits just inside the Parts box.
    return { view, part: () => view.state.doc.nodeAt(1)! }
  }

  test('a Part switches kind at any time, keeping its stem, id and columns', () => {
    const { view, part } = editorWith({ type: 'multipleChoice', content: [choice('Egypt'), choice('Persia')] })
    expect(setPartKind(view, 1, 'open')).toBe(true)
    expect(partKindOf(part())).toBe('open')
    expect(part().attrs).toEqual({ id: 'p1', columns: 1 })
    expect(part().firstChild!.textContent).toBe('Which region?')
    // Without anywhere to set them aside, the answers it comes back to are blank.
    expect(setPartKind(view, 1, 'multiple-choice')).toBe(true)
    expect(part().lastChild!.childCount).toBe(4)
    expect(part().lastChild!.textContent).toBe('')
    expect(setPartKind(view, 1, 'multiple-choice')).toBe(false)
  })

  test('switching back brings the answers that were set aside, and the document holds only one kind', () => {
    const setAside: SetAsideAnswers = new Map()
    const { view, part } = editorWith({ type: 'multipleChoice', content: [choice('Egypt'), choice('Persia', true)] })
    setPartKind(view, 1, 'open', setAside)
    const suggested = view.state.schema.nodes.paragraph!.create(null, view.state.schema.text('Trade routes'))
    const answerStart = 1 + part().nodeSize - 1 - part().lastChild!.nodeSize
    view.dispatch(view.state.tr.insert(answerStart + 1, suggested))
    expect(part().lastChild!.textContent).toBe('Trade routes')
    expect(view.state.doc.textContent).not.toContain('Egypt')

    setPartKind(view, 1, 'multiple-choice', setAside)
    expect(part().lastChild!.textContent).toBe('EgyptPersia')
    expect(part().lastChild!.child(1).attrs.correct).toBe(true)
    expect(view.state.doc.textContent).not.toContain('Trade routes')

    setPartKind(view, 1, 'open', setAside)
    expect(part().lastChild!.textContent).toBe('Trade routes')
  })

  test('a dragged Part lands before the Part it is dropped on, or after the last', () => {
    const { view } = editorWith({ type: 'multipleChoice', content: [choice('Egypt')] })
    const box = () => view.state.doc.firstChild!
    const stems = () => Array.from({ length: box().childCount }, (_, i) => box().child(i).firstChild!.textContent)
    const partAt = (index: number) => {
      let pos = 1
      for (let i = 0; i < index; i += 1) pos += box().child(i).nodeSize
      return pos
    }
    const second = schema.nodeFromJSON({
      type: 'multipartPart',
      attrs: { id: 'p2' },
      content: [
        { type: 'multipartPartStem', content: [paragraph('Explain one factor.')] },
        { type: 'suggestedAnswer', content: [{ type: 'paragraph' }] },
      ],
    })
    view.dispatch(view.state.tr.insert(1 + box().content.size, second))
    view.dispatch(view.state.tr.insert(1 + box().content.size, second.type.create({ id: 'p3' }, [
      second.firstChild!.type.create(null, schema.nodes.paragraph!.create(null, schema.text('Third'))),
      second.lastChild!,
    ])))
    expect(stems()).toEqual(['Which region?', 'Explain one factor.', 'Third'])

    expect(movePartTo(view, partAt(2), 0)).toBe(true)
    expect(stems()).toEqual(['Third', 'Which region?', 'Explain one factor.'])
    expect(movePartTo(view, partAt(0), 3)).toBe(true)
    expect(stems()).toEqual(['Which region?', 'Explain one factor.', 'Third'])
    // Dropped where it already is, on either side of itself, nothing moves.
    expect(movePartTo(view, partAt(1), 1)).toBe(false)
    expect(movePartTo(view, partAt(1), 2)).toBe(false)
  })
})
