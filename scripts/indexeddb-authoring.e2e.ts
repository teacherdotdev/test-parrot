// The fresh Export History storage generation, exercised in a real browser.
//
// These tests deliberately cross the public application boundary. IndexedDB
// is Chromium's implementation, and the assertions observe the Question Bank
// and Working Copy the same way a teacher does after startup and reload.

import { expect, test } from '@playwright/test'
import { createQuestion } from '../src/exam'
import type { AuthoringState } from '../src/exam-store'

const legacyAuthoringState = (): AuthoringState => {
  const question = createQuestion('multiple-choice')
  question.doc.content = [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Written in the previous generation' }],
    },
  ]
  return {
    questionBank: { questions: [question] },
    workingCopy: { title: 'Previous exam', questionIds: [question.id] },
    dirty: true,
  }
}

test('the fresh generation ignores earlier browser authoring data', async ({
  page,
}) => {
  const legacy = legacyAuthoringState()
  await page.addInitScript((state: AuthoringState) => {
    localStorage.setItem('exam-authoring-v2', JSON.stringify(state))
    const oldDatabase = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('exam-saved-v2', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('state')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('state', 'readwrite')
        transaction
          .objectStore('state')
          .put(
            { questionBank: state.questionBank, workingCopy: state.workingCopy },
            'saved',
          )
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
    })
    const oldCache = caches
      .open('crepe-local-images-v1')
      .then((cache) =>
        cache.put('/local-images/legacy', new Response('legacy image bytes')),
      )
    ;(window as unknown as { legacySetup: Promise<unknown> }).legacySetup =
      Promise.all([oldDatabase, oldCache])
  }, legacy)

  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  await page.getByRole('textbox', { name: 'Exam name' }).waitFor()
  await page.evaluate(
    () => (window as unknown as { legacySetup: Promise<unknown> }).legacySetup,
  )

  await expect(
    page.getByRole('region', { name: 'Question Bank' }).getByRole('listitem'),
  ).toHaveCount(0)
  await expect(page.locator('.exam-question')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Exam name' })).toHaveValue(
    'Untitled Exam',
  )
  expect(
    await page.evaluate(() => localStorage.getItem('exam-authoring-v2')),
  ).toBe(JSON.stringify(legacy))
  expect(await page.evaluate(() => caches.has('crepe-local-images-v1'))).toBe(
    true,
  )
  expect(
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('exam-saved-v2')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        return await new Promise<boolean>((resolve, reject) => {
          const request = database
            .transaction('state')
            .objectStore('state')
            .get('saved')
          request.onsuccess = () =>
            resolve(request.result.workingCopy.title === 'Previous exam')
          request.onerror = () => reject(request.error)
        })
      } finally {
        database.close()
      }
    }),
  ).toBe(true)
})

test('failed normalized write and Save transactions expose no partial state', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  await page.getByRole('textbox', { name: 'Exam name' }).waitFor()
  const baseline = legacyAuthoringState()
  baseline.workingCopy.title = 'Last complete write'

  const restored = await page.evaluate(async (state: AuthoringState) => {
    const modulePath = '/src/indexeddb-authoring.ts'
    const { createIndexedDBAuthoringBackend } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../src/indexeddb-authoring')
    const backend = createIndexedDBAuthoringBackend('transaction-abort-test')
    await backend.write(state)

    const broken = structuredClone(state) as AuthoringState & {
      workingCopy: AuthoringState['workingCopy'] & { cannotClone?: () => void }
    }
    broken.questionBank.questions = []
    broken.workingCopy.cannotClone = () => undefined
    try {
      await backend.write(broken)
    } catch {
      // A DataCloneError is the failure under test. Read through the same
      // public adapter to observe what the aborted transaction exposed.
    }
    const afterWriteFailure = await backend.read()

    const brokenSave = structuredClone(state) as AuthoringState & {
      workingCopy: AuthoringState['workingCopy'] & { cannotClone?: () => void }
    }
    brokenSave.questionBank.questions = []
    brokenSave.workingCopy.cannotClone = () => undefined
    try {
      await backend.commitSaved(brokenSave)
    } catch {
      // Saving crosses the working and explicit-saved stores. Its abort must
      // leave both at their state before the attempted transaction.
    }
    return {
      afterWriteFailure,
      afterSaveFailure: await backend.read(),
      saved: await backend.readSaved(),
    }
  }, baseline)

  expect(restored.afterWriteFailure).toEqual(baseline)
  expect(restored.afterSaveFailure).toEqual(baseline)
  expect(restored.saved).toBeNull()
})

test('Question Metadata and bank-only content survive a user-visible reload', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  await page.getByRole('button', { name: 'Add Question', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Multiple choice' }).click()
  const dialog = page.getByRole('dialog', { name: 'Question editor' })
  await dialog.waitFor()
  await page.keyboard.type('Which gas do plants take in?')
  await dialog.getByRole('button', { name: 'Difficulty', exact: true }).click()
  await page.getByRole('button', { name: 'Hard', exact: true }).click()
  await dialog.getByRole('button', { name: 'Topics', exact: true }).click()
  const topic = dialog.getByRole('textbox', { name: 'Filter Topics' })
  await topic.fill('Photosynthesis')
  await topic.press('Enter')
  await page.getByRole('button', { name: 'Save question' }).click()
  await expect(page.locator('.exam-question')).toHaveCount(0)

  await page.reload()

  const row = page
    .getByRole('region', { name: 'Question Bank' })
    .getByRole('listitem')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Which gas do plants take in?')
  await expect(row).toContainText('Hard')
  await expect(row).toContainText('Photosynthesis')
  await expect(page.locator('.exam-question')).toHaveCount(0)
})

test('publication aborts every store when a required Media Asset is absent', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  // A first visit registers the image service worker, which may reload once
  // before it takes control. Wait for application startup rather than running
  // the IndexedDB probe in the navigation that registration replaces.
  await page.getByRole('textbox', { name: 'Exam name' }).waitFor()
  const result = await page.evaluate(async () => {
    const authoringPath = '/src/indexeddb-authoring.ts'
    const preparationPath = '/src/export-preparation.ts'
    const selectedPath = '/src/selected-exam.ts'
    const planPath = '/src/export-plan.ts'
    const { createIndexedDBAuthoringBackend } = (await import(
      /* @vite-ignore */ authoringPath
    )) as typeof import('../src/indexeddb-authoring')
    const { prepareExport, EMPTY_EXPORT_HISTORY } = (await import(
      /* @vite-ignore */ preparationPath
    )) as typeof import('../src/export-preparation')
    const { selectedExam } = (await import(
      /* @vite-ignore */ selectedPath
    )) as typeof import('../src/selected-exam')
    const { unmeasured } = (await import(
      /* @vite-ignore */ planPath
    )) as typeof import('../src/export-plan')

    const question = {
      id: 'q1',
      type: 'open' as const,
      columns: 2 as const,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Complete me' }],
          },
        ],
      },
    }
    const state: AuthoringState = {
      questionBank: { questions: [question] },
      workingCopy: { title: 'Atomic publication', questionIds: ['q1'] },
      dirty: true,
    }
    const prepared = prepareExport({
      examId: 'exam-1',
      ...selectedExam(state.questionBank, state.workingCopy),
      configuration: { format: 'pdf', selection: { test: true, answerKey: true } },
      history: EMPTY_EXPORT_HISTORY,
      measure: unmeasured,
      createdAt: '2026-09-04T12:00:00.000Z',
    })
    prepared.record.mediaHashes = ['f'.repeat(64)]
    const backend = createIndexedDBAuthoringBackend(
      'publication-media-abort-test',
    )
    let failed = false
    try {
      await backend.commitExportRecord(prepared.record)
    } catch {
      failed = true
    }
    return {
      failed,
      working: await backend.read(),
      saved: await backend.readSaved(),
      history: await backend.readExportHistory(),
    }
  })

  expect(result.failed).toBe(true)
  expect(result.working).toBeNull()
  expect(result.saved).toBeNull()
  expect(result.history).toEqual({ records: [] })
})
