// Exam Picture Size (ADR-0050): how wide one Exam prints a picture, set on
// the sheet and never changing the Question.

import { describe, expect, test } from 'bun:test'
import { DEFAULT_COLUMNS, type Question } from './exam'
import { createMemoryBackend, loadExamStore, type AuthoringState, type SavedState } from './exam-store'
import { buildExportDocument } from './export-plan'
import { pictureKey, withPictureSizes } from './picture-geometry'
import type { ProseMirrorJSON } from './question-doc'

const picture = (src: string, attrs: Record<string, unknown> = {}): ProseMirrorJSON => ({
  type: 'image-block',
  attrs: { src, caption: '', ...attrs },
})
const crop = { left: 0, top: 0, right: 0.5, bottom: 1, width: 100, height: 50 }

function question(...blocks: ProseMirrorJSON[]): Question {
  return { id: 'q', type: 'open', columns: DEFAULT_COLUMNS, doc: { type: 'doc', content: blocks } }
}

const sizesIn = (blocks: readonly ProseMirrorJSON[]): unknown[] =>
  blocks.flatMap((block) => (block.type === 'image-block' ? [(block.attrs as { size?: unknown }).size] : []))

describe('an Exam’s own picture sizes', () => {
  test('take the place of the Question’s, picture by picture, leaving the Question as it was', () => {
    const doc = question(picture('a.png', { size: 0.8 }), picture('b.png'), picture('a.png', { crop })).doc
    const sized = withPictureSizes(doc, { 'a.png': 0.3, [pictureKey({ src: 'a.png', crop })]: 0.5 })
    expect(sizesIn(sized.content as ProseMirrorJSON[])).toEqual([0.3, undefined, 0.5])
    expect(sizesIn(doc.content as ProseMirrorJSON[])).toEqual([0.8, undefined, undefined])
  })

  test('print on this Exam’s test and Answer Key', () => {
    const exam = {
      title: 'T',
      questions: [question(picture('a.png', { size: 0.8 }))],
      pictureSizes: { q: { 'a.png': 0.4 } },
    }
    const document = buildExportDocument(exam, { id: 'v', letter: 'A', questionOrder: ['q'], choiceOrder: {} }, { test: true, answerKey: true })
    const planned = document.test.flatMap((item) => (item.kind === 'question' ? [item.question] : []))
    expect(sizesIn(planned[0]!.stem)).toEqual([0.4])
  })
})

describe('sizing a picture on the sheet', () => {
  async function storeWith(owned: Question) {
    const store = await loadExamStore(
      createMemoryBackend<AuthoringState>(null),
      createMemoryBackend<SavedState>(),
    )
    store.createInQuestionBank(owned)
    store.addToWorkingCopy(owned)
    await store.whenSettled()
    return store
  }

  test('is the Exam’s, one undoable step, and leaves the Question alone', async () => {
    const owned = question(picture('a.png', { size: 0.8 }))
    const store = await storeWith(owned)
    store.setPictureSize('q', 'a.png', 0.333)
    expect(store.getState().workingCopy.pictureSizes).toEqual({ q: { 'a.png': 0.33 } })
    expect(store.selectedExam().exam.questions[0]!.doc).toEqual(owned.doc)
    store.undo()
    expect(store.getState().workingCopy.pictureSizes).toBeUndefined()
  })

  test('Reset size goes back to the picture’s own', async () => {
    const store = await storeWith(question(picture('a.png')))
    store.setPictureSize('q', 'a.png', 0.5)
    store.setPictureSize('q', 'a.png', null)
    expect(store.getState().workingCopy.pictureSizes).toBeUndefined()
  })

  test('Duplicate keeps the sizes, and Remove forgets them', async () => {
    const store = await storeWith(question(picture('a.png')))
    store.setPictureSize('q', 'a.png', 0.5)
    store.duplicateInWorkingCopy('q')
    const { workingCopy } = store.getState()
    const copy = workingCopy.questionIds.find((id) => id !== 'q')!
    expect(workingCopy.pictureSizes?.[copy]).toEqual({ 'a.png': 0.5 })
    store.removeFromWorkingCopy(['q'])
    expect(store.getState().workingCopy.pictureSizes?.q).toBeUndefined()
  })
})
