// Deleting an Exam (ADR-0047) takes its Working Copy, saved state and Export
// History with it, forgets everything remembered about it by id, and leaves
// its Questions where they live. Media only it held is collected; media
// anything else still references stays.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createQuestion } from './exam'
import { examDatabaseName, createExamWorkspaceService } from './exam-workspaces'
import { examDeletionMessage } from './exam-deletion'
import type { ExportRecord } from './export-preparation'
import { createQuestionBankWorkspaceService } from './question-bank-workspaces'
import {
  EDITOR_WORKSPACE_STORE,
  EXAM_WORKSPACE_STORE,
  MEDIA_ASSET_STORE,
  QUESTION_BANK_WORKSPACE_STORE,
  STORAGE_NAME,
} from './storage-schema'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const hash = (digit: string) => digit.repeat(64)

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function read(store: string, key: string): Promise<unknown> {
  const database = await open(STORAGE_NAME)
  try {
    return await new Promise((resolve) => {
      const request = database.transaction(store, 'readonly').objectStore(store).get(key)
      request.onsuccess = () => resolve(request.result)
    })
  } finally {
    database.close()
  }
}

async function storedMedia(): Promise<string[]> {
  const database = await open(STORAGE_NAME)
  try {
    return await new Promise((resolve) => {
      const request = database.transaction(MEDIA_ASSET_STORE, 'readonly').objectStore(MEDIA_ASSET_STORE).getAllKeys()
      request.onsuccess = () => resolve(request.result.map(String).sort())
    })
  } finally {
    database.close()
  }
}

async function storeMedia(...hashes: string[]) {
  const database = await open(STORAGE_NAME)
  try {
    const transaction = database.transaction(MEDIA_ASSET_STORE, 'readwrite')
    for (const value of hashes) {
      transaction.objectStore(MEDIA_ASSET_STORE).put({ hash: value, mimeType: 'image/png', bytes: new ArrayBuffer(1), width: 1, height: 1 })
    }
    await new Promise((resolve) => { transaction.oncomplete = resolve })
  } finally {
    database.close()
  }
}

async function databaseNames(): Promise<string[]> {
  return (await indexedDB.databases()).flatMap(({ name }) => (name ? [name] : []))
}

/** An Export Record whose one page prints one picture. */
function exportRecord(examId: string, id: string, media: string): ExportRecord {
  return {
    id,
    examId,
    capturedName: 'Biology Unit 3',
    createdAt: `2026-10-0${id.length}T00:00:00.000Z`,
    format: 'pdf',
    selection: { studentTest: true, answerKey: false },
    questionCount: 1,
    plans: [{
      pageSize: { width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 }, contentWidth: 468 },
      pages: [{ items: [{ kind: 'picture', src: `/local-images/${media}` }] }],
    }],
    mediaHashes: [media],
  } as never
}

async function namedExam(exams: ReturnType<typeof createExamWorkspaceService>, title: string) {
  const exam = await exams.create()
  const backend = exams.backendFor(exam.id)
  const working = (await backend.read())!
  await backend.commitSaved({ questionBank: working.questionBank, workingCopy: { ...working.workingCopy, title } })
  return exam
}

describe('deleting an Exam', () => {
  test('removes it, its Working Copy and its whole Export History, and nothing of any other Exam', async () => {
    const exams = createExamWorkspaceService()
    await storeMedia(hash('a'))
    const biology = await namedExam(exams, 'Biology Unit 3')
    const chemistry = await namedExam(exams, 'Chemistry')
    await exams.backendFor(biology.id).commitExportRecord(exportRecord(biology.id, 'one', hash('a')))
    await exams.backendFor(biology.id).commitExportRecord(exportRecord(biology.id, 'two', hash('a')))
    await exams.backendFor(chemistry.id).commitExportRecord(exportRecord(chemistry.id, 'three', hash('a')))

    expect(await exams.deletionSummary(biology.id)).toEqual({ examId: biology.id, title: 'Biology Unit 3', exportCount: 2 })
    expect(await exams.deleteExam(biology.id)).toBe(true)

    expect(await exams.exists(biology.id)).toBe(false)
    expect((await exams.recent()).map(({ id }) => id)).toEqual([chemistry.id])
    expect(await databaseNames()).not.toContain(examDatabaseName(biology.id))
    expect(await exams.deletionSummary(biology.id)).toBeNull()
    expect((await exams.backendFor(chemistry.id).readExportHistory()).records.map(({ id }) => id)).toEqual(['three'])
  })

  test('leaves the Questions it used in their Question Bank', async () => {
    const exams = createExamWorkspaceService()
    const banks = createQuestionBankWorkspaceService()
    const bank = await banks.create()
    const question = createQuestion('true-false')
    await banks.commit(bank.id, { kind: 'create-question', question }, false)
    const exam = await exams.create(question)

    await exams.deleteExam(exam.id)

    expect((await banks.read(bank.id))!.questions.map(({ id }) => id)).toEqual([question.id])
  })

  test('forgets it as the Exam to reopen and the Question Bank tabs kept for it', async () => {
    const exams = createExamWorkspaceService()
    const banks = createQuestionBankWorkspaceService()
    const bank = await banks.create()
    const other = await namedExam(exams, 'Other')
    await banks.openTab({ examId: other.id }, bank.id)
    const exam = await namedExam(exams, 'Biology Unit 3')
    await banks.openTab({ examId: exam.id }, bank.id)
    expect(await exams.activeId()).toBe(exam.id)
    expect(await banks.activeEditor()).toMatchObject({ resourceId: exam.id })

    await exams.deleteExam(exam.id)

    expect(await exams.activeId()).toBeNull()
    expect(await banks.activeEditor()).toBeNull()
    expect(await read(EXAM_WORKSPACE_STORE, 'active')).toBeUndefined()
    expect(await read(EDITOR_WORKSPACE_STORE, 'active')).toBeUndefined()
    expect(await read(QUESTION_BANK_WORKSPACE_STORE, `exam:${exam.id}`)).toBeUndefined()
    expect(await read(QUESTION_BANK_WORKSPACE_STORE, `exam:${other.id}`)).toBeDefined()
  })

  test('keeps the Exam to reopen when it is a different one', async () => {
    const exams = createExamWorkspaceService()
    const banks = createQuestionBankWorkspaceService()
    const exam = await namedExam(exams, 'Biology Unit 3')
    const other = await namedExam(exams, 'Other')

    await exams.deleteExam(exam.id)

    expect(await exams.activeId()).toBe(other.id)
    expect(await banks.activeEditor()).toMatchObject({ resourceId: other.id })
  })

  test('collects media only it referenced, and keeps media anything else still uses', async () => {
    const exams = createExamWorkspaceService()
    const banks = createQuestionBankWorkspaceService()
    await storeMedia(hash('a'), hash('b'), hash('c'))
    const bank = await banks.create()
    const question = createQuestion('true-false')
    question.doc = {
      ...question.doc,
      content: [{ type: 'image-block', attrs: { src: `/local-images/${hash('b')}` } }, ...(question.doc.content as never[])],
    }
    await banks.commit(bank.id, { kind: 'create-question', question }, false)
    const exam = await namedExam(exams, 'Biology Unit 3')
    const other = await namedExam(exams, 'Other')
    await exams.backendFor(exam.id).commitExportRecord(exportRecord(exam.id, 'one', hash('a')))
    await exams.backendFor(exam.id).commitExportRecord(exportRecord(exam.id, 'two', hash('b')))
    await exams.backendFor(exam.id).commitExportRecord(exportRecord(exam.id, 'three', hash('c')))
    await exams.backendFor(other.id).commitExportRecord(exportRecord(other.id, 'four', hash('c')))

    await exams.deleteExam(exam.id)

    expect(await storedMedia()).toEqual([hash('b'), hash('c')])
  })

  test('closes an open connection to its database rather than waiting on it', async () => {
    const exams = createExamWorkspaceService()
    const exam = await namedExam(exams, 'Biology Unit 3')
    // The editor holds this backend open while the Exam is shown.
    const editing = exams.backendFor(exam.id)
    await editing.read()

    await exams.deleteExam(exam.id)

    expect(await databaseNames()).not.toContain(examDatabaseName(exam.id))
  })

  test('of an Exam that is no longer there deletes nothing and recreates nothing', async () => {
    const exams = createExamWorkspaceService()
    expect(await exams.deleteExam('missing')).toBe(false)
    expect(await exams.removePristine('missing')).toBe(false)
    expect(await databaseNames()).not.toContain(examDatabaseName('missing'))
  })
})

describe('the confirmation', () => {
  test('names the Exam and how many exports go with it', () => {
    expect(examDeletionMessage({ title: 'Biology Unit 3', exportCount: 4 })).toEqual({
      title: 'Delete “Biology Unit 3”?',
      body: 'This also deletes its 4 exports. Files you’ve already downloaded aren’t affected. This can’t be undone.',
    })
    expect(examDeletionMessage({ title: 'Quiz', exportCount: 1 }).body).toBe(
      'This also deletes its 1 export. Files you’ve already downloaded aren’t affected. This can’t be undone.',
    )
    expect(examDeletionMessage({ title: 'Quiz', exportCount: 0 }).body).toBe('This can’t be undone.')
  })
})
