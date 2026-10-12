import { describe, expect, test } from 'bun:test'
import { PDFDocument } from 'pdf-lib'
import { PIXEL_PNG } from './export-fixtures'
import { choicesOf, partsOf, promptsOf } from './exam'
import {
  QUESTION_BANK_ATTACHMENT_DESCRIPTION,
  QUESTION_BANK_ATTACHMENT_NAME,
  QUESTION_BANK_FORMAT,
  QUESTION_BANK_FORMAT_VERSION,
  type QuestionBankRecord,
  type QuestionBankRecordQuestion,
  type SemanticNode,
} from './question-bank-export'
import {
  DEFAULT_QUESTION_BANK_IMPORT_LIMITS,
  QuestionBankImportError,
  SUPPORTED_QUESTION_BANK_VERSIONS,
  importedQuestionsFromRecord,
  inspectQuestionBankFile,
  inspectQuestionBankRecord,
  type QuestionBankImportLimits,
} from './question-bank-import'

const encoder = new TextEncoder()

const paragraph = (value = 'Question') => ({
  type: 'document' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
})

const block = (value = 'Panel') => ({ type: 'paragraph', content: [{ type: 'text', text: value }] })
const panel = (...content: SemanticNode[]): SemanticNode => ({ type: 'panel', content })
const sideBySide = (...panels: SemanticNode[]): SemanticNode => ({ type: 'side-by-side', content: panels })
const PIXEL_ID = 'sha256:c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77'
const PIXEL_ASSET: QuestionBankRecord['media'][number] = {
  id: PIXEL_ID,
  mimeType: 'image/png',
  width: 1,
  height: 1,
  bytes: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
}

// 0.7.0 is the last version to carry a Media Asset's bytes inline as base64.
// Files already shared are 0.7.0, so every rule is checked on it; the 0.8.0
// zip, whose pictures are files, is checked below against the same rules.
function baseRecord(): QuestionBankRecord {
  return {
    format: QUESTION_BANK_FORMAT,
    formatVersion: '0.7.0' as typeof QUESTION_BANK_FORMAT_VERSION,
    generator: { name: 'Independent Generator', version: '9.4.2' },
    requiredFeatures: [],
    bank: {
      name: 'Portable chemistry',
      questions: [
        {
          id: 'q1',
          type: 'multiple-choice',
          stem: paragraph('Which particle is neutral?'),
          difficulty: 'easy',
          topics: ['Atoms'],
          choices: [
            { id: 'q1-c1', content: paragraph('Proton'), correct: false },
            { id: 'q1-c2', content: paragraph('Neutron'), correct: true },
          ],
        },
      ],
    },
    media: [],
  }
}

function multipartQuestion(): QuestionBankRecordQuestion {
  return {
    id: 'q1',
    type: 'multipart',
    stem: paragraph('The power of the Kingdom of Aldmere was fading by 1450 …'),
    difficulty: 'medium',
    topics: ['Kingdom of Aldmere'],
    parts: [
      {
        id: 'q1-s1',
        type: 'multiple-choice',
        stem: paragraph('Which region was controlled by the Kingdom of Aldmere in 1450?'),
        choices: [
          { id: 'q1-s1-c1', content: paragraph('Eastern Forests'), correct: false },
          { id: 'q1-s1-c2', content: paragraph('Northern Coast'), correct: true },
        ],
      },
      {
        id: 'q1-s2',
        type: 'short-answer',
        stem: paragraph('Identify an issue the kingdom faced.'),
        suggestedAnswer: paragraph('Trade routes moved to the sea.'),
      },
    ],
  }
}

function multipartRecord(): QuestionBankRecord {
  const record = baseRecord()
  record.bank.questions = [multipartQuestion()]
  return record
}

function bytesOf(record: QuestionBankRecord & Record<string, unknown>) {
  return encoder.encode(JSON.stringify(record))
}

async function pdfWith(...attachments: { name: string; description: string; bytes: Uint8Array }[]) {
  const pdf = await PDFDocument.create()
  pdf.addPage()
  for (const attachment of attachments) {
    await pdf.attach(attachment.bytes, attachment.name, {
      description: attachment.description,
      mimeType: 'application/json',
    })
  }
  return pdf.save({ useObjectStreams: false })
}

// A JPEG as a phone camera writes one: an EXIF Orientation, the frame's stored
// size, then scan data, padded to make a big photo.
function photoJpeg(options: { stored: { width: number; height: number }; orientation: number; padding?: number }): Uint8Array {
  const tiff = new DataView(new ArrayBuffer(26))
  tiff.setUint16(0, 0x4d4d)
  tiff.setUint16(2, 42)
  tiff.setUint32(4, 8)
  tiff.setUint16(8, 1)
  tiff.setUint16(10, 0x0112)
  tiff.setUint16(12, 3)
  tiff.setUint32(14, 1)
  tiff.setUint16(18, options.orientation)
  const exif = [...encoder.encode('Exif'), 0, 0, ...new Uint8Array(tiff.buffer)]
  const app1 = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif]
  const { width, height } = options.stored
  const sof = [0xff, 0xc0, 0x00, 0x0b, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]
  const head = Uint8Array.from([0xff, 0xd8, ...app1, ...sof, 0xff, 0xda, 0x00, 0x02])
  const bytes = new Uint8Array(head.length + (options.padding ?? 0) + 2)
  bytes.set(head)
  bytes.set([0xff, 0xd9], bytes.length - 2)
  return bytes
}

async function recordWithPicture(data: Uint8Array, declared: { width: number; height: number }) {
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
  const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
  const id = `sha256:${digest}`
  source.media = [{ id, mimeType: 'image/jpeg', ...declared, bytes: Buffer.from(data).toString('base64') }]
  ;(source.bank.questions[0]!.stem.content as unknown[]) = [{ type: 'block-image', asset: id }]
  return source
}

function limits(overrides: Partial<QuestionBankImportLimits>): QuestionBankImportLimits {
  return { ...DEFAULT_QUESTION_BANK_IMPORT_LIMITS, ...overrides }
}

async function rejected(
  operation: Promise<unknown>,
  code: QuestionBankImportError['code'],
  text: string,
) {
  try {
    await operation
    throw new Error('Expected inspection to reject')
  } catch (error) {
    expect(error).toBeInstanceOf(QuestionBankImportError)
    expect((error as QuestionBankImportError).code).toBe(code)
    expect((error as Error).message).toContain(text)
  }
}

describe('Question Bank import mapping', () => {
  test('creates fresh local Question and choice identities while preserving content', async () => {
    const record = baseRecord()
    record.bank.questions[0]!.stem.content.push({
      type: 'block-image',
      asset: `sha256:${'a'.repeat(64)}`,
      alt: 'Atom model',
      authoredSize: 0.5,
    })
    const ids = ['local-question', 'local-choice-a', 'local-choice-b']
    const imported = importedQuestionsFromRecord(record, () => ids.shift()!)

    expect(imported).toHaveLength(1)
    expect(imported[0]).toMatchObject({
      id: 'local-question',
      type: 'multiple-choice',
      difficulty: 'easy',
      topics: ['Atoms'],
    })
    expect(JSON.stringify(imported)).not.toContain('q1')
    expect(JSON.stringify(imported)).toContain('Which particle is neutral?')
    expect(JSON.stringify(imported)).toContain('/local-images/')
    const choiceList = (imported[0]!.doc.content as Record<string, unknown>[]).find(
      (node) => node.type === 'multipleChoice',
    )!
    const choices = choiceList.content as Record<string, unknown>[]
    expect(choices.map((choice) => (choice.attrs as Record<string, unknown>).id)).toEqual([
      'local-choice-a',
      'local-choice-b',
    ])
  })

  test('Pending Images in stems, matching items and Word Bank answers survive import and re-export exactly', async () => {
    const tag = (image: number) => ({ type: 'block-image', pending: { image }, alt: `Graph ${image}` })
    const record = baseRecord()
    record.bank.questions[0]!.stem.content.push({ type: 'inline-image', pending: { page: 2 }, caption: 'Figure' })
    record.bank.questions.push({
      id: 'q2',
      type: 'matching',
      stem: { type: 'document', content: [tag(1)] },
      prompts: [
        { id: 'q2-p1', content: { type: 'document', content: [tag(2)] }, answer: 'q2-a2' },
        { id: 'q2-p2', content: paragraph('Slope 0'), answer: 'q2-a1' },
      ],
      wordBank: [
        { id: 'q2-a1', content: { type: 'document', content: [tag(3)] } },
        { id: 'q2-a2', content: paragraph('Increasing') },
      ],
    })
    const proposal = await inspectQuestionBankRecord(bytesOf(record))
    expect(proposal.summary).toMatchObject({ pendingImages: 4, mediaAssets: 0 })

    const imported = importedQuestionsFromRecord(proposal.record)
    expect(JSON.stringify(imported)).not.toContain('/local-images/')
    const { prepareQuestionBankExport } = await import('./question-bank-export')
    const exported = await prepareQuestionBankExport(
      { id: 'b', name: 'Portable chemistry', createdAt: '', lastUpdatedAt: '', questions: imported },
      async () => {
        throw new Error('a Pending Image has no media to load')
      },
    )
    expect(exported.record.media).toEqual([])
    expect(exported.record.bank.questions.map((question) => question.stem)).toEqual(
      proposal.record.bank.questions.map((question) => question.stem),
    )
    expect(exported.record.bank.questions[1]!.prompts!.map((prompt) => prompt.content)).toEqual(
      proposal.record.bank.questions[1]!.prompts!.map((prompt) => prompt.content),
    )
    expect(exported.record.bank.questions[1]!.wordBank!.map((answer) => answer.content)).toEqual(
      proposal.record.bank.questions[1]!.wordBank!.map((answer) => answer.content),
    )
  })
})

describe('hostile Question Bank File inspection', () => {
  test('publishes exact compatibility and production resource limits', () => {
    expect(Object.keys(SUPPORTED_QUESTION_BANK_VERSIONS)).toEqual([
      '0.1.0',
      '0.2.0',
      '0.3.0',
      '0.4.0',
      '0.5.0',
      '0.6.0',
      '0.7.0',
      '0.8.0',
      '0.9.0',
      '0.10.0',
    ])
    expect(DEFAULT_QUESTION_BANK_IMPORT_LIMITS).toEqual({
      pdfBytes: 100 * 1024 * 1024,
      recordBytes: 75 * 1024 * 1024,
      questions: 10_000,
      mediaAssets: 2_000,
      mediaAssetBytes: 25 * 1024 * 1024,
      totalMediaBytes: 75 * 1024 * 1024,
      questionNodes: 25_000,
      richTextDepth: 50,
      imageWidth: 20_000,
      imageHeight: 20_000,
    })
  })

  test('accepts an exact supported version from another generator and discards unknown optional fields', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.futureEnvelopeNote = 'ignore me'
    ;(source.bank as Record<string, unknown>).futureBankNote = { opaque: true }
    ;(source.bank.questions[0] as unknown as Record<string, unknown>).futureQuestionNote = 42
    const proposal = await inspectQuestionBankRecord(bytesOf(source))

    expect(proposal.summary).toMatchObject({
      bankName: 'Portable chemistry',
      questionCounts: { 'multiple-choice': 1, 'true-false': 0, matching: 0, 'short-answer': 0 },
      formatVersion: '0.7.0',
    })
    expect(proposal.record.generator.name).toBe('Independent Generator')
    expect(JSON.stringify(proposal.record)).not.toContain('future')
  })

  test('reports the file version and exact supported versions before semantic validation', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.formatVersion = '0.11.0'
    source.requiredFeatures = ['also-unknown']
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'unsupported-version',
      '0.11.0',
    )
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'unsupported-version',
      '0.1.0, 0.2.0, 0.3.0, 0.4.0, 0.5.0, 0.6.0, 0.7.0, 0.8.0, 0.9.0, 0.10.0',
    )
  })

  test('reads a 0.1.0 record and reports the version the file actually declared', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.formatVersion = '0.1.0'
    const proposal = await inspectQuestionBankRecord(bytesOf(source))

    // Migrated forward for every reader downstream, but a teacher is told what
    // they opened rather than what the app rewrote it to.
    expect(proposal.record.formatVersion).toBe(QUESTION_BANK_FORMAT_VERSION)
    expect(proposal.summary.formatVersion).toBe('0.1.0')
    expect(importedQuestionsFromRecord(proposal.record)[0]!.type).toBe(
      'multiple-choice',
    )
  })

  test('refuses a True/False Question in a 0.1.0 record', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.formatVersion = '0.1.0'
    ;(source.bank.questions[0] as { type: string }).type = 'true-false'
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-structure',
      'schema',
    )
  })

  test('reads a True/False Question and imports it as one', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    const question = source.bank.questions[0]!
    question.type = 'true-false'
    question.choices = [
      { id: 'q1-c1', content: paragraph('True'), correct: true },
      { id: 'q1-c2', content: paragraph('False'), correct: false },
    ]
    const proposal = await inspectQuestionBankRecord(bytesOf(source))

    expect(proposal.summary.questionCounts['true-false']).toBe(1)
    const [imported] = importedQuestionsFromRecord(proposal.record)
    expect(imported!.type).toBe('true-false')
    expect(choicesOf(imported!).map((choice) => choice.correct)).toEqual([
      true,
      false,
    ])
  })

  test('refuses a True/False Question that does not ask with exactly two answers', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    const question = source.bank.questions[0]!
    question.type = 'true-false'
    question.choices = [
      { id: 'q1-c1', content: paragraph('True'), correct: true },
      { id: 'q1-c2', content: paragraph('False'), correct: false },
      { id: 'q1-c3', content: paragraph('Sometimes'), correct: false },
    ]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-structure',
      'schema',
    )
  })

  test('refuses a Matching Question in a 0.2.0 record', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.formatVersion = '0.2.0'
    ;(source.bank.questions[0] as { type: string }).type = 'matching'
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-structure',
      'schema',
    )
  })

  test('reads a 0.2.0 record and reports the version the file actually declared', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.formatVersion = '0.2.0'
    const proposal = await inspectQuestionBankRecord(bytesOf(source))

    expect(proposal.record.formatVersion).toBe(QUESTION_BANK_FORMAT_VERSION)
    expect(proposal.summary.formatVersion).toBe('0.2.0')
  })

  test('reads a matching set and imports it with every item still naming its answer', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    const question = source.bank.questions[0]!
    question.type = 'matching'
    delete question.choices
    question.prompts = [
      { id: 'q1-p1', content: paragraph('Osmosis'), answer: 'q1-a2' },
      { id: 'q1-p2', content: paragraph('Diffusion') },
    ]
    question.wordBank = [
      { id: 'q1-a1', content: paragraph('Particles spread out.') },
      { id: 'q1-a2', content: paragraph('Water crosses a membrane.') },
      { id: 'q1-a3', content: paragraph('A distractor.') },
    ]
    const proposal = await inspectQuestionBankRecord(bytesOf(source))

    expect(proposal.summary.questionCounts.matching).toBe(1)
    // An unmatched item is reported the way an unmarked choice is.
    expect(proposal.summary.questionsWithoutCorrectAnswer).toBe(1)
    const [imported] = importedQuestionsFromRecord(proposal.record)
    expect(imported!.type).toBe('matching')
    const prompts = promptsOf(imported!)
    const bank = choicesOf(imported!)
    expect(bank).toHaveLength(3)
    expect(prompts).toHaveLength(2)
    // Package-local ids never survive import; the match does.
    expect(prompts[0]!.answerId).toBe(bank[1]!.id)
    expect(prompts[0]!.answerId).not.toBe('q1-a2')
    expect(prompts[1]!.answerId).toBe('')
    expect(JSON.stringify(imported)).not.toContain('q1-')
  })

  test('refuses content nested under a member no node has rather than dropping it', async () => {
    const table = {
      type: 'table',
      content: [{ type: 'table-row', content: [{ type: 'table-cell', content: [{ type: 'paragraph' }] }] }],
    }
    const inStem = baseRecord()
    ;(inStem.bank.questions[0]!.stem.content[0] as unknown as Record<string, unknown>).table = table
    await rejected(inspectQuestionBankRecord(bytesOf(inStem)), 'invalid-question', 'table inside a paragraph’s “table” member')

    // An answer's document is read the same way as a stem.
    const inChoice = baseRecord()
    ;(inChoice.bank.questions[0]!.choices![0]!.content.content[0] as unknown as Record<string, unknown>).extra = [table]
    await rejected(inspectQuestionBankRecord(bytesOf(inChoice)), 'invalid-question', 'Question “q1”')
  })

  test('refuses a matching item that names an answer outside its own Word Bank', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    const question = source.bank.questions[0]!
    question.type = 'matching'
    delete question.choices
    question.prompts = [{ id: 'q1-p1', content: paragraph('Osmosis'), answer: 'q1-a9' }]
    question.wordBank = [
      { id: 'q1-a1', content: paragraph('One') },
      { id: 'q1-a2', content: paragraph('Two') },
    ]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'dangling-reference',
      'q1-a9',
    )
  })

  test('refuses a matching set that asks with fewer than two Word Bank answers, or one that also carries choices', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    const question = source.bank.questions[0]!
    question.type = 'matching'
    question.prompts = [{ id: 'q1-p1', content: paragraph('Osmosis') }]
    question.wordBank = [{ id: 'q1-a1', content: paragraph('One') }]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-structure',
      'schema',
    )
    question.wordBank.push({ id: 'q1-a2', content: paragraph('Two') })
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-question',
      'cannot contain choices',
    )
  })

  test('refuses a Word Bank on a Question that is not a matching set', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.bank.questions[0]!.wordBank = [
      { id: 'q1-a1', content: paragraph('One') },
      { id: 'q1-a2', content: paragraph('Two') },
    ]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-question',
      'Word Bank',
    )
  })

  test('refuses a Multipart Question in a 0.3.0 record', async () => {
    const source = multipartRecord() as QuestionBankRecord & Record<string, unknown>
    source.formatVersion = '0.3.0'
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-structure',
      'schema',
    )
  })

  test('reads a 0.3.0 record and reports the version the file actually declared', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.formatVersion = '0.3.0'
    const proposal = await inspectQuestionBankRecord(bytesOf(source))

    expect(proposal.record.formatVersion).toBe(QUESTION_BANK_FORMAT_VERSION)
    expect(proposal.summary.formatVersion).toBe('0.3.0')
    expect(proposal.summary.questionCounts.multipart).toBe(0)
  })

  test('reads a Multipart question and imports it whole, every Part and choice under a fresh id', async () => {
    const proposal = await inspectQuestionBankRecord(bytesOf(multipartRecord()))

    expect(proposal.summary.questionCounts.multipart).toBe(1)
    expect(proposal.summary.questionsWithoutCorrectAnswer).toBe(0)
    const [imported] = importedQuestionsFromRecord(proposal.record)
    expect(imported).toMatchObject({ type: 'multipart', difficulty: 'medium', topics: ['Kingdom of Aldmere'] })
    // The Short Answer Part's Suggested Answer stays in the document, beside
    // its stem, rather than becoming the Multipart question's own.
    expect(imported!.suggestedAnswer).toBeUndefined()
    const parts = partsOf(imported!)
    expect(parts.map((part) => part.type)).toEqual(['multiple-choice', 'open'])
    expect(parts[0]!.choices.map((choice) => choice.correct)).toEqual([false, true])
    expect(JSON.stringify(parts[1]!.suggestedAnswer)).toContain('Trade routes moved to the sea.')
    // Package-local ids never survive import.
    expect(JSON.stringify(imported)).not.toContain('q1-s')
    const ids = [imported!.id, ...parts.map((part) => part.id), ...parts[0]!.choices.map((choice) => choice.id)]
    expect(new Set(ids).size).toBe(ids.length)
    expect(JSON.stringify(imported!.doc)).toContain('The power of the Kingdom of Aldmere was fading by 1450')
  })

  test('reads a Multipart question with no Parts as incomplete rather than invalid', async () => {
    const source = multipartRecord()
    source.bank.questions[0]!.parts = []
    const proposal = await inspectQuestionBankRecord(bytesOf(source))

    expect(proposal.summary.questionsWithoutCorrectAnswer).toBe(1)
    const [imported] = importedQuestionsFromRecord(proposal.record)
    expect(imported!.type).toBe('multipart')
    expect(partsOf(imported!)).toEqual([])
  })

  test('refuses a Multiple Choice Part with fewer than two choices', async () => {
    const source = multipartRecord()
    source.bank.questions[0]!.parts![0]!.choices!.splice(1)
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-structure',
      '/bank/questions/0/parts/0/choices',
    )
    delete source.bank.questions[0]!.parts![0]!.choices
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-structure',
      '/bank/questions/0/parts/0',
    )
  })

  test('refuses a Short Answer Part that carries choices', async () => {
    const source = multipartRecord()
    source.bank.questions[0]!.parts![1]!.choices = [
      { id: 'q1-s2-c1', content: paragraph('One'), correct: false },
      { id: 'q1-s2-c2', content: paragraph('Two'), correct: true },
    ]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-question',
      'Part b (“q1-s2”) of Multipart Question “q1” is Short Answer and cannot contain choices.',
    )
  })

  test('refuses a Part of any type but Multiple Choice or Short Answer', async () => {
    const source = multipartRecord()
    ;(source.bank.questions[0]!.parts![0] as { type: string }).type = 'true-false'
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-structure',
      '/bank/questions/0/parts/0/type',
    )
  })

  test('refuses a Multiple Choice Part with two correct choices, or a Suggested Answer', async () => {
    const source = multipartRecord()
    const part = source.bank.questions[0]!.parts![0]!
    part.choices![0]!.correct = true
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-question',
      'at most one correct choice',
    )
    part.choices![0]!.correct = false
    part.suggestedAnswer = paragraph('Northern Coast')
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-question',
      'cannot contain a Suggested Answer',
    )
  })

  test('refuses Parts on a Question that is not a Multipart question, and choices on a Multipart question itself', async () => {
    const onMultipleChoice = baseRecord()
    onMultipleChoice.bank.questions[0]!.parts = []
    await rejected(
      inspectQuestionBankRecord(bytesOf(onMultipleChoice)),
      'invalid-question',
      'cannot contain Multipart Parts',
    )
    const withChoices = multipartRecord()
    withChoices.bank.questions[0]!.choices = [
      { id: 'q1-c1', content: paragraph('One'), correct: false },
      { id: 'q1-c2', content: paragraph('Two'), correct: true },
    ]
    await rejected(
      inspectQuestionBankRecord(bytesOf(withChoices)),
      'invalid-question',
      'each Part carries its own',
    )
  })

  test('refuses a Part id used twice', async () => {
    const source = multipartRecord()
    source.bank.questions[0]!.parts![1]!.id = 'q1-s1'
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'duplicate-id',
      'q1-s1',
    )
  })

  test('reads a Side-by-Side in a stem and in a Part’s stem, and imports it as the editor’s', async () => {
    const source = multipartRecord()
    const question = source.bank.questions[0]!
    question.stem.content.push(sideBySide(panel(block('Left')), panel(block('Right'))))
    question.parts![0]!.stem.content.push(sideBySide(panel(block('One')), panel(block('Two')), panel(block('Three'))))
    const proposal = await inspectQuestionBankRecord(bytesOf(source))

    expect(proposal.record.bank.questions[0]!.stem.content[1]).toEqual(sideBySide(panel(block('Left')), panel(block('Right'))))
    const [imported] = importedQuestionsFromRecord(proposal.record)
    expect(imported!.doc.content![1]).toEqual({
      type: 'sideBySide',
      content: ['Left', 'Right'].map((value) => ({
        type: 'sideBySidePanel',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
      })),
    })
    expect(partsOf(imported!)[0]!.stem[1]).toMatchObject({
      type: 'sideBySide',
      content: [{ type: 'sideBySidePanel' }, { type: 'sideBySidePanel' }, { type: 'sideBySidePanel' }],
    })
  })

  test.each([
    ['with one Panel', (record: QuestionBankRecord) => {
      record.bank.questions[0]!.stem.content.push(sideBySide(panel(block())))
    }, 'two or three Panels; this one holds 1'],
    ['with four Panels', (record: QuestionBankRecord) => {
      record.bank.questions[0]!.stem.content.push(sideBySide(panel(block()), panel(block()), panel(block()), panel(block())))
    }, 'two or three Panels; this one holds 4'],
    ['with an empty Panel', (record: QuestionBankRecord) => {
      record.bank.questions[0]!.stem.content.push(sideBySide(panel(), panel(block())))
    }, 'A Panel must hold at least one block'],
    ['holding something other than Panels', (record: QuestionBankRecord) => {
      record.bank.questions[0]!.stem.content.push(sideBySide(panel(block()), block()))
    }, 'may hold only Panels'],
    ['inside another Side-by-Side', (record: QuestionBankRecord) => {
      record.bank.questions[0]!.stem.content.push(
        sideBySide(panel(sideBySide(panel(block()), panel(block()))), panel(block())),
      )
    }, 'inside a Panel of another Side-by-Side'],
    ['in a choice', (record: QuestionBankRecord) => {
      record.bank.questions[0]!.choices![0]!.content.content.push(sideBySide(panel(block()), panel(block())))
    }, 'only as a top-level block'],
    ['inside a blockquote', (record: QuestionBankRecord) => {
      record.bank.questions[0]!.stem.content.push({ type: 'blockquote', content: [sideBySide(panel(block()), panel(block()))] })
    }, 'only as a top-level block'],
    ['inside a list item', (record: QuestionBankRecord) => {
      record.bank.questions[0]!.stem.content.push({
        type: 'bullet-list',
        content: [{ type: 'list-item', content: [sideBySide(panel(block()), panel(block()))] }],
      })
    }, 'only as a top-level block'],
    ['in a Suggested Answer', (record: QuestionBankRecord) => {
      const question = record.bank.questions[0]!
      question.type = 'short-answer'
      delete question.choices
      question.suggestedAnswer = { type: 'document', content: [sideBySide(panel(block()), panel(block()))] }
    }, 'only as a top-level block'],
    ['as a lone Panel', (record: QuestionBankRecord) => {
      record.bank.questions[0]!.stem.content.push(panel(block()))
    }, 'only inside a Side-by-Side'],
  ])('refuses a Side-by-Side %s', async (_name, edit, message) => {
    const source = baseRecord()
    edit(source)
    await rejected(inspectQuestionBankRecord(bytesOf(source)), 'invalid-structure', message)
  })

  test('refuses a Side-by-Side in a Part’s choice, while reading one in the Part’s stem', async () => {
    const source = multipartRecord()
    source.bank.questions[0]!.parts![0]!.choices![0]!.content.content.push(sideBySide(panel(block()), panel(block())))
    await rejected(inspectQuestionBankRecord(bytesOf(source)), 'invalid-structure', 'only as a top-level block')
  })

  test('refuses a Side-by-Side in a record older than 0.6.0, and still reads that record without one', async () => {
    const source = baseRecord()
    source.formatVersion = '0.5.0' as typeof source.formatVersion
    const proposal = await inspectQuestionBankRecord(bytesOf(source))
    expect(proposal.summary.formatVersion).toBe('0.5.0')
    expect(proposal.record.formatVersion).toBe(QUESTION_BANK_FORMAT_VERSION)

    source.bank.questions[0]!.stem.content.push(sideBySide(panel(block()), panel(block())))
    await rejected(inspectQuestionBankRecord(bytesOf(source)), 'invalid-structure', 'need Question Bank Record 0.6.0')
  })

  test('counts a Media Asset and a Pending Image inside a Panel like any other picture', async () => {
    const source = baseRecord()
    source.bank.questions[0]!.stem.content.push(
      sideBySide(
        panel({ type: 'block-image', asset: PIXEL_ID, alt: 'Graph A' }),
        panel({ type: 'block-image', pending: { image: 2 }, alt: 'Graph B' }),
      ),
    )
    source.media = [PIXEL_ASSET]
    const proposal = await inspectQuestionBankRecord(bytesOf(source))
    expect(proposal.summary).toMatchObject({ mediaAssets: 1, pendingImages: 1 })

    source.media = []
    await rejected(inspectQuestionBankRecord(bytesOf(source)), 'dangling-reference', PIXEL_ID)
  })

  test('structural schema validation precedes semantic validation', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    delete (source.bank.questions[0] as unknown as { stem?: unknown }).stem
    source.requiredFeatures = ['unknown-feature']
    await rejected(
      inspectQuestionBankRecord(bytesOf(source)),
      'invalid-structure',
      'schema',
    )
  })

  test.each([
    ['required feature', (record: QuestionBankRecord) => { record.requiredFeatures = ['future-meaning'] }, 'unsupported-feature'],
    ['Question Type', (record: QuestionBankRecord) => { (record.bank.questions[0] as { type: string }).type = 'essay' }, 'invalid-structure'],
    ['rich-text node', (record: QuestionBankRecord) => { record.bank.questions[0]!.stem.content[0]!.type = 'video' }, 'invalid-structure'],
    ['mark', (record: QuestionBankRecord) => { record.bank.questions[0]!.stem.content[0] = { type: 'text', text: 'x', marks: [{ type: 'blink' } as never] } }, 'invalid-structure'],
    ['semantic enum', (record: QuestionBankRecord) => { (record.bank.questions[0] as { difficulty?: string }).difficulty = 'impossible' }, 'invalid-structure'],
  ] as const)('rejects an unknown %s for the whole record', async (_label, mutate, code) => {
    const source = baseRecord()
    mutate(source)
    await rejected(
      inspectQuestionBankRecord(bytesOf(source as QuestionBankRecord & Record<string, unknown>)),
      code,
      code === 'unsupported-feature' ? 'future-meaning' : 'schema',
    )
  })

  test('validates package IDs, references, cardinality, and links', async () => {
    const duplicate = baseRecord()
    duplicate.bank.questions.push(structuredClone(duplicate.bank.questions[0]!))
    await rejected(inspectQuestionBankRecord(bytesOf(duplicate as QuestionBankRecord & Record<string, unknown>)), 'duplicate-id', 'q1')

    const cardinality = baseRecord()
    cardinality.bank.questions[0]!.choices![0]!.correct = true
    await rejected(inspectQuestionBankRecord(bytesOf(cardinality as QuestionBankRecord & Record<string, unknown>)), 'invalid-question', 'one correct')

    const wrongContent = baseRecord()
    wrongContent.bank.questions[0]!.suggestedAnswer = paragraph('Not allowed')
    await rejected(inspectQuestionBankRecord(bytesOf(wrongContent as QuestionBankRecord & Record<string, unknown>)), 'invalid-question', 'Suggested Answer')

    const unsafe = baseRecord()
    unsafe.bank.questions[0]!.stem.content[0] = {
      type: 'text', text: 'click', marks: [{ type: 'link', href: 'javascript:alert(1)' }],
    }
    await rejected(inspectQuestionBankRecord(bytesOf(unsafe as QuestionBankRecord & Record<string, unknown>)), 'unsafe-url', 'HTTP or HTTPS')
  })

  test('checks PDF and decoded record byte boundaries before parsing', async () => {
    const recordBytes = bytesOf(baseRecord() as QuestionBankRecord & Record<string, unknown>)
    const pdf = await pdfWith({ name: QUESTION_BANK_ATTACHMENT_NAME, description: QUESTION_BANK_ATTACHMENT_DESCRIPTION, bytes: recordBytes })

    await expect(inspectQuestionBankFile(pdf, { limits: limits({ pdfBytes: pdf.byteLength, recordBytes: recordBytes.byteLength }) })).resolves.toBeDefined()
    await rejected(inspectQuestionBankFile(pdf, { limits: limits({ pdfBytes: pdf.byteLength - 1 }) }), 'pdf-size-limit', `${pdf.byteLength - 1}`)
    await rejected(inspectQuestionBankFile(pdf, { limits: limits({ recordBytes: recordBytes.byteLength - 1 }) }), 'record-size-limit', `${recordBytes.byteLength - 1}`)
  })

  test('rejects malformed PDFs, missing records, ambiguous records, and malformed JSON distinctly', async () => {
    await rejected(inspectQuestionBankFile(encoder.encode('not a PDF')), 'invalid-pdf', 'valid PDF')
    await rejected(inspectQuestionBankFile(await pdfWith()), 'missing-attachment', 'not exported from Test Parrot')
    const good = bytesOf(baseRecord() as QuestionBankRecord & Record<string, unknown>)
    await rejected(inspectQuestionBankFile(await pdfWith(
      { name: 'one.json', description: QUESTION_BANK_ATTACHMENT_DESCRIPTION, bytes: good },
      { name: 'two.json', description: QUESTION_BANK_ATTACHMENT_DESCRIPTION, bytes: good },
    )), 'ambiguous-attachments', 'several')
    await rejected(inspectQuestionBankFile(await pdfWith(
      { name: QUESTION_BANK_ATTACHMENT_NAME, description: QUESTION_BANK_ATTACHMENT_DESCRIPTION, bytes: encoder.encode('{') },
    )), 'invalid-json', 'JSON')
  })

  test('checks media count at and immediately over the configured limit before decoding', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.media = []
    await expect(
      inspectQuestionBankRecord(bytesOf(source), { limits: limits({ mediaAssets: 0 }) }),
    ).resolves.toBeDefined()
    source.media = [{ id: `sha256:${'0'.repeat(64)}`, mimeType: 'image/png', width: 1, height: 1, bytes: '' }]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source), { limits: limits({ mediaAssets: 0 }) }),
      'media-count-limit',
      '0',
    )
  })

  test('checks declared image dimensions before base64 allocation', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.media = [{ id: `sha256:${'0'.repeat(64)}`, mimeType: 'image/png', width: 20_001, height: 1, bytes: '' }]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source), { limits: limits({ imageWidth: 20_000 }) }),
      'image-dimension-limit',
      '20000 by 20000',
    )
    source.media = [{ id: `sha256:${'0'.repeat(64)}`, mimeType: 'image/png', width: 1, height: 20_001, bytes: '' }]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source), { limits: limits({ imageHeight: 20_000 }) }),
      'image-dimension-limit',
      '20000 by 20000',
    )
  })

  test('checks declared and total decoded media sizes from base64 length before allocation', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.media = [{ id: `sha256:${'0'.repeat(64)}`, mimeType: 'image/png', width: 1, height: 1, bytes: 'AAAA' }]
    await rejected(
      inspectQuestionBankRecord(bytesOf(source), { limits: limits({ mediaAssetBytes: 2 }) }),
      'media-asset-size-limit',
      '2',
    )
    await rejected(
      inspectQuestionBankRecord(bytesOf(source), { limits: limits({ totalMediaBytes: 2 }) }),
      'total-media-size-limit',
      '2',
    )
  })

  test('accepts decoded media exactly at byte and dimension limits', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', PIXEL_PNG.data)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')
    const id = `sha256:${digest}`
    source.media = [{
      id,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      bytes: Buffer.from(PIXEL_PNG.data).toString('base64'),
    }]
    ;(source.bank.questions[0]!.stem.content as unknown[]) = [{ type: 'block-image', asset: id }]
    await expect(inspectQuestionBankRecord(bytesOf(source), {
      limits: limits({
        mediaAssetBytes: PIXEL_PNG.data.byteLength,
        totalMediaBytes: PIXEL_PNG.data.byteLength,
        imageWidth: 1,
        imageHeight: 1,
      }),
    })).resolves.toMatchObject({ summary: { mediaAssets: 1, decodedMediaBytes: PIXEL_PNG.data.byteLength } })
  })

  test('rejects malformed base64 without decoding it', async () => {
    const source = baseRecord() as QuestionBankRecord & Record<string, unknown>
    source.media = [{ id: `sha256:${'0'.repeat(64)}`, mimeType: 'image/png', width: 1, height: 1, bytes: '!!!!' }]
    await rejected(inspectQuestionBankRecord(bytesOf(source)), 'invalid-media', 'malformed base64')
  })

  test('accepts a phone photo whose base64 runs to millions of characters', async () => {
    // A 4.5 MB photo is about 6 million base64 characters, enough to overflow
    // a backtracking check.
    const source = await recordWithPicture(photoJpeg({ stored: { width: 40, height: 30 }, orientation: 1, padding: 4_500_000 }), { width: 40, height: 30 })
    await expect(inspectQuestionBankRecord(bytesOf(source))).resolves.toMatchObject({ summary: { mediaAssets: 1 } })
  })

  test('measures a turned camera JPEG upright, as export declares it', async () => {
    // Orientation 6 stores the pixels sideways: 40 by 30 on disk, 30 by 40 seen.
    const turned = photoJpeg({ stored: { width: 40, height: 30 }, orientation: 6 })
    await expect(inspectQuestionBankRecord(bytesOf(await recordWithPicture(turned, { width: 30, height: 40 }))))
      .resolves.toMatchObject({ summary: { mediaAssets: 1 } })
    await rejected(
      inspectQuestionBankRecord(bytesOf(await recordWithPicture(turned, { width: 40, height: 30 }))),
      'invalid-media',
      'dimensions do not match',
    )
  })

  test('checks Question count, semantic node count, and nesting exactly at and immediately over each configured limit', async () => {
    const source = baseRecord()
    source.bank.questions.push({ id: 'q2', type: 'short-answer', stem: paragraph('Second') })
    await expect(inspectQuestionBankRecord(bytesOf(source as QuestionBankRecord & Record<string, unknown>), { limits: limits({ questions: 2 }) })).resolves.toBeDefined()
    await rejected(inspectQuestionBankRecord(bytesOf(source as QuestionBankRecord & Record<string, unknown>), { limits: limits({ questions: 1 }) }), 'question-count-limit', '1')

    const nodes = baseRecord()
    nodes.bank.questions[0]!.stem = { type: 'document', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }] }
    await expect(inspectQuestionBankRecord(bytesOf(nodes as QuestionBankRecord & Record<string, unknown>), { limits: limits({ questionNodes: 7 }) })).resolves.toBeDefined()
    await rejected(inspectQuestionBankRecord(bytesOf(nodes as QuestionBankRecord & Record<string, unknown>), { limits: limits({ questionNodes: 6 }) }), 'question-node-limit', '6')

    const nested = baseRecord()
    nested.bank.questions[0]!.stem = { type: 'document', content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'deep' }] }] }] }
    await expect(inspectQuestionBankRecord(bytesOf(nested as QuestionBankRecord & Record<string, unknown>), { limits: limits({ richTextDepth: 3 }) })).resolves.toBeDefined()
    await rejected(inspectQuestionBankRecord(bytesOf(nested as QuestionBankRecord & Record<string, unknown>), { limits: limits({ richTextDepth: 2 }) }), 'rich-text-depth-limit', '2')
  })
})

describe('a picture’s Authored Image Size and Picture Crop', () => {
  const pictured = (image: Record<string, unknown>, version = '0.7.0') => {
    const record = baseRecord() as QuestionBankRecord & Record<string, unknown>
    record.formatVersion = version as typeof QUESTION_BANK_FORMAT_VERSION
    record.media = [PIXEL_ASSET]
    record.bank.questions[0]!.stem.content.push({ type: 'block-image', asset: PIXEL_ID, ...image } as SemanticNode)
    return record
  }
  const importedPicture = async (record: QuestionBankRecord) => {
    const proposal = await inspectQuestionBankRecord(bytesOf(record as QuestionBankRecord & Record<string, unknown>))
    const [question] = importedQuestionsFromRecord(proposal.record)
    const image = (question!.doc.content as { type: string; attrs?: Record<string, unknown> }[]).find(
      (node) => node.type === 'image-block',
    )!
    return image.attrs!
  }

  test('a 0.7.0 record’s size is a share of its container, and an older record’s is the ratio it always meant', async () => {
    const current = await importedPicture(pictured({ authoredSize: 0.5 }))
    expect(current.size).toBe(0.5)
    expect(current).not.toHaveProperty('ratio')

    for (const version of ['0.1.0', '0.5.0', '0.6.0']) {
      const legacy = await importedPicture(pictured({ authoredSize: 0.5 }, version))
      expect(legacy.ratio, version).toBe(0.5)
      expect(legacy, version).not.toHaveProperty('size')
    }
  })

  test('a crop reaches the editor with its Media Asset’s pixel size, and is not read from an older record', async () => {
    const crop = { left: 0.1, top: 0, right: 0.9, bottom: 0.5 }
    const current = await importedPicture(pictured({ authoredSize: 0.4, crop }))
    expect(current).toMatchObject({ size: 0.4, crop: { ...crop, width: 1, height: 1 } })

    const legacy = await importedPicture(pictured({ authoredSize: 0.4, crop }, '0.6.0'))
    expect(legacy).not.toHaveProperty('crop')
  })

  test('refuses a crop that keeps nothing, leaves the picture, or sits where no crop may', async () => {
    const crop = { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 }
    await rejected(inspectQuestionBankRecord(bytesOf(pictured({ crop: { ...crop, left: 0.9, right: 0.1 } }))), 'invalid-question', '`left` must be less than `right`')
    await rejected(inspectQuestionBankRecord(bytesOf(pictured({ crop: { ...crop, top: 0.5, bottom: 0.5 } }))), 'invalid-question', '`top` less than `bottom`')
    await rejected(inspectQuestionBankRecord(bytesOf(pictured({ crop: { ...crop, right: 1.2 } }))), 'invalid-question', 'from 0 to 1')
    await rejected(inspectQuestionBankRecord(bytesOf(pictured({ crop: { ...crop, width: 1 } }))), 'invalid-question', 'exactly `left`, `top`, `right` and `bottom`')
    await rejected(inspectQuestionBankRecord(bytesOf(pictured({ crop: { left: 0, top: 0, right: 1 } }))), 'invalid-question', 'exactly `left`')

    const pending = baseRecord() as QuestionBankRecord & Record<string, unknown>
    pending.bank.questions[0]!.stem.content.push({ type: 'block-image', pending: { image: 1 }, crop } as SemanticNode)
    await rejected(inspectQuestionBankRecord(bytesOf(pending)), 'invalid-question', 'A Pending Image cannot carry a Picture Crop')

    const inline = pictured({})
    inline.bank.questions[0]!.stem.content.pop()
    ;(inline.bank.questions[0]!.stem.content[0]!.content as SemanticNode[]).push({ type: 'inline-image', asset: PIXEL_ID, crop } as SemanticNode)
    await rejected(inspectQuestionBankRecord(bytesOf(inline)), 'invalid-question', 'an inline image cannot carry one')
  })
})
