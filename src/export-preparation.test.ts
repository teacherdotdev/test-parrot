import { describe, expect, test } from 'bun:test'
import type { Exam, Question, Arrangement, RandomSource } from './exam'
import {
  DEFAULT_EXPORT_CONFIGURATION,
  EMPTY_EXPORT_HISTORY,
  prepareExport,
  readExportPreferences,
  readShufflePreferences,
  writeExportPreferences,
  writeShufflePreferences,
  prepareHistoricalExport,
  PicturesNeededError,
  type ExportHistory,
} from './export-preparation'
import { unmeasured, type LayoutPlan } from './export-plan'

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function choice(id: string, text: string, correct = false) {
  return {
    type: 'multipleChoiceChoice',
    attrs: { id, correct },
    content: [paragraph(text)],
  }
}

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'question-1',
    type: 'multiple-choice',
    columns: 2,
    difficulty: 'easy',
    topics: ['Biology'],
    doc: {
      type: 'doc',
      content: [
        paragraph('Which animal is a mammal?'),
        {
          type: 'multipleChoice',
          content: [
            choice('whale', 'Whale', true),
            choice('shark', 'Shark'),
          ],
        },
      ],
    },
    ...overrides,
  }
}

function request(
  configuration = DEFAULT_EXPORT_CONFIGURATION,
  history: ExportHistory = EMPTY_EXPORT_HISTORY,
) {
  const selected = question()
  const exam: Exam = { title: 'Biology Quiz', questions: [selected] }
  const arrangement: Arrangement = {
    id: 'working-copy',
    letter: '',
    questionOrder: [selected.id],
    choiceOrder: {},
  }
  return {
    examId: 'exam-1',
    exam,
    arrangement,
    configuration,
    history,
    measure: unmeasured,
    createdAt: '2026-09-10T12:00:00.000Z',
    createId: () => 'record-1',
  }
}

describe('Export Record preparation', () => {
  test('defaults to one PDF event containing the student test and answer key', () => {
    const prepared = prepareExport(request())

    expect(prepared.documents.map((plan) => plan.pages[0]?.stream)).toEqual([
      'test',
      'answer-key',
    ])
    expect(prepared.filename).toBe('Biology Quiz.pdf')
    expect(prepared.record).toMatchObject({
      id: 'record-1',
      examId: 'exam-1',
      capturedName: 'Biology Quiz',
      format: 'pdf',
      selection: { test: true, answerKey: true },
      questionCount: 1,
      createdAt: '2026-09-10T12:00:00.000Z',
    })
    expect(prepared.record.plans).toEqual(prepared.documents)
  })

  test('retains only the Content Selection actually produced', () => {
    const prepared = prepareExport(request({
      format: 'docx',
      selection: { test: false, answerKey: true },
    }))

    expect(prepared.documents).toHaveLength(1)
    expect(prepared.documents[0]?.pages[0]?.stream).toBe('answer-key')
    expect(prepared.record.plans).toHaveLength(1)
    expect(prepared.record.selection).toEqual({ test: false, answerKey: true })
    expect(prepared.filename).toBe('Biology Quiz.docx')
  })

  test('identical exports are distinct events rather than deduplicated identities', () => {
    const first = prepareExport(request())
    const second = prepareExport({
      ...request(DEFAULT_EXPORT_CONFIGURATION, { records: [first.record] }),
      createdAt: '2026-09-10T12:01:00.000Z',
      createId: () => 'record-2',
    })

    expect(second.record.id).toBe('record-2')
    expect(second.record.createdAt).not.toBe(first.record.createdAt)
    expect(second.documents).toEqual(first.documents)
  })

  test('captures unsaved visible content without consulting the saved Exam', () => {
    const input = request()
    input.exam.title = 'Renamed Working Copy'
    input.arrangement.choiceOrder = { 'question-1': ['shark', 'whale'] }

    const prepared = prepareExport(input)

    expect(prepared.record.capturedName).toBe('Renamed Working Copy')
    expect(prepared.filename).toBe('Renamed Working Copy.pdf')
    const firstQuestion = prepared.record.plans
      .flatMap((plan) => plan.pages)
      .flatMap((page) => page.items)
      .find((item) => item.kind === 'question')
    expect(firstQuestion?.kind === 'question' && firstQuestion.question.choices.map(({ id }) => id)).toEqual([
      'shark',
      'whale',
    ])
  })

  test('historical re-export uses only stored plans and appends a new event', () => {
    const original = prepareExport(request()).record
    const historical = prepareHistoricalExport({
      record: original,
      createdAt: '2026-09-11T09:00:00.000Z',
      createId: () => 'record-2',
    })

    expect(historical.documents).toEqual(original.plans)
    expect(historical.filename).toBe('Biology Quiz.pdf')
    expect(historical.record).toEqual({
      ...original,
      id: 'record-2',
      createdAt: '2026-09-11T09:00:00.000Z',
      sourceRecordId: 'record-1',
    })
    expect(original.sourceRecordId).toBeUndefined()
  })

  test('blocks empty output and invalid Content Selection', () => {
    expect(() => prepareExport({
      ...request(),
      exam: { title: 'Empty', questions: [] },
      arrangement: { id: 'working-copy', letter: '', questionOrder: [], choiceOrder: {} },
    })).toThrow('Add at least one question to the Exam before exporting.')

    expect(() => prepareExport(request({
      format: 'pdf',
      selection: { test: false, answerKey: false },
    }))).toThrow('Choose the student test, the answer key, or both.')
  })

  test('missing correctness and optional metadata never block export', () => {
    const input = request()
    input.exam.questions = [question({
      difficulty: undefined,
      topics: undefined,
      doc: {
        type: 'doc',
        content: [
          paragraph('Choose one.'),
          { type: 'multipleChoice', content: [choice('one', 'One'), choice('two', 'Two')] },
        ],
      },
    })]
    const prepared = prepareExport(input)
    const entries = prepared.documents
      .flatMap((plan) => plan.pages)
      .flatMap((page) => page.items)
      .filter((item) => item.kind === 'answer-key-entry')

    expect(entries).toEqual([{ kind: 'answer-key-entry', number: 1, letter: null }])
  })
})


describe('global Export preferences', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }

  test('default to PDF with both documents and retain a valid choice', () => {
    values.clear()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    expect(readExportPreferences()).toEqual(DEFAULT_EXPORT_CONFIGURATION)
    const preferred = {
      format: 'docx' as const,
      selection: { test: false, answerKey: true },
    }
    writeExportPreferences(preferred)
    expect(readExportPreferences()).toEqual(preferred)
  })

  test('remember shuffle options and Version count for each Exam on its own', () => {
    values.clear()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    expect(readShufflePreferences('exam-1')).toEqual({ shuffle: { questions: false, answers: false }, versionCount: 2 })

    writeShufflePreferences('exam-1', { shuffle: { questions: true, answers: false }, versionCount: 4 })
    writeShufflePreferences('exam-2', { shuffle: { questions: false, answers: true }, versionCount: 3 })
    expect(readShufflePreferences('exam-1')).toEqual({ shuffle: { questions: true, answers: false }, versionCount: 4 })
    expect(readShufflePreferences('exam-2')).toEqual({ shuffle: { questions: false, answers: true }, versionCount: 3 })
    // Global format and Content Selection are untouched by either.
    expect(readExportPreferences()).toEqual(DEFAULT_EXPORT_CONFIGURATION)

    values.set('test-parrot-export-shuffle-v1', JSON.stringify({ 'exam-1': { shuffle: 'yes', versionCount: -1 } }))
    expect(readShufflePreferences('exam-1')).toEqual({ shuffle: { questions: false, answers: false }, versionCount: 2 })
    // A count box left empty stores no count, and the checkboxes survive it.
    values.set('test-parrot-export-shuffle-v1', JSON.stringify({ 'exam-1': { shuffle: { questions: true, answers: true }, versionCount: null } }))
    expect(readShufflePreferences('exam-1')).toEqual({ shuffle: { questions: true, answers: true }, versionCount: 2 })
    values.set('test-parrot-export-shuffle-v1', 'not json')
    expect(readShufflePreferences('exam-2')).toEqual({ shuffle: { questions: false, answers: false }, versionCount: 2 })
  })

  test('ignore malformed and empty Content Selection preferences', () => {
    values.set('test-parrot-export-preferences-v1', JSON.stringify({
      format: 'docx', selection: { test: false, answerKey: false },
    }))
    expect(readExportPreferences()).toEqual(DEFAULT_EXPORT_CONFIGURATION)
  })
})

describe('shuffled Versions', () => {
  const pagesOf = (plans: readonly LayoutPlan[]) => plans.flatMap((plan) => plan.pages)
  const NO_SHUFFLE_OPTIONS = { questions: false, answers: false }

  // Reproducible draws: the same seed always shuffles the same way.
  function seeded(seed: number): RandomSource {
    let state = seed >>> 0
    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function multipleChoice(id: string, answers: string[]): Question {
    return question({
      id,
      doc: {
        type: 'doc',
        content: [
          paragraph(`Question ${id}`),
          { type: 'multipleChoice', content: answers.map((answer, index) => choice(answer, answer, index === 0)) },
        ],
      },
    })
  }

  // Every Question Type, so each shuffle rule has something to hold still.
  function mixedExam(): { exam: Exam; arrangement: Arrangement } {
    const questions: Question[] = [
      multipleChoice('mc1', ['a1', 'a2', 'a3']),
      multipleChoice('mc2', ['b1', 'b2', 'b3']),
      multipleChoice('mc3', ['c1', 'c2', 'c3']),
      {
        id: 'tf1',
        type: 'true-false',
        columns: 1,
        doc: {
          type: 'doc',
          content: [
            paragraph('Water is wet.'),
            { type: 'multipleChoice', content: [choice('tf1-t', 'True', true), choice('tf1-f', 'False')] },
          ],
        },
      },
      {
        id: 'tf2',
        type: 'true-false',
        columns: 1,
        doc: {
          type: 'doc',
          content: [
            paragraph('Fire is cold.'),
            { type: 'multipleChoice', content: [choice('tf2-t', 'True'), choice('tf2-f', 'False', true)] },
          ],
        },
      },
      {
        id: 'match1',
        type: 'matching',
        columns: 1,
        doc: {
          type: 'doc',
          content: [
            paragraph('Match each animal.'),
            {
              type: 'matching',
              content: [
                { type: 'matchingPrompt', attrs: { id: 'p1', answer: 'w1' }, content: [paragraph('Dog')] },
                { type: 'matchingPrompt', attrs: { id: 'p2', answer: 'w2' }, content: [paragraph('Cat')] },
                { type: 'matchingAnswer', attrs: { id: 'w1' }, content: [paragraph('Bark')] },
                { type: 'matchingAnswer', attrs: { id: 'w2' }, content: [paragraph('Meow')] },
                { type: 'matchingAnswer', attrs: { id: 'w3' }, content: [paragraph('Moo')] },
              ],
            },
          ],
        },
      },
      { id: 'open1', type: 'open', columns: 1, doc: { type: 'doc', content: [paragraph('Explain.')] } },
      {
        id: 'multi1',
        type: 'multipart',
        columns: 1,
        doc: {
          type: 'doc',
          content: [
            paragraph('Read the passage.'),
            {
              type: 'multipartParts',
              content: [
                {
                  type: 'multipartPart',
                  attrs: { id: 'part1', columns: 1 },
                  content: [
                    { type: 'multipartPartStem', content: [paragraph('Pick one.')] },
                    { type: 'multipleChoice', content: [choice('d1', 'd1', true), choice('d2', 'd2'), choice('d3', 'd3')] },
                  ],
                },
                {
                  type: 'multipartPart',
                  attrs: { id: 'part2', columns: 1 },
                  content: [
                    { type: 'multipartPartStem', content: [paragraph('Explain it.')] },
                    { type: 'suggestedAnswer', content: [paragraph('')] },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]
    return {
      exam: { title: 'Mixed Quiz', questions },
      arrangement: {
        id: 'working-copy',
        letter: 'A',
        questionOrder: questions.map(({ id }) => id),
        choiceOrder: {},
      },
    }
  }

  function shuffledRequest(
    shuffle: { questions: boolean; answers: boolean },
    versionCount: number,
    options: { history?: ExportHistory; seed?: number; selection?: { test: boolean; answerKey: boolean } } = {},
  ) {
    const { exam, arrangement } = mixedExam()
    let next = 0
    return {
      ...request(
        {
          format: 'pdf' as const,
          selection: options.selection ?? { test: true, answerKey: true },
          shuffle,
          versionCount,
        },
        options.history,
      ),
      exam,
      arrangement,
      random: seeded(options.seed ?? 7),
      createId: () => `id-${next++}`,
    }
  }

  // What one printed plan put where: the questions in page order, and every
  // answer list — Multiple Choice, Word Bank, Part — in its printed order.
  function printedOrder(plan: LayoutPlan) {
    const questions: string[] = []
    const answers: Record<string, string[]> = {}
    for (const item of plan.pages.flatMap((page) => page.items)) {
      if (item.kind !== 'question' || questions.includes(item.question.id)) continue
      const { question: printed } = item
      questions.push(printed.id)
      if (printed.choices.length > 0) answers[printed.id] = printed.choices.map(({ id }) => id)
      if (printed.matching) answers[printed.id] = printed.matching.bank.map(({ id }) => id)
      for (const part of printed.parts ?? []) {
        if (part.choices.length > 0) answers[part.id] = part.choices.map(({ id }) => id)
      }
    }
    return { questions, answers }
  }

  const testsOf = (plans: readonly LayoutPlan[]) =>
    plans.filter((plan) => plan.pages[0]?.stream === 'test')

  test('each Version hides as many incorrect answers as the Working Copy, drawn for itself, and its record reprints exactly that', () => {
    const base = shuffledRequest({ questions: false, answers: true }, 4)
    const hiding = { ...base, arrangement: { ...base.arrangement, hiddenAnswers: { mc1: ['a2'] } } }
    const prepared = prepareExport(hiding)
    const printedMc1 = testsOf(prepared.documents).map((plan) => printedOrder(plan).answers.mc1!)
    for (const answers of printedMc1) {
      expect(answers).toHaveLength(2)
      expect(answers).toContain('a1')
    }
    // Over four Versions, more than one distractor came up.
    expect(new Set(printedMc1.flat()).size).toBe(3)

    const historical = prepareHistoricalExport({
      record: prepared.record,
      createdAt: '2026-09-11T09:00:00.000Z',
      createId: () => 'record-2',
    })
    expect(testsOf(historical.documents).map((plan) => printedOrder(plan).answers.mc1)).toEqual(printedMc1)
  })

  test('a shuffled export prints every Version’s test, then every Version’s key, each page named', () => {
    const prepared = prepareExport(shuffledRequest({ questions: true, answers: true }, 3))
    const names = prepared.record.versions!

    expect(names).toHaveLength(3)
    expect(new Set(names).size).toBe(3)
    for (const name of names) expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    expect(prepared.documents.map((plan) => [plan.pages[0]?.stream, plan.arrangement.version])).toEqual([
      ['test', names[0]],
      ['test', names[1]],
      ['test', names[2]],
      ['answer-key', names[0]],
      ['answer-key', names[1]],
      ['answer-key', names[2]],
    ])
    for (const plan of prepared.documents) {
      expect(plan.pages.every((page) => page.furniture.arrangementLabel === plan.arrangement.version))
        .toBe(true)
    }
    expect(prepared.record.plans).toEqual(prepared.documents)
  })

  test('every Version differs from the others and from the Working Copy as authored', () => {
    const authored = JSON.stringify(printedOrder(prepareExport(shuffledRequest(NO_SHUFFLE_OPTIONS, 1)).documents[0]!))
    const tests = testsOf(prepareExport(shuffledRequest({ questions: false, answers: true }, 8)).documents)
    const seen = tests.map((plan) => JSON.stringify(printedOrder(plan)))

    expect(new Set(seen).size).toBe(8)
    expect(seen).not.toContain(authored)

    // Three answers have six orders; five Versions must be exactly the other five.
    const small = {
      ...request({
        format: 'pdf',
        selection: { test: true, answerKey: false },
        shuffle: { questions: false, answers: true },
        versionCount: 5,
      }),
      exam: { title: 'One', questions: [multipleChoice('only', ['x', 'y', 'z'])] },
      arrangement: { id: 'working-copy', letter: 'A', questionOrder: ['only'], choiceOrder: {} },
      random: seeded(3),
    }
    const orders = prepareExport(small).documents.map((plan) => printedOrder(plan).answers.only!.join(''))
    expect(orders.sort()).toEqual(['xzy', 'yxz', 'yzx', 'zxy', 'zyx'])
    expect(() => prepareExport({ ...small, configuration: { ...small.configuration, versionCount: 6 } }))
      .toThrow('Choose from 1 to 5 Versions for this Exam.')
  })

  test('question order moves only within each Section, and only when asked', () => {
    const authored = printedOrder(prepareExport(shuffledRequest(NO_SHUFFLE_OPTIONS, 1)).documents[0]!)
    const sectionOf = (id: string) => mixedExam().exam.questions.find((item) => item.id === id)!.type

    const questionsOnly = testsOf(prepareExport(shuffledRequest({ questions: true, answers: false }, 5)).documents)
    for (const plan of questionsOnly) {
      const printed = printedOrder(plan)
      expect(printed.questions.map(sectionOf)).toEqual(authored.questions.map(sectionOf))
      expect(printed.answers).toEqual(authored.answers)
    }
    expect(questionsOnly.some((plan) => printedOrder(plan).questions.join() !== authored.questions.join()))
      .toBe(true)

    const answersOnly = testsOf(prepareExport(shuffledRequest({ questions: false, answers: true }, 5)).documents)
    for (const plan of answersOnly) {
      expect(printedOrder(plan).questions).toEqual(authored.questions)
    }
  })

  test('answer order moves Multiple Choice, Part and Word Bank answers, never True/False or Items', () => {
    const authored = printedOrder(prepareExport(shuffledRequest(NO_SHUFFLE_OPTIONS, 1)).documents[0]!)
    const tests = testsOf(prepareExport(shuffledRequest({ questions: true, answers: true }, 12)).documents)
    const moved = new Set<string>()
    for (const plan of tests) {
      const printed = printedOrder(plan)
      expect(printed.answers.tf1).toEqual(['tf1-t', 'tf1-f'])
      expect(printed.answers.tf2).toEqual(['tf2-t', 'tf2-f'])
      const match = plan.pages.flatMap((page) => page.items)
        .find((item) => item.kind === 'question' && item.question.id === 'match1')
      expect(match?.kind === 'question' && match.question.matching!.prompts.map(({ id }) => id))
        .toEqual(['p1', 'p2'])
      for (const [id, order] of Object.entries(printed.answers)) {
        expect([...order].sort()).toEqual([...authored.answers[id]!].sort())
        if (order.join() !== authored.answers[id]!.join()) moved.add(id)
      }
    }
    expect([...moved].sort()).toEqual(['match1', 'mc1', 'mc2', 'mc3', 'part1'])
  })

  test('a count the Exam cannot support, or nothing to shuffle, is refused with a reason', () => {
    const input = request({
      format: 'pdf',
      selection: { test: true, answerKey: true },
      shuffle: { questions: false, answers: true },
      versionCount: 2,
    })
    // One question with two answers has one arrangement besides its own.
    expect(() => prepareExport(input)).toThrow('Choose from 1 to 1 Version for this Exam.')
    expect(prepareExport({ ...input, configuration: { ...input.configuration, versionCount: 1 } })
      .record.versions).toHaveLength(1)

    expect(() => prepareExport(request({
      format: 'pdf',
      selection: { test: true, answerKey: true },
      shuffle: { questions: true, answers: false },
      versionCount: 1,
    }))).toThrow('Nothing on this Exam can be shuffled with these options.')

    expect(() => prepareExport(shuffledRequest({ questions: true, answers: true }, 0)))
      .toThrow('Choose from 1 to 50 Versions for this Exam.')
  })

  test('a Version name is never reused within the Exam’s Export History', () => {
    const first = prepareExport(shuffledRequest({ questions: true, answers: true }, 4, { seed: 1 })).record
    const second = prepareExport(shuffledRequest({ questions: true, answers: true }, 4, {
      seed: 1,
      history: { records: [first] },
    })).record

    expect(second.versions).toHaveLength(4)
    for (const name of second.versions!) expect(first.versions).not.toContain(name)
  })

  test('the same random draws reproduce the same Versions, so the preview is what exports', () => {
    const preview = prepareExport(shuffledRequest({ questions: true, answers: true }, 3, { seed: 42 }))
    const exported = prepareExport(shuffledRequest({ questions: true, answers: true }, 3, { seed: 42 }))

    expect(exported.record.versions).toEqual(preview.record.versions)
    expect(exported.documents.map(printedOrder)).toEqual(preview.documents.map(printedOrder))
  })

  test('shuffling leaves the Exam and its Working Copy arrangement untouched', () => {
    const input = shuffledRequest({ questions: true, answers: true }, 3)
    const exam = structuredClone(input.exam)
    const arrangement = structuredClone(input.arrangement)
    prepareExport(input)

    expect(input.exam).toEqual(exam)
    expect(input.arrangement).toEqual(arrangement)
  })

  test('a re-export reproduces a chosen subset of stored Versions exactly, settings frozen', () => {
    const original = {
      ...prepareExport(shuffledRequest({ questions: true, answers: false }, 3)).record,
      examPackage: '{"package":true}',
    }
    // The record keeps what it shuffled, so the Re-export dialog can show it.
    expect(original.shuffle).toEqual({ questions: true, answers: false })
    const [first, second, third] = original.versions!
    const reprint = prepareHistoricalExport({
      record: original,
      versions: [third!, first!],
      createdAt: '2026-09-12T09:00:00.000Z',
      createId: () => 'record-9',
    })

    // In the record's own order, from its stored plans, and nothing else.
    const plansOf = (name: string) => original.plans.filter((plan) => plan.arrangement.version === name)
    expect(reprint.documents).toEqual([
      plansOf(first!)[0], plansOf(third!)[0], plansOf(first!)[1], plansOf(third!)[1],
    ])
    expect(reprint.documents.map((plan) => plan.pages[0]?.stream)).toEqual(['test', 'test', 'answer-key', 'answer-key'])
    expect(reprint.record).toMatchObject({
      id: 'record-9',
      sourceRecordId: original.id,
      createdAt: '2026-09-12T09:00:00.000Z',
      format: original.format,
      selection: original.selection,
      shuffle: original.shuffle,
      versions: [first, third],
      plans: reprint.documents,
      examPackage: '{"package":true}',
    })
    expect(reprint.record.versions).not.toContain(second)
  })

  test('a re-export cannot ask for a Version its record never printed', () => {
    const original = prepareExport(shuffledRequest({ questions: true, answers: true }, 2)).record
    const createdAt = '2026-09-12T09:00:00.000Z'

    expect(() => prepareHistoricalExport({ record: original, versions: ['Made Up'], createdAt }))
      .toThrow('Choose at least one Version this export printed.')
    expect(() => prepareHistoricalExport({ record: original, versions: [], createdAt }))
      .toThrow('Choose at least one Version this export printed.')
  })

  test('only the chosen Content Selection prints, for every Version', () => {
    const prepared = prepareExport(shuffledRequest({ questions: true, answers: true }, 2, {
      selection: { test: false, answerKey: true },
    }))
    expect(prepared.documents.map((plan) => plan.pages[0]?.stream)).toEqual(['answer-key', 'answer-key'])
    expect(prepared.record.selection).toEqual({ test: false, answerKey: true })
  })

  test('an export that shuffles nothing prints the Working Copy unlabeled and records no Version', () => {
    const prepared = prepareExport(request())

    expect(prepared.record.versions).toBeUndefined()
    expect(pagesOf(prepared.documents).map((page) => page.furniture.arrangementLabel))
      .toEqual(['', ''])
  })
})

describe('an Exam with Pending Images', () => {
  const pictured = (id: string, image: Record<string, unknown>): Question => ({
    id,
    type: 'open',
    columns: 1,
    doc: { type: 'doc', content: [paragraph(`Describe picture ${id}.`), { type: 'image-block', attrs: image }] },
  })
  const exportOf = (questions: Question[]) => ({
    ...request(),
    exam: { title: 'Pictures', questions },
    arrangement: { id: 'working-copy', letter: '', questionOrder: questions.map(({ id }) => id), choiceOrder: {} },
  })

  test('refuses while a Question still needs a picture, naming its printed number', () => {
    const questions = [
      pictured('a', { src: `/local-images/${'a'.repeat(64)}`, caption: '' }),
      pictured('b', { src: '', caption: '', pending: { image: 3 } }),
      pictured('c', { src: '', caption: '', pending: { page: 2 } }),
    ]
    expect(() => prepareExport(exportOf(questions))).toThrow(PicturesNeededError)
    expect(() => prepareExport(exportOf(questions))).toThrow(
      'Questions 2 and 3 still need pictures. Resolve them before exporting.',
    )
    expect(() => prepareExport(exportOf(questions.slice(0, 2)))).toThrow(
      'Question 2 still needs a picture. Resolve it before exporting.',
    )
  })

  test('names a shuffled export’s missing pictures by the Working Copy’s numbers', () => {
    const questions = [
      pictured('a', { src: `/local-images/${'a'.repeat(64)}`, caption: '' }),
      pictured('b', { src: `/local-images/${'b'.repeat(64)}`, caption: '' }),
      pictured('c', { src: '', caption: '', pending: { image: 1 } }),
    ]
    const shuffled = {
      ...exportOf(questions),
      configuration: {
        format: 'pdf' as const,
        selection: { test: true, answerKey: true },
        shuffle: { questions: true, answers: false },
        versionCount: 5,
      },
    }
    expect(() => prepareExport(shuffled)).toThrow(
      'Question 3 still needs a picture. Resolve it before exporting.',
    )
  })

  test('exports once every picture is resolved', () => {
    const prepared = prepareExport(exportOf([pictured('b', { src: `/local-images/${'b'.repeat(64)}`, caption: '' })]))
    expect(prepared.record.mediaHashes).toEqual(['b'.repeat(64)])
  })
})
