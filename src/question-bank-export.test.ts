import { describe, expect, test } from 'bun:test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { partsOf, type Question } from './exam'
import { PIXEL_PNG, mark, paragraph, text } from './export-fixtures'
import type { ProseMirrorJSON } from './question-doc'
import type { QuestionBankResource } from './question-bank-workspaces'
import { PAGE_CONTENT_WIDTH } from './export-plan'
import {
  QUESTION_BANK_FORMAT,
  QUESTION_BANK_FORMAT_VERSION,
  prepareQuestionBankExport,
  recordDocumentToEditorNodes,
  questionBankFilename,
  type PreparedQuestionBankExport,
  type QuestionBankRecord,
} from './question-bank-export'
import {
  importedQuestionsFromRecord,
  inspectQuestionBankRecordValue,
  packageFiles,
} from './question-bank-import'
import { readPackageZip } from './package-zip'
import {
  createQuestionBankPdf,
  type QuestionBankPdfFontLoader,
} from './question-bank-pdf'

/** Read an export's record back the way import reads it: its pictures are
 *  the files beside it, as they are in its zip. */
const reinspect = (prepared: PreparedQuestionBankExport) =>
  inspectQuestionBankRecordValue(JSON.parse(new TextDecoder().decode(prepared.recordBytes)), undefined, packageFiles(prepared.files))

async function pagesText(reader: Awaited<ReturnType<typeof getDocument>['promise']>): Promise<string[]> {
  return Promise.all(
    Array.from({ length: reader.numPages }, async (_, index) =>
      (await (await reader.getPage(index + 1)).getTextContent()).items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' '),
    ),
  )
}

const fontFiles = {
  regular: new URL('../public/fonts/FreeSans.ttf', import.meta.url).pathname,
  bold: new URL('../public/fonts/FreeSansBold.ttf', import.meta.url).pathname,
  italic: new URL('../public/fonts/FreeSansOblique.ttf', import.meta.url).pathname,
  boldItalic: new URL('../public/fonts/FreeSansBoldOblique.ttf', import.meta.url).pathname,
  mono: new URL('../public/fonts/FreeMono.ttf', import.meta.url).pathname,
} as const
const fonts: QuestionBankPdfFontLoader = async (style) =>
  Bun.file(fontFiles[style]).arrayBuffer()

function choice(id: string, correct: boolean, value: string) {
  return {
    type: 'multipleChoiceChoice',
    attrs: { id, correct },
    content: [paragraph(text(value))],
  }
}

function bank(questions: Question[]): QuestionBankResource {
  return {
    id: 'local-bank-id',
    name: 'Chemistry / Review',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUpdatedAt: '2026-02-01T00:00:00.000Z',
    questions,
  }
}

const shortAnswer: Question = {
  id: 'local-short-answer-id',
  type: 'open',
  columns: 4,
  difficulty: 'hard',
  topics: ['Matter', 'Lab'],
  doc: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [text('Evidence')] },
      { type: 'blockquote', content: [paragraph(text('Observe carefully.'))] },
      {
        type: 'bullet_list',
        content: [
          { type: 'list_item', content: [paragraph(text('Record mass.'))] },
        ],
      },
      {
        type: 'ordered_list',
        attrs: { order: 3 },
        content: [
          { type: 'list_item', content: [paragraph(text('Explain change.'))] },
        ],
      },
      {
        type: 'code_block',
        attrs: { language: 'python' },
        content: [text('mass = before - after')],
      },
      { type: 'hr' },
      {
        type: 'table',
        content: [
          {
            type: 'table_header_row',
            content: [
              { type: 'table_header', content: [paragraph(text('Trial'))] },
            ],
          },
          {
            type: 'table_row',
            content: [
              { type: 'table_cell', content: [paragraph(text('One'))] },
            ],
          },
        ],
      },
      paragraph(
        text('Use ', mark('strong')),
        text('the notes', mark('link', { href: 'https://example.test/notes' })),
        text(' with emphasis', mark('emphasis')),
        text(' code', mark('inlineCode')),
        text(' strike', mark('strike_through')),
        text(' H'),
        text('2', mark('subscript')),
        text(' and x'),
        text('2', mark('superscript')),
        { type: 'hardbreak' },
        { type: 'math_inline', attrs: { value: 'E = mc^2' } },
      ),
      {
        type: 'code_block',
        attrs: { language: 'latex' },
        content: [text('x^2 + y^2')],
      },
    ],
  },
  suggestedAnswer: {
    type: 'doc',
    content: [paragraph(text('Mass is conserved.', mark('emphasis')))],
  },
}

const multipleChoice: Question = {
  id: 'local-multiple-choice-id',
  type: 'multiple-choice',
  columns: 1,
  difficulty: 'easy',
  topics: ['Atoms'],
  doc: {
    type: 'doc',
    content: [
      paragraph(text('Which particle has no charge?')),
      {
        type: 'multipleChoice',
        content: [
          choice('local-choice-a', false, 'Proton'),
          choice('local-choice-b', true, 'Neutron'),
          choice('local-choice-c', false, 'Electron'),
        ],
      },
    ],
  },
}

const trueFalse: Question = {
  id: 'local-true-false-id',
  type: 'true-false',
  columns: 2,
  doc: {
    type: 'doc',
    content: [
      paragraph(text('Sound travels faster in water than in air.')),
      {
        type: 'multipleChoice',
        content: [
          choice('local-choice-true', false, 'True'),
          choice('local-choice-false', true, 'False'),
        ],
      },
    ],
  },
}

const matching: Question = {
  id: 'local-matching-id',
  type: 'matching',
  columns: 2,
  topics: ['Early history'],
  doc: {
    type: 'doc',
    content: [
      paragraph(text('Match each event to the correct time period.')),
      {
        type: 'matching',
        content: [
          {
            type: 'matchingPrompt',
            attrs: { id: 'local-prompt-1', answer: 'local-answer-c' },
            content: [paragraph(text('Bronze tools were first made.'))],
          },
          {
            type: 'matchingPrompt',
            attrs: { id: 'local-prompt-2', answer: 'gone' },
            content: [paragraph(text('Castles were built.'))],
          },
          { type: 'matchingAnswer', attrs: { id: 'local-answer-a' }, content: [paragraph(text('Stone Age'))] },
          { type: 'matchingAnswer', attrs: { id: 'local-answer-b' }, content: [paragraph(text('Middle Ages'))] },
          { type: 'matchingAnswer', attrs: { id: 'local-answer-c' }, content: [paragraph(text('Bronze Age'))] },
        ],
      },
    ],
  },
}

// A Multipart question with one Multiple Choice Part and one Short Answer Part. The
// Short Answer Part's Suggested Answer stays inside the document, and the
// Multiple Choice Part's answer columns are presentation the record omits.
const multipart: Question = {
  id: 'local-multipart-id',
  type: 'multipart',
  columns: 2,
  difficulty: 'medium',
  topics: ['Kingdom of Aldmere'],
  doc: {
    type: 'doc',
    content: [
      paragraph(text('The power of the Kingdom of Aldmere was fading by 1450 …')),
      paragraph(text('Source: “A Short History of Aldmere,” 1998 (adapted)')),
      {
        type: 'multipartParts',
        content: [
          {
            type: 'multipartPart',
            attrs: { id: 'local-part-a', columns: 4 },
            content: [
              {
                type: 'multipartPartStem',
                content: [paragraph(text('Which region was controlled by the Kingdom of Aldmere in 1450?'))],
              },
              {
                type: 'multipleChoice',
                content: [
                  choice('local-part-a-1', false, 'Western Hills'),
                  choice('local-part-a-2', false, 'Southern Plains'),
                  choice('local-part-a-3', false, 'Eastern Forests'),
                  choice('local-part-a-4', true, 'Northern Coast'),
                ],
              },
            ],
          },
          {
            type: 'multipartPart',
            attrs: { id: 'local-part-b', columns: 2 },
            content: [
              {
                type: 'multipartPartStem',
                content: [paragraph(text('Identify an issue faced by the Kingdom of Aldmere in the 1400s.'))],
              },
              {
                type: 'suggestedAnswer',
                content: [paragraph(text('Its harbors silted up.'))],
              },
            ],
          },
        ],
      },
    ],
  },
}

const emptyMultipart: Question = {
  id: 'local-empty-multipart-id',
  type: 'multipart',
  columns: 2,
  doc: {
    type: 'doc',
    content: [
      paragraph(text('Study the map of the Silk Road.')),
      { type: 'multipartParts', content: [] },
    ],
  },
}

describe('Question Bank exchange export seam', () => {
  test('builds the authoritative semantic record in canonical stored order', async () => {
    const prepared = await prepareQuestionBankExport(
      bank([shortAnswer, multipleChoice]),
    )
    const parsed = JSON.parse(
      new TextDecoder().decode(prepared.recordBytes),
    ) as QuestionBankRecord

    expect(parsed).toEqual(prepared.record)
    expect(parsed.format).toBe(QUESTION_BANK_FORMAT)
    expect(parsed.formatVersion).toBe(QUESTION_BANK_FORMAT_VERSION)
    expect(parsed.bank.questions.map((question) => question.id)).toEqual([
      'q1',
      'q2',
    ])
    expect(parsed.bank.questions.map((question) => question.type)).toEqual([
      'short-answer',
      'multiple-choice',
    ])
    expect(parsed.bank.questions[0]).toMatchObject({
      difficulty: 'hard',
      topics: ['Matter', 'Lab'],
      suggestedAnswer: {
        type: 'document',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Mass is conserved.' }],
          },
        ],
      },
    })
    expect(parsed.bank.questions[1]).toMatchObject({
      difficulty: 'easy',
      topics: ['Atoms'],
      choices: [
        { id: 'q2-c1', correct: false },
        { id: 'q2-c2', correct: true },
        { id: 'q2-c3', correct: false },
      ],
    })
    expect(JSON.stringify(parsed)).not.toContain('local-')
    expect(JSON.stringify(parsed)).not.toContain('columns')
    expect(JSON.stringify(parsed)).not.toContain('createdAt')
    expect(JSON.stringify(parsed)).not.toContain('multipleChoiceChoice')
    expect(parsed.media).toEqual([])
  })

  test('writes a True/False Question as its own type, carrying the fixed pair', async () => {
    const { record } = await prepareQuestionBankExport(bank([trueFalse]))

    expect(record.bank.questions[0]).toMatchObject({
      id: 'q1',
      type: 'true-false',
      choices: [
        { id: 'q1-c1', correct: false },
        { id: 'q1-c2', correct: true },
      ],
    })
    // The pair goes out as authored content so an importer needs no table of
    // what True/False means, and no Suggested Answer rides along with it.
    expect(record.bank.questions[0]!.choices![0]!.content).toEqual({
      type: 'document',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'True' }] }],
    })
    expect(record.bank.questions[0]!.suggestedAnswer).toBeUndefined()
  })

  test('refuses a True/False Question that does not ask with exactly two answers', async () => {
    const extra: Question = {
      ...trueFalse,
      doc: {
        type: 'doc',
        content: [
          paragraph(text('Sound travels faster in water than in air.')),
          {
            type: 'multipleChoice',
            content: [
              choice('tf-t', false, 'True'),
              choice('tf-f', true, 'False'),
              choice('tf-x', false, 'Sometimes'),
            ],
          },
        ],
      },
    }
    await expect(prepareQuestionBankExport(bank([extra]))).rejects.toThrow(
      /True\/False and must have exactly two choices/,
    )
  })

  test('writes a matching set as its items and Word Bank, each item naming its answer by package-local id', async () => {
    const { record } = await prepareQuestionBankExport(bank([matching]))

    expect(record.bank.questions[0]).toMatchObject({
      id: 'q1',
      type: 'matching',
      stem: {
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Match each event to the correct time period.' }],
          },
        ],
      },
      prompts: [
        { id: 'q1-p1', answer: 'q1-a3' },
        // An answer the Word Bank no longer holds is no answer.
        { id: 'q1-p2' },
      ],
      wordBank: [{ id: 'q1-a1' }, { id: 'q1-a2' }, { id: 'q1-a3' }],
    })
    expect(record.bank.questions[0]!.prompts![1]).not.toHaveProperty('answer')
    expect(record.bank.questions[0]!.choices).toBeUndefined()
    const encoded = JSON.stringify(record)
    expect(encoded).not.toContain('local-')
    expect(encoded).not.toContain('matchingPrompt')
    expect(encoded).not.toContain('matchingAnswer')
  })

  test('refuses a matching set with fewer than two Word Bank answers', async () => {
    const thin: Question = {
      ...matching,
      doc: {
        type: 'doc',
        content: [
          paragraph(text('Match.')),
          {
            type: 'matching',
            content: [
              { type: 'matchingPrompt', attrs: { id: 'p', answer: '' }, content: [paragraph(text('Item'))] },
              { type: 'matchingAnswer', attrs: { id: 'a' }, content: [paragraph(text('Only'))] },
            ],
          },
        ],
      },
    }
    await expect(prepareQuestionBankExport(bank([thin]))).rejects.toThrow(
      /at least two Word Bank answers/,
    )
  })

  test('writes a Multipart question as its material and lettered Parts, each under a package-local id', async () => {
    const { record } = await prepareQuestionBankExport(bank([multipart, emptyMultipart]))

    expect(record.formatVersion).toBe('0.10.0')
    expect(record.bank.questions[0]).toEqual({
      id: 'q1',
      type: 'multipart',
      stem: {
        type: 'document',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'The power of the Kingdom of Aldmere was fading by 1450 …' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Source: “A Short History of Aldmere,” 1998 (adapted)' }],
          },
        ],
      },
      difficulty: 'medium',
      topics: ['Kingdom of Aldmere'],
      parts: [
        {
          id: 'q1-s1',
          type: 'multiple-choice',
          stem: expect.objectContaining({ type: 'document' }),
          choices: [
            { id: 'q1-s1-c1', content: expect.anything(), correct: false },
            { id: 'q1-s1-c2', content: expect.anything(), correct: false },
            { id: 'q1-s1-c3', content: expect.anything(), correct: false },
            { id: 'q1-s1-c4', content: expect.anything(), correct: true },
          ],
        },
        {
          id: 'q1-s2',
          type: 'short-answer',
          stem: expect.objectContaining({ type: 'document' }),
          suggestedAnswer: {
            type: 'document',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Its harbors silted up.' }] },
            ],
          },
        },
      ],
    })
    // A Multipart question with no Parts yet is incomplete, not unexportable.
    expect(record.bank.questions[1]).toMatchObject({ id: 'q2', type: 'multipart', parts: [] })
    const encoded = JSON.stringify(record)
    expect(encoded).not.toContain('local-')
    expect(encoded).not.toContain('multipartPart')
    expect(encoded).not.toContain('columns')
  })

  test('a Multipart question round-trips through the record with its Parts, answers and Suggested Answer intact', async () => {
    const first = await prepareQuestionBankExport(bank([multipart, emptyMultipart]))
    const inspected = await reinspect(first)
    const imported = importedQuestionsFromRecord(inspected.record)

    expect(imported.map((question) => question.type)).toEqual(['multipart', 'multipart'])
    const parts = partsOf(imported[0]!)
    expect(parts.map((part) => part.type)).toEqual(['multiple-choice', 'open'])
    expect(parts[0]!.choices.map((choice) => choice.correct)).toEqual([false, false, false, true])
    expect(parts[0]!.id).not.toBe('local-part-a')
    expect(partsOf(imported[1]!)).toEqual([])

    const second = await prepareQuestionBankExport(bank(imported))
    expect(second.record.bank).toEqual(first.record.bank)
  })

  test('collects images inside Part stems, choices and Suggested Answers into media', async () => {
    const withImages = structuredClone(multipart)
    const [partA, partB] = (withImages.doc.content as Record<string, unknown>[]).at(-1)!
      .content as { content: Record<string, unknown>[] }[]
    const image = (name: string) => ({ type: 'image-block', attrs: { src: `/local-images/${name}` } })
    partA!.content[0]!.content = [image('stem')]
    ;(partA!.content[1]!.content as { content: unknown[] }[])[0]!.content = [paragraph(text('Map')), image('choice')]
    partB!.content[1]!.content = [image('answer')]
    const loaded: string[] = []
    const { record } = await prepareQuestionBankExport(bank([withImages]), async (source) => {
      loaded.push(source)
      return { data: new TextEncoder().encode(source), mimeType: 'image/png', width: 1, height: 1 }
    })

    expect(loaded).toEqual(['/local-images/stem', '/local-images/choice', '/local-images/answer'])
    expect(record.media).toHaveLength(3)
    const parts = record.bank.questions[0]!.parts!
    for (const document of [parts[0]!.stem, parts[0]!.choices![0]!.content, parts[1]!.suggestedAnswer!]) {
      expect(JSON.stringify(document)).toContain('sha256:')
    }
  })

  test('refuses a Multiple Choice Part with fewer than two choices', async () => {
    const thin = structuredClone(multipart)
    const [partA] = (thin.doc.content as Record<string, unknown>[]).at(-1)!
      .content as { content: { content: unknown[] }[] }[]
    partA!.content[1]!.content.splice(1)
    await expect(prepareQuestionBankExport(bank([thin]))).rejects.toThrow(
      'Question 1, Part a must have at least two choices.',
    )
  })

  test('exports only explicitly stored provenance', async () => {
    const source = {
      ...bank([shortAnswer]),
      description: 'Semester review',
      author: 'Ada Teacher',
      license: { name: 'CC BY', url: 'https://example.test/license' },
    }
    const { record } = await prepareQuestionBankExport(source)
    expect(record.bank).toMatchObject({
      description: 'Semester review',
      author: 'Ada Teacher',
      license: { name: 'CC BY', url: 'https://example.test/license' },
    })
    expect(JSON.stringify(record)).not.toContain('createdAt')
  })

  test('preserves every supported media-free rich-text semantic without editor node names', async () => {
    const { record } = await prepareQuestionBankExport(bank([shortAnswer]))
    const encoded = JSON.stringify(record.bank.questions[0]!.stem)

    for (const semantic of [
      'heading',
      'blockquote',
      'bullet-list',
      'ordered-list',
      'list-item',
      'code-block',
      'rule',
      'table',
      'table-row',
      'table-cell',
      'inline-math',
      'display-math',
      'hard-break',
      'text',
      'strong',
      'emphasis',
      'inline-code',
      'strike',
      'subscript',
      'superscript',
      'link',
    ])
      expect(encoded).toContain(`"${semantic}"`)
    expect(encoded).toContain('https://example.test/notes')
  })

  test('rejects unsafe links, missing media, and invalid Multiple Choice correctness', async () => {
    const unsafe = structuredClone(shortAnswer)
    const unsafeParagraph = (
      unsafe.doc.content as Record<string, unknown>[]
    )[7]!
    const linked = (unsafeParagraph.content as Record<string, unknown>[])[1]!
    ;(
      (linked.marks as Record<string, unknown>[])[0]!.attrs as Record<
        string,
        unknown
      >
    ).href = 'javascript:alert(1)'
    await expect(prepareQuestionBankExport(bank([unsafe]))).rejects.toThrow(
      'HTTP or HTTPS',
    )

    const image = structuredClone(shortAnswer)
    ;(image.doc.content as Record<string, unknown>[]).push({
      type: 'image-block',
      attrs: { src: '/local-images/deadbeef' },
    })
    await expect(prepareQuestionBankExport(bank([image]))).rejects.toThrow(
      'Required media',
    )

    const twoCorrect = structuredClone(multipleChoice)
    const choices = (twoCorrect.doc.content as Record<string, unknown>[])[1]!
      .content as Record<string, unknown>[]
    ;(choices[0]!.attrs as Record<string, unknown>).correct = true
    await expect(prepareQuestionBankExport(bank([twoCorrect]))).rejects.toThrow(
      'zero or one correct choice',
    )

    const oneChoice = structuredClone(multipleChoice)
    ;((oneChoice.doc.content as Record<string, unknown>[])[1]!
      .content as unknown[]) = [choice('one', false, 'Only')]
    await expect(prepareQuestionBankExport(bank([oneChoice]))).rejects.toThrow(
      'at least two choices',
    )
  })

  test('embeds referenced media once and preserves image semantics', async () => {
    const digest = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
    const image = structuredClone(shortAnswer)
    ;(image.doc.content as Record<string, unknown>[]).push({
      type: 'image-block',
      attrs: { src: '/local-images/shared', alt: 'Lab setup', caption: 'Figure 1', size: 0.5 },
    }, {
      type: 'image-block',
      attrs: { src: '/local-images/shared', alt: 'Repeated setup' },
    })
    const prepared = await prepareQuestionBankExport(bank([image]), async () => ({
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      width: 10,
      height: 20,
    }))

    expect(prepared.record.media).toEqual([{
      id: `sha256:${digest}`,
      mimeType: 'image/png',
      width: 10,
      height: 20,
      file: `media/sha256-${digest}.png`,
    }])
    expect([...prepared.files]).toEqual([[`media/sha256-${digest}.png`, new Uint8Array([1, 2, 3])]])
    expect(JSON.stringify(prepared.record.bank)).toContain(`sha256:${digest}`)
    expect(JSON.stringify(prepared.record.bank)).toContain('"authoredSize":0.5')
  })

  test('requires a non-empty bank and creates safe filenames', async () => {
    await expect(prepareQuestionBankExport(bank([]))).rejects.toThrow(
      'at least one Question',
    )
    expect(questionBankFilename('  Álgebra: Unit / 1?  ')).toBe(
      'algebra-unit-1.question-bank.pdf',
    )
    expect(questionBankFilename(' ::: ')).toBe(
      'untitled-question-bank.question-bank.pdf',
    )
  })

  test('attaches its bank as a package zip, the sole canonical attachment, and renders a complete preview', async () => {
    const prepared = await prepareQuestionBankExport(
      bank([shortAnswer, multipleChoice]),
    )
    const bytes = await createQuestionBankPdf(prepared, fonts)
    const source = new TextDecoder('latin1').decode(bytes)
    const reader = await getDocument({
      data: bytes.slice(),
      disableWorker: true,
    }).promise
    const attachments = await reader.getAttachments()
    const attachment = attachments?.get('parrot.zip')

    expect([...attachments!.keys()]).toEqual(['parrot.zip'])
    expect(attachment?.description).toBe('pdf-canonical-extraction')
    expect(source).toContain('/Subtype /application#2Fzip')
    const zip = await readPackageZip(await reader.getAttachmentContent('parrot.zip'))
    const carried = JSON.parse(new TextDecoder().decode(zip.json))
    expect(carried).toMatchObject({ format: 'test-parrot/package', exams: [] })
    expect(carried.questionBanks).toEqual([{ id: 'bank-1', record: prepared.record }])

    const preview = (await pagesText(reader)).join(' ')
    expect(preview).toContain('TEST PARROT')
    expect(preview).toContain('QUESTION BANK FILE')
    expect(preview).toContain('Chemistry / Review')
    expect(preview).toContain('2 Questions')
    expect(preview).toContain('A digital file for importing into Test Parrot')
    expect(preview).toContain('answers included')
    expect(preview).toContain('saving it again as a PDF')
    expect(preview).toContain('Short Answer')
    expect(preview).toContain('Multiple Choice')
    expect(preview).toMatch(/Difficulty:\s+Hard/)
    expect(preview).toMatch(/Topics:\s+Matter, Lab/)
    expect(preview).toContain('Suggested Answer')
    expect(preview).toContain('Mass is conserved.')
    expect(preview).toContain('Neutron')
    expect(preview).toContain('Correct answer')
    expect(preview).not.toContain('Student Name')
    expect(preview).not.toContain('Answer Section')
    expect(preview).not.toContain('Version A')
    expect(source).toContain('/AFRelationship /Source')
  })

  test('draws Test Parrot’s logo atop the file and teacher.dev’s beside its credit, both linked where they belong', async () => {
    const png = async () => new Uint8Array(await Bun.file(new URL('../public/logo.png', import.meta.url).pathname).arrayBuffer())
    const prepared = await prepareQuestionBankExport(bank([multipleChoice]))
    const plain = await createQuestionBankPdf(prepared, fonts)
    const branded = await createQuestionBankPdf(prepared, fonts, { logo: png, teacherDevLogo: png })
    const imagesOn = async (bytes: Uint8Array) => {
      const reader = await getDocument({ data: bytes.slice(), disableWorker: true }).promise
      const operators = await (await reader.getPage(1)).getOperatorList()
      return operators.fnArray.filter((fn) => fn === 85 /* paintImageXObject */).length
    }
    expect(await imagesOn(plain)).toBe(0)
    expect(await imagesOn(branded)).toBe(2)
    const reader = await getDocument({ data: branded.slice(), disableWorker: true }).promise
    const urls = (await (await reader.getPage(1)).getAnnotations()).map((annotation) => annotation.url).filter(Boolean)
    expect(urls.filter((url) => url === 'https://teacher.dev/')).toHaveLength(2)
  })

  test('previews a Centred caption in the middle of the page’s column, and a left paragraph at its left', async () => {
    const centred: Question = {
      id: 'centred-sa',
      type: 'open',
      columns: 4,
      doc: {
        type: 'doc',
        content: [
          paragraph(text('Describe the leaf in Fig. 1.1.')),
          { ...paragraph(text('Fig. 1.1')), attrs: { align: 'center' } },
        ],
      },
    }
    const prepared = await prepareQuestionBankExport(bank([centred]))
    expect(JSON.stringify(prepared.record.bank)).toContain('"align":"center"')
    const bytes = await createQuestionBankPdf(prepared, fonts)
    const reader = await getDocument({ data: bytes.slice(), disableWorker: true }).promise
    const items = (await (await reader.getPage(2)).getTextContent()).items as { str: string; transform: number[]; width: number }[]
    const caption = items.find((item) => item.str.trim() === 'Fig. 1.1')!
    const left = items.find((item) => item.str.includes('Describe the leaf'))!
    // Letter paper, 54pt margins: the column's middle is 306pt across.
    expect(Math.abs(caption.transform[4]! + caption.width / 2 - 306)).toBeLessThan(1)
    expect(left.transform[4]).toBeCloseTo(54, 0)
  })

  test('opens with an outline of its Question Types and their Topics, every entry a link into the preview', async () => {
    const tagged = (question: Question, topics: string[], id: string): Question => ({ ...structuredClone(question), id, topics })
    const prepared = await prepareQuestionBankExport(bank([
      tagged(multipleChoice, ['Waves', 'Atoms'], 'wave-mc'),
      tagged(shortAnswer, [], 'plain-sa'),
      tagged(multipleChoice, ['Atoms'], 'atom-mc'),
      tagged(multipleChoice, [], 'plain-mc'),
    ]))
    const bytes = await createQuestionBankPdf(prepared, fonts)
    const reader = await getDocument({ data: bytes.slice(), disableWorker: true }).promise
    const pages = await pagesText(reader)

    // The front matter lists each type, with its count, then its Topics.
    const front = pages[0]!
    const order = ['Question Types', 'Multiple Choice', '3', 'Atoms', '1', 'Waves', '1', 'No topic', '1', 'Short Answer', '1']
    let from = 0
    for (const fragment of order) {
      const at = front.indexOf(fragment, from)
      expect(at, fragment).toBeGreaterThanOrEqual(0)
      from = at + fragment.length
    }
    // Each type starts a page, and a Question with several Topics is placed
    // once, under its first.
    expect(pages[1]).toContain('Multiple Choice')
    expect(pages.join(' ').match(/Question 1\b/g)).toHaveLength(1)
    expect(pages.slice(1).join(' ').indexOf('Atoms')).toBeLessThan(pages.slice(1).join(' ').indexOf('Waves'))

    // Every row and bubble links inside the file: 2 types, 3 Multiple Choice
    // Topics on the front page, and the same Topics again atop their section.
    const annotations = (await (await reader.getPage(1)).getAnnotations()).filter((annotation) => annotation.subtype === 'Link')
    const links = annotations.filter((annotation) => annotation.dest)
    expect(links).toHaveLength(5)
    // The notice links to Test Parrot's import page, and the credit to teacher.dev.
    expect(annotations.filter((annotation) => annotation.url).map((annotation) => annotation.url)).toEqual([
      'https://testparrot.com/imports/new',
      'https://teacher.dev/',
    ])
    expect(front).toContain('Test Parrot is a free exam builder by')
    const sectionLinks = (await (await reader.getPage(2)).getAnnotations()).filter((annotation) => annotation.subtype === 'Link')
    expect(sectionLinks).toHaveLength(3)
    const target = await reader.getPageIndex((links[0]!.dest as [{ num: number; gen: number }])[0])
    expect(target).toBe(1)

    // The sidebar shows the same outline.
    const outline = await reader.getOutline()
    expect(outline.map((item) => item.title)).toEqual([
      'About this Question Bank',
      'Multiple Choice (3)',
      'Short Answer (1)',
    ])
    expect(outline[1]!.items.map((item) => item.title)).toEqual(['Atoms (1)', 'Waves (1)', 'No topic (1)'])
  })

  test('previews a Multipart question as its material, then its lettered Parts with their answers', async () => {
    const prepared = await prepareQuestionBankExport(bank([multipart, emptyMultipart]))
    const bytes = await createQuestionBankPdf(prepared, fonts)
    const reader = await getDocument({ data: bytes.slice(), disableWorker: true }).promise
    const preview = (
      await Promise.all(
        Array.from({ length: reader.numPages }, async (_, index) =>
          (await (await reader.getPage(index + 1)).getTextContent()).items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' '),
        ),
      )
    ).join(' ')

    expect(preview).toContain('Multipart')
    const order = [
      'The power of the Kingdom of Aldmere',
      'Source:',
      'a.',
      'Which region was controlled',
      'Northern Coast',
      'Correct answer',
      'b.',
      'Identify an issue',
      'Suggested Answer',
      'Its harbors silted up.',
      'No Parts yet.',
    ].map((fragment) => preview.indexOf(fragment))
    expect(order.every((position) => position >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((left, right) => left - right))
  })

  test('paginates long Question Content instead of overflowing', async () => {
    const long = structuredClone(shortAnswer)
    long.doc = {
      type: 'doc',
      content: Array.from({ length: 120 }, (_, index) =>
        paragraph(text(`Complete line ${index + 1}`)),
      ),
    }
    delete long.suggestedAnswer
    const prepared = await prepareQuestionBankExport(bank([long]))
    const bytes = await createQuestionBankPdf(prepared, fonts)
    const reader = await getDocument({ data: bytes, disableWorker: true })
      .promise
    expect(reader.numPages).toBeGreaterThan(1)
    const last = await (await reader.getPage(reader.numPages)).getTextContent()
    expect(
      last.items.map((item) => ('str' in item ? item.str : '')).join(' '),
    ).toContain('Complete line 120')
  })
})

describe('a Question Bank File’s equations and pictures', () => {
  const question = (content: unknown[]): Question => ({
    id: 'local-typeset',
    type: 'open',
    columns: 1,
    doc: { type: 'doc', content: content as never },
  })

  test('typesets an equation as the Exam PDF does, never printing its LaTeX', async () => {
    const prepared = await prepareQuestionBankExport(bank([question([
      paragraph(text('Add '), { type: 'math_inline', attrs: { value: '\\frac{3}{5} + \\frac{4}{15}' } }, text(' now.')),
      { type: 'code_block', attrs: { language: 'latex' }, content: [text('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}')] },
    ])]))
    const bytes = await createQuestionBankPdf(prepared, fonts)
    const reader = await getDocument({ data: bytes.slice(), disableWorker: true }).promise
    const preview = (await pagesText(reader)).join(' ')
    expect(preview).not.toContain('\\frac')
    expect(preview).not.toContain('\\sqrt')
    // Written over what is drawn, invisibly, so it can be searched and copied.
    expect(preview).toContain('3⁄5')
    const operators = await (await reader.getPage(2)).getOperatorList()
    const filledPaths = operators.fnArray.filter((fn) => fn === 91 /* constructPath */).length
    expect(filledPaths).toBeGreaterThan(10)
  })

  const pictureWidth = async (attrs: Record<string, unknown>, pixelWidth: number) => {
    const prepared = await prepareQuestionBankExport(bank([question([
      { type: 'image-block', attrs: { src: '/local-images/picture', ...attrs } },
    ])]), async () => ({ data: PIXEL_PNG.data, mimeType: 'image/png', width: pixelWidth, height: pixelWidth / 2 }))
    // The preview draws what it was given at the width the record asks for;
    // its pixel size is the one the loader declared.
    prepared.previewMedia!.forEach((media) => Object.assign(media, { width: pixelWidth, height: pixelWidth / 2 }))
    const bytes = await createQuestionBankPdf(prepared, fonts)
    const reader = await getDocument({ data: bytes.slice(), disableWorker: true }).promise
    const operators = await (await reader.getPage(2)).getOperatorList()
    const transform = operators.argsArray.find((args, index) =>
      operators.fnArray[index] === 12 /* transform */ && Array.isArray(args) && args[0] > 1 && args[3] > 1) as number[]
    return transform[0]!
  }

  test('draws a picture no one sized at its own width, or the column’s when that is narrower', async () => {
    expect(await pictureWidth({}, 200)).toBeCloseTo(150)
    expect(await pictureWidth({}, 2000)).toBeCloseTo(504)
    expect(await pictureWidth({ size: 0.5 }, 200)).toBeCloseTo(252)
  })
})

describe('a Question Bank with Pending Images', () => {
  const pictured: Question = {
    id: 'local-pictured-id',
    type: 'multiple-choice',
    columns: 1,
    doc: {
      type: 'doc',
      content: [
        paragraph(text('Which graph is increasing?')),
        { type: 'image-block', attrs: { src: '', caption: 'Graphs of f and g', ratio: 1, pending: { image: 3 } } },
        {
          type: 'multipleChoice',
          content: [
            { type: 'multipleChoiceChoice', attrs: { id: 'a', correct: true }, content: [{ type: 'image-block', attrs: { src: '', caption: '', ratio: 1, pending: { page: 2 } } }] },
            choice('b', false, 'Neither'),
          ],
        },
      ],
    },
  }

  test('shares them unresolved: in the record, as a box in the preview, and back again on import', async () => {
    const prepared = await prepareQuestionBankExport(bank([pictured]), async () => {
      throw new Error('a Pending Image has no media to load')
    })
    expect(prepared.record.formatVersion).toBe('0.10.0')
    expect(prepared.record.media).toEqual([])
    expect(prepared.record.bank.questions[0]!.stem.content[1]).toEqual({
      type: 'block-image',
      pending: { image: 3 },
      caption: 'Graphs of f and g',
    })
    expect(prepared.record.bank.questions[0]!.choices![0]!.content.content[0]).toMatchObject({ pending: { page: 2 } })

    const bytes = await createQuestionBankPdf(prepared, fonts)
    const reader = await getDocument({ data: bytes.slice(), disableWorker: true }).promise
    const preview = (await pagesText(reader)).join(' ')
    expect(preview).toContain('Picture needed')
    expect(preview).toContain('IMG 3')
    expect(preview).toContain('page 2')

    const { inspectImportFile } = await import('./package-import')
    const [reimported] = (await inspectImportFile(bytes)).banks
    expect(reimported!.summary.pendingImages).toBe(2)
    const [question] = importedQuestionsFromRecord(reimported!.record)
    expect(JSON.stringify(question!.doc)).toContain('"pending":{"image":3}')
    expect(JSON.stringify(question!.doc)).toContain('"pending":{"page":2}')
  })
})

describe('a Question Bank with Side-by-Sides', () => {
  const PIXEL = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
    (character) => character.charCodeAt(0),
  )
  const pixels = async () => ({ data: PIXEL, mimeType: 'image/png' as const, width: 1, height: 1 })
  const panel = (...content: ProseMirrorJSON[]): ProseMirrorJSON => ({ type: 'sideBySidePanel', content })
  const sideBySide = (...panels: ProseMirrorJSON[]): ProseMirrorJSON => ({ type: 'sideBySide', content: panels })
  const graph = (name: string): ProseMirrorJSON => ({ type: 'image-block', attrs: { src: `/local-images/${name}`, alt: name } })
  const table = (value: string): ProseMirrorJSON => ({
    type: 'table',
    content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [paragraph(text(value))] }] }],
  })

  const compared: Question = {
    id: 'local-compared-id',
    type: 'open',
    columns: 1,
    doc: {
      type: 'doc',
      content: [
        paragraph(text('Compare the two graphs.')),
        sideBySide(panel(graph('graph-a'), paragraph(text('Graph A'))), panel(graph('graph-b'))),
        paragraph(text('What changed?')),
      ],
    },
  }
  const passage: Question = {
    id: 'local-passage-id',
    type: 'multipart',
    columns: 1,
    doc: {
      type: 'doc',
      content: [
        { type: 'blockquote', content: [paragraph(text('Four score and seven years ago …'))] },
        paragraph(text('Source: Abraham Lincoln, 1863')),
        sideBySide(panel(graph('photo')), panel(paragraph(text('Lincoln spoke for two minutes.')))),
        {
          type: 'multipartParts',
          content: [
            {
              type: 'multipartPart',
              attrs: { id: 'local-part', columns: 2 },
              content: [
                {
                  type: 'multipartPartStem',
                  content: [sideBySide(panel(table('Liberty')), panel(table('Union')), panel(paragraph(text('Equality'))))],
                },
                { type: 'suggestedAnswer', content: [paragraph(text('Because.'))] },
              ],
            },
          ],
        },
      ],
    },
  }

  test('writes a Side-by-Side in a stem and a Part’s stem as its Panels, collecting their pictures into media', async () => {
    const loaded: string[] = []
    const { record } = await prepareQuestionBankExport(bank([compared, passage]), async (source) => {
      loaded.push(source)
      return pixels()
    })

    expect(loaded).toEqual(['/local-images/graph-a', '/local-images/graph-b', '/local-images/photo'])
    expect(record.media).toHaveLength(1)
    const [first, second] = record.bank.questions
    expect(first!.stem.content[1]).toMatchObject({
      type: 'side-by-side',
      content: [
        { type: 'panel', content: [{ type: 'block-image', alt: 'graph-a' }, { type: 'paragraph' }] },
        { type: 'panel', content: [{ type: 'block-image', alt: 'graph-b' }] },
      ],
    })
    expect(JSON.stringify(first!.stem.content[1])).toContain(record.media[0]!.id)
    expect(JSON.stringify(record)).not.toContain('sideBySide')
    expect(second!.stem.content.map((node) => node.type)).toEqual(['blockquote', 'paragraph', 'side-by-side'])
    expect(second!.parts![0]!.stem.content[0]!.content!.map((node) => node.type)).toEqual(['panel', 'panel', 'panel'])
  })

  test('round-trips through the record: export, import, and export again write the same bank', async () => {
    const first = await prepareQuestionBankExport(bank([compared, passage]), pixels)
    const inspected = await reinspect(first)
    expect(inspected.summary.mediaAssets).toBe(1)
    const imported = importedQuestionsFromRecord(inspected.record)

    const hash = first.record.media[0]!.id.slice('sha256:'.length)
    expect(imported[0]!.doc.content![1]).toMatchObject({
      type: 'sideBySide',
      content: [
        {
          type: 'sideBySidePanel',
          content: [{ type: 'image-block', attrs: { src: `/local-images/${hash}` } }, { type: 'paragraph' }],
        },
        { type: 'sideBySidePanel' },
      ],
    })
    const second = await prepareQuestionBankExport(bank(imported), pixels)
    expect(second.record.bank).toEqual(first.record.bank)
    expect(second.record.media).toEqual(first.record.media)
  })

  test('refuses a Side-by-Side anywhere but directly in a stem, and one without two or three Panels', async () => {
    const inChoice: Question = {
      id: 'local-choice-side-by-side',
      type: 'multiple-choice',
      columns: 1,
      doc: {
        type: 'doc',
        content: [
          paragraph(text('Which?')),
          {
            type: 'multipleChoice',
            content: [
              {
                type: 'multipleChoiceChoice',
                attrs: { id: 'a', correct: true },
                content: [sideBySide(panel(paragraph(text('A'))), panel(paragraph(text('B'))))],
              },
              choice('b', false, 'Other'),
            ],
          },
        ],
      },
    }
    const inBlockquote: Question = {
      ...compared,
      doc: { type: 'doc', content: [{ type: 'blockquote', content: [compared.doc.content![1]!] }] },
    }
    const onePanel: Question = {
      ...compared,
      doc: { type: 'doc', content: [sideBySide(panel(paragraph(text('Alone'))))] },
    }

    await expect(prepareQuestionBankExport(bank([inChoice]), pixels)).rejects.toThrow(/only as a top-level block of a stem/)
    await expect(prepareQuestionBankExport(bank([inBlockquote]), pixels)).rejects.toThrow(/only as a top-level block of a stem/)
    await expect(prepareQuestionBankExport(bank([onePanel]), pixels)).rejects.toThrow(/two or three Panels/)
  })
})

describe('a picture’s Authored Image Size and Picture Crop in Record 0.7.0', () => {
  const pictureQuestion = (attrs: Record<string, unknown>): Question => ({
    id: 'local-picture',
    type: 'open',
    columns: 1,
    doc: {
      type: 'doc',
      content: [paragraph(text('Name the shape.')), { type: 'image-block', attrs: { src: '/local-images/shape', alt: 'Shape', ...attrs } }],
    },
  })
  const loaderOf = (width: number) => async () => ({
    data: new Uint8Array([width % 256, 1, 2]),
    mimeType: 'image/png' as const,
    width,
    height: 100,
  })
  const pictureOf = (record: QuestionBankRecord) => record.bank.questions[0]!.stem.content[1]!

  test('a sized, cropped picture reads back as the same size and crop, with its Media Asset’s pixel size', async () => {
    const example = await Bun.file(
      new URL('../public/formats/question-bank/0.7.0/examples/cropped-picture.json', import.meta.url).pathname,
    ).json()
    const asset = example.media[0]
    const crop = { left: 0.1, top: 0.2, right: 0.6, bottom: 0.9, width: asset.width, height: asset.height }
    const prepared = await prepareQuestionBankExport(bank([pictureQuestion({ size: 0.35, crop })]), async () => ({
      data: Uint8Array.from(atob(asset.bytes), (character) => character.charCodeAt(0)),
      mimeType: 'image/png',
      width: asset.width,
      height: asset.height,
    }))

    expect(pictureOf(prepared.record)).toMatchObject({
      authoredSize: 0.35,
      crop: { left: 0.1, top: 0.2, right: 0.6, bottom: 0.9 },
    })
    expect(JSON.stringify(prepared.record)).not.toContain('"width":40,"height":20}')

    const reimported = await reinspect(prepared)
    const [question] = importedQuestionsFromRecord(reimported.record)
    const image = (question!.doc.content as ProseMirrorJSON[])[1]!
    expect(image.attrs).toMatchObject({ size: 0.35, crop })
    expect(image.attrs).not.toHaveProperty('ratio')
  })

  test('a crop that keeps the whole picture is left out', async () => {
    const whole = { left: 0, top: 0, right: 1, bottom: 1, width: 400, height: 100 }
    const prepared = await prepareQuestionBankExport(bank([pictureQuestion({ size: 0.5, crop: whole })]), loaderOf(400))
    expect(pictureOf(prepared.record)).not.toHaveProperty('crop')
  })

  test('a legacy ratio is written as a share of the Question Content lane', async () => {
    const wide = await prepareQuestionBankExport(bank([pictureQuestion({ ratio: 0.5 })]), loaderOf(2000))
    expect(pictureOf(wide.record).authoredSize).toBe(0.5)

    const narrow = await prepareQuestionBankExport(bank([pictureQuestion({ ratio: 0.5 })]), loaderOf(300))
    expect(pictureOf(narrow.record).authoredSize).toBe(Math.round(((0.5 * 300) / PAGE_CONTENT_WIDTH) * 100) / 100)

    // Crepe let a drag leave a picture larger than it fit at; that no longer
    // refuses the export, and it never prints wider than the lane.
    const dragged = await prepareQuestionBankExport(bank([pictureQuestion({ ratio: 1.4 })]), loaderOf(300))
    expect(pictureOf(dragged.record).authoredSize).toBe(Math.round(((1.4 * 300) / PAGE_CONTENT_WIDTH) * 100) / 100)
    const overwide = await prepareQuestionBankExport(bank([pictureQuestion({ ratio: 1.4 })]), loaderOf(2000))
    expect(pictureOf(overwide.record).authoredSize).toBe(1)

    const unsized = await prepareQuestionBankExport(bank([pictureQuestion({ ratio: 1 })]), loaderOf(300))
    expect(pictureOf(unsized.record)).not.toHaveProperty('authoredSize')
  })

  test('a size outside 0.05–1 is refused', async () => {
    await expect(prepareQuestionBankExport(bank([pictureQuestion({ size: 1.2 })]), loaderOf(300))).rejects.toThrow(
      'between 0.05 and 1',
    )
  })

  test('the export preview finds a crop’s pixel size in the record’s media', async () => {
    const crop = { left: 0.25, top: 0, right: 0.75, bottom: 1, width: 400, height: 100 }
    const prepared = await prepareQuestionBankExport(bank([pictureQuestion({ size: 0.3, crop })]), loaderOf(400))
    const stem = prepared.record.bank.questions[0]!.stem
    expect(recordDocumentToEditorNodes(stem, prepared.record.media)[1]!.attrs).toMatchObject({ size: 0.3, crop })
    expect(recordDocumentToEditorNodes(stem)[1]!.attrs).not.toHaveProperty('crop')
  })
})
