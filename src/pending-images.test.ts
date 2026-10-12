import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { inspectImportRecord } from './package-import'
import { initialSelection } from './import-selection'
import { planImport } from './package-commit'
import {
  checkAgainstSourceDocument,
  pendingImagesOf,
  pendingImagesOfQuestions,
  pendingKeyOf,
  withPendingKeys,
  withStoredPictures,
} from './pending-images'
import { estimatedSize, resolutionOf } from './resolved-pictures'
import { ownDocumentMedia } from './local-images'
import { cleanDocument, pendingImageOf, type ProseMirrorJSON } from './question-doc'

const example = join(import.meta.dir, '..', 'public', 'formats', 'question-bank', '0.7.0', 'examples', 'pending-images.json')
const proposal = async () => inspectImportRecord(await Bun.file(example).bytes())
const tags = (...numbers: number[]) => numbers.map((tag) => ({ tag }))

const PAGES = [
  'Social Studies Unit 4. 1. Use the map to name the bus stop farthest east!',
  '2. WHICH graph shows a function that is increasing everywhere? 3. Which bus route has the most stops on the map?',
  '',
  '4) Describe   the circuit shown below. 5. Source: Riverton Times, 2019 (adapted). What is the main idea of this cartoon? Use the chart on page 4 to explain one cause of the flooding.',
]

describe('checking a record against its Source Document', () => {
  test('matches when every tag exists and the stems are in the document’s text', async () => {
    expect(checkAgainstSourceDocument(await proposal(), { tags: tags(1, 2, 3, 4, 5), pageText: PAGES })).toEqual({
      unknownTags: [],
      stemsChecked: 5,
      stemsFound: 5,
      matches: true,
    })
  })

  test('warns when the record names a tag the document does not have', async () => {
    const check = checkAgainstSourceDocument(await proposal(), { tags: tags(1, 2), pageText: PAGES })
    expect(check).toMatchObject({ unknownTags: [3, 4, 5], matches: false })
  })

  test('warns when most stems are not in the document', async () => {
    const check = checkAgainstSourceDocument(await proposal(), {
      tags: tags(1, 2, 3, 4, 5),
      pageText: ['Chemistry quiz. Balance each equation.', PAGES[3]!],
    })
    expect(check).toMatchObject({ stemsChecked: 5, stemsFound: 2, matches: false })
  })

  test('checks only the tags of a document with no text layer', async () => {
    expect(checkAgainstSourceDocument(await proposal(), { tags: tags(1, 2, 3, 4, 5), pageText: ['', ''] })).toEqual({
      unknownTags: [],
      stemsChecked: 0,
      stemsFound: 0,
      matches: true,
    })
  })
})

const graph = { type: 'image-block', attrs: { src: '', caption: 'Graph of f', ratio: 1, pending: { image: 3 } } }
const stored = {
  id: 'question-1',
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Which graph?' }] },
      graph,
      {
        type: 'multipleChoice',
        content: [
          { type: 'multipleChoiceChoice', attrs: { id: 'a', correct: false }, content: [{ type: 'image-block', attrs: { src: '', caption: '', ratio: 1, pending: { page: 2 } } }] },
          { type: 'multipleChoiceChoice', attrs: { id: 'b', correct: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'None' }] }] },
        ],
      },
    ],
  },
}

describe('saving a Question with Pending Images', () => {
  test('keeps what each one names, and gives an ordinary image no pending at all', async () => {
    const editorJson = {
      type: 'doc',
      content: [
        graph,
        { type: 'image-block', attrs: { src: `/local-images/${'a'.repeat(64)}`, caption: '', ratio: 1, pending: null } },
        { type: 'image-block', attrs: { src: '', caption: '', ratio: 1, pending: { image: 0 } } },
      ],
    }
    const cleaned = cleanDocument(editorJson) as { content: { attrs: Record<string, unknown> }[] }
    expect(cleaned.content[0]!.attrs.pending).toEqual({ image: 3 })
    expect('pending' in cleaned.content[1]!.attrs).toBe(false)
    expect('pending' in cleaned.content[2]!.attrs).toBe(false)

    // Owning media on save leaves a Pending Image as it is, rather than
    // replacing it with an image that could not be captured.
    expect(await ownDocumentMedia({ type: 'doc', content: [graph] })).toEqual({ type: 'doc', content: [graph] })
  })

  test('lists a stored Question’s Pending Images and resolves them in place', () => {
    const occurrences = pendingImagesOfQuestions([stored])
    expect(occurrences.map(({ key, where, pending }) => [key, where, pending])).toEqual([
      ['question-1/doc/0', 'Question', { image: 3 }],
      ['question-1/doc/1', 'Answer A', { page: 2 }],
    ])
    const resolved = withStoredPictures(stored, new Map([['question-1/doc/1', { src: `/local-images/${'c'.repeat(64)}`, size: 0.4 }]]))
    expect(pendingImagesOfQuestions([resolved]).map(({ pending }) => pending)).toEqual([{ image: 3 }])
    expect(JSON.stringify(resolved)).toMatch(new RegExp(`"src":"/local-images/${'c'.repeat(64)}"[^}]*"size":0.4}`))
  })
})

describe('previewing Pending Images', () => {
  test('each one carries its key into the editor documents, and only there', async () => {
    const found = await proposal()
    const bank = found.banks[0]!
    const keys = pendingImagesOf(found).map(({ key }) => key)
    const plan = planImport(
      { ...found, banks: [{ ...bank, record: withPendingKeys(bank.id, bank.record) }] },
      initialSelection(found),
      (() => { let next = 0; return () => `id-${next++}` })(),
    )
    const marked: string[] = []
    const visit = (node: ProseMirrorJSON) => {
      const key = pendingKeyOf(node)
      if (key) {
        marked.push(key)
        // What it names is still read exactly.
        expect(pendingImageOf(node)).toBeDefined()
      }
      for (const child of (node.content as ProseMirrorJSON[] | undefined) ?? []) visit(child)
    }
    for (const question of plan.banks[0]!.questions) visit(question.doc)
    expect(marked).toEqual(keys)
    expect(JSON.stringify(bank.record)).not.toContain('"key"')
  })
})

describe('sizing a picture from its page', () => {
  const asset = (width: number) => ({ id: `sha256:${'a'.repeat(64)}`, mimeType: 'image/png' as const, width, height: 100, bytes: '' })
  const crop = (width: number, pageShare: number) => ({ asset: asset(width), origin: { kind: 'crop', page: 1 } as const, pageShare })

  test('prints a picture about as wide as it was on its page', () => {
    // A third of a Letter page, cropped at 300 DPI: wider than the lane, so
    // its size is a share of the lane.
    expect(estimatedSize(crop(850, 1 / 3), { where: 'Question' })).toBe(0.4)
    // A small embedded image narrower than the lane is a share of it too.
    expect(estimatedSize(crop(400, 0.25), { where: 'Question' })).toBe(0.3)
  })

  test('leaves a picture that filled its page, an upload, and a matching set’s pictures at the size they fit', () => {
    expect(estimatedSize(crop(2400, 0.9), { where: 'Question' })).toBeUndefined()
    expect(estimatedSize({ asset: asset(900), origin: { kind: 'upload', name: 'a.png' } }, { where: 'Question' })).toBeUndefined()
    expect(estimatedSize(crop(850, 1 / 3), { where: 'Item 2' })).toBeUndefined()
  })

  // A converted math test's answers were four graphs, each a third of
  // its page wide. Left to fill its cell, each printed as wide as the question
  // whenever the answers were in one column.
  test('knows the columns an imported Exam prints each Question’s answers in', () => {
    const pictured = (image: number) => ({
      id: `c${image}`,
      correct: image === 1,
      content: { type: 'document', content: [{ type: 'block-image', pending: { image }, alt: 'graph' }] },
    })
    const question = (id: string) => ({
      id,
      type: 'multiple-choice',
      stem: { type: 'document', content: [] },
      choices: [pictured(1), pictured(2)],
    })
    const banks = [{ id: 'bank', record: { bank: { questions: [question('q1'), question('q2'), question('q3')] } } }]
    const exams = [{
      positions: [
        { question: { bank: 'bank', question: 'q1' } },
        { question: { bank: 'bank', question: 'q2' }, columns: 4 },
        { question: { bank: 'bank', question: 'q3' } },
      ],
    }]
    const columnsOf = (occurrences: ReturnType<typeof pendingImagesOf>) =>
      occurrences.filter((_, index) => index % 2 === 0).map((occurrence) => occurrence.answerColumns)
    // As the import lays them out: the first takes one column, a Question with
    // none of its own takes the one before it.
    expect(columnsOf(pendingImagesOf({ banks, exams } as never))).toEqual([1, 4, 4])
    // With no Exam, a Question's answers are sized for the columns it starts with.
    expect(columnsOf(pendingImagesOf({ banks } as never))).toEqual([2, 2, 2])
  })

  test('sizes an answer’s picture against its cell, as wide as its answers’ columns make it', () => {
    const graph = crop(850, 1 / 3)
    // Two columns: a third of the page is about the whole cell.
    expect(estimatedSize(graph, { where: 'Answer B', answerColumns: 2 })).toBeUndefined()
    // One column: the cell is the question's width, and the graph a share of it.
    const alone = estimatedSize(graph, { where: 'Answer B', answerColumns: 1 })!
    expect(alone).toBeGreaterThan(0.4)
    expect(alone).toBeLessThan(0.55)
    // A narrower graph in a grid is a share of its cell.
    const small = estimatedSize(crop(850, 0.2), { where: 'Answer C', answerColumns: 2 })!
    expect(small).toBeGreaterThan(0.5)
    expect(small).toBeLessThan(0.7)
    // A Part's answers are sized against a Part's choice area, in the columns
    // a Part starts with.
    const part = estimatedSize(crop(850, 0.2), { where: 'Part a, Answer A' })!
    expect(part).toBeGreaterThan(0.5)
    expect(part).toBeLessThan(0.7)
  })

  test('an import writes the estimated size as the Authored Image Size', async () => {
    const found = await proposal()
    const occurrences = pendingImagesOf(found)
    const first = occurrences[0]!
    const resolution = resolutionOf(new Map([[first.key, crop(850, 1 / 3)]]), occurrences)
    const plan = planImport(found, initialSelection(found), (() => { let next = 0; return () => `id-${next++}` })(), resolution)
    expect(JSON.stringify(plan.banks[0]!.questions[0]!.doc)).toContain('"size":0.4}')
  })

  test('the estimated size replaces the legacy ratio a 0.6.0 Pending Image was written with', async () => {
    const record = await Bun.file(example).json()
    record.formatVersion = '0.6.0'
    record.bank.questions[0].stem.content[1].authoredSize = 0.8
    const found = await inspectImportRecord(new TextEncoder().encode(JSON.stringify(record)))
    const occurrences = pendingImagesOf(found)
    const first = occurrences[0]!
    const ids = () => { let next = 0; return () => `id-${next++}` }

    const sized = planImport(found, initialSelection(found), ids(), resolutionOf(new Map([[first.key, crop(850, 1 / 3)]]), occurrences))
    const sizedDoc = JSON.stringify(sized.banks[0]!.questions[0]!.doc)
    expect(sizedDoc).toContain('"size":0.4}')
    expect(sizedDoc).not.toContain('"ratio"')

    // Left unsized by its resolution, it keeps the size its record gave it.
    const unsized = planImport(found, initialSelection(found), ids(), resolutionOf(new Map([[first.key, crop(850)]]), occurrences))
    expect(JSON.stringify(unsized.banks[0]!.questions[0]!.doc)).toContain('"ratio":0.8}')
  })
})

describe('a Pending Image inside a Side-by-Side', () => {
  const pixel = {
    id: 'sha256:c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77',
    mimeType: 'image/png' as const,
    width: 1,
    height: 1,
    bytes: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  }
  const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const pictured = (image: number) => ({ type: 'block-image', pending: { image }, alt: `Graph ${image}` })
  const panels = (...blocks: unknown[]) => ({
    type: 'side-by-side',
    content: blocks.map((block) => ({ type: 'panel', content: [block] })),
  })
  const record = {
    format: 'test-parrot/question-bank',
    formatVersion: '0.6.0',
    generator: { name: 'Assistant', version: '1' },
    requiredFeatures: [],
    bank: {
      name: 'Graphs',
      questions: [
        {
          id: 'q1',
          type: 'short-answer',
          stem: { type: 'document', content: [paragraph('Compare the graphs.'), panels(pictured(1), pictured(2))] },
        },
        {
          id: 'q2',
          type: 'multipart',
          stem: { type: 'document', content: [paragraph('Use the graphs.')] },
          parts: [
            {
              id: 'q2-s1',
              type: 'short-answer',
              stem: { type: 'document', content: [panels(paragraph('Before'), pictured(3))] },
            },
          ],
        },
      ],
    },
    media: [],
  }
  const found = async () => inspectImportRecord(new TextEncoder().encode(JSON.stringify(record)))

  test('is found where it sits, in a stem or a Part’s stem, and resolved in place', async () => {
    const proposal = await found()
    const occurrences = pendingImagesOf(proposal)
    expect(occurrences.map(({ where, pending }) => [where, pending])).toEqual([
      ['Question', { image: 1 }],
      ['Question', { image: 2 }],
      ['Part a', { image: 3 }],
    ])
    // Each fills its Panel rather than taking the lane's share it had on
    // its page.
    expect(occurrences.every((occurrence) => occurrence.inPanel)).toBe(true)
    const third = { asset: { ...pixel, width: 850 }, origin: { kind: 'crop', page: 1 } as const, pageShare: 1 / 3 }
    expect(estimatedSize(third, { where: 'Question' })).toBe(0.4)
    expect(estimatedSize(third, occurrences[0]!)).toBeUndefined()

    const resolution = new Map(occurrences.map(({ key }) => [key, { asset: pixel }]))
    const plan = planImport(proposal, initialSelection(proposal), (() => { let next = 0; return () => `id-${next++}` })(), resolution)
    const [compared, multipart] = plan.banks[0]!.questions
    const sideBySide = (compared!.doc.content as ProseMirrorJSON[])[1]!
    expect(sideBySide.type).toBe('sideBySide')
    const hash = pixel.id.slice('sha256:'.length)
    expect(JSON.stringify(sideBySide)).toContain(`/local-images/${hash}`)
    expect(JSON.stringify(sideBySide)).not.toContain('pending')
    expect(JSON.stringify(multipart!.doc)).toContain(`/local-images/${hash}`)
  })

  test('in a stored Question, is listed and given its stored picture', () => {
    const question = {
      id: 'stored',
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Compare.' }] },
          {
            type: 'sideBySide',
            content: [
              { type: 'sideBySidePanel', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Left' }] }] },
              { type: 'sideBySidePanel', content: [{ type: 'image-block', attrs: { src: '', pending: { image: 4 } } }] },
            ],
          },
        ],
      },
    }
    expect(pendingImagesOfQuestions([question]).map(({ key, where, pending }) => [key, where, pending])).toEqual([
      ['stored/doc/0', 'Question', { image: 4 }],
    ])
    const resolved = withStoredPictures(question, new Map([['stored/doc/0', { src: `/local-images/${'d'.repeat(64)}` }]]))
    expect(pendingImagesOfQuestions([resolved])).toEqual([])
    expect(JSON.stringify(resolved)).toContain(`/local-images/${'d'.repeat(64)}`)
  })
})
