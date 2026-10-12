import { describe, expect, test } from 'bun:test'
import { PDFDocument } from 'pdf-lib'
import {
  QUESTION_BANK_ATTACHMENT_DESCRIPTION,
  QUESTION_BANK_ATTACHMENT_NAME,
  QUESTION_BANK_FORMAT,
  QUESTION_BANK_FORMAT_VERSION,
  type QuestionBankRecord,
  type QuestionBankRecordQuestion,
} from './question-bank-export'
import { QuestionBankImportError } from './question-bank-import'
import {
  BARE_RECORD_BANK_ID,
  DEFAULT_PACKAGE_IMPORT_LIMITS,
  inspectImportFile,
  inspectImportRecord,
  type ExamRecordPosition,
} from './package-import'
import { mediaFilePath, writePackageZip } from './package-zip'
import { PIXEL_PNG } from './export-fixtures'

const encoder = new TextEncoder()

const paragraph = (value: string) => ({
  type: 'document' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
})

function multipleChoice(id: string, answers = 3): QuestionBankRecordQuestion {
  return {
    id,
    type: 'multiple-choice',
    stem: paragraph(`Question ${id}`),
    choices: Array.from({ length: answers }, (_, index) => ({
      id: `${id}-c${index + 1}`,
      content: paragraph(`Answer ${index + 1}`),
      correct: index === 0,
    })),
  }
}

function shortAnswer(id: string): QuestionBankRecordQuestion {
  return { id, type: 'short-answer', stem: paragraph(`Explain ${id}`) }
}

function trueFalse(id: string): QuestionBankRecordQuestion {
  return {
    id,
    type: 'true-false',
    stem: paragraph(`Is ${id} true?`),
    choices: [
      { id: `${id}-c1`, content: paragraph('True'), correct: true },
      { id: `${id}-c2`, content: paragraph('False'), correct: false },
    ],
  }
}

function matching(id: string): QuestionBankRecordQuestion {
  return {
    id,
    type: 'matching',
    stem: paragraph(`Match ${id}`),
    prompts: [
      { id: `${id}-p1`, content: paragraph('One'), answer: `${id}-a1` },
      { id: `${id}-p2`, content: paragraph('Two'), answer: `${id}-a2` },
    ],
    wordBank: [
      { id: `${id}-a1`, content: paragraph('1') },
      { id: `${id}-a2`, content: paragraph('2') },
      { id: `${id}-a3`, content: paragraph('3') },
    ],
  }
}

function multipart(id: string): QuestionBankRecordQuestion {
  return {
    id,
    type: 'multipart',
    stem: paragraph(`Read ${id}`),
    parts: [
      {
        id: `${id}-s1`,
        type: 'multiple-choice',
        stem: paragraph('Which?'),
        choices: [
          { id: `${id}-s1-c1`, content: paragraph('This'), correct: true },
          { id: `${id}-s1-c2`, content: paragraph('That'), correct: false },
        ],
      },
      { id: `${id}-s2`, type: 'short-answer', stem: paragraph('Why?') },
    ],
  }
}

function bankRecord(name: string, questions: QuestionBankRecordQuestion[]): QuestionBankRecord {
  return {
    format: QUESTION_BANK_FORMAT,
    formatVersion: QUESTION_BANK_FORMAT_VERSION,
    generator: { name: 'Test', version: '1' },
    requiredFeatures: [],
    bank: { name, questions },
    media: [],
  }
}

function at(bank: string, question: string, extra: Omit<ExamRecordPosition, 'question'> = {}) {
  return { question: { bank, question }, ...extra }
}

function examRecord(name: string, positions: unknown[]) {
  return { format: 'test-parrot/exam', formatVersion: '0.1.0', name, positions }
}

function packageOf(
  banks: { id: string; record: unknown }[],
  exams: unknown[] = [],
): Record<string, unknown> {
  return {
    format: 'test-parrot/package',
    formatVersion: '0.1.0',
    generator: { name: 'Test', version: '1' },
    requiredFeatures: [],
    questionBanks: banks,
    exams,
  }
}

const bytesOf = (value: unknown) => encoder.encode(JSON.stringify(value))

async function rejected(value: unknown, code: QuestionBankImportError['code'], text?: string) {
  try {
    await inspectImportRecord(bytesOf(value))
  } catch (error) {
    expect(error).toBeInstanceOf(QuestionBankImportError)
    expect((error as QuestionBankImportError).code).toBe(code)
    if (text) expect((error as Error).message).toContain(text)
    return
  }
  throw new Error('Expected inspection to reject')
}

const chemistry = () => bankRecord('Chemistry', [multipleChoice('q1'), shortAnswer('q2'), multipleChoice('q3')])

describe('inspecting a Test Parrot Package', () => {
  test('a bare Question Bank Record reads as one bank and no Exams', async () => {
    const proposal = await inspectImportRecord(bytesOf(chemistry()))

    expect(proposal.source).toEqual({ format: QUESTION_BANK_FORMAT, formatVersion: QUESTION_BANK_FORMAT_VERSION })
    expect(proposal.banks).toHaveLength(1)
    expect(proposal.banks[0]).toMatchObject({
      id: BARE_RECORD_BANK_ID,
      exams: [],
      summary: { bankName: 'Chemistry', questionCounts: { 'multiple-choice': 2, 'short-answer': 1 } },
    })
    expect(proposal.exams).toEqual([])
  })

  test('a bank with an Exam lists both and the dependency between them', async () => {
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'chem', record: chemistry() }],
      [examRecord('Unit 1 Test', [
        at('chem', 'q3', { columns: 4, answerOrder: ['q3-c3', 'q3-c1', 'q3-c2'] }),
        at('chem', 'q2', { workSpace: { height: 96, style: 'lines', fill: false } }),
      ])],
    )))

    expect(proposal.source).toEqual({ format: 'test-parrot/package', formatVersion: '0.1.0' })
    expect(proposal.banks.map(({ id, exams }) => ({ id, exams }))).toEqual([
      { id: 'chem', exams: ['exam-1'] },
    ])
    expect(proposal.exams).toEqual([{
      key: 'exam-1',
      name: 'Unit 1 Test',
      formatVersion: '0.1.0',
      banks: ['chem'],
      positions: [
        at('chem', 'q3', { columns: 4, answerOrder: ['q3-c3', 'q3-c1', 'q3-c2'] }),
        at('chem', 'q2', { workSpace: { height: 96, style: 'lines', fill: false } }),
      ],
    }])
  })

  test('several Exams may share one bank, and a bank may hold Questions no Exam uses', async () => {
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'chem', record: chemistry() }],
      [
        examRecord('Version A', [at('chem', 'q1', { answerOrder: ['q1-c1', 'q1-c2', 'q1-c3'] })]),
        examRecord('Version B', [at('chem', 'q1', { answerOrder: ['q1-c3', 'q1-c2', 'q1-c1'] })]),
      ],
    )))

    expect(proposal.banks[0]!.exams).toEqual(['exam-1', 'exam-2'])
    expect(proposal.exams.map(({ name, banks }) => ({ name, banks }))).toEqual([
      { name: 'Version A', banks: ['chem'] },
      { name: 'Version B', banks: ['chem'] },
    ])
  })

  test('an Exam may draw on several banks, and dependencies read both ways', async () => {
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [
        { id: 'chem', record: chemistry() },
        { id: 'phys', record: bankRecord('Physics', [trueFalse('q1')]) },
        { id: 'bio', record: bankRecord('Biology', [shortAnswer('q1')]) },
      ],
      [
        examRecord('Science', [at('phys', 'q1'), at('chem', 'q1')]),
        examRecord('Chemistry only', [at('chem', 'q2')]),
      ],
    )))

    expect(proposal.exams.map(({ banks }) => banks)).toEqual([['phys', 'chem'], ['chem']])
    expect(Object.fromEntries(proposal.banks.map(({ id, exams }) => [id, exams]))).toEqual({
      chem: ['exam-1', 'exam-2'],
      phys: ['exam-1'],
      bio: [],
    })
  })

  test('positions regroup into Section order, keeping order within each Section', async () => {
    const record = bankRecord('Mixed', [
      multipleChoice('q1'), multipleChoice('q2'), trueFalse('q3'), matching('q4'), shortAnswer('q5'), shortAnswer('q6'),
      multipart('q7'),
    ])
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'b', record }],
      [examRecord('Upside down', [
        at('b', 'q7'), at('b', 'q6'), at('b', 'q2'), at('b', 'q4'), at('b', 'q5'), at('b', 'q3'), at('b', 'q1'),
      ])],
    )))

    // A Multipart question prints last, in a Section of its own.
    expect(proposal.exams[0]!.positions.map(({ question }) => question.question)).toEqual([
      'q2', 'q1', 'q3', 'q4', 'q6', 'q5', 'q7',
    ])
  })

  test('a Multipart position is accepted as a whole Question, and per-Part presentation is not carried', async () => {
    const record = bankRecord('Passages', [multipart('q1')])
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'b', record }],
      [examRecord('Reading', [at('b', 'q1')])],
    )))

    expect(proposal.banks[0]!.summary.questionCounts.multipart).toBe(1)
    expect(proposal.exams[0]!.positions).toEqual([at('b', 'q1')])
    // Answer order belongs to a Part, not the Multipart question, and 0.1.0 cannot say
    // which Part it would be for.
    await rejected(
      packageOf([{ id: 'b', record }], [
        examRecord('Reading', [at('b', 'q1', { answerOrder: ['q1-s1-c2', 'q1-s1-c1'] })]),
      ]),
      'invalid-position',
      'answer order',
    )
  })

  test('a PDF carrier may hold a package', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage()
    await pdf.attach(
      bytesOf(packageOf([{ id: 'chem', record: chemistry() }], [examRecord('From PDF', [at('chem', 'q1')])])),
      QUESTION_BANK_ATTACHMENT_NAME,
      { description: QUESTION_BANK_ATTACHMENT_DESCRIPTION, mimeType: 'application/json' },
    )
    const proposal = await inspectImportFile(await pdf.save({ useObjectStreams: false }))

    expect(proposal.banks.map(({ id }) => id)).toEqual(['chem'])
    expect(proposal.exams.map(({ name }) => name)).toEqual(['From PDF'])
  })
})

describe('rejecting a Test Parrot Package whole', () => {
  const withExam = (positions: unknown[]) =>
    packageOf([{ id: 'chem', record: chemistry() }], [examRecord('Broken', positions)])

  test('an Exam referencing an unknown bank or Question', async () => {
    await rejected(withExam([at('elsewhere', 'q1')]), 'dangling-reference', 'elsewhere')
    await rejected(withExam([at('chem', 'q99')]), 'dangling-reference', 'q99')
  })

  test('one Question used twice in one Exam', async () => {
    await rejected(withExam([at('chem', 'q1'), at('chem', 'q1')]), 'duplicate-reference', 'q1')
  })

  test('a position option that does not fit its Question Type', async () => {
    await rejected(withExam([at('chem', 'q2', { columns: 2 })]), 'invalid-position', 'answer columns')
    await rejected(
      withExam([at('chem', 'q1', { workSpace: { height: 32, style: 'blank', fill: false } })]),
      'invalid-position',
      'Work Space',
    )
    await rejected(withExam([at('chem', 'q2', { answerOrder: [] })]), 'invalid-position', 'answer order')
    await rejected(
      packageOf([{ id: 'b', record: bankRecord('TF', [trueFalse('q1')]) }], [
        examRecord('TF', [at('b', 'q1', { answerOrder: ['q1-c2', 'q1-c1'] })]),
      ]),
      'invalid-position',
      'answer order',
    )
  })

  test('an answer order that is not an exact permutation', async () => {
    await rejected(withExam([at('chem', 'q1', { answerOrder: ['q1-c1', 'q1-c2'] })]), 'invalid-answer-order')
    await rejected(withExam([at('chem', 'q1', { answerOrder: ['q1-c1', 'q1-c1', 'q1-c2'] })]), 'invalid-answer-order')
    await rejected(withExam([at('chem', 'q1', { answerOrder: ['q1-c1', 'q1-c2', 'q3-c1'] })]), 'invalid-answer-order')
    await rejected(
      packageOf([{ id: 'b', record: bankRecord('M', [matching('q1')]) }], [
        examRecord('M', [at('b', 'q1', { answerOrder: ['q1-p1', 'q1-a2', 'q1-a3'] })]),
      ]),
      'invalid-answer-order',
    )
  })

  test('duplicated bank ids, and a package with no banks', async () => {
    await rejected(
      packageOf([{ id: 'chem', record: chemistry() }, { id: 'chem', record: chemistry() }]),
      'duplicate-id',
      'chem',
    )
    await rejected(packageOf([]), 'invalid-structure')
  })

  test('a bank inside a package obeys every Question Bank Record rule', async () => {
    const broken = chemistry()
    broken.bank.questions[1] = { ...broken.bank.questions[0]!, id: 'q1' }
    await rejected(packageOf([{ id: 'chem', record: broken }]), 'duplicate-id', 'q1')
  })

  test('an unsupported version of each format', async () => {
    await rejected({ ...packageOf([{ id: 'chem', record: chemistry() }]), formatVersion: '9.0.0' }, 'unsupported-version', 'Test Parrot Package')
    await rejected(
      packageOf([{ id: 'chem', record: { ...chemistry(), formatVersion: '9.0.0' } }]),
      'unsupported-version',
      'Question Bank',
    )
    await rejected(
      packageOf([{ id: 'chem', record: chemistry() }], [{ ...examRecord('Future', []), formatVersion: '9.0.0' }]),
      'unsupported-version',
      'Exam Record',
    )
  })

  test('an Exam Record on its own is not importable', async () => {
    await rejected(examRecord('Alone', [at('chem', 'q1')]), 'unsupported-format', 'Exam Record on its own')
  })

  test('an unsupported required feature', async () => {
    await rejected({ ...packageOf([{ id: 'chem', record: chemistry() }]), requiredFeatures: ['time-travel'] }, 'unsupported-feature')
  })

  test('limits apply to the package as a whole', async () => {
    const two = packageOf([
      { id: 'a', record: chemistry() },
      { id: 'b', record: chemistry() },
    ])
    const limit = (overrides: Partial<typeof DEFAULT_PACKAGE_IMPORT_LIMITS>) => ({
      limits: { ...DEFAULT_PACKAGE_IMPORT_LIMITS, ...overrides },
    })
    await expect(inspectImportRecord(bytesOf(two), limit({ questions: 6, banks: 2 }))).resolves.toBeDefined()
    await expect(inspectImportRecord(bytesOf(two), limit({ questions: 5 }))).rejects.toMatchObject({ code: 'question-count-limit' })
    await expect(inspectImportRecord(bytesOf(two), limit({ banks: 1 }))).rejects.toMatchObject({ code: 'bank-count-limit' })
    await expect(
      inspectImportRecord(bytesOf(packageOf([{ id: 'a', record: chemistry() }], [examRecord('1', []), examRecord('2', [])])), limit({ exams: 1 })),
    ).rejects.toMatchObject({ code: 'exam-count-limit' })
  })
})

describe('Exam Record 0.4.0 hidden answers', () => {
  const bank = () => bankRecord('Mixed', [multipleChoice('q1', 4), shortAnswer('q2')])
  const exam = (version: string, position: Record<string, unknown>) => ({
    format: 'test-parrot/exam',
    formatVersion: version,
    name: 'Hiding',
    sections: [{ title: 'All', instructions: '' }],
    positions: [{ question: { bank: 'b', question: 'q1' }, section: 0, ...position }],
  })

  test('a Multiple Choice position may leave incorrect answers off', async () => {
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'b', record: bank() }],
      [exam('0.4.0', { hiddenAnswers: ['q1-c2', 'q1-c4'] })],
    )))
    expect(proposal.exams[0]!.positions[0]!.hiddenAnswers).toEqual(['q1-c2', 'q1-c4'])
  })

  test('only its own incorrect answers, and only on Multiple Choice', async () => {
    await rejected(
      packageOf([{ id: 'b', record: bank() }], [exam('0.4.0', { hiddenAnswers: ['q1-c9'] })]),
      'dangling-reference',
      'q1-c9',
    )
    await rejected(
      packageOf([{ id: 'b', record: bank() }], [exam('0.4.0', { hiddenAnswers: ['q1-c1'] })]),
      'invalid-position',
      'correct answer',
    )
    await rejected(
      packageOf([{ id: 'b', record: bank() }], [{
        ...exam('0.4.0', {}),
        positions: [{ question: { bank: 'b', question: 'q2' }, section: 0, hiddenAnswers: ['q1-c2'] }],
      }]),
      'invalid-position',
      'only a Multiple Choice Question',
    )
  })

  test('a 0.3.0 record has no hidden answers: the member is ignored', async () => {
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'b', record: bank() }],
      [exam('0.3.0', { hiddenAnswers: ['q1-c2'] })],
    )))
    expect(proposal.exams[0]!.positions[0]!.hiddenAnswers).toBeUndefined()
  })
})

describe('Exam Record 0.3.0 Sections', () => {
  const mixed = () => bankRecord('Mixed', [
    multipleChoice('q1'), multipleChoice('q2'), trueFalse('q3'), shortAnswer('q4'),
  ])
  const sectioned = (sections: unknown[], positions: unknown[]) => ({
    format: 'test-parrot/exam', formatVersion: '0.3.0', name: 'Sectioned', sections, positions,
  })

  const worded = (title: string, instructions = '') => ({ title, instructions })

  test('are proposed in record order with their wording in full, mixed types and empty ones included', async () => {
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'b', record: mixed() }],
      [sectioned(
        [
          { title: 'Essays', instructions: '' },
          { title: 'Warm-up', instructions: 'Answer each question.' },
          { title: 'Nothing here', instructions: 'Kept, but prints nothing.' },
          { title: '', instructions: 'Circle one.' },
        ],
        // Interleaved positions regroup stably by Section, keeping order
        // within each; Section 2 takes a Multiple Choice and a True/False.
        [
          at('b', 'q2', { section: 3 }),
          at('b', 'q3', { section: 1 }),
          at('b', 'q4', { section: 0 }),
          at('b', 'q1', { section: 1 }),
        ],
      )],
    )))
    expect(proposal.exams[0]).toEqual({
      key: 'exam-1',
      name: 'Sectioned',
      formatVersion: '0.3.0',
      sections: [
        { title: 'Essays', instructions: '' },
        { title: 'Warm-up', instructions: 'Answer each question.' },
        { title: 'Nothing here', instructions: 'Kept, but prints nothing.' },
        { title: '', instructions: 'Circle one.' },
      ],
      positions: [
        at('b', 'q4', { section: 0 }),
        at('b', 'q3', { section: 1 }),
        at('b', 'q1', { section: 1 }),
        at('b', 'q2', { section: 3 }),
      ],
      banks: ['b'],
    })
  })

  test('a position must name one of the record’s Sections, and any Section takes any type', async () => {
    await rejected(
      packageOf([{ id: 'b', record: mixed() }], [sectioned([worded('Only')], [at('b', 'q1', { section: 1 })])]),
      'dangling-reference',
      'Section 2',
    )
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'b', record: mixed() }],
      [sectioned([worded('Multiple Choice'), worded('Short Answer')], [at('b', 'q1', { section: 1 })])],
    )))
    expect(proposal.exams[0]!.positions).toEqual([at('b', 'q1', { section: 1 })])
  })

  test('sections, and each position’s section, are required, and a Section is its full wording and nothing else', async () => {
    await rejected(
      packageOf([{ id: 'b', record: mixed() }], [{ format: 'test-parrot/exam', formatVersion: '0.3.0', name: 'No sections', positions: [] }]),
      'invalid-structure',
    )
    await rejected(
      packageOf([{ id: 'b', record: mixed() }], [sectioned([worded('A')], [at('b', 'q1')])]),
      'invalid-structure',
    )
    await rejected(
      packageOf([{ id: 'b', record: mixed() }], [sectioned([{ title: 'No directions' }], [])]),
      'invalid-structure',
    )
    await rejected(
      packageOf([{ id: 'b', record: mixed() }], [sectioned([{ instructions: 'No heading' }], [])]),
      'invalid-structure',
    )
    await rejected(
      packageOf([{ id: 'b', record: mixed() }], [sectioned([{ ...worded('Typed'), type: 'multiple-choice' }], [])]),
      'invalid-structure',
    )
    await rejected(
      packageOf([{ id: 'b', record: mixed() }], [sectioned([{ title: 3, instructions: '' }], [])]),
      'invalid-structure',
    )
  })

  test('leave per-type section wording behind: in 0.3.0 it is an unknown member, and ignored', async () => {
    const proposal = await inspectImportRecord(bytesOf(packageOf([{ id: 'b', record: mixed() }], [{
      ...sectioned([worded('Short Answer')], []),
      sectionHeadings: { 'short-answer': { title: 'Essays' } },
    }])))
    expect(proposal.exams[0]).not.toHaveProperty('sectionHeadings')
    expect(proposal.exams[0]!.sections).toEqual([{ title: 'Short Answer', instructions: '' }])
  })
})

describe('an Exam Record 0.2.0', () => {
  test('still imports, with per-type wording and its Sections left to be derived by type', async () => {
    const proposal = await inspectImportRecord(bytesOf(packageOf(
      [{ id: 'chem', record: chemistry() }],
      [{
        format: 'test-parrot/exam',
        formatVersion: '0.2.0',
        name: 'Older',
        sectionHeadings: { 'short-answer': { title: 'Essays', instructions: '' } },
        headingSize: 'large',
        // A 0.2.0 position has no Section; a member it does not define is dropped.
        positions: [at('chem', 'q2', { section: 0 }), at('chem', 'q1')],
      }],
    )))
    expect(proposal.exams[0]).toEqual({
      key: 'exam-1',
      name: 'Older',
      formatVersion: '0.2.0',
      sectionHeadings: { open: { title: 'Essays', instructions: '' } },
      headingSize: 'large',
      positions: [at('chem', 'q1'), at('chem', 'q2')],
      banks: ['chem'],
    })
  })
})

describe('a package zip with its pictures (ADR-0036)', () => {
  const pictureRecord = async (bytes: Uint8Array = PIXEL_PNG.data) => {
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice())),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')
    const id = `sha256:${digest}`
    const record = chemistry()
    record.bank.questions[0]!.stem.content.push({ type: 'block-image', asset: id })
    record.media = [{ id, mimeType: 'image/png', width: 1, height: 1, file: mediaFilePath(id, 'image/png') }]
    return record
  }
  const zipOf = (value: unknown, files: Record<string, Uint8Array>) =>
    writePackageZip(JSON.stringify(value), new Map(Object.entries(files)))
  async function rejectedZip(zip: Uint8Array, code: QuestionBankImportError['code'], text?: string) {
    try {
      await inspectImportRecord(zip)
    } catch (error) {
      expect((error as QuestionBankImportError).code).toBe(code)
      if (text) expect((error as Error).message).toContain(text)
      return
    }
    throw new Error('Expected inspection to reject')
  }

  test('reads each picture from the file its Media Asset names, as raw bytes', async () => {
    const record = await pictureRecord()
    const file = record.media[0]!.file
    expect(file).toMatch(/^media\/sha256-[a-f0-9]{64}\.png$/)
    const zip = await zipOf(packageOf([{ id: 'chem', record }]), { [file]: PIXEL_PNG.data })
    const proposal = await inspectImportRecord(zip)
    expect(proposal.banks[0]!.summary).toMatchObject({ mediaAssets: 1, decodedMediaBytes: PIXEL_PNG.data.byteLength })
    expect(proposal.banks[0]!.record.media[0]!.bytes).toEqual(PIXEL_PNG.data)
  })

  test('the same zip imports from inside a PDF, whose attachment is the zip itself', async () => {
    const record = await pictureRecord()
    const zip = await zipOf(packageOf([{ id: 'chem', record }]), { [record.media[0]!.file]: PIXEL_PNG.data })
    const document = await PDFDocument.create()
    document.addPage()
    await document.attach(zip, 'parrot.zip', { mimeType: 'application/zip', description: QUESTION_BANK_ATTACHMENT_DESCRIPTION })
    const proposal = await inspectImportFile(await document.save())
    expect(proposal.banks[0]!.summary.mediaAssets).toBe(1)
  })

  test('a 0.8.0 record read outside its zip may declare no Media Asset', async () => {
    await expect(inspectImportRecord(bytesOf(chemistry()))).resolves.toBeDefined()
    await rejected(await pictureRecord(), 'missing-media', '.parrot.zip')
  })

  test('refuses a picture that is missing, altered, or that no Media Asset names', async () => {
    const record = await pictureRecord()
    const file = record.media[0]!.file
    await rejectedZip(await zipOf(packageOf([{ id: 'chem', record }]), {}), 'missing-media', file)
    const altered = PIXEL_PNG.data.slice()
    altered[altered.length - 1] ^= 0xff
    await rejectedZip(await zipOf(packageOf([{ id: 'chem', record }]), { [file]: altered }), 'invalid-media', 'SHA-256')
    await rejectedZip(
      await zipOf(packageOf([{ id: 'chem', record }]), { [file]: PIXEL_PNG.data, 'media/sha256-extra.png': PIXEL_PNG.data }),
      'invalid-media',
      'media/sha256-extra.png',
    )
  })

  test('holds a zipped picture to the same size limits as one carried inline', async () => {
    const record = await pictureRecord()
    const zip = await zipOf(packageOf([{ id: 'chem', record }]), { [record.media[0]!.file]: PIXEL_PNG.data })
    await expect(inspectImportRecord(zip, {
      limits: { ...DEFAULT_PACKAGE_IMPORT_LIMITS, mediaAssetBytes: PIXEL_PNG.data.byteLength - 1 },
    })).rejects.toMatchObject({ code: 'media-asset-size-limit' })
  })

  test('ignores files outside media/, and refuses a zip with no parrot.json', async () => {
    const record = await pictureRecord()
    const zip = await zipOf(packageOf([{ id: 'chem', record }]), {
      [record.media[0]!.file]: PIXEL_PNG.data,
      '__MACOSX/._parrot.json': new Uint8Array([1, 2, 3]),
    })
    await expect(inspectImportRecord(zip)).resolves.toBeDefined()
    const JSZip = (await import('jszip')).default
    const empty = new JSZip()
    empty.file('notes.txt', 'hello')
    await rejectedZip(await empty.generateAsync({ type: 'uint8array' }), 'invalid-zip', 'parrot.json')
  })

  test('a 0.7.0 record inside a zip still carries its bytes inline', async () => {
    const record = await pictureRecord()
    const legacy = {
      ...record,
      formatVersion: '0.7.0',
      media: [{ ...record.media[0]!, file: undefined, bytes: Buffer.from(PIXEL_PNG.data).toString('base64') }],
    }
    const proposal = await inspectImportRecord(await zipOf(packageOf([{ id: 'chem', record: legacy }]), {}))
    expect(proposal.banks[0]!.record.media[0]!.bytes).toEqual(PIXEL_PNG.data)
  })

  test('writes the same package to the same bytes, so a re-export attaches what the export did', async () => {
    const record = await pictureRecord()
    const files = { [record.media[0]!.file]: PIXEL_PNG.data }
    expect(await zipOf(packageOf([{ id: 'chem', record }]), files)).toEqual(await zipOf(packageOf([{ id: 'chem', record }]), files))
  })
})
