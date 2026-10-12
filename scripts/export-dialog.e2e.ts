import { expect, test, type Page } from '@playwright/test'
import type { ExportHistory } from '../src/export-preparation'
import { seedAuthoringState } from './seed-authoring'

const EXAM = {
  title: 'Biology Quiz',
  questions: [
    {
      id: 'm1',
      type: 'multiple-choice' as const,
      columns: 1 as const,
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Which is a mammal?' }] },
          {
            type: 'multipleChoice',
            content: [
              { type: 'multipleChoiceChoice', attrs: { id: 'c1', correct: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Whale' }] }] },
              { type: 'multipleChoiceChoice', attrs: { id: 'c2', correct: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shark' }] }] },
            ],
          },
        ],
      },
    },
    {
      id: 'o1', type: 'open' as const, columns: 2 as const,
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Explain why.' }] }] },
    },
  ],
}

const AUTHORING = {
  questionBank: { questions: EXAM.questions },
  workingCopy: { title: EXAM.title, questionIds: ['m1', 'o1'] },
  dirty: false,
}

async function open(page: Page, authoring = AUTHORING) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => true })
  })
  await seedAuthoringState(page, authoring)
  await page.locator('.exam-page').first().waitFor()
}

const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Export' })
async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(dialogOf(page)).toBeVisible()
  return dialogOf(page)
}

async function historyOf(page: Page): Promise<ExportHistory> {
  return page.evaluate(async () => {
    const { createExamWorkspaceService } = await import(/* @vite-ignore */ '/src/exam-workspaces.ts') as typeof import('../src/exam-workspaces')
    const workspaces = createExamWorkspaceService()
    const examId = await workspaces.activeId()
    if (!examId) throw new Error('No active Exam workspace')
    return workspaces.backendFor(examId).readExportHistory()
  })
}

async function download(page: Page, format: 'PDF' | 'DOCX' = 'PDF') {
  const dialog = await openDialog(page)
  if (format === 'DOCX') await dialog.getByRole('radio', { name: 'DOCX' }).check()
  const pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: `Download ${format}` }).click()
  return pending
}

test('Export defaults to PDF with both selected documents and a clean preview', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)
  await expect(dialog.getByRole('radio', { name: 'PDF' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Student test' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Answer key' })).toBeChecked()
  await expect(dialog.getByLabel('Export Preview').locator('.exam-page')).toHaveCount(2)
  await expect(dialog.getByLabel('Export Preview')).toContainText('Which is a mammal?')
  await expect(dialog.getByLabel('Export Preview').locator('.choice-correctness-marker')).toHaveCount(0)
})

test('format and Content Selection control the artifact and record', async ({ page }) => {
  await open(page)
  const dialog = await openDialog(page)
  await dialog.getByRole('radio', { name: 'DOCX' }).check()
  await dialog.getByRole('checkbox', { name: 'Student test' }).uncheck()
  await expect(dialog.getByLabel('Export Preview').locator('.exam-page')).toHaveCount(1)
  const file = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download DOCX' }).click()
  expect((await file).suggestedFilename()).toBe('Biology Quiz.docx')
  await expect.poll(async () => (await historyOf(page)).records.length).toBe(1)
  expect((await historyOf(page)).records[0]).toMatchObject({
    capturedName: 'Biology Quiz', format: 'docx',
    selection: { test: false, answerKey: true }, questionCount: 2,
  })
})

test('identical exports append distinct records without saving the Working Copy', async ({ page }) => {
  await open(page)
  const title = page.getByRole('textbox', { name: 'Exam name' })
  await title.fill('Unsaved Biology Quiz')
  await expect(page.getByLabel('Working Copy status')).toContainText('Unsaved changes')

  expect((await download(page)).suggestedFilename()).toBe('Unsaved Biology Quiz.pdf')
  expect((await download(page)).suggestedFilename()).toBe('Unsaved Biology Quiz.pdf')
  await expect.poll(async () => (await historyOf(page)).records.length).toBe(2)
  const records = (await historyOf(page)).records
  expect(records[0]!.id).not.toBe(records[1]!.id)
  expect(records.every((record) => record.capturedName === 'Unsaved Biology Quiz')).toBe(true)
  await expect(page.getByLabel('Working Copy status')).toContainText('Unsaved changes')
})

test('Export History is newest-first, and its frozen Re-export appends an event', async ({ page }) => {
  await open(page)
  await download(page, 'PDF')
  await download(page, 'DOCX')

  await page.getByRole('button', { name: 'Export History' }).click()
  const history = page.getByRole('complementary', { name: 'Export History' })
  await expect(history.locator('.export-history-item')).toHaveCount(2)
  await expect(history.locator('.export-history-item').first()).toContainText('DOCX')
  await history.locator('.export-history-item').first().click()

  const reExport = page.getByRole('dialog', { name: 'Re-export' })
  await expect(reExport).toContainText('Export Record, Immutable')
  await expect(reExport).toContainText('#2')
  // Every setting is frozen as it was exported.
  await expect(reExport.getByRole('radio', { name: 'DOCX' })).toBeChecked()
  await expect(reExport.getByRole('radio', { name: 'DOCX' })).toBeDisabled()
  await expect(reExport.getByRole('checkbox', { name: 'Student test' })).toBeDisabled()
  await expect(reExport.getByRole('button', { name: /Use as draft/i })).toHaveCount(0)

  const file = page.waitForEvent('download')
  await reExport.getByRole('button', { name: 'Re-export DOCX' }).click()
  expect((await file).suggestedFilename()).toBe('Biology Quiz.docx')
  await expect(reExport).toBeHidden()
  await expect.poll(async () => (await historyOf(page)).records.length).toBe(3)
  await expect(page.locator('.exam-page').first()).toBeVisible()
})

test('Escape closes Export History and restores focus', async ({ page }) => {
  await open(page)
  const button = page.getByRole('button', { name: 'Export History' })
  await button.click()
  await expect(page.getByRole('complementary', { name: 'Export History' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Export History' })).toBeHidden()
  await expect(button).toBeFocused()
})

test('empty Exams cannot export and Cmd/Ctrl+P opens Export for non-empty Exams', async ({ page }) => {
  await open(page, { questionBank: { questions: [] }, workingCopy: { title: 'Empty', questionIds: [] }, dirty: false })
  const dialog = await openDialog(page)
  await expect(dialog.getByText('Add at least one question', { exact: false }).first()).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  await open(page)
  await page.keyboard.press('ControlOrMeta+P')
  await expect(dialogOf(page)).toBeVisible()
})

test('a Short Answer question sits close to its number, and its Suggested Answer prints only in the key', async ({ page }) => {
  const [mc, sa] = EXAM.questions
  const withAnswer = {
    ...sa!,
    suggestedAnswer: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Because whales breathe air.' }] }] },
  }
  await open(page, { ...AUTHORING, questionBank: { questions: [mc!, withAnswer] } })

  // On the sheet, a Short Answer question has no blank beside its number, so
  // its text starts well short of where a Multiple Choice stem does.
  const stemLeft = async (id: string) =>
    (await page.locator(`.exam-workspace [data-question-id="${id}"] .question-stem`).boundingBox())!.x
  expect(await stemLeft('o1')).toBeLessThan(await stemLeft('m1') - 40)

  const dialog = await openDialog(page)
  const [testPage, keyPage] = await dialog.getByLabel('Export Preview').locator('.exam-page').all()
  await expect(testPage!).toContainText('Explain why.')
  await expect(testPage!).not.toContainText('Because whales breathe air.')
  await expect(keyPage!.locator('.answer-key-suggested')).toHaveText('Because whales breathe air.')
})

test('a matching set too long for one page continues on the next, its Word Bank on each, nothing clipped', async ({ page }) => {
  const bank = ['noun', 'verb', 'adjective', 'adverb']
  const long = {
    id: 'x1',
    type: 'matching' as const,
    columns: 1 as const,
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Match each word to its part of speech.' }] },
        {
          type: 'matching',
          content: [
            ...Array.from({ length: 40 }, (_unused, index) => ({
              type: 'matchingPrompt',
              attrs: { id: `x1-p${index + 1}`, answer: `x1-a${(index % 4) + 1}` },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: `vocabulary word ${index + 1}` }] }],
            })),
            ...bank.map((word, index) => ({
              type: 'matchingAnswer',
              attrs: { id: `x1-a${index + 1}` },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: word }] }],
            })),
          ],
        },
      ],
    },
  }
  await open(page, {
    questionBank: { questions: [long] },
    workingCopy: { title: 'Vocabulary', questionIds: ['x1'] },
    dirty: false,
  })

  const dialog = await openDialog(page)
  const pages = dialog.getByLabel('Export Preview').locator('.exam-page:has(.matching-set)')
  await expect(pages).toHaveCount(2)

  // Every item prints once, in order, across the pages.
  await expect(pages.locator('.matching-count')).toHaveText(
    Array.from({ length: 40 }, (_unused, index) => `${index + 1}.`),
  )
  for (const sheet of await pages.all()) {
    // Each page of items has the whole bank beside it.
    await expect(sheet.locator('.matching-answer')).toHaveText(bank.map((word, index) => `${'ABCD'[index]}.${word}`))
    // And every item ends above the footer: the sheet clips whatever runs past.
    const footerTop = (await sheet.locator('.page-footer').boundingBox())!.y
    const last = (await sheet.locator('.matching-prompt').last().boundingBox())!
    expect(last.y + last.height).toBeLessThanOrEqual(footerTop)
  }
})
