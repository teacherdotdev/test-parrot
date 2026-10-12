import { describe, expect, test } from 'bun:test'
import Ajv2020 from 'ajv/dist/2020'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import publicSchema010 from '../public/formats/question-bank/0.1.0/schema.json'
import applicationSchema010 from './question-bank-record-0.1.0.schema.json'
import publicSchema020 from '../public/formats/question-bank/0.2.0/schema.json'
import applicationSchema020 from './question-bank-record-0.2.0.schema.json'
import publicSchema030 from '../public/formats/question-bank/0.3.0/schema.json'
import applicationSchema030 from './question-bank-record-0.3.0.schema.json'
import publicSchema040 from '../public/formats/question-bank/0.4.0/schema.json'
import applicationSchema040 from './question-bank-record-0.4.0.schema.json'
import publicSchema050 from '../public/formats/question-bank/0.5.0/schema.json'
import applicationSchema050 from './question-bank-record-0.5.0.schema.json'
import publicSchema060 from '../public/formats/question-bank/0.6.0/schema.json'
import applicationSchema060 from './question-bank-record-0.6.0.schema.json'
import publicSchema070 from '../public/formats/question-bank/0.7.0/schema.json'
import applicationSchema070 from './question-bank-record-0.7.0.schema.json'
import publicSchema080 from '../public/formats/question-bank/0.8.0/schema.json'
import applicationSchema080 from './question-bank-record-0.8.0.schema.json'
import publicSchema090 from '../public/formats/question-bank/0.9.0/schema.json'
import applicationSchema090 from './question-bank-record-0.9.0.schema.json'
import publicSchema from '../public/formats/question-bank/0.10.0/schema.json'
import applicationSchema from './question-bank-record-0.10.0.schema.json'
import {
  QUESTION_BANK_FORMAT_VERSION,
  SUPPORTED_BLANK_CONTENT_TYPES,
  SUPPORTED_BLANK_NODE_TYPE,
  SUPPORTED_SEMANTIC_MARK_TYPES,
  SUPPORTED_SEMANTIC_NODE_TYPES,
  SUPPORTED_STEM_LAYOUT_NODE_TYPES,
  prepareQuestionBankExport,
  recordDocumentToEditorNodes,
  serializeQuestionBankRecord,
  type QuestionBankRecord,
} from './question-bank-export'
import {
  QuestionBankImportError,
  importedQuestionsFromRecord,
  inspectQuestionBankRecord,
  inspectQuestionBankRecordValue,
  packageFiles,
  type QuestionBankImportProposal,
} from './question-bank-import'
import { mediaFilePath } from './package-zip'
import { choicesOf, partsOf } from './exam'
import { pointsOfQuestion } from './points'
import type { QuestionBankResource } from './question-bank-workspaces'

function fixtureRootFor(version: string): string {
  return join(import.meta.dir, '..', 'public', 'formats', 'question-bank', version)
}

const fixtureRoot = fixtureRootFor(QUESTION_BANK_FORMAT_VERSION)
const exampleRoot = join(fixtureRoot, 'examples')
const invalidRoot = join(fixtureRoot, 'invalid')
// The last version whose Media Assets carry base64: an older version's record
// is made from its examples, since a 0.8.0 or later example's pictures are
// files.
const example070Root = join(fixtureRootFor('0.7.0'), 'examples')
const decoder = new TextDecoder()

async function filesIn(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .sort()
}

async function fixture(directory: string, name: string): Promise<unknown> {
  return JSON.parse(await Bun.file(join(directory, name)).text())
}

/** The picture files beside a fixture directory's records, keyed as a package
 *  zip keys them: each directory is laid out as that zip is. */
async function mediaBeside(directory: string): Promise<Map<string, Uint8Array>> {
  const media = join(directory, 'media')
  const files = new Map<string, Uint8Array>()
  for (const name of (await readdir(media)).sort())
    files.set(`media/${name}`, await Bun.file(join(media, name)).bytes())
  return files
}

/** A 0.8.0 or later fixture inspected as it would be read out of its zip. */
async function inspectFixture(directory: string, name: string): Promise<QuestionBankImportProposal> {
  return inspectQuestionBankRecordValue(
    await fixture(directory, name),
    undefined,
    packageFiles(await mediaBeside(directory)),
  )
}

function schemaEnum(definition: 'node' | 'mark', property: string): string[] {
  const schema = publicSchema as {
    $defs: Record<string, { properties: Record<string, { enum: string[] }> }>
  }
  return schema.$defs[definition]!.properties[property]!.enum
}

describe('public Question Bank Record 0.10.0 contract', () => {
  test('canonical examples validate independently against the published schema', async () => {
    expect(publicSchema.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.10.0/schema.json',
    )
    expect(publicSchema.properties.formatVersion.const).toBe(QUESTION_BANK_FORMAT_VERSION)
    expect(
      await Bun.file(
        join(
          import.meta.dir,
          '..',
          'public',
          'question-bank-record-0.10.0.schema.json',
        ),
      ).json(),
    ).toEqual(publicSchema)
    expect(applicationSchema).toEqual(publicSchema)
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      publicSchema,
    )
    const names = await filesIn(exampleRoot)

    expect(names).toEqual([
      'centred-figure.json',
      'complete-rich-text.json',
      'cropped-picture.json',
      'fill-in-the-blank.json',
      'locked-answers.json',
      'matching.json',
      'media-rich.json',
      'minimal-multiple-choice.json',
      'multipart.json',
      'pending-images.json',
      'points.json',
      'provenance-and-links.json',
      'short-answer.json',
      'side-by-side.json',
      'subparts.json',
      'true-false.json',
    ])
    for (const name of names) {
      expect(
        validate(await fixture(exampleRoot, name)),
        `${name}: ${JSON.stringify(validate.errors)}`,
      ).toBe(true)
    }
  })

  test('every Media Asset names its file by its digest and type, and every picture file is named', async () => {
    const pictures = await mediaBeside(exampleRoot)
    const named = new Set<string>()
    for (const name of await filesIn(exampleRoot)) {
      const record = (await fixture(exampleRoot, name)) as {
        media: { id: string; mimeType: string; file?: string; bytes?: string }[]
      }
      for (const asset of record.media) {
        expect(asset, name).not.toHaveProperty('bytes')
        expect(asset.file, name).toBe(mediaFilePath(asset.id, asset.mimeType))
        expect(pictures.has(asset.file!), `${name}: ${asset.file}`).toBe(true)
        named.add(asset.file!)
      }
    }
    expect([...pictures.keys()].sort()).toEqual([...named].sort())
  })

  test('a record that declares a Media Asset cannot be read without the files beside it', async () => {
    try {
      await inspectQuestionBankRecord(await Bun.file(join(exampleRoot, 'media-rich.json')).bytes())
      throw new Error('unexpectedly conformed')
    } catch (error) {
      expect(error).toBeInstanceOf(QuestionBankImportError)
      expect((error as QuestionBankImportError).code).toBe('missing-media')
    }
    // One with no Media Asset needs none.
    const proposal = await inspectQuestionBankRecord(
      await Bun.file(join(exampleRoot, 'pending-images.json')).bytes(),
    )
    expect(proposal.summary.formatVersion).toBe('0.10.0')
  })

  test('a True/False Question states its fixed pair and nothing else', async () => {
    const proposal = await inspectFixture(exampleRoot, 'true-false.json')

    expect(proposal.summary.questionCounts).toEqual({
      'multiple-choice': 0,
      'true-false': 2,
      matching: 0,
      'fill-in-the-blank': 0,
      'short-answer': 0,
      multipart: 0,
    })
    expect(proposal.record.bank.questions[0]).toMatchObject({
      type: 'true-false',
      choices: [{ correct: true }, { correct: false }],
    })
    expect(proposal.record.bank.questions[0]!.suggestedAnswer).toBeUndefined()
  })

  test('a Matching Question names its answers from its own Word Bank, distractors and unmatched items included', async () => {
    const proposal = await inspectFixture(exampleRoot, 'matching.json')

    expect(proposal.summary.questionCounts).toEqual({
      'multiple-choice': 0,
      'true-false': 0,
      matching: 2,
      'fill-in-the-blank': 0,
      'short-answer': 0,
      multipart: 0,
    })
    // The second set leaves an item unmatched; that is reported, not refused.
    expect(proposal.summary.questionsWithoutCorrectAnswer).toBe(1)
    const [events, terms] = proposal.record.bank.questions
    expect(events).toMatchObject({
      type: 'matching',
      prompts: [
        { id: 'q1-p1', answer: 'q1-a3' },
        { id: 'q1-p2', answer: 'q1-a1' },
        { id: 'q1-p3', answer: 'q1-a2' },
        { id: 'q1-p4', answer: 'q1-a4' },
      ],
    })
    expect(events!.wordBank!.map((answer) => answer.id)).toEqual([
      'q1-a1',
      'q1-a2',
      'q1-a3',
      'q1-a4',
    ])
    expect(events!.choices).toBeUndefined()
    expect(events!.suggestedAnswer).toBeUndefined()
    expect(terms!.prompts!.map((prompt) => prompt.answer)).toEqual(['q2-a2', undefined])
    expect(terms!.wordBank).toHaveLength(3)
  })

  test('a Fill in the Blank Question answers with the Blanks in its stem, and one with none is reported', async () => {
    const proposal = await inspectFixture(exampleRoot, 'fill-in-the-blank.json')

    expect(proposal.summary.questionCounts['fill-in-the-blank']).toBe(4)
    // The stem with no Blank is incomplete, not invalid.
    expect(proposal.summary.questionsWithoutCorrectAnswer).toBe(1)
    const [bees, square, river] = proposal.record.bank.questions
    expect(bees!.stem.content[0]!.content).toEqual([
      { type: 'text', text: 'Bees carry (p)' },
      { type: 'blank', content: [{ type: 'text', text: 'pollen' }] },
      { type: 'text', text: ' from flower to flower.' },
    ])
    expect(bees!.points).toBe(1)
    expect(river!.stem.content[0]!.content![1]).toEqual({ type: 'blank' })

    const [imported, area] = importedQuestionsFromRecord(proposal.record)
    expect(imported!.type).toBe('fill-in-the-blank')
    expect(imported!.points).toBe(1)
    expect(imported!.doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Bees carry (p)' },
          { type: 'blank', content: [{ type: 'text', text: 'pollen' }] },
          { type: 'text', text: ' from flower to flower.' },
        ],
      },
    ])
    expect(JSON.stringify(area!.doc)).toContain('{"type":"blank","content":[{"type":"math_inline","attrs":{"value":"9"}},{"type":"text","text":" cm²"}]}')
    expect(square!.choices).toBeUndefined()
  })

  test('a Fill in the Blank Question with two Blanks is written, validates, and imports back as it was', async () => {
    const validate = new Ajv2020({ strict: true }).compile(publicSchema)
    const sentence = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Light travels at about ' },
        { type: 'blank', content: [{ type: 'math_inline', attrs: { value: '3 \\times 10^8' } }, { type: 'text', text: ' m/s' }] },
        { type: 'text', text: ', far ' },
        { type: 'blank', content: [{ type: 'text', text: 'faster', marks: [{ type: 'emphasis' }] }] },
        { type: 'text', text: ' than sound.' },
      ],
    }
    const bank: QuestionBankResource = {
      id: 'local-bank',
      name: 'Generated Fill in the Blank',
      createdAt: 'not-public',
      lastUpdatedAt: 'not-public',
      questions: [
        { id: 'local-fib', type: 'fill-in-the-blank', columns: 2, points: 2, doc: { type: 'doc', content: [sentence] } },
        // A Blank pasted into another type's question is written as its words.
        {
          id: 'local-open',
          type: 'open',
          columns: 2,
          doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Why is it ' }, { type: 'blank', content: [{ type: 'text', text: 'blue' }] }, { type: 'text', text: '?' }] }] },
        },
      ],
    }
    const prepared = await prepareQuestionBankExport(bank)
    const generated = JSON.parse(decoder.decode(prepared.recordBytes)) as QuestionBankRecord

    expect(generated.formatVersion).toBe('0.10.0')
    expect(validate(generated), JSON.stringify(validate.errors)).toBe(true)
    expect(generated.bank.questions[0]).toEqual({
      id: 'q1',
      type: 'fill-in-the-blank',
      points: 2,
      stem: {
        type: 'document',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Light travels at about ' },
            { type: 'blank', content: [{ type: 'inline-math', source: '3 \\times 10^8' }, { type: 'text', text: ' m/s' }] },
            { type: 'text', text: ', far ' },
            { type: 'blank', content: [{ type: 'text', text: 'faster', marks: [{ type: 'emphasis' }] }] },
            { type: 'text', text: ' than sound.' },
          ],
        }],
      },
    })
    expect(generated.bank.questions[1]!.stem.content[0]!.content).toEqual([
      { type: 'text', text: 'Why is it ' },
      { type: 'text', text: 'blue' },
      { type: 'text', text: '?' },
    ])

    const [back] = importedQuestionsFromRecord((await inspectQuestionBankRecord(prepared.recordBytes)).record)
    expect(back!.type).toBe('fill-in-the-blank')
    expect(back!.points).toBe(2)
    expect(back!.doc.content).toEqual([sentence])
  })

  test('a Blank out of its place is refused, by where it may go', async () => {
    for (const [name, message] of [
      ['blank-in-choice.json', 'Question “q1” has a Blank outside the stem of a Fill in the Blank Question. A Blank may appear only there — not in another type’s stem, an answer, a matching item, a Word Bank answer, a Part or a Suggested Answer.'],
      ['blank-in-short-answer.json', 'Question “q1” has a Blank outside the stem of a Fill in the Blank Question. A Blank may appear only there — not in another type’s stem, an answer, a matching item, a Word Bank answer, a Part or a Suggested Answer.'],
      ['blank-as-block.json', 'Question “q1” has a Blank that stands as a block of its own. A Blank stands among the text of a paragraph or heading of its stem.'],
      ['blank-nested.json', 'Question “q1” has a Blank inside another Blank. A Blank’s answer holds only text and inline mathematics.'],
      ['blank-holding-picture.json', 'Question “q1” has a Blank whose answer holds something other than text and inline mathematics.'],
    ] as const) {
      try {
        await inspectFixture(invalidRoot, name)
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect((error as QuestionBankImportError).message, name).toBe(message)
      }
    }
  })

  test('a Multipart Question keeps its Parts in lettered order, each answering as its own type', async () => {
    const proposal = await inspectFixture(exampleRoot, 'multipart.json')

    expect(proposal.summary.questionCounts).toEqual({
      'multiple-choice': 0,
      'true-false': 0,
      matching: 0,
      'fill-in-the-blank': 0,
      'short-answer': 0,
      multipart: 3,
    })
    // The third Multipart question has no Parts yet; that is reported, not refused.
    expect(proposal.summary.questionsWithoutCorrectAnswer).toBe(1)
    const [aldmere, liberty, unfinished] = proposal.record.bank.questions
    // The source line is ordinary stem content, not a field of its own.
    expect(JSON.stringify(aldmere!.stem)).toContain('Source: “A Short History of Aldmere,” 1998')
    expect(aldmere).toMatchObject({
      type: 'multipart',
      difficulty: 'medium',
      topics: ['Kingdom of Aldmere'],
      parts: [
        { id: 'q1-s1', type: 'multiple-choice' },
        { id: 'q1-s2', type: 'multiple-choice' },
      ],
    })
    expect(aldmere!.parts![0]!.choices!.map((choice) => [choice.id, choice.correct])).toEqual([
      ['q1-s1-c1', false],
      ['q1-s1-c2', false],
      ['q1-s1-c3', false],
      ['q1-s1-c4', true],
    ])
    expect(aldmere!.choices).toBeUndefined()
    expect(liberty!.parts!.map((part) => part.type)).toEqual([
      'multiple-choice',
      'short-answer',
      'short-answer',
    ])
    expect(liberty!.parts![1]!.suggestedAnswer).toMatchObject({ type: 'document' })
    expect(liberty!.parts![2]!.suggestedAnswer).toBeUndefined()
    expect(unfinished!.parts).toEqual([])

    const imported = importedQuestionsFromRecord(proposal.record)
    expect(imported.map((question) => question.type)).toEqual(['multipart', 'multipart', 'multipart'])
    expect(partsOf(imported[1]!).map((part) => part.type)).toEqual([
      'multiple-choice',
      'open',
      'open',
    ])
    expect(partsOf(imported[2]!)).toEqual([])
  })

  test('canonical examples pass Test Parrot inspection and retain documented semantics', async () => {
    const proposals = await Promise.all(
      (await filesIn(exampleRoot)).map(
        async (name) =>
          [
            name,
            await inspectFixture(exampleRoot, name),
          ] as const,
      ),
    )
    const byName = Object.fromEntries(
      proposals.map(([name, proposal]) => [
        name.replace(/\.json$/, ''),
        proposal,
      ]),
    )

    expect(
      byName['minimal-multiple-choice'].record.bank.questions[0],
    ).toMatchObject({
      type: 'multiple-choice',
      choices: [{ correct: false }, { correct: true }],
    })
    expect(byName['short-answer'].record.bank.questions[0]).toMatchObject({
      type: 'short-answer',
      suggestedAnswer: { type: 'document' },
    })
    expect(JSON.stringify(byName['complete-rich-text'].record)).toContain(
      'display-math',
    )
    expect(byName['provenance-and-links'].record.bank).toMatchObject({
      description: 'A bank published to demonstrate declared provenance.',
      author: 'Ada Teacher',
      license: {
        name: 'CC BY 4.0',
        url: 'https://creativecommons.org/licenses/by/4.0/',
      },
    })
    expect(byName['provenance-and-links'].summary.externalLinks).toBe(true)
    expect(byName['media-rich'].summary).toMatchObject({
      mediaAssets: 1,
      decodedMediaBytes: 70,
    })
    expect(
      byName['media-rich'].record.bank.questions[0]!.stem.content,
    ).toContainEqual(
      expect.objectContaining({ type: 'block-image', authoredSize: 0.5 }),
    )
  })

  test('a Pending Image names a tag or a page, may be shared, and needs no Media Asset', async () => {
    const proposal = await inspectFixture(exampleRoot, 'pending-images.json')

    expect(proposal.summary).toMatchObject({ mediaAssets: 0, pendingImages: 8 })
    const [inStem, asChoices, shared, byPage] = proposal.record.bank.questions
    expect(inStem!.stem.content[1]).toEqual({
      type: 'block-image',
      pending: { image: 1 },
      alt: 'Map of the bus routes in the town of Riverton',
      caption: 'Riverton Bus Routes, 2020',
    })
    expect(asChoices!.choices!.map((choice) => choice.content.content[0]!.pending)).toEqual([
      { image: 2 },
      { image: 3 },
      { image: 4 },
    ])
    expect(shared!.stem.content[0]!.pending).toEqual({ image: 1 })
    expect(byPage!.stem.content[1]).toMatchObject({ pending: { page: 4 }, authoredSize: 0.6 })
  })

  test('a Picture Crop keeps part of a whole Media Asset, and its size is a share of its container', async () => {
    const proposal = await inspectFixture(exampleRoot, 'cropped-picture.json')
    const picture = proposal.record.bank.questions[0]!.stem.content[1]!
    const asset = proposal.record.media[0]!

    expect(picture).toMatchObject({
      type: 'block-image',
      asset: asset.id,
      authoredSize: 0.4,
      crop: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
    })
    expect(recordDocumentToEditorNodes(proposal.record.bank.questions[0]!.stem)[1]!.attrs).toMatchObject({
      size: 0.4,
      crop: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75, width: asset.width, height: asset.height },
    })
  })

  test('a Centred figure, caption and table reach the editor centred, and are written back centred', async () => {
    const proposal = await inspectFixture(exampleRoot, 'centred-figure.json')
    const stem = proposal.record.bank.questions[0]!.stem
    const aligned = (content: readonly { align?: string }[]) => content.map((node) => node.align ?? 'left')
    expect(aligned(stem.content)).toEqual(['left', 'center', 'center', 'left', 'center', 'center', 'left'])

    const editor = recordDocumentToEditorNodes(stem, proposal.record.media)
    expect(editor.map((node) => (node.attrs as { align?: string } | undefined)?.align ?? 'left')).toEqual(
      ['left', 'center', 'center', 'left', 'center', 'center', 'left'],
    )
    expect(editor[1]!.type).toBe('image-block')
    expect(JSON.stringify(editor[4])).toContain('"text":"42"')

    const questions = importedQuestionsFromRecord(proposal.record)
    const png = [...(await mediaBeside(exampleRoot))].find(([path]) => path.includes('c414cd0e'))![1]
    const prepared = await prepareQuestionBankExport({
      id: 'local-bank',
      name: 'Centred Figure',
      createdAt: 'not-public',
      lastUpdatedAt: 'not-public',
      questions,
    }, async () => ({ data: png, mimeType: 'image/png', width: 1, height: 1 }))
    const generated = JSON.parse(decoder.decode(prepared.recordBytes)) as QuestionBankRecord
    const validate = new Ajv2020({ strict: true }).compile(publicSchema)
    expect(validate(generated), JSON.stringify(validate.errors)).toBe(true)
    const written = generated.bank.questions[0]!.stem.content
    expect(aligned(written)).toEqual(['left', 'center', 'center', 'left', 'center', 'center', 'left'])
    // The table's own cell keeps its centred paragraph.
    expect(JSON.stringify(written[4])).toContain('"align":"center","content":[{"type":"text","text":"42"}]')
  })

  test('a list item’s and an answer’s blocks import to the left', async () => {
    const record = (await fixture(exampleRoot, 'centred-figure.json')) as {
      bank: { questions: Record<string, unknown>[] }
      media: unknown[]
    }
    record.media = []
    const centred = { type: 'paragraph', align: 'center', content: [{ type: 'text', text: 'Leaf A' }] }
    record.bank.questions[0] = {
      id: 'q1',
      type: 'multiple-choice',
      stem: {
        type: 'document',
        content: [{ type: 'bullet-list', content: [{ type: 'list-item', content: [centred] }] }],
      },
      choices: [
        { id: 'q1-c1', correct: true, content: { type: 'document', content: [centred] } },
        { id: 'q1-c2', correct: false, content: { type: 'document', content: [centred] } },
      ],
    }
    const proposal = await inspectQuestionBankRecordValue(record, undefined, packageFiles(await mediaBeside(exampleRoot)))
    expect(JSON.stringify(proposal.record.bank)).not.toContain('"align"')
  })

  test('a record older than 0.9.0 has no Centred blocks: its `align` is ignored and every block is left', async () => {
    const record = (await fixture(exampleRoot, 'centred-figure.json')) as { formatVersion: string }
    record.formatVersion = '0.8.0'
    const proposal = await inspectQuestionBankRecordValue(record, undefined, packageFiles(await mediaBeside(exampleRoot)))
    expect(JSON.stringify(proposal.record)).not.toContain('"align"')
    const [imported] = importedQuestionsFromRecord(proposal.record)
    expect(JSON.stringify(imported)).not.toContain('"align"')
  })

  test('a Locked Answer says so, an unlocked one says it was unlocked, and both reach the editor', async () => {
    const proposal = await inspectFixture(exampleRoot, 'locked-answers.json')
    const [planets, photosynthesis, falling] = proposal.record.bank.questions

    expect(planets!.choices!.map((choice) => choice.locked)).toEqual([undefined, undefined, undefined, true])
    expect(photosynthesis!.choices!.map((choice) => choice.locked)).toEqual([undefined, undefined, true, false])
    expect(falling!.parts![0]!.choices!.map((choice) => choice.locked)).toEqual([undefined, undefined, true])

    const imported = importedQuestionsFromRecord(proposal.record)
    expect(choicesOf(imported[0]!).map((choice) => choice.locked)).toEqual([false, false, false, true])
    // “None of the above” reads as locked, but its author unlocked it.
    expect(choicesOf(imported[1]!).map((choice) => choice.locked)).toEqual([false, false, true, false])
    expect(partsOf(imported[2]!)[0]!.choices.map((choice) => choice.locked)).toEqual([false, false, true])
  })

  test('a Part holds Subparts as its lead-in, and they reach the editor numbered beneath it', async () => {
    const proposal = await inspectFixture(exampleRoot, 'subparts.json')
    const [pond] = proposal.record.bank.questions
    const [answering, holding] = pond!.parts!

    expect(answering).toMatchObject({ id: 'q1-s1', type: 'short-answer' })
    expect(holding).not.toHaveProperty('type')
    expect(holding).toMatchObject({ id: 'q1-s2' })
    const subparts = (holding as { subparts: { id: string; type: string }[] }).subparts
    expect(subparts.map(({ id, type }) => [id, type])).toEqual([
      ['q1-s2-s1', 'multiple-choice'],
      ['q1-s2-s2', 'short-answer'],
      ['q1-s2-s3', 'short-answer'],
    ])

    const [imported] = importedQuestionsFromRecord(proposal.record)
    const parts = partsOf(imported!)
    expect(parts.map((part) => part.type)).toEqual(['open', 'subparts'])
    expect(parts[1]!.subparts.map((subpart) => subpart.type)).toEqual(['multiple-choice', 'open', 'open'])
    expect(parts[1]!.subparts[0]!.choices.map((choice) => [choice.correct, choice.locked])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ])
  })

  test('a record older than 0.9.0 has no Subparts: its Parts all answer, and a `subparts` it carries is ignored', async () => {
    const record = (await fixture(exampleRoot, 'subparts.json')) as {
      formatVersion: string
      bank: { questions: { parts: Record<string, unknown>[] }[] }
    }
    record.formatVersion = '0.8.0'
    // An older record cannot leave a Part's type out.
    try {
      await inspectQuestionBankRecordValue(structuredClone(record))
      throw new Error('unexpectedly conformed')
    } catch (error) {
      expect((error as QuestionBankImportError).code).toBe('invalid-structure')
    }
    record.bank.questions[0]!.parts[1]!.type = 'short-answer'
    const proposal = await inspectQuestionBankRecordValue(record)
    expect(proposal.record.bank.questions[0]!.parts![1]).not.toHaveProperty('subparts')
    expect(partsOf(importedQuestionsFromRecord(proposal.record)[0]!)[1]!.type).toBe('open')
  })

  test('Points reach the editor on a question, a whole Matching set, a Part and a Subpart', async () => {
    const proposal = await inspectFixture(exampleRoot, 'points.json')
    const questions = importedQuestionsFromRecord(proposal.record)
    expect(questions.map((question) => question.points)).toEqual([1, 1, 2, 3, undefined, undefined])
    expect(questions.map(pointsOfQuestion)).toEqual([1, 1, 2, 3, undefined, 4])
    const [a, b] = partsOf(questions[5]!)
    expect(a!.points).toBe(1)
    expect(b!.points).toBeUndefined()
    expect(b!.subparts.map((subpart) => subpart.points)).toEqual([1, 2, undefined])
  })

  test('Points are refused on a Multipart Question and on a Part that holds Subparts, by name', async () => {
    for (const [name, message] of [
      ['points-on-multipart.json', 'Multipart Question “q6” is worth what its Parts and Subparts are, so it cannot have Points of its own; give them to its Parts and Subparts.'],
      ['points-on-lead-in.json', 'Part b (“q6-s2”) of Multipart Question “q6” holds Subparts, so it cannot also have a type, choices, a Suggested Answer or Points of its own; each Subpart carries its own.'],
    ] as const) {
      try {
        await inspectFixture(invalidRoot, name)
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect((error as QuestionBankImportError).message, name).toBe(message)
      }
    }
  })

  test('a record older than 0.9.0 has no Points: every Question it holds is unpointed', async () => {
    const record = (await fixture(exampleRoot, 'points.json')) as {
      formatVersion: string
      bank: { questions: Record<string, unknown>[] }
    }
    record.formatVersion = '0.8.0'
    // An older record has no Subparts either, so the lead-in answers.
    const multipart = record.bank.questions[5] as { parts: Record<string, unknown>[] }
    multipart.parts[1] = { id: 'q6-s2', type: 'short-answer', stem: multipart.parts[1]!.stem, points: 3 }
    const proposal = await inspectQuestionBankRecordValue(record)
    expect(JSON.stringify(proposal.record)).not.toContain('"points"')
    expect(importedQuestionsFromRecord(proposal.record).map(pointsOfQuestion)).toEqual(
      [undefined, undefined, undefined, undefined, undefined, undefined],
    )
  })

  test('Points are written where a student answers, validate, and import back as they were', async () => {
    const proposal = await inspectFixture(exampleRoot, 'points.json')
    const questions = importedQuestionsFromRecord(proposal.record)
    // A Multipart question's stored `points`, should one carry any, is never written.
    questions[5] = { ...questions[5]!, points: 9 }
    const prepared = await prepareQuestionBankExport({
      id: 'local-bank',
      name: 'Points',
      createdAt: 'not-public',
      lastUpdatedAt: 'not-public',
      questions,
    })
    const generated = JSON.parse(decoder.decode(prepared.recordBytes)) as QuestionBankRecord
    const validate = new Ajv2020({ strict: true }).compile(publicSchema)
    expect(validate(generated), JSON.stringify(validate.errors)).toBe(true)
    expect(generated.bank.questions.map((question) => question.points)).toEqual([1, 1, 2, 3, undefined, undefined])
    const parts = generated.bank.questions[5]!.parts!
    expect(parts.map((part) => (part as { points?: number }).points)).toEqual([1, undefined])
    expect((parts[1] as { subparts: { points?: number }[] }).subparts.map((subpart) => subpart.points)).toEqual([1, 2, undefined])
    const again = importedQuestionsFromRecord((await inspectQuestionBankRecord(prepared.recordBytes)).record)
    expect(again.map(pointsOfQuestion)).toEqual([1, 1, 2, 3, undefined, 4])
  })

  test('a Part that holds Subparts and answers too is refused, by name', async () => {
    try {
      await inspectFixture(invalidRoot, 'subparts-and-answers.json')
      throw new Error('unexpectedly conformed')
    } catch (error) {
      expect((error as QuestionBankImportError).message).toBe(
        'Part b (“q1-s2”) of Multipart Question “q1” holds Subparts, so it cannot also have a type, choices, a Suggested Answer or Points of its own; each Subpart carries its own.',
      )
    }
  })

  test('a record older than 0.9.0 has no Locked Answers of its own, so its wording locks its answers', async () => {
    const record = (await fixture(exampleRoot, 'locked-answers.json')) as { formatVersion: string }
    record.formatVersion = '0.8.0'
    const proposal = await inspectQuestionBankRecordValue(record)

    // An older record's `locked` is an unknown optional field, and is ignored.
    expect(proposal.record.bank.questions[1]!.choices!.map((choice) => choice.locked)).toEqual([
      undefined, undefined, undefined, undefined,
    ])
    const imported = importedQuestionsFromRecord(proposal.record)
    expect(choicesOf(imported[0]!).map((choice) => choice.locked)).toEqual([false, false, false, true])
    expect(choicesOf(imported[1]!).map((choice) => choice.locked)).toEqual([false, false, false, true])
  })

  test('a Pending Image in a record older than 0.5.0 is refused', async () => {
    const record = (await fixture(example070Root, 'pending-images.json')) as { formatVersion: string }
    record.formatVersion = '0.4.0'
    try {
      await inspectQuestionBankRecord(new TextEncoder().encode(JSON.stringify(record)))
      throw new Error('unexpectedly conformed')
    } catch (error) {
      expect((error as QuestionBankImportError).code).toBe('invalid-question')
    }
  })

  test('invalid counterexamples are rejected with their documented application errors', async () => {
    const manifest = (await fixture(invalidRoot, 'manifest.json')) as Record<
      string,
      string
    >
    expect(Object.keys(manifest).sort()).toEqual([
      'align-on-heading.json',
      'align-right.json',
      'bad-reference.json',
      'base64-media.json',
      'blank-as-block.json',
      'blank-holding-picture.json',
      'blank-in-choice.json',
      'blank-in-short-answer.json',
      'blank-nested.json',
      'crop-inverted.json',
      'crop-on-inline-image.json',
      'crop-on-pending.json',
      'crop-out-of-range.json',
      'fill-in-the-blank-with-choices.json',
      'invalid-media.json',
      'locked-not-boolean.json',
      'locked-true-false.json',
      'malformed-matching.json',
      'malformed-multipart.json',
      'malformed-question.json',
      'malformed-true-false.json',
      'missing-media-file.json',
      'pending-empty.json',
      'pending-image-and-page.json',
      'pending-negative-page.json',
      'pending-unknown-member.json',
      'pending-with-asset.json',
      'pending-zero.json',
      'points-fraction.json',
      'points-on-lead-in.json',
      'points-on-multipart.json',
      'points-zero.json',
      'side-by-side-four-panels.json',
      'side-by-side-in-blockquote.json',
      'side-by-side-in-choice.json',
      'side-by-side-nested.json',
      'side-by-side-one-panel.json',
      'subparts-and-answers.json',
      'subparts-empty.json',
      'subparts-nested.json',
      'unsafe-url.json',
      'unsupported-required-feature.json',
      'unsupported-version.json',
    ])
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(publicSchema)
    for (const [name, code] of Object.entries(manifest)) {
      // An inverted crop is well-formed: only the importer can compare its sides.
      if (/^(?:pending-|side-by-side-|crop-(?!inverted)|base64-|locked-|subparts-|points-|align-)/.test(name))
        expect(validate(await fixture(invalidRoot, name)), name).toBe(false)
      // A Blank out of its place is beyond the schema's sight; what it holds,
      // and a Fill in the Blank Question that answers otherwise, are not.
      if (['blank-as-block.json', 'blank-holding-picture.json', 'blank-nested.json', 'fill-in-the-blank-with-choices.json'].includes(name))
        expect(validate(await fixture(invalidRoot, name)), name).toBe(false)
      // Only the importer can compare a crop's sides, look for a file, or see
      // which Question's stem a Blank stands in.
      if (['crop-inverted.json', 'missing-media-file.json', 'invalid-media.json', 'blank-in-choice.json', 'blank-in-short-answer.json'].includes(name))
        expect(validate(await fixture(invalidRoot, name)), name).toBe(true)
      try {
        await inspectFixture(invalidRoot, name)
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })

  test('public records round-trip semantically while unknown fields and source bytes may change', async () => {
    const sourceBytes = await Bun.file(
      join(exampleRoot, 'provenance-and-links.json'),
    ).bytes()
    const imported = await inspectQuestionBankRecord(sourceBytes)
    const reexported = await serializeQuestionBankRecord({
      requiredFeatures: imported.record.requiredFeatures,
      bank: imported.record.bank,
      media: imported.record.media,
    })
    const inspectedAgain = await inspectQuestionBankRecord(reexported.bytes)

    expect(inspectedAgain.record.bank).toEqual(imported.record.bank)
    expect(inspectedAgain.record.media).toEqual(imported.record.media)
    expect(JSON.stringify(inspectedAgain.record)).not.toContain('publisherNote')
    expect(reexported.record.generator.name).toBe('Test Parrot')
    expect(reexported.bytes).not.toEqual(sourceBytes)
  })

  test('schema vocabulary, application adapters, and complete example stay aligned', async () => {
    expect([...SUPPORTED_SEMANTIC_NODE_TYPES].sort()).toEqual(
      schemaEnum('node', 'type').sort(),
    )
    expect([...SUPPORTED_SEMANTIC_MARK_TYPES].sort()).toEqual(
      schemaEnum('mark', 'type').sort(),
    )
    const layoutDefinitions = publicSchema.$defs as unknown as Record<
      string,
      { properties: { type: { const: string } } }
    >
    expect([...SUPPORTED_STEM_LAYOUT_NODE_TYPES]).toEqual([
      layoutDefinitions.sideBySide!.properties.type.const,
      layoutDefinitions.panel!.properties.type.const,
    ])
    const blankDefinition = (publicSchema.$defs as unknown as Record<string, {
      properties: { type: { const: string }; content: { items: { properties: { type: { enum: string[] } } } } }
    }>).blank!
    expect(SUPPORTED_BLANK_NODE_TYPE).toBe(blankDefinition.properties.type.const)
    expect([...SUPPORTED_BLANK_CONTENT_TYPES]).toEqual(blankDefinition.properties.content.items.properties.type.enum)

    const complete = (await fixture(
      exampleRoot,
      'complete-rich-text.json',
    )) as QuestionBankRecord
    const encoded = JSON.stringify(complete)
    for (const type of [...SUPPORTED_SEMANTIC_NODE_TYPES, ...SUPPORTED_STEM_LAYOUT_NODE_TYPES])
      expect(encoded).toContain(`"type":"${type}"`)
    for (const type of SUPPORTED_SEMANTIC_MARK_TYPES)
      expect(encoded).toContain(`"type":"${type}"`)

    const schemaText = JSON.stringify(publicSchema)
    for (const privateTerm of [
      'IndexedDB',
      '/local-images/',
      'ProseMirror',
      'multipleChoiceChoice',
      'matchingPrompt',
      'matchingAnswer',
      'multipartPart',
      'Exam Layout Plan',
      'Working Copy',
    ])
      expect(schemaText).not.toContain(privateTerm)
  })

  test('Test Parrot generated records validate against the public schema', async () => {
    const validate = new Ajv2020({ strict: true }).compile(publicSchema)
    const bank: QuestionBankResource = {
      id: 'local-bank',
      name: 'Generated example',
      createdAt: 'not-public',
      lastUpdatedAt: 'not-public',
      questions: [
        {
          id: 'local-question',
          type: 'open',
          columns: 4,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Explain.' }],
              },
            ],
          },
        },
        {
          id: 'local-multipart',
          type: 'multipart',
          columns: 2,
          doc: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Read the passage.' }] },
              {
                type: 'multipartParts',
                content: [
                  {
                    type: 'multipartPart',
                    attrs: { id: 'local-part-a', columns: 4 },
                    content: [
                      { type: 'multipartPartStem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Which?' }] }] },
                      {
                        type: 'multipleChoice',
                        content: ['This', 'That', 'Both A and B'].map((answer, index) => ({
                          type: 'multipleChoiceChoice',
                          attrs: { id: `local-choice-${index}`, correct: index === 0 },
                          content: [{ type: 'paragraph', content: [{ type: 'text', text: answer }] }],
                        })),
                      },
                    ],
                  },
                  {
                    type: 'multipartPart',
                    attrs: { id: 'local-part-b', columns: 2 },
                    content: [
                      { type: 'multipartPartStem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Why?' }] }] },
                      { type: 'suggestedAnswer', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Because.' }] }] },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    }
    const prepared = await prepareQuestionBankExport(bank)
    const generated = JSON.parse(decoder.decode(prepared.recordBytes)) as QuestionBankRecord

    expect(validate(generated), JSON.stringify(validate.errors)).toBe(true)
    expect(generated.bank.questions[1]!.parts![0]!.choices!.map((choice) => choice.locked)).toEqual([
      undefined, undefined, true,
    ])
  })

  test('a Part with Subparts is written as their lead-in, validates, and imports back as it was', async () => {
    const validate = new Ajv2020({ strict: true }).compile(publicSchema)
    const text = (value: string) => [{ type: 'paragraph', content: [{ type: 'text', text: value }] }]
    const answering = (type: string, id: string, stem: string, answer: Record<string, unknown>) => ({
      type,
      attrs: { id, columns: 2 },
      content: [{ type: 'multipartPartStem', content: text(stem) }, answer],
    })
    const bank: QuestionBankResource = {
      id: 'local-bank',
      name: 'Generated Subparts',
      createdAt: 'not-public',
      lastUpdatedAt: 'not-public',
      questions: [{
        id: 'local-multipart',
        type: 'multipart',
        columns: 2,
        doc: {
          type: 'doc',
          content: [
            ...text('A table of rainfall by month.'),
            {
              type: 'multipartParts',
              content: [
                answering('multipartPart', 'local-a', 'Which month was wettest?', {
                  type: 'suggestedAnswer', content: text('March.'),
                }),
                {
                  type: 'multipartPart',
                  attrs: { id: 'local-b', columns: 2 },
                  content: [
                    { type: 'multipartPartStem', content: text('Rain fell on 12 days in May.') },
                    {
                      type: 'multipartSubparts',
                      content: [
                        answering('multipartSubpart', 'local-b-i', 'Is that more than in April?', {
                          type: 'multipleChoice',
                          content: ['Yes', 'No'].map((answer, index) => ({
                            type: 'multipleChoiceChoice',
                            attrs: { id: `local-b-i-${index}`, correct: index === 0 },
                            content: text(answer),
                          })),
                        }),
                        answering('multipartSubpart', 'local-b-ii', 'Give a reason.', {
                          type: 'suggestedAnswer', content: [{ type: 'paragraph' }],
                        }),
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }],
    }
    const prepared = await prepareQuestionBankExport(bank)
    const generated = JSON.parse(decoder.decode(prepared.recordBytes)) as QuestionBankRecord

    expect(generated.formatVersion).toBe('0.10.0')
    expect(validate(generated), JSON.stringify(validate.errors)).toBe(true)
    expect(generated.bank.questions[0]!.parts![1]).toEqual({
      id: 'q1-s2',
      stem: { type: 'document', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rain fell on 12 days in May.' }] }] },
      subparts: [
        expect.objectContaining({
          id: 'q1-s2-s1',
          type: 'multiple-choice',
          choices: [
            expect.objectContaining({ id: 'q1-s2-s1-c1', correct: true }),
            expect.objectContaining({ id: 'q1-s2-s1-c2', correct: false }),
          ],
        }),
        { id: 'q1-s2-s2', type: 'short-answer', stem: expect.anything() },
      ],
    })

    const proposal = await inspectQuestionBankRecord(prepared.recordBytes)
    const [imported] = importedQuestionsFromRecord(proposal.record)
    const original = partsOf(bank.questions[0]!)
    const back = partsOf(imported!)
    // Fresh local ids, the same Parts and Subparts.
    const shape = (parts: typeof back) => parts.map((part) => ({
      type: part.type,
      stem: part.stem,
      subparts: part.subparts.map((subpart) => ({
        type: subpart.type,
        stem: subpart.stem,
        choices: subpart.choices.map((choice) => [choice.correct, choice.node.content]),
        suggestedAnswer: subpart.suggestedAnswer,
      })),
      suggestedAnswer: part.suggestedAnswer,
    }))
    expect(shape(back)).toEqual(shape(original))
    expect(back[1]!.subparts[0]!.id).not.toBe('local-b-i')
  })
})

describe('retained Question Bank Record 0.9.0 contract', () => {
  const root090 = fixtureRootFor('0.9.0')

  test('the published 0.9.0 schema is unchanged and still checked in twice', async () => {
    expect(publicSchema090.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.9.0/schema.json',
    )
    expect(publicSchema090.properties.formatVersion.const).toBe('0.9.0')
    expect(applicationSchema090).toEqual(publicSchema090)
    expect(
      await Bun.file(join(import.meta.dir, '..', 'public', 'question-bank-record-0.9.0.schema.json')).json(),
    ).toEqual(publicSchema090)
  })

  test('every 0.9.0 canonical example still imports from beside its files, migrated to the current version', async () => {
    const names = await filesIn(join(root090, 'examples'))

    expect(names).toContain('subparts.json')
    for (const name of names) {
      const proposal = await inspectFixture(join(root090, 'examples'), name)
      expect(proposal.record.formatVersion, name).toBe(QUESTION_BANK_FORMAT_VERSION)
      expect(proposal.summary.formatVersion, name).toBe('0.9.0')
    }
  })

  test('0.9.0 counterexamples are still rejected with their documented errors', async () => {
    const root = join(root090, 'invalid')
    const manifest = (await fixture(root, 'manifest.json')) as Record<string, string>

    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectFixture(root, name)
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })

  test('a 0.9.0 record has no Fill in the Blank Questions and no Blanks', async () => {
    const record = (await fixture(exampleRoot, 'fill-in-the-blank.json')) as {
      formatVersion: string
      bank: { questions: Record<string, unknown>[] }
    }
    record.formatVersion = '0.9.0'
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(publicSchema090)
    expect(validate(record)).toBe(false)
    try {
      await inspectQuestionBankRecordValue(record)
      throw new Error('A 0.9.0 Blank unexpectedly conformed')
    } catch (error) {
      expect(error).toBeInstanceOf(QuestionBankImportError)
      expect((error as QuestionBankImportError).message).toBe(
        'Blanks need Question Bank Record 0.10.0 or later; this record declares 0.9.0.',
      )
    }
  })
})

describe('retained Question Bank Record 0.8.0 contract', () => {
  const root080 = fixtureRootFor('0.8.0')

  test('the published 0.8.0 schema is unchanged and still checked in twice', async () => {
    expect(publicSchema080.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.8.0/schema.json',
    )
    expect(publicSchema080.properties.formatVersion.const).toBe('0.8.0')
    expect(applicationSchema080).toEqual(publicSchema080)
    expect(
      await Bun.file(join(import.meta.dir, '..', 'public', 'question-bank-record-0.8.0.schema.json')).json(),
    ).toEqual(publicSchema080)
  })

  test('every 0.8.0 canonical example still imports from beside its files, migrated to the current version', async () => {
    const names = await filesIn(join(root080, 'examples'))

    expect(names).toContain('media-rich.json')
    for (const name of names) {
      const proposal = await inspectFixture(join(root080, 'examples'), name)
      expect(proposal.record.formatVersion, name).toBe(QUESTION_BANK_FORMAT_VERSION)
      expect(proposal.summary.formatVersion, name).toBe('0.8.0')
    }
  })

  test('0.8.0 counterexamples are still rejected with their documented errors', async () => {
    const root = join(root080, 'invalid')
    const manifest = (await fixture(root, 'manifest.json')) as Record<string, string>

    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectFixture(root, name)
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })
})

// 0.1.0 through 0.9.0 are retired as producer versions and retained as
// consumer ones: every Question Bank File a teacher has already shared must
// still open. Their published contracts are therefore frozen — these are the
// assertions that keep them that way.
describe('retained Question Bank Record 0.7.0 contract', () => {
  const root070 = fixtureRootFor('0.7.0')

  test('the published 0.7.0 schema is unchanged and still checked in twice', async () => {
    expect(publicSchema070.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.7.0/schema.json',
    )
    expect(publicSchema070.properties.formatVersion.const).toBe('0.7.0')
    expect(applicationSchema070).toEqual(publicSchema070)
    expect(
      await Bun.file(join(import.meta.dir, '..', 'public', 'question-bank-record-0.7.0.schema.json')).json(),
    ).toEqual(publicSchema070)
  })

  test('every 0.7.0 canonical example still imports with its base64 Media Assets, migrated to the current version', async () => {
    const names = await filesIn(join(root070, 'examples'))

    expect(names).toContain('cropped-picture.json')
    for (const name of names) {
      const proposal = await inspectQuestionBankRecord(
        await Bun.file(join(root070, 'examples', name)).bytes(),
      )
      expect(proposal.record.formatVersion, name).toBe(QUESTION_BANK_FORMAT_VERSION)
      expect(proposal.summary.formatVersion, name).toBe('0.7.0')
    }
    const media = await inspectQuestionBankRecord(
      await Bun.file(join(root070, 'examples', 'media-rich.json')).bytes(),
    )
    expect(media.summary).toMatchObject({ mediaAssets: 1, decodedMediaBytes: 70 })
    expect(media.record.media[0]!.bytes).toBeInstanceOf(Uint8Array)
  })

  test('0.7.0 counterexamples are still rejected with their documented errors', async () => {
    const manifest = (await fixture(join(root070, 'invalid'), 'manifest.json')) as Record<string, string>

    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectQuestionBankRecord(await Bun.file(join(root070, 'invalid', name)).bytes())
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })

  test('a 0.7.0 record carries its pictures as base64, and cannot name a file', async () => {
    const record = (await fixture(exampleRoot, 'media-rich.json')) as { formatVersion: string }
    record.formatVersion = '0.7.0'
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(publicSchema070)

    expect(validate(record)).toBe(false)
    try {
      await inspectQuestionBankRecordValue(record, undefined, packageFiles(await mediaBeside(exampleRoot)))
      throw new Error('A 0.7.0 Media Asset naming a file unexpectedly conformed')
    } catch (error) {
      expect(error).toBeInstanceOf(QuestionBankImportError)
      expect((error as QuestionBankImportError).code).toBe('invalid-structure')
    }
  })
})

describe('retained Question Bank Record 0.6.0 contract', () => {
  const root060 = fixtureRootFor('0.6.0')

  test('the published 0.6.0 schema is unchanged and still checked in twice', async () => {
    expect(publicSchema060.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.6.0/schema.json',
    )
    expect(publicSchema060.properties.formatVersion.const).toBe('0.6.0')
    expect(applicationSchema060).toEqual(publicSchema060)
    expect(
      await Bun.file(join(import.meta.dir, '..', 'public', 'question-bank-record-0.6.0.schema.json')).json(),
    ).toEqual(publicSchema060)
  })

  test('every 0.6.0 canonical example still imports, migrated to the current version', async () => {
    const names = await filesIn(join(root060, 'examples'))

    expect(names).toContain('side-by-side.json')
    expect(names).not.toContain('cropped-picture.json')
    for (const name of names) {
      const proposal = await inspectQuestionBankRecord(
        await Bun.file(join(root060, 'examples', name)).bytes(),
      )
      expect(proposal.record.formatVersion, name).toBe(QUESTION_BANK_FORMAT_VERSION)
      expect(proposal.summary.formatVersion, name).toBe('0.6.0')
    }
  })

  test('0.6.0 counterexamples are still rejected with their documented errors', async () => {
    const manifest = (await fixture(join(root060, 'invalid'), 'manifest.json')) as Record<string, string>

    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectQuestionBankRecord(await Bun.file(join(root060, 'invalid', name)).bytes())
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })

  test('a 0.6.0 Authored Image Size keeps its old meaning, and a crop it carries is not read', async () => {
    const record = (await fixture(example070Root, 'cropped-picture.json')) as { formatVersion: string }
    record.formatVersion = '0.6.0'
    const proposal = await inspectQuestionBankRecord(new TextEncoder().encode(JSON.stringify(record)))
    const stem = proposal.record.bank.questions[0]!.stem

    expect(stem.content[1]).not.toHaveProperty('crop')
    expect(stem.content[1]).not.toHaveProperty('authoredSize')
    expect(stem.content[1]).toMatchObject({ legacyRatio: 0.4 })
    const attrs = recordDocumentToEditorNodes(stem)[1]!.attrs as Record<string, unknown>
    expect(attrs.ratio).toBe(0.4)
    expect(attrs).not.toHaveProperty('size')
    expect(attrs).not.toHaveProperty('crop')
  })
})

describe('retained Question Bank Record 0.5.0 contract', () => {
  const root050 = fixtureRootFor('0.5.0')

  test('the published 0.5.0 schema is unchanged and still checked in twice', async () => {
    expect(publicSchema050.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.5.0/schema.json',
    )
    expect(publicSchema050.properties.formatVersion.const).toBe('0.5.0')
    expect(applicationSchema050).toEqual(publicSchema050)
    expect(
      await Bun.file(join(import.meta.dir, '..', 'public', 'question-bank-record-0.5.0.schema.json')).json(),
    ).toEqual(publicSchema050)
  })

  test('every 0.5.0 canonical example still imports, migrated to the current version', async () => {
    const names = await filesIn(join(root050, 'examples'))

    expect(names).toContain('pending-images.json')
    expect(names).not.toContain('side-by-side.json')
    for (const name of names) {
      const proposal = await inspectQuestionBankRecord(
        await Bun.file(join(root050, 'examples', name)).bytes(),
      )
      expect(proposal.record.formatVersion, name).toBe(QUESTION_BANK_FORMAT_VERSION)
      expect(proposal.summary.formatVersion, name).toBe('0.5.0')
    }
  })

  test('0.5.0 counterexamples are still rejected with their documented errors', async () => {
    const manifest = (await fixture(join(root050, 'invalid'), 'manifest.json')) as Record<string, string>

    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectQuestionBankRecord(await Bun.file(join(root050, 'invalid', name)).bytes())
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })

  test('a 0.5.0 record cannot hold a Side-by-Side, since a 0.5.0 consumer would reject one', async () => {
    const record = (await fixture(example070Root, 'side-by-side.json')) as { formatVersion: string }
    record.formatVersion = '0.5.0'
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(publicSchema050)

    expect(validate(record)).toBe(false)
    try {
      await inspectQuestionBankRecord(new TextEncoder().encode(JSON.stringify(record)))
      throw new Error('A 0.5.0 Side-by-Side unexpectedly conformed')
    } catch (error) {
      expect(error).toBeInstanceOf(QuestionBankImportError)
      expect((error as QuestionBankImportError).code).toBe('invalid-structure')
      expect((error as Error).message).toContain('0.6.0')
    }
  })
})

describe('retained Question Bank Record 0.4.0 contract', () => {
  const root040 = fixtureRootFor('0.4.0')

  test('the published 0.4.0 schema is unchanged and still checked in twice', async () => {
    expect(publicSchema040.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.4.0/schema.json',
    )
    expect(publicSchema040.properties.formatVersion.const).toBe('0.4.0')
    expect(applicationSchema040).toEqual(publicSchema040)
    expect(
      await Bun.file(join(import.meta.dir, '..', 'public', 'question-bank-record-0.4.0.schema.json')).json(),
    ).toEqual(publicSchema040)
  })

  test('every 0.4.0 canonical example still imports, migrated to the current version', async () => {
    const names = await filesIn(join(root040, 'examples'))

    expect(names).toContain('multipart.json')
    expect(names).not.toContain('pending-images.json')
    for (const name of names) {
      const proposal = await inspectQuestionBankRecord(
        await Bun.file(join(root040, 'examples', name)).bytes(),
      )
      expect(proposal.record.formatVersion, name).toBe(QUESTION_BANK_FORMAT_VERSION)
      expect(proposal.summary.formatVersion, name).toBe('0.4.0')
    }
  })

  test('0.4.0 counterexamples are still rejected with their documented errors', async () => {
    const manifest = (await fixture(join(root040, 'invalid'), 'manifest.json')) as Record<string, string>

    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectQuestionBankRecord(await Bun.file(join(root040, 'invalid', name)).bytes())
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })

  test('a 0.4.0 record cannot hold a Pending Image, since a 0.4.0 consumer would reject one', async () => {
    const record = (await fixture(example070Root, 'pending-images.json')) as { formatVersion: string }
    record.formatVersion = '0.4.0'
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(publicSchema040)

    expect(validate(record)).toBe(false)
  })
})

describe('retained Question Bank Record 0.3.0 contract', () => {
  const root030 = fixtureRootFor('0.3.0')

  test('the published 0.3.0 schema is unchanged and still checked in twice', async () => {
    expect(publicSchema030.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.3.0/schema.json',
    )
    expect(publicSchema030.properties.formatVersion.const).toBe('0.3.0')
    expect(applicationSchema030).toEqual(publicSchema030)
    expect(
      await Bun.file(
        join(
          import.meta.dir,
          '..',
          'public',
          'question-bank-record-0.3.0.schema.json',
        ),
      ).json(),
    ).toEqual(publicSchema030)
  })

  test('every 0.3.0 canonical example still imports, migrated to the current version', async () => {
    const names = await filesIn(join(root030, 'examples'))

    expect(names).toEqual([
      'complete-rich-text.json',
      'matching.json',
      'media-rich.json',
      'minimal-multiple-choice.json',
      'provenance-and-links.json',
      'short-answer.json',
      'true-false.json',
    ])
    for (const name of names) {
      const proposal = await inspectQuestionBankRecord(
        await Bun.file(join(root030, 'examples', name)).bytes(),
      )
      expect(proposal.record.formatVersion, name).toBe(
        QUESTION_BANK_FORMAT_VERSION,
      )
      expect(proposal.summary.formatVersion, name).toBe('0.3.0')
    }
  })

  test('0.3.0 counterexamples are still rejected with their documented errors', async () => {
    const manifest = (await fixture(
      join(root030, 'invalid'),
      'manifest.json',
    )) as Record<string, string>

    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectQuestionBankRecord(
          await Bun.file(join(root030, 'invalid', name)).bytes(),
        )
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })

  test('a 0.3.0 record cannot hold a Multipart question, since a 0.3.0 consumer would reject one', async () => {
    const multipart = (await fixture(
      example070Root,
      'multipart.json',
    )) as QuestionBankRecord & { formatVersion: string }
    multipart.formatVersion = '0.3.0'
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(publicSchema030)

    expect(validate(multipart)).toBe(false)
    try {
      await inspectQuestionBankRecord(new TextEncoder().encode(JSON.stringify(multipart)))
      throw new Error('A 0.3.0 Multipart question unexpectedly conformed')
    } catch (error) {
      expect(error).toBeInstanceOf(QuestionBankImportError)
      expect((error as QuestionBankImportError).code).toBe('invalid-structure')
    }
  })
})

describe('retained Question Bank Record 0.2.0 contract', () => {
  const root020 = fixtureRootFor('0.2.0')

  test('the published 0.2.0 schema is unchanged and still checked in twice', async () => {
    expect(publicSchema020.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.2.0/schema.json',
    )
    expect(publicSchema020.properties.formatVersion.const).toBe('0.2.0')
    expect(applicationSchema020).toEqual(publicSchema020)
    expect(
      await Bun.file(
        join(
          import.meta.dir,
          '..',
          'public',
          'question-bank-record-0.2.0.schema.json',
        ),
      ).json(),
    ).toEqual(publicSchema020)
  })

  test('every 0.2.0 canonical example still imports, migrated to the current version', async () => {
    const names = await filesIn(join(root020, 'examples'))

    expect(names).toEqual([
      'complete-rich-text.json',
      'media-rich.json',
      'minimal-multiple-choice.json',
      'provenance-and-links.json',
      'short-answer.json',
      'true-false.json',
    ])
    for (const name of names) {
      const proposal = await inspectQuestionBankRecord(
        await Bun.file(join(root020, 'examples', name)).bytes(),
      )
      expect(proposal.record.formatVersion, name).toBe(
        QUESTION_BANK_FORMAT_VERSION,
      )
      expect(proposal.summary.formatVersion, name).toBe('0.2.0')
    }
  })

  test('0.2.0 counterexamples are still rejected with their documented errors', async () => {
    const manifest = (await fixture(
      join(root020, 'invalid'),
      'manifest.json',
    )) as Record<string, string>

    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectQuestionBankRecord(
          await Bun.file(join(root020, 'invalid', name)).bytes(),
        )
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })
})

describe('retained Question Bank Record 0.1.0 contract', () => {
  const root010 = fixtureRootFor('0.1.0')

  test('the published 0.1.0 schema is unchanged and still checked in twice', async () => {
    expect(publicSchema010.$id).toBe(
      'https://testparrot.com/formats/question-bank/0.1.0/schema.json',
    )
    expect(publicSchema010.properties.formatVersion.const).toBe('0.1.0')
    expect(applicationSchema010).toEqual(publicSchema010)
    expect(
      await Bun.file(
        join(
          import.meta.dir,
          '..',
          'public',
          'question-bank-record-0.1.0.schema.json',
        ),
      ).json(),
    ).toEqual(publicSchema010)
  })

  test('each retained version knows only the Question Types of its day', () => {
    const typeEnum = (
      schema:
        | typeof publicSchema010
        | typeof publicSchema020
        | typeof publicSchema030
        | typeof publicSchema070
        | typeof publicSchema090
        | typeof publicSchema,
    ) =>
      (schema as {
        $defs: { question: { properties: { type: { enum: string[] } } } }
      }).$defs.question.properties.type.enum

    expect(typeEnum(publicSchema010)).toEqual([
      'multiple-choice',
      'short-answer',
    ])
    expect(typeEnum(publicSchema020)).toEqual([
      'multiple-choice',
      'true-false',
      'short-answer',
    ])
    expect(typeEnum(publicSchema030)).toEqual([
      'multiple-choice',
      'true-false',
      'matching',
      'short-answer',
    ])
    expect(typeEnum(publicSchema070)).toEqual(typeEnum(publicSchema090))
    expect(typeEnum(publicSchema090)).toEqual([
      'multiple-choice',
      'true-false',
      'matching',
      'short-answer',
      'multipart',
    ])
    expect(typeEnum(publicSchema)).toEqual([
      'multiple-choice',
      'true-false',
      'matching',
      'fill-in-the-blank',
      'short-answer',
      'multipart',
    ])
  })

  test('every 0.1.0 canonical example still imports, migrated to the current version', async () => {
    const names = await filesIn(join(root010, 'examples'))

    expect(names).toEqual([
      'complete-rich-text.json',
      'media-rich.json',
      'minimal-multiple-choice.json',
      'provenance-and-links.json',
      'short-answer.json',
    ])
    for (const name of names) {
      const proposal = await inspectQuestionBankRecord(
        await Bun.file(join(root010, 'examples', name)).bytes(),
      )
      expect(proposal.record.formatVersion, name).toBe(
        QUESTION_BANK_FORMAT_VERSION,
      )
      // What the teacher opened, not what the app rewrote it to.
      expect(proposal.summary.formatVersion, name).toBe('0.1.0')
    }
  })

  test('0.1.0 counterexamples are still rejected with their documented errors', async () => {
    const manifest = (await fixture(
      join(root010, 'invalid'),
      'manifest.json',
    )) as Record<string, string>

    for (const [name, code] of Object.entries(manifest)) {
      try {
        await inspectQuestionBankRecord(
          await Bun.file(join(root010, 'invalid', name)).bytes(),
        )
        throw new Error(`${name} unexpectedly conformed`)
      } catch (error) {
        expect(error, name).toBeInstanceOf(QuestionBankImportError)
        expect((error as QuestionBankImportError).code, name).toBe(code)
      }
    }
  })
})
