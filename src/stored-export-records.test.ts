// An Export Record is kept exactly as it was made (ADR-0014), and one made
// before Sections were stored (ADR-0029) has to read, preview and reprint in
// this version: its questions say whether they printed an answer blank, and its
// Section headings and key groupings name a Question Type rather than a
// Section. What is asserted here is that such a record reads back whole, and
// reprints the blank it printed.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, expect, test } from 'bun:test'
import { createExamDocx } from './docx-export'
import { createExamPdf, type PdfFontLoader } from './pdf-export'
import { FIXTURES } from './export-fixtures'
import { layoutFingerprint } from './export-fingerprint'
import { LEGACY_ANSWER_BLANK, planExport, questionIndentOf, type LayoutPlan } from './export-plan'
import { createIndexedDBAuthoringBackend } from './indexeddb-authoring'
import type { ExportRecord } from './export-preparation'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const fontFile = (name: string) => new URL(`../public/fonts/${name}`, import.meta.url).pathname
const fonts: PdfFontLoader = async (style) => Bun.file(fontFile({
  regular: 'FreeSerif.ttf',
  bold: 'FreeSerifBold.ttf',
  italic: 'FreeSerifItalic.ttf',
  boldItalic: 'FreeSerifBoldItalic.ttf',
  mono: 'FreeMono.ttf',
}[style])).arrayBuffer()

/** A plan in the shape this version's predecessor stored: an `answerBlank`
 *  flag where `marks` now is, and a Question Type where `sectionId` now is. */
function asStoredBefore(plan: LayoutPlan): LayoutPlan {
  return {
    ...plan,
    pages: plan.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => {
        if (item.kind === 'question') {
          const question: Record<string, unknown> = { ...item.question }
          delete question.marks
          const answerBlank = question.type === 'multiple-choice' || question.type === 'true-false'
          return { ...item, question: { ...question, answerBlank } } as never
        }
        if (item.kind === 'section-heading' || item.kind === 'answer-key-section') {
          const rest: Record<string, unknown> = { ...item }
          delete rest.sectionId
          return { ...rest, section: 'multiple-choice' } as never
        }
        return item
      }),
    })),
  }
}

test('an Export Record made before Sections were stored reads back whole and reprints its answer blanks', async () => {
  const fixture = FIXTURES.find(({ name }) => name === 'reworded, cleared and large section headings')!
  const plan = planExport({
    exam: fixture.exam,
    arrangement: fixture.arrangement,
    selection: { test: true, answerKey: true },
    measure: fixture.measure,
  })
  const stored = asStoredBefore(plan)
  const record: ExportRecord = {
    id: 'record-1',
    examId: 'exam-1',
    capturedName: fixture.exam.title,
    createdAt: '2026-01-01T00:00:00.000Z',
    format: 'pdf',
    selection: { test: true, answerKey: true },
    questionCount: fixture.exam.questions.length,
    plans: [stored],
    mediaHashes: [],
  }
  const backend = createIndexedDBAuthoringBackend('legacy-exam')
  await backend.commitExportRecord(record)

  const [read] = (await backend.readExportHistory()).records
  expect(read?.id).toBe('record-1')
  const [readPlan] = read!.plans
  const questions = readPlan!.pages.flatMap((page) => page.items).flatMap((item) => (item.kind === 'question' ? [item.question] : []))
  expect(questions.length).toBeGreaterThan(0)
  for (const question of questions) {
    const blank = question.type === 'multiple-choice' || question.type === 'true-false'
    expect(question.marks).toEqual(blank ? [LEGACY_ANSWER_BLANK] : [])
    // The number column it printed in, not today's narrower one.
    if (blank) expect(questionIndentOf(question)).toBe(98)
    expect('answerBlank' in question).toBe(false)
  }
  const sectioned = readPlan!.pages.flatMap((page) => page.items)
    .filter((item) => item.kind === 'section-heading' || item.kind === 'answer-key-section')
  expect(sectioned.length).toBeGreaterThan(0)
  for (const item of sectioned) expect(item).toMatchObject({ sectionId: 'multiple-choice' })

  // What is stored is never rewritten.
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('legacy-exam')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const raw = await new Promise<ExportRecord>((resolve, reject) => {
    const store = [...database.objectStoreNames].find((name) => name.includes('export'))!
    const request = database.transaction(store).objectStore(store).get('record-1')
    request.onsuccess = () => resolve(request.result as ExportRecord)
    request.onerror = () => reject(request.error)
  })
  database.close()
  expect(raw.plans).toEqual([stored])

  // And it reprints: both adapters, and the fingerprint export parity reads.
  expect((await createExamDocx(read!.plans, async () => null)).size).toBeGreaterThan(0)
  expect((await createExamPdf(read!.plans, async () => null, fonts)).length).toBeGreaterThan(0)
  expect(() => layoutFingerprint(read!.plans)).not.toThrow()
})
