// A page may break between a stem's blocks (ADR-0048): a question's stem, a
// Part's, a Part's lead-in and a Subpart's — never inside a block, never
// between a picture and the paragraph that captions it, and never leaving a
// number or a letter at the foot of a page without its first block. A
// question still moves whole when a page would hold it, and a Part when a
// page would hold that Part.

import { describe, expect, test } from 'bun:test'
import { DEFAULT_COLUMNS, type Arrangement, type Exam, type Question } from './exam'
import {
  pageContentHeight,
  planExport,
  STUDENT_TEST,
  type Measure,
  type PageItem,
  type PlannedPart,
  type PlannedSubpart,
  type QuestionItem,
} from './export-plan'
import type { ProseMirrorJSON } from './question-doc'

// What each page holds: the first under the title, the rest a little more.
const boxOf = (page: number) => pageContentHeight(page === 0 ? 'first' : 'later')

function paragraph(text: string): ProseMirrorJSON {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function picture(name: string): ProseMirrorJSON {
  return { type: 'image-block', attrs: { src: `/local-images/${name}`, caption: '' } }
}

function table(name: string): ProseMirrorJSON {
  return {
    type: 'table',
    content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [paragraph(name)] }] }],
  }
}

const sa = { type: 'suggestedAnswer', content: [{ type: 'paragraph' }] }

function part(id: string, stem: ProseMirrorJSON[], answer: ProseMirrorJSON = sa): ProseMirrorJSON {
  return {
    type: 'multipartPart',
    attrs: { id, columns: DEFAULT_COLUMNS },
    content: [{ type: 'multipartPartStem', content: stem }, answer],
  }
}

function subpart(id: string, stem: ProseMirrorJSON[]): ProseMirrorJSON {
  return {
    type: 'multipartSubpart',
    attrs: { id, columns: DEFAULT_COLUMNS },
    content: [{ type: 'multipartPartStem', content: stem }, sa],
  }
}

function holding(id: string, leadIn: ProseMirrorJSON[], subparts: ProseMirrorJSON[]): ProseMirrorJSON {
  return {
    type: 'multipartPart',
    attrs: { id, columns: DEFAULT_COLUMNS },
    content: [
      { type: 'multipartPartStem', content: leadIn },
      { type: 'multipartSubparts', content: subparts },
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

function open(id: string, ...blocks: ProseMirrorJSON[]): Question {
  return { id, type: 'open', columns: DEFAULT_COLUMNS, doc: { type: 'doc', content: blocks } }
}

const arrangementOf = (questionOrder: string[]): Arrangement =>
  ({ id: 'v', letter: 'A', questionOrder, choiceOrder: {} })

// Every block a piece prints is as tall as its kind, and each work space as
// tall as the plan made it: what a page holds is their sum.
const HEIGHTS: Record<string, number> = { paragraph: 60, 'image-block': 400, table: 300 }
const blocks = (stem: readonly ProseMirrorJSON[]) =>
  stem.reduce((sum, block) => sum + (HEIGHTS[block.type as string] ?? 60), 0)
const answering = (piece: Pick<PlannedSubpart, 'stem' | 'workSpace'>) =>
  blocks(piece.stem) + (piece.workSpace?.height ?? 0)
const measure: Measure = {
  itemHeight: (item: PageItem) =>
    item.kind === 'question'
      ? blocks(item.stem)
        + (item.workSpace?.height ?? 0)
        + (item.parts ?? []).reduce(
          (sum, piece: PlannedPart) => sum + answering(piece) + piece.subparts.reduce((all, s) => all + answering(s), 0),
          0,
        )
      : 0,
}

function piecesOf(question: Question, workSpace: Exam['workSpace'] = {}): QuestionItem[][] {
  return planExport({
    exam: { title: 'T', questions: [question], workSpace },
    arrangement: arrangementOf([question.id]),
    selection: STUDENT_TEST,
    measure,
  }).pages.map((page) => page.items.filter((item): item is QuestionItem => item.kind === 'question'))
}

const textOf = (block: ProseMirrorJSON): string =>
  block.type === 'image-block'
    ? `picture ${String((block.attrs as { src: string }).src).split('/').at(-1)}`
    : block.type === 'table'
      ? 'table'
      : ((block.content as { text: string }[] | undefined) ?? []).map((node) => node.text).join('')

describe('a page may break between a stem’s blocks', () => {
  // Part (a): text, a tall picture and its caption, a table and more text,
  // and ruled room — taller than any page.
  const tall = () =>
    multipart('q', [paragraph('This question is about a pendulum.')], [
      part('q-a', [
        paragraph('A pendulum swings.'),
        picture('pendulum'),
        paragraph('Fig. 1.1'),
        table('timings'),
        paragraph('Complete the table.'),
        picture('graph'),
        paragraph('Fig. 1.2'),
      ]),
      part('q-b', [paragraph('Name the force that slows it.')]),
    ])

  test('breaks a Part taller than a page between its blocks, its letter with the first', () => {
    const pages = piecesOf(tall(), { 'q-a': { height: 96, style: 'lines', fill: false } })
    expect(pages.length).toBeGreaterThan(1)
    // Each page holds what its box has room for.
    pages.forEach((items, page) =>
      expect(items.reduce((sum, item) => sum + measure.itemHeight(item), 0)).toBeLessThanOrEqual(boxOf(page)))
    const pieces = pages.flat().flatMap((item) => (item.parts ?? []).filter((piece) => piece.id === 'q-a'))
    // Every block printed once, in order.
    expect(pieces.flatMap((piece) => piece.stem.map(textOf))).toEqual([
      'A pendulum swings.', 'picture pendulum', 'Fig. 1.1', 'table', 'Complete the table.', 'picture graph', 'Fig. 1.2',
    ])
    // Only the first piece prints the letter; only the last the room.
    expect(pieces.map((piece) => piece.continued ?? false)).toEqual([false, ...pieces.slice(1).map(() => true)])
    expect(pieces.slice(0, -1).every((piece) => piece.workSpace === null)).toBe(true)
    expect(pieces.at(-1)!.workSpace).toMatchObject({ style: 'lines' })
    // The number and the stem stay with the first block of Part (a).
    const first = pages[0]![0]!
    expect(first.numbered).toBe(true)
    expect(first.parts![0]!.stem.map(textOf)).toContain('A pendulum swings.')
  })

  test('never parts a picture from the paragraph that captions it', () => {
    for (const items of piecesOf(tall())) {
      for (const piece of items.flatMap((item) => item.parts ?? [])) {
        const texts = piece.stem.map(textOf)
        const at = texts.indexOf('picture pendulum')
        if (at >= 0) expect(texts[at + 1]).toBe('Fig. 1.1')
        const graph = texts.indexOf('picture graph')
        if (graph >= 0) expect(texts[graph + 1]).toBe('Fig. 1.2')
      }
    }
  })

  test('keeps a picture’s caption with it in a question’s own stem too', () => {
    // The page would hold the text, the table and the map, but not the map's caption too.
    const question = open('o', paragraph('Look at the map.'), table('places'), picture('map'), paragraph('Fig. 2.1'))
    const pieces = piecesOf(question).flat()
    expect(pieces.map((piece) => piece.stem.map(textOf))).toEqual([
      ['Look at the map.', 'table'],
      ['picture map', 'Fig. 2.1'],
    ])
  })

  test('moves a Part a page would hold whole, rather than breaking it', () => {
    // Part (b) fits a page of its own, but not the room Part (a) leaves.
    const question = multipart('q', [paragraph('Material.')], [
      part('q-a', [paragraph('one'), picture('a1')]),
      part('q-b', [paragraph('two'), picture('b1'), paragraph('three')]),
    ])
    const pages = piecesOf(question)
    expect(pages.map((items) => items.flatMap((item) => (item.parts ?? []).map((piece) => `${piece.letter}${piece.continued ? '…' : ''}`))))
      .toEqual([['a'], ['b']])
  })

  test('breaks a Subpart taller than a page, and a lead-in, keeping the lead-in’s last block with Subpart (i)', () => {
    const question = multipart('q', [], [
      holding('q-a', [paragraph('A lead-in.'), picture('lead'), paragraph('Fig. 3.1'), table('lead-table')], [
        subpart('q-a-i', [paragraph('First.'), picture('first'), paragraph('Fig. 3.2'), table('first-table'), picture('second'), paragraph('Fig. 3.3')]),
        subpart('q-a-ii', [paragraph('Second.')]),
      ]),
    ])
    const pages = piecesOf(question)
    pages.forEach((items, page) =>
      expect(items.reduce((sum, item) => sum + measure.itemHeight(item), 0)).toBeLessThanOrEqual(boxOf(page)))
    const parts = pages.flat().flatMap((item) => item.parts ?? [])
    expect(parts.flatMap((piece) => piece.stem.map(textOf)))
      .toEqual(['A lead-in.', 'picture lead', 'Fig. 3.1', 'table'])
    const subparts = parts.flatMap((piece) => piece.subparts)
    expect(subparts.filter((piece) => piece.id === 'q-a-i').flatMap((piece) => piece.stem.map(textOf)))
      .toEqual(['First.', 'picture first', 'Fig. 3.2', 'table', 'picture second', 'Fig. 3.3'])
    // Subpart (i)'s label prints once, on its first piece, below the lead-in's last block.
    expect(subparts.filter((piece) => piece.id === 'q-a-i').map((piece) => piece.continued ?? false))
      .toEqual([false, ...subparts.filter((piece) => piece.id === 'q-a-i').slice(1).map(() => true)])
    const leadEnd = parts.find((piece) => piece.stem.some((block) => textOf(block) === 'table'))!
    expect(leadEnd.subparts[0]?.id).toBe('q-a-i')
  })
})
