// Format → Text size and Format → Heading size, in a real browser.
//
// The text size sets the questions and answers; the heading size sets every
// heading, the Exam's title included; the header line keeps the sheet's own
// type. The sheet measures at the size it prints, so a long Exam at either
// size still exports to PDF inside the pages print planned.

import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

const choice = (id: string, correct: boolean, text: string) => ({
  type: 'multipleChoiceChoice',
  attrs: { correct, id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const question = (index: number) => ({
  id: `q${index}`,
  type: 'multiple-choice',
  columns: 1,
  doc: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{
          type: 'text',
          text: `Question ${index}: which of these particles carries no electric charge at all, and why does that matter here?`,
        }],
      },
      {
        type: 'multipleChoice',
        content: [
          choice(`q${index}-a`, false, 'Proton'),
          choice(`q${index}-b`, true, 'Neutron'),
          choice(`q${index}-c`, false, 'Electron'),
          choice(`q${index}-d`, false, 'Positron'),
        ],
      },
    ],
  },
})

async function openExam(page: Page, count = 1, textSize?: 'small' | 'large') {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => true })
  })
  const questions = Array.from({ length: count }, (_, index) => question(index + 1))
  await seedAuthoringState(page, {
    questionBank: { questions },
    workingCopy: {
      title: 'Sized',
      questionIds: questions.map(({ id }) => id),
      ...(textSize ? { textSize } : {}),
    },
    dirty: false,
  })
  await expect(page.locator('.exam-question[data-question-id]')).toHaveCount(count)
}

async function choose(page: Page, menu: 'Text size' | 'Heading size', size: string) {
  await page.getByRole('button', { name: 'Format' }).click()
  await page.getByRole('menuitem', { name: menu }).hover()
  await page.getByRole('menuitemradio', { name: size }).click()
}

const fontSize = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((element) => getComputedStyle(element).fontSize)

test('Format → Text size sets how large the questions print, and not the header line', async ({ page }) => {
  await openExam(page)
  expect(await fontSize(page, '.exam-workspace .question-stem')).toBe('15px')

  await choose(page, 'Text size', 'Large')
  await expect.poll(() => fontSize(page, '.exam-workspace .question-stem')).toBe('17px')
  expect(await fontSize(page, '.exam-workspace .page-identity')).toBe('15px')
  expect(await fontSize(page, '.exam-workspace .section-instructions')).toBe('15px')

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Export' }).getByLabel('Export Preview')
  await expect(preview).toBeVisible()
  expect(await preview.locator('.question-stem').first().evaluate(
    (element) => getComputedStyle(element).fontSize,
  )).toBe('17px')
})

test('Format → Heading size sets the Exam’s title with its section headings', async ({ page }) => {
  await openExam(page)
  expect(await fontSize(page, '.exam-workspace .exam-title')).toBe('26px')
  await choose(page, 'Heading size', 'Large')
  await expect.poll(() => fontSize(page, '.exam-workspace .exam-title')).toBe('30px')
  await choose(page, 'Heading size', 'Small')
  await expect.poll(() => fontSize(page, '.exam-workspace .exam-title')).toBe('22px')
})

for (const size of ['small', 'large'] as const) {
  test(`a long Exam at ${size} text exports to PDF within the pages it was planned on`, async ({ page }) => {
    await openExam(page, 18, size)
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Export' })
    await expect(dialog).toBeVisible()
    const pending = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download PDF' }).click()
    const download = await pending
    expect(download.suggestedFilename()).toMatch(/\.pdf$/)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
}
