import { describe, expect, test } from 'bun:test'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { answeringPartsOf, DEFAULT_COLUMNS, duplicateQuestion, partsOf, type Question } from './exam'
import { cleanDocument, type ProseMirrorJSON } from './question-doc'
import {
  pointsLabel,
  pointsOfQuestion,
  parsePointsInput,
  readPoints,
  withPartPoints,
  withQuestionPoints,
} from './points'
import { addSubparts, deleteSubpart, setPartPoints } from './multipart'
import { buildExportDocument, type AnswerKeyEntryItem } from './export-plan'
import { FIXTURES } from './export-fixtures'

// Points on what a student answers (ADR-0042), with invented questions.

function paragraph(text: string): ProseMirrorJSON {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

const mc = (...ids: string[]): ProseMirrorJSON => ({
  type: 'multipleChoice',
  content: ids.map((id, index) => ({
    type: 'multipleChoiceChoice',
    attrs: { id, correct: index === 0 },
    content: [paragraph(id)],
  })),
})
const sa = (): ProseMirrorJSON => ({ type: 'suggestedAnswer', content: [{ type: 'paragraph' }] })

function answering(
  type: 'multipartPart' | 'multipartSubpart',
  id: string,
  answer: ProseMirrorJSON,
  points?: number,
): ProseMirrorJSON {
  return {
    type,
    attrs: { id, columns: 2, ...(points === undefined ? {} : { points }) },
    content: [{ type: 'multipartPartStem', content: [paragraph(`stem ${id}`)] }, answer],
  }
}

function holding(id: string, subparts: ProseMirrorJSON[], points?: number): ProseMirrorJSON {
  return {
    type: 'multipartPart',
    attrs: { id, columns: 2, ...(points === undefined ? {} : { points }) },
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
    doc: { type: 'doc', content: [paragraph('A map of a river.'), { type: 'multipartParts', content: parts }] },
  }
}

function single(id: string, type: Question['type'], points?: number): Question {
  return {
    id,
    type,
    columns: DEFAULT_COLUMNS,
    doc: { type: 'doc', content: [paragraph(id)] },
    ...(points === undefined ? {} : { points }),
  }
}

/** Part a answers for 2; Part b leads in to Subparts worth 1 and 3, and one unpointed. */
const river = () =>
  multipart('r', [
    answering('multipartPart', 'a', mc('a1', 'a2'), 2),
    holding('b', [
      answering('multipartSubpart', 'b-i', sa(), 1),
      answering('multipartSubpart', 'b-ii', sa(), 3),
      answering('multipartSubpart', 'b-iii', sa()),
    ]),
  ])

describe('reading Points', () => {
  test('are a positive whole number, and anything else is unpointed', () => {
    expect(readPoints(3)).toBe(3)
    for (const value of [0, -1, 1.5, '2', null, undefined, Number.NaN, Infinity]) {
      expect(readPoints(value)).toBeUndefined()
    }
  })

  test('a typed field reads a whole number, clears on empty, and changes nothing otherwise', () => {
    expect(parsePointsInput(' 4 ')).toBe(4)
    expect(parsePointsInput('')).toBeNull()
    expect(parsePointsInput('  ')).toBeNull()
    for (const text of ['0', '-2', '1.5', 'two', '3a', '1e2']) {
      expect(parsePointsInput(text)).toBeUndefined()
    }
  })

  test('are counted in words', () => {
    expect(pointsLabel(1)).toBe('1 point')
    expect(pointsLabel(24)).toBe('24 points')
  })
})

describe('what a Question is worth', () => {
  test('a Multiple Choice, True/False, Short Answer or Matching question is worth its own Points', () => {
    for (const type of ['multiple-choice', 'true-false', 'open', 'matching'] as const) {
      expect(pointsOfQuestion(single('q', type, 2))).toBe(2)
      expect(pointsOfQuestion(single('q', type))).toBeUndefined()
    }
  })

  test('a stored value that is not Points reads as unpointed', () => {
    expect(pointsOfQuestion({ ...single('q', 'open'), points: 0 })).toBeUndefined()
    expect(pointsOfQuestion({ ...single('q', 'open'), points: 2.5 })).toBeUndefined()
  })

  test('a Multipart question is worth the sum of its answering Parts and Subparts', () => {
    expect(answeringPartsOf(river()).map(({ id, points }) => [id, points])).toEqual([
      ['a', 2], ['b-i', 1], ['b-ii', 3], ['b-iii', undefined],
    ])
    expect(pointsOfQuestion(river())).toBe(6)
  })

  test('a Part holding Subparts never adds Points of its own, and nor does the question', () => {
    const question = multipart('r', [holding('b', [answering('multipartSubpart', 'b-i', sa(), 1)], 5)])
    expect(partsOf(question)[0]!.points).toBeUndefined()
    expect(pointsOfQuestion({ ...question, points: 9 })).toBe(1)
  })

  test('a Multipart question with no Points anywhere is unpointed, not worth nothing', () => {
    const question = multipart('r', [answering('multipartPart', 'a', sa())])
    expect(pointsOfQuestion(question)).toBeUndefined()
  })
})

describe('changing Points', () => {
  test('a question’s own Points are set and cleared, and never on a Multipart question', () => {
    expect(withQuestionPoints(single('q', 'open'), 3).points).toBe(3)
    expect('points' in withQuestionPoints(single('q', 'open', 3), null)).toBe(false)
    expect('points' in withQuestionPoints(river(), 3)).toBe(false)
  })

  test('a Part’s or Subpart’s Points are set on its node, and a lead-in takes none', () => {
    const set = withPartPoints(river(), 'b-iii', 5)
    expect(pointsOfQuestion(set)).toBe(11)
    const cleared = withPartPoints(set, 'a', null)
    expect(answeringPartsOf(cleared).map(({ points }) => points)).toEqual([undefined, 1, 3, 5])
    expect(withPartPoints(river(), 'b', 4)).toEqual(river())
    expect(withPartPoints(river(), 'nowhere', 4)).toEqual(river())
  })

  test('a duplicate keeps every Point', () => {
    expect(pointsOfQuestion(duplicateQuestion(river()))).toBe(6)
    expect(duplicateQuestion(single('q', 'open', 2)).points).toBe(2)
  })
})

describe('Points in a stored document', () => {
  test('survive cleaning on a Part or Subpart that answers', () => {
    expect(cleanDocument(river().doc)).toEqual(river().doc)
  })

  test('an unpointed Part keeps no `points` at all, and a lead-in loses any it carried', () => {
    const editorShaped = multipart('r', [
      { ...answering('multipartPart', 'a', sa()), attrs: { id: 'a', columns: 2, points: null } },
      holding('b', [answering('multipartSubpart', 'b-i', sa(), 1)], 4),
    ])
    const cleaned = cleanDocument(editorShaped.doc)
    const parts = (cleaned.content as ProseMirrorJSON[])[1]!.content as ProseMirrorJSON[]
    expect(parts[0]!.attrs).toEqual({ id: 'a', columns: 2 })
    expect(parts[1]!.attrs).toEqual({ id: 'b', columns: 2 })
  })
})

describe('Points in the Part editor', () => {
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
        attrs: { id: { default: '' }, columns: { default: 2 }, points: { default: null } },
      },
      multipartSubpart: {
        content: 'multipartPartStem (multipleChoice | suggestedAnswer)',
        attrs: { id: { default: '' }, columns: { default: 2 }, points: { default: null } },
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
    const part0 = () => view.state.doc.nodeAt(1)!
    const subpartAt = () => 1 + 1 + part0().firstChild!.nodeSize + 1
    return { view, part: part0, subpartAt }
  }

  test('a Part’s Points are set, cleared, and never set on a lead-in', () => {
    const { view, part } = editorWith(answering('multipartPart', 'p', sa()))
    expect(setPartPoints(view, 1, 3)).toBe(true)
    expect(part().attrs.points).toBe(3)
    expect(setPartPoints(view, 1, 3)).toBe(false)
    expect(setPartPoints(view, 1, null)).toBe(true)
    expect(part().attrs.points).toBeNull()
    const lead = editorWith(holding('p', [answering('multipartSubpart', 's', sa())]))
    expect(setPartPoints(lead.view, 1, 2)).toBe(false)
    expect(setPartPoints(lead.view, lead.subpartAt(), 2)).toBe(true)
    expect(lead.part().lastChild!.firstChild!.attrs.points).toBe(2)
  })

  test('Add Subparts moves a Part’s Points into Subpart (i), and removing it moves them back', () => {
    const { view, part, subpartAt } = editorWith(answering('multipartPart', 'p', mc('x', 'y'), 4))
    addSubparts(view, 1)
    expect(part().attrs.points).toBeNull()
    expect(part().lastChild!.firstChild!.attrs).toEqual({ id: 'p', columns: 2, points: 4 })
    deleteSubpart(view, subpartAt())
    expect(part().attrs).toEqual({ id: 'p', columns: 2, points: 4 })
  })
})

describe('Points in the Export Document', () => {
  const pointed = FIXTURES.find((fixture) => fixture.name === 'a paper with points')!
  const exportDocument = () =>
    buildExportDocument(pointed.exam, pointed.arrangement, { test: true, answerKey: true })
  const planned = () =>
    exportDocument().test.flatMap((item) => (item.kind === 'question' ? [item.question] : []))

  test('plan each question’s worth, and each Part’s and Subpart’s, as data', () => {
    expect(planned().map((question) => question.totalPoints)).toEqual([1, undefined, 2, 6])
    const [a, b] = planned()[3]!.parts!
    expect(a!.points).toBe(1)
    expect(b!.points).toBeUndefined()
    expect(b!.subparts.map((subpart) => subpart.points)).toEqual([2, 3])
  })

  test('the key carries the paper’s total and each line’s Points', () => {
    const key = exportDocument().answerKey
    expect(key[0]).toEqual({ kind: 'answer-key-heading', totalPoints: 9 })
    const entries = key.filter((item): item is AnswerKeyEntryItem => item.kind === 'answer-key-entry')
    expect(entries.map((entry) => [entry.number, entry.points])).toEqual([
      [1, 1], [2, undefined], [3, 2], [4, undefined], [5, undefined],
    ])
    expect(entries.at(-1)!.parts!.map((line) => [line.letter, line.points])).toEqual([
      ['a', 1], ['b (i)', 2], ['b (ii)', 3],
    ])
  })

  test('an unpointed paper plans exactly as before: no total and no Points anywhere', () => {
    const unpointed = FIXTURES.find((fixture) => fixture.name === 'a multipart whose part holds subparts')!
    const document = buildExportDocument(unpointed.exam, unpointed.arrangement, { test: true, answerKey: true })
    expect(document.answerKey[0]).toEqual({ kind: 'answer-key-heading' })
    expect(JSON.stringify(document)).not.toMatch(/"(total)?[mM]arks":\d/)
  })
})
