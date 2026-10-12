import { describe, expect, test } from 'bun:test'
import {
  choicesOf,
  orderedChoices,
  orderedQuestions,
  questionsInSection,
  sectionsOf,
  takesWorkSpace,
  workSpaceOf,
  type Arrangement,
  type Exam,
  type ExamSection,
  type Question,
} from './exam'
import type { ProseMirrorJSON } from './question-doc'
import { unmeasured } from './export-plan'
import { prepareExport, prepareHistoricalExport, EMPTY_EXPORT_HISTORY, type ExportConfiguration } from './export-preparation'
import { printFingerprint } from './print-fingerprint'
import { createPublicationPdf, type PdfFontLoader } from './pdf-export'
import { examPackage, withExamPackage } from './exam-package-export'
import { initialSelection } from './import-selection'
import { planImport } from './package-commit'
import { blockPictureKeysOf, inspectImportFile, inspectImportRecord, type ExamRecord } from './package-import'
import { PIXEL_PNG } from './export-fixtures'
import { pictureKey } from './picture-geometry'
import { writePackageZip } from './package-zip'
import { selectedExam } from './selected-exam'
import { shownChoices } from './hidden-answers'
import { pointsOfQuestion } from './points'
import { importedQuestionsFromRecord } from './question-bank-import'
import type { QuestionBankResource } from './question-bank-workspaces'

const fontFiles = {
  regular: 'FreeSerif.ttf',
  bold: 'FreeSerifBold.ttf',
  italic: 'FreeSerifItalic.ttf',
  boldItalic: 'FreeSerifBoldItalic.ttf',
  mono: 'FreeMono.ttf',
} as const
const fonts: PdfFontLoader = async (style) =>
  Bun.file(new URL(`../public/fonts/${fontFiles[style]}`, import.meta.url).pathname).arrayBuffer()
const noImages = async () => null

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

function multipleChoice(id: string, stem: string, answers: string[]): Question {
  return {
    id,
    type: 'multiple-choice',
    columns: 2,
    doc: {
      type: 'doc',
      content: [paragraph(stem), {
        type: 'multipleChoice',
        content: answers.map((answer, index) => ({
          type: 'multipleChoiceChoice',
          attrs: { id: `${id}-choice-${index}`, correct: index === 0 },
          content: [paragraph(answer)],
        })),
      }],
    },
  }
}

function matching(id: string): Question {
  return {
    id,
    type: 'matching',
    columns: 1,
    doc: {
      type: 'doc',
      content: [paragraph('Match each term.'), {
        type: 'matching',
        content: [
          { type: 'matchingPrompt', attrs: { id: `${id}-p1`, answer: `${id}-a2` }, content: [paragraph('Nucleus')] },
          { type: 'matchingPrompt', attrs: { id: `${id}-p2`, answer: `${id}-a1` }, content: [paragraph('Ribosome')] },
          { type: 'matchingAnswer', attrs: { id: `${id}-a1` }, content: [paragraph('Builds proteins')] },
          { type: 'matchingAnswer', attrs: { id: `${id}-a2` }, content: [paragraph('Holds DNA')] },
          { type: 'matchingAnswer', attrs: { id: `${id}-a3` }, content: [paragraph('Stores water')] },
        ],
      }],
    },
  }
}

function shortAnswer(id: string, stem: string): Question {
  return { id, type: 'open', columns: 1, doc: { type: 'doc', content: [paragraph(stem)] } }
}

const cellsQuestion = multipleChoice('cells-1', 'Which organelle releases energy?', ['Mitochondrion', 'Nucleus', 'Ribosome', 'Vacuole'])
const unusedQuestion = multipleChoice('cells-unused', 'Never printed', ['A', 'B'])
const matchingQuestion = matching('cells-2')
const forcesQuestion = shortAnswer('forces-1', 'Describe what a newton measures.')
const forcesSecond = multipleChoice('forces-2', 'Which is a unit of force?', ['Newton', 'Joule'])

const bank = (id: string, name: string, questions: Question[]): QuestionBankResource => ({
  id, name, createdAt: '2026-01-01T00:00:00.000Z', lastUpdatedAt: '2026-01-01T00:00:00.000Z', questions,
})
const cells = bank('cells', 'Cells', [cellsQuestion, unusedQuestion, matchingQuestion])
const forces = bank('forces', 'Forces', [forcesQuestion, forcesSecond])
const ownerOf = async (questionId: string) =>
  [cells, forces].find((candidate) => candidate.questions.some(({ id }) => id === questionId)) ?? null

// A Working Copy as the editor presents it: columns set on the sheet, answers
// shuffled, and room for work below the Short Answer.
const exam: Exam = {
  title: 'Cells and Forces',
  questions: [
    { ...cellsQuestion, columns: 4 },
    matchingQuestion,
    forcesQuestion,
    { ...forcesSecond, columns: 1 },
  ],
  workSpace: { 'forces-1': { height: 96, style: 'lines', fill: false } },
}
const arrangement: Arrangement = {
  id: 'exam-draft',
  letter: 'A',
  questionOrder: ['forces-2', 'cells-1', 'cells-2', 'forces-1'],
  choiceOrder: {
    'cells-1': ['cells-1-choice-2', 'cells-1-choice-0', 'cells-1-choice-3', 'cells-1-choice-1'],
    'cells-2': ['cells-2-a3', 'cells-2-a1', 'cells-2-a2'],
  },
}

function prepared(configuration: ExportConfiguration) {
  return prepareExport({
    examId: 'exam-1',
    exam,
    arrangement,
    configuration,
    history: EMPTY_EXPORT_HISTORY,
    measure: unmeasured,
    createdAt: '2026-09-24T00:00:00.000Z',
    createId: () => 'record-1',
  })
}

const text = (question: Question) => JSON.stringify(question.doc).match(/"text":"([^"]+)"/)![1]
const answerTexts = (question: Question, order: Arrangement) =>
  orderedChoices(question, order).map((choice) => JSON.stringify(choice.node).match(/"text":"([^"]+)"/)![1])

/** What a sheet prints, reduced to what a teacher would compare by eye. */
function printed(sheet: Exam, order: Arrangement) {
  return orderedQuestions(sheet, order).map((question) => ({
    type: question.type,
    stem: text(question),
    columns: question.type === 'multiple-choice' ? question.columns : undefined,
    answers: choicesOf(question).length ? answerTexts(question, order) : [],
    workSpace: sheet.workSpace?.[question.id],
  }))
}

describe('an Exam PDF carrying its Exam', () => {
  test('carries the Paper Style, and only the Work Space the teacher set, "None" included where the style rules lines', async () => {
    const recordOf = async (sheet: Exam) =>
      (await examPackage({ exam: sheet, arrangement, ownerOf, loadMedia: noImages })).package.exams[0]!
    const shortAnswerOf = (record: ExamRecord) =>
      record.positions.find((position) => position.workSpace !== undefined)?.workSpace

    // The room the style rules is the style's, and is not written out.
    const ruled = await recordOf({ ...exam, workSpace: {}, paperStyle: 'condensed' })
    expect(ruled.paperStyle).toBe('condensed')
    expect(shortAnswerOf(ruled)).toBeUndefined()

    // "None" set against the style travels, so it still wins on import.
    const none = { height: 0, style: 'blank' as const, fill: false }
    const cleared = await recordOf({ ...exam, workSpace: { 'forces-1': none }, paperStyle: 'classic' })
    expect(shortAnswerOf(cleared)).toEqual(none)

    const plain = await recordOf(exam)
    expect(plain).not.toHaveProperty('paperStyle')
    expect(shortAnswerOf(plain)).toEqual({ height: 96, style: 'lines', fill: false })
  })

  test('carries where a Matching question’s Word Bank prints, and brings it back on import', async () => {
    const matchingId = exam.questions.find((question) => question.type === 'matching')!.id
    const matchingPosition = (record: ExamRecord) =>
      record.positions.filter((position) => position.wordBankLayout !== undefined)
    const sheet: Exam = { ...exam, wordBankLayout: { [matchingId]: 'above' } }
    const { package: written } = await examPackage({ exam: sheet, arrangement, ownerOf, loadMedia: noImages })
    expect(matchingPosition(written.exams[0]!).map((position) => position.wordBankLayout)).toEqual(['above'])
    // Every Matching position says where its Word Bank prints, one stored
    // before every position carried a layout included.
    const plain = await examPackage({ exam, arrangement, ownerOf, loadMedia: noImages })
    expect(matchingPosition(plain.package.exams[0]!)).toHaveLength(1)

    const proposal = await inspectImportRecord(new TextEncoder().encode(JSON.stringify(written)))
    const planned = planImport(proposal, initialSelection(proposal)).exams[0]!
    const imported = selectedExam(planned.saved.questionBank, planned.saved.workingCopy).exam
    const importedMatching = imported.questions.find((question) => question.type === 'matching')!
    expect(imported.wordBankLayout).toEqual({ [importedMatching.id]: 'above' })
  })

  test('carries whether the teacher chose a Word Bank’s layout, so a change of style after import leaves it', async () => {
    const matchingId = exam.questions.find((question) => question.type === 'matching')!.id
    const matchingOf = (record: ExamRecord) =>
      record.positions.find((position) => position.wordBankLayout !== undefined)!
    const chosen: Exam = { ...exam, wordBankLayout: { [matchingId]: 'above' }, wordBankLayoutSet: { [matchingId]: true } }
    const { package: written } = await examPackage({ exam: chosen, arrangement, ownerOf, loadMedia: noImages })
    expect(matchingOf(written.exams[0]!).wordBankLayoutSet).toBe(true)
    // A layout the teacher did not choose says nothing: absent is false.
    const plain = await examPackage({ exam, arrangement, ownerOf, loadMedia: noImages })
    expect(matchingOf(plain.package.exams[0]!)).not.toHaveProperty('wordBankLayoutSet')

    const importedFrom = async (record: typeof written) => {
      const proposal = await inspectImportRecord(new TextEncoder().encode(JSON.stringify(record)))
      return planImport(proposal, initialSelection(proposal)).exams[0]!.saved.workingCopy
    }
    const imported = await importedFrom(written)
    expect(Object.values(imported.wordBankLayoutSet ?? {})).toEqual([true])
    expect(await importedFrom(plain.package)).not.toHaveProperty('wordBankLayoutSet')
  })

  test('carries a Work Space of none the teacher set under any style, so a lining style after import leaves it', async () => {
    const none = { height: 0, style: 'blank' as const, fill: false }
    // Set under Classic, then the Exam went back to Standard, which rules
    // nothing there either: the teacher's "None" still travels.
    const sheet: Exam = { ...exam, workSpace: { 'forces-1': none } }
    const { package: written } = await examPackage({ exam: sheet, arrangement, ownerOf, loadMedia: noImages })
    expect(written.exams[0]!.positions.find((position) => position.workSpace)?.workSpace).toEqual(none)

    const proposal = await inspectImportRecord(new TextEncoder().encode(JSON.stringify(written)))
    const { questionBank, workingCopy } = planImport(proposal, initialSelection(proposal)).exams[0]!.saved
    const shortAnswer = questionBank.questions.find((question) => takesWorkSpace(question.type))!
    const classic = selectedExam(questionBank, { ...workingCopy, paperStyle: 'classic' }).exam
    expect(workSpaceOf(classic, shortAnswer.id)).toEqual(none)
  })

  test('places a Word Bank on import that its record does not, by its Paper Style and the fit rule', async () => {
    const { package: written } = await examPackage({ exam, arrangement, ownerOf, loadMedia: noImages })
    for (const position of written.exams[0]!.positions) delete position.wordBankLayout
    const importedWith = async (paperStyle: Exam['paperStyle'], width: number) => {
      const record = { ...written, exams: [{ ...written.exams[0]!, ...(paperStyle ? { paperStyle } : {}) }] }
      const proposal = await inspectImportRecord(new TextEncoder().encode(JSON.stringify(record)))
      const planned = planImport(proposal, initialSelection(proposal), undefined, undefined, () => width).exams[0]!
      return Object.values(planned.saved.workingCopy.wordBankLayout ?? {})
    }
    expect(await importedWith(undefined, 40)).toEqual(['beside'])
    expect(await importedWith(undefined, 2000)).toEqual(['above'])
    expect(await importedWith('classic', 40)).toEqual(['above'])
  })

  test('re-importing an answer-key PDF reproduces exactly what it printed', async () => {
    const withPackage = await withExamPackage(
      prepared({ format: 'pdf', selection: { test: true, answerKey: true } }),
      { exam, arrangement, ownerOf, loadMedia: noImages },
    )
    const { bytes: pdf } = await createPublicationPdf(withPackage.documents, noImages, fonts, withPackage.record.examPackage)

    const proposal = await inspectImportFile(pdf)

    // One bank, named for the Exam, holds exactly the Questions it printed,
    // in the order it printed them, whichever banks they came from.
    expect(proposal.banks.map(({ record }) => ({
      name: record.bank.name,
      questions: record.bank.questions.length,
    }))).toEqual([{ name: 'Cells and Forces Question Bank', questions: 4 }])
    expect(proposal.banks[0]!.record.bank).not.toHaveProperty('description')
    expect(JSON.stringify(proposal)).not.toContain('Never printed')
    expect(proposal.exams).toHaveLength(1)

    let next = 0
    const plan = planImport(proposal, initialSelection(proposal), () => `local-${next++}`)
    const { exam: imported, arrangement: importedOrder } = selectedExam(
      plan.exams[0]!.saved.questionBank,
      plan.exams[0]!.saved.workingCopy,
    )
    expect(imported.title).toBe('Cells and Forces')
    expect(printed(imported, importedOrder)).toEqual(printed(exam, arrangement))
  })

  test('a position that hides incorrect answers carries them, and imports hiding the same ones', async () => {
    const hiding: Arrangement = { ...arrangement, hiddenAnswers: { 'cells-1': ['cells-1-choice-3', 'cells-1-choice-1'] } }
    const carried = (await examPackage({ exam, arrangement: hiding, ownerOf, loadMedia: noImages })).package
    const position = carried.exams[0]!.positions.find(({ hiddenAnswers }) => hiddenAnswers)!
    // The bank keeps every answer; the position names the two it leaves off.
    expect(position.hiddenAnswers).toEqual(['q2-c4', 'q2-c2'])
    const record = carried.questionBanks[0]!.record as { bank: { questions: { id: string; choices?: unknown[] }[] } }
    expect(record.bank.questions.find(({ id }) => id === 'q2')!.choices).toHaveLength(4)

    const proposal = await inspectImportRecord(new TextEncoder().encode(JSON.stringify(carried)))
    let next = 0
    const plan = planImport(proposal, initialSelection(proposal), () => `local-${next++}`)
    const { exam: imported, arrangement: importedOrder } = selectedExam(
      plan.exams[0]!.saved.questionBank,
      plan.exams[0]!.saved.workingCopy,
    )
    const shownTexts = (sheet: Exam, order: Arrangement) => {
      const question = sheet.questions.find((candidate) => text(candidate) === 'Which organelle releases energy?')!
      return shownChoices(question, order).map((choice) => JSON.stringify(choice.node).match(/"text":"([^"]+)"/)![1])
    }
    expect(shownTexts(imported, importedOrder)).toEqual(['Ribosome', 'Mitochondrion'])
    expect(shownTexts(imported, importedOrder)).toEqual(shownTexts(exam, hiding))
  })

  test('a shuffled answer-key PDF carries the Exam as authored, not one Exam per Version', async () => {
    const shuffled = await withExamPackage(
      prepared({
        format: 'pdf',
        selection: { test: true, answerKey: true },
        shuffle: { questions: true, answers: true },
        versionCount: 3,
      }),
      { exam, arrangement, ownerOf, loadMedia: noImages },
    )
    expect(shuffled.record.versions).toHaveLength(3)
    const { bytes: pdf } = await createPublicationPdf(shuffled.documents, noImages, fonts, shuffled.record.examPackage)

    const proposal = await inspectImportFile(pdf)
    expect(proposal.exams).toHaveLength(1)
    let next = 0
    const plan = planImport(proposal, initialSelection(proposal), () => `local-${next++}`)
    const { exam: imported, arrangement: importedOrder } = selectedExam(
      plan.exams[0]!.saved.questionBank,
      plan.exams[0]!.saved.workingCopy,
    )
    expect(printed(imported, importedOrder)).toEqual(printed(exam, arrangement))
  })

  test('a student-only PDF and a DOCX carry nothing, and the pages are unchanged', async () => {
    const studentOnly = await withExamPackage(
      prepared({ format: 'pdf', selection: { test: true, answerKey: false } }),
      { exam, arrangement, ownerOf, loadMedia: noImages },
    )
    expect(studentOnly.record.examPackage).toBeUndefined()
    const { bytes: pdf } = await createPublicationPdf(studentOnly.documents, noImages, fonts, studentOnly.record.examPackage)
    await expect(inspectImportFile(pdf)).rejects.toMatchObject({ code: 'missing-attachment' })

    const docx = await withExamPackage(
      prepared({ format: 'docx', selection: { test: true, answerKey: true } }),
      { exam, arrangement, ownerOf, loadMedia: noImages },
    )
    expect(docx.record.examPackage).toBeUndefined()

    const before = prepared({ format: 'pdf', selection: { test: true, answerKey: true } })
    const after = await withExamPackage(before, { exam, arrangement, ownerOf, loadMedia: noImages })
    expect(after.record.examPackage).toBeDefined()
    expect(printFingerprint(after.documents)).toEqual(printFingerprint(before.documents))
    expect(after.record.plans).toEqual(before.record.plans)
  })

  test('credits an author or license only when every bank the Exam drew on declares the same one', async () => {
    const license = { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }
    const credited = (author: string, bankLicense = license) => (questionId: string) =>
      ownerOf(questionId).then((owner) => owner && { ...owner, author, license: bankLicense, description: 'Kept at home' })
    const shared = (await examPackage({ exam, arrangement, ownerOf: credited('A. Teacher'), loadMedia: noImages })).package
    expect(shared.questionBanks[0]!.record).toMatchObject({ bank: { author: 'A. Teacher', license } })
    expect(shared.questionBanks[0]!.record).not.toHaveProperty('bank.description')

    const mixed = async (questionId: string) => {
      const owner = await ownerOf(questionId)
      return owner && { ...owner, author: owner.id === 'cells' ? 'A. Teacher' : 'B. Teacher', license }
    }
    const differing = (await examPackage({ exam, arrangement, ownerOf: mixed, loadMedia: noImages })).package
    expect(differing.questionBanks[0]!.record).not.toHaveProperty('bank.author')
    expect(differing.questionBanks[0]!.record).toMatchObject({ bank: { license } })
  })

  test('a historical re-export embeds the record’s own package', async () => {
    const original = await withExamPackage(
      prepared({ format: 'pdf', selection: { test: true, answerKey: true } }),
      { exam, arrangement, ownerOf, loadMedia: noImages },
    )
    const again = prepareHistoricalExport({
      record: original.record,
      createdAt: '2026-09-25T00:00:00.000Z',
      createId: () => 'record-2',
    })
    expect(again.record.examPackage).toEqual(original.record.examPackage)
    expect(again.record.examPackage).toBeInstanceOf(Uint8Array)
  })
})

describe('a Multipart question in an Exam package', () => {
  test('travels as one whole position, its Parts in its bank record, and imports again', async () => {
    const reading: Question = {
      id: 'reading-1',
      type: 'multipart',
      columns: 2,
      doc: {
        type: 'doc',
        content: [paragraph('The power of the Kingdom was fading by 1450.'), {
          type: 'multipartParts',
          content: [{
            type: 'multipartPart',
            attrs: { id: 'reading-1-part-a', columns: 4 },
            content: [
              { type: 'multipartPartStem', content: [paragraph('Which region?')] },
              {
                type: 'multipleChoice',
                content: ['Northern Coast', 'Eastern Forests'].map((answer, index) => ({
                  type: 'multipleChoiceChoice',
                  attrs: { id: `reading-1-choice-${index}`, correct: index === 0 },
                  content: [paragraph(answer)],
                })),
              },
            ],
          }],
        }],
      },
    }
    const sheet: Exam = { title: 'Reading', questions: [reading] }
    const order: Arrangement = {
      id: 'exam-draft',
      letter: 'A',
      questionOrder: ['reading-1'],
      choiceOrder: { 'reading-1-part-a': ['reading-1-choice-1', 'reading-1-choice-0'] },
    }
    const carried = (await examPackage({ exam: sheet, arrangement: order, ownerOf: async () => null, loadMedia: noImages })).package

    // Per-Part answer order and columns are not carried yet: the position is bare.
    expect(carried.exams[0]!.positions).toEqual([{ question: { bank: 'bank-1', question: 'q1' }, section: 0 }])
    expect(carried.exams[0]!.sections).toEqual([{ title: 'Multipart', instructions: 'Answer every part of each question.' }])
    const proposal = await inspectImportRecord(new TextEncoder().encode(JSON.stringify(carried)))
    expect(proposal.banks[0]!.record.bank.questions[0]).toMatchObject({
      type: 'multipart',
      parts: [{ id: 'q1-s1', type: 'multiple-choice', choices: [{ correct: true }, { correct: false }] }],
    })
    expect(proposal.exams[0]!.positions).toHaveLength(1)
  })

  test('travels with a Part’s Subparts in its bank record, as a bare position like its Parts', async () => {
    const answering = (type: string, id: string, stem: string, answer: ProseMirrorJSON) => ({
      type,
      attrs: { id, columns: 2 },
      content: [{ type: 'multipartPartStem', content: [paragraph(stem)] }, answer],
    })
    const survey: Question = {
      id: 'survey-1',
      type: 'multipart',
      columns: 2,
      doc: {
        type: 'doc',
        content: [paragraph('A class counted frogs at a pond.'), {
          type: 'multipartParts',
          content: [{
            type: 'multipartPart',
            attrs: { id: 'survey-1-b', columns: 2 },
            content: [
              { type: 'multipartPartStem', content: [paragraph('The count was highest in April.')] },
              {
                type: 'multipartSubparts',
                content: [
                  answering('multipartSubpart', 'survey-1-b-i', 'Which season?', {
                    type: 'multipleChoice',
                    content: ['Spring', 'Autumn'].map((answer, index) => ({
                      type: 'multipleChoiceChoice',
                      attrs: { id: `survey-1-b-i-${index}`, correct: index === 0 },
                      content: [paragraph(answer)],
                    })),
                  }),
                  answering('multipartSubpart', 'survey-1-b-ii', 'Why?', {
                    type: 'suggestedAnswer', content: [paragraph('Breeding.')],
                  }),
                ],
              },
            ],
          }],
        }],
      },
    }
    const sheet: Exam = {
      title: 'Survey',
      questions: [survey],
      workSpace: { 'survey-1-b-ii': { height: 64, style: 'lines', fill: false } },
    }
    const order: Arrangement = {
      id: 'exam-draft',
      letter: 'A',
      questionOrder: ['survey-1'],
      choiceOrder: { 'survey-1-b-i': ['survey-1-b-i-1', 'survey-1-b-i-0'] },
    }
    const carried = (await examPackage({ exam: sheet, arrangement: order, ownerOf: async () => null, loadMedia: noImages })).package

    // Per-Part and per-Subpart presentation is not carried yet (Exam Record
    // has nowhere to put it): the position is bare, as a Part's is.
    expect(carried.exams[0]!.positions).toEqual([{ question: { bank: 'bank-1', question: 'q1' }, section: 0 }])
    const proposal = await inspectImportRecord(new TextEncoder().encode(JSON.stringify(carried)))
    expect(proposal.banks[0]!.record.bank.questions[0]).toMatchObject({
      type: 'multipart',
      parts: [{
        id: 'q1-s1',
        subparts: [
          { id: 'q1-s1-s1', type: 'multiple-choice', choices: [{ correct: true }, { correct: false }] },
          { id: 'q1-s1-s2', type: 'short-answer' },
        ],
      }],
    })
  })

  test('carries Points in its bank record, on a question and on a Part, and imports them again', async () => {
    const pond: Question = {
      id: 'pond-1',
      type: 'multipart',
      columns: 2,
      doc: {
        type: 'doc',
        content: [paragraph('A pond freezes over in winter.'), {
          type: 'multipartParts',
          content: [{
            type: 'multipartPart',
            attrs: { id: 'pond-1-a', columns: 2, points: 2 },
            content: [
              { type: 'multipartPartStem', content: [paragraph('Why does ice float?')] },
              { type: 'suggestedAnswer', content: [paragraph('It is less dense than water.')] },
            ],
          }],
        }],
      },
    }
    const sheet: Exam = {
      title: 'Ponds',
      questions: [{ ...multipleChoice('frog-1', 'What does a tadpole become?', ['A frog', 'A fish']), points: 1 }, pond],
    }
    const order: Arrangement = { id: 'exam-draft', letter: 'A', questionOrder: ['frog-1', 'pond-1'], choiceOrder: {} }
    const carried = (await examPackage({ exam: sheet, arrangement: order, ownerOf: async () => null, loadMedia: noImages })).package
    const proposal = await inspectImportRecord(new TextEncoder().encode(JSON.stringify(carried)))
    const [frog, carriedPond] = proposal.banks[0]!.record.bank.questions
    expect(frog!.points).toBe(1)
    expect(carriedPond).not.toHaveProperty('points')
    expect(carriedPond!.parts![0]).toMatchObject({ points: 2 })
    expect(importedQuestionsFromRecord(proposal.banks[0]!.record).map(pointsOfQuestion)).toEqual([1, 2])
  })

  test('carries a derived Exam’s legacy section wording on its Sections, with heading size and header lines, and imports them again', async () => {
    const worded: Exam = {
      ...exam,
      sectionHeadings: {
        open: { title: 'Essays', instructions: '' },
        matching: { title: 'Vocabulary' },
      },
      headingSize: 'small',
      header: { first: 'Student: ____  Period: __', later: '' },
      textSize: 'large',
      margins: { top: 1, right: 0.6, bottom: 1, left: 1.25 },
    }
    const carried = (await examPackage({ exam: worded, arrangement, ownerOf, loadMedia: noImages })).package
    // Each derived Section travels with its wording in full, and no type.
    expect(carried.exams[0]).toMatchObject({
      formatVersion: '0.5.0',
      sections: [
        { title: 'Multiple Choice', instructions: 'Identify the choice that best completes the statement or answers the question.' },
        { title: 'Vocabulary', instructions: 'Match each item with the correct answer from the word bank. Write its letter in the blank.' },
        { title: 'Essays', instructions: '' },
      ],
      headingSize: 'small',
      header: { first: 'Student: ____  Period: __', later: '' },
      textSize: 'large',
      margins: { top: 1, right: 0.6, bottom: 1, left: 1.25 },
    })
    expect(carried.exams[0]).not.toHaveProperty('sectionHeadings')

    const proposal = await inspectImportRecord(new TextEncoder().encode(JSON.stringify(carried)))
    let next = 0
    const plan = planImport(proposal, initialSelection(proposal), () => `local-${next++}`)
    const { exam: imported, arrangement: importedOrder } = selectedExam(
      plan.exams[0]!.saved.questionBank,
      plan.exams[0]!.saved.workingCopy,
    )
    expect(withoutIds(sectionsOf(imported))).toEqual(withoutIds(sectionsOf(worded)))
    expect(printed(imported, importedOrder)).toEqual(printed(worded, arrangement))
    expect(imported.headingSize).toBe('small')
    expect(imported.header).toEqual(worded.header)
    expect(imported.textSize).toBe('large')
    expect(imported.margins).toEqual(worded.margins)
  })

  test('an Exam that keeps the default headings writes their wording out in full, and no sizes', async () => {
    const carried = (await examPackage({ exam, arrangement, ownerOf, loadMedia: noImages })).package
    expect(carried.exams[0]!.sections).toEqual([
      { title: 'Multiple Choice', instructions: 'Identify the choice that best completes the statement or answers the question.' },
      { title: 'Matching', instructions: 'Match each item with the correct answer from the word bank. Write its letter in the blank.' },
      { title: 'Short Answer', instructions: 'Answer the following questions in the space provided. Show all work.' },
    ])
    expect(carried.exams[0]).not.toHaveProperty('sectionHeadings')
    expect(carried.exams[0]).not.toHaveProperty('headingSize')
    expect(carried.exams[0]).not.toHaveProperty('header')
    expect(carried.exams[0]).not.toHaveProperty('textSize')
  })
})

const withoutIds = (sections: readonly ExamSection[]) =>
  sections.map(({ title, instructions }) => ({ title, instructions }))

describe('an Exam’s stored Sections in its package', () => {
  // A Section holding Questions of two types, a Short Answer Section whose
  // directions are cleared, a Section whose heading is cleared, and an
  // emptied Section that is kept but prints nothing.
  const sheet: Exam = {
    ...exam,
    sections: [
      { id: 'warm-up', title: 'Warm-up', instructions: 'Answer each question.' },
      { id: 'written', title: 'Written', instructions: '' },
      { id: 'challenge', title: '', instructions: 'Show your reasoning.' },
      { id: 'empty', title: 'Extra Credit', instructions: 'Optional.' },
    ],
    sectionOf: {
      'forces-2': 'warm-up',
      'cells-2': 'warm-up',
      'forces-1': 'written',
      'cells-1': 'challenge',
    },
  }

  test('travel in print order, empty ones included, each position naming its Section', async () => {
    const carried = (await examPackage({ exam: sheet, arrangement, ownerOf, loadMedia: noImages })).package
    const record = carried.exams[0]!
    expect(record.formatVersion).toBe('0.5.0')
    // An Exam that keeps today's margins writes none.
    expect(record).not.toHaveProperty('margins')
    expect(record.sections).toEqual([
      { title: 'Warm-up', instructions: 'Answer each question.' },
      { title: 'Written', instructions: '' },
      { title: '', instructions: 'Show your reasoning.' },
      { title: 'Extra Credit', instructions: 'Optional.' },
    ])
    // The Warm-up Section holds a Multiple Choice and a Matching Question.
    expect(record.positions.map(({ section }) => section)).toEqual([0, 0, 1, 2])
  })

  test('import again as the same Sections under fresh ids, printing the same sheet', async () => {
    const carried = (await examPackage({ exam: sheet, arrangement, ownerOf, loadMedia: noImages })).package
    const proposal = await inspectImportRecord(new TextEncoder().encode(JSON.stringify(carried)))
    let next = 0
    const plan = planImport(proposal, initialSelection(proposal), () => `local-${next++}`)
    const { exam: imported, arrangement: importedOrder } = selectedExam(
      plan.exams[0]!.saved.questionBank,
      plan.exams[0]!.saved.workingCopy,
    )
    expect(withoutIds(sectionsOf(imported))).toEqual(withoutIds(sectionsOf(sheet)))
    expect(sectionsOf(imported).map(({ id }) => id)).not.toContain('warm-up')
    expect(printed(imported, importedOrder)).toEqual(printed(sheet, arrangement))
    expect(
      sectionsOf(imported).map((section) => questionsInSection(imported, importedOrder, section.id).map(text)),
    ).toEqual(
      sectionsOf(sheet).map((section) => questionsInSection(sheet, arrangement, section.id).map(text)),
    )
  })
})

// Exam Picture Sizes (ADR-0050) travel in Exam Record 0.5.0, each naming its
// picture by its place among the Question's block pictures.
describe('an Exam’s picture sizes in its package', () => {
  const pixels = async () => ({ data: PIXEL_PNG.data, mimeType: 'image/png' as const, width: 1, height: 1 })
  const source = `/local-images/${'b'.repeat(64)}`
  const whole = { src: source, size: 0.3 }
  const cropped = { src: source, crop: { left: 0, top: 0, right: 0.5, bottom: 1, width: 1, height: 1 } }
  const diagram: Question = {
    id: 'pictured',
    type: 'open',
    columns: 1,
    doc: {
      type: 'doc',
      content: [
        paragraph('Which way does the current flow?'),
        { type: 'image-block', attrs: whole },
        { type: 'image-block', attrs: cropped },
      ],
    },
  }
  const sized: Exam = {
    title: 'Circuits',
    questions: [diagram],
    pictureSizes: { pictured: { [pictureKey(whole)]: 0.45, [pictureKey(cropped)]: 1 } },
  }
  const order: Arrangement = { id: 'pictures', letter: 'A', questionOrder: ['pictured'], choiceOrder: {} }
  const written = () => examPackage({ exam: sized, arrangement: order, ownerOf: async () => null, loadMedia: pixels })
  const imported = async (edit: (record: ExamRecord) => void = () => {}) => {
    const carried = await written()
    edit(carried.package.exams[0]! as ExamRecord)
    const zip = await writePackageZip(JSON.stringify(carried.package), carried.files)
    return inspectImportRecord(zip)
  }

  test('each picture the Exam sized travels by its place among the Question’s block pictures', async () => {
    const record = (await written()).package.exams[0]!
    expect(record.formatVersion).toBe('0.5.0')
    expect(record.positions[0]!.pictureSizes).toEqual([{ picture: 1, size: 0.45 }, { picture: 2, size: 1 }])
  })

  test('import gives each size back to the same picture, on the Exam alone', async () => {
    const proposal = await imported()
    const { questionBank, workingCopy } = planImport(proposal, initialSelection(proposal)).exams[0]!.saved
    const question = questionBank.questions[0]!
    const keys = blockPictureKeysOf(question)
    expect(keys).toHaveLength(2)
    expect(workingCopy.pictureSizes).toEqual({ [question.id]: { [keys[0]!]: 0.45, [keys[1]!]: 1 } })
    // The Question keeps its own size.
    const images = (question.doc.content as ProseMirrorJSON[]).filter((node) => node.type === 'image-block')
    expect((images[0]!.attrs as { size?: number }).size).toBe(0.3)
  })

  test('an Exam that sized nothing writes nothing', async () => {
    const plain = await examPackage({ exam: { ...sized, pictureSizes: undefined }, arrangement: order, ownerOf: async () => null, loadMedia: pixels })
    expect(plain.package.exams[0]!.positions[0]).not.toHaveProperty('pictureSizes')
  })

  test('a size naming a picture the Question does not have is refused, naming the Exam and position', async () => {
    await expect(imported((record) => {
      record.positions[0]!.pictureSizes = [{ picture: 3, size: 0.5 }]
    })).rejects.toThrow('Exam “Circuits” position 1 sizes picture 3, but Question “q1” has 2 block pictures.')
  })

  test('a size outside 0.05 to 1 of its container is refused', async () => {
    await expect(imported((record) => {
      record.positions[0]!.pictureSizes = [{ picture: 1, size: 1.5 }]
    })).rejects.toThrow()
    await expect(imported((record) => {
      record.positions[0]!.pictureSizes = [{ picture: 1, size: 0.5 }, { picture: 1, size: 0.6 }]
    })).rejects.toThrow('sizes picture 1 more than once')
  })

  test('a 0.4.0 record, which has no picture sizes, still imports', async () => {
    const proposal = await imported((record) => {
      record.formatVersion = '0.4.0'
      delete record.positions[0]!.pictureSizes
    })
    expect(proposal.exams[0]!.formatVersion).toBe('0.4.0')
    expect(planImport(proposal, initialSelection(proposal)).exams[0]!.saved.workingCopy).not.toHaveProperty('pictureSizes')
  })
})
