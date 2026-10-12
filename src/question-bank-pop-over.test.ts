// The Question Bank Pop-over's tabs are remembered on their own: they belong to
// no Exam, opening one never changes which Exam the editor restores, and a
// deleted bank leaves them as it leaves every Exam's (ADR-0030).

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, expect, test } from 'bun:test'
import { createExamWorkspaceService } from './exam-workspaces'
import {
  createQuestionBankWorkspaceService,
  openBankTab,
  updateBankTabFilter,
} from './question-bank-workspaces'
import { NO_FILTER } from './question-bank-view'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

test('the Pop-over keeps its own tabs and filters, apart from any Exam and without touching the editor', async () => {
  const banks = createQuestionBankWorkspaceService()
  const exams = createExamWorkspaceService()
  const exam = await exams.create()
  const biology = await banks.create()
  const chemistry = await banks.create()
  await banks.openTab({ examId: exam.id }, chemistry.id)
  const editorBefore = await banks.activeEditor()

  let popOver = openBankTab(await banks.popOverWorkspace(), biology.id)
  popOver = updateBankTabFilter(popOver, biology.id, { ...NO_FILTER, search: 'cell' })
  await banks.savePopOverWorkspace(popOver)

  const reopened = await createQuestionBankWorkspaceService().popOverWorkspace()
  expect(reopened.openBankIds).toEqual([biology.id])
  expect(reopened.activeBankId).toBe(biology.id)
  expect(reopened.filters[biology.id]?.search).toBe('cell')
  expect((await banks.workspace({ examId: exam.id })).openBankIds).toEqual([chemistry.id])
  expect(await banks.activeEditor()).toEqual(editorBefore)
})

test('deleting a bank closes its Pop-over tab', async () => {
  const banks = createQuestionBankWorkspaceService()
  const exams = createExamWorkspaceService()
  const kept = await banks.create()
  const doomed = await banks.create()
  await banks.savePopOverWorkspace(openBankTab(openBankTab(await banks.popOverWorkspace(), kept.id), doomed.id))

  await banks.permanentlyDeleteBank(doomed.id, (ids) => exams.forceDeleteQuestions(ids))

  const popOver = await banks.popOverWorkspace()
  expect(popOver.openBankIds).toEqual([kept.id])
  expect(popOver.activeBankId).toBe(kept.id)
})
