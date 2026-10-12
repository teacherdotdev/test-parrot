// Rewording a test page's header line, in a real browser.
//
// The line reads as it prints until it is clicked, when it becomes the field;
// the ID beside it is never part of it; and the margin offers the default back.

import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

const QUESTION = {
  id: 'q1',
  type: 'open',
  doc: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Explain osmosis.' }] }],
  },
}

async function openExam(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => true })
  })
  await seedAuthoringState(page, {
    questionBank: { questions: [QUESTION] },
    workingCopy: { title: 'Header', questionIds: ['q1'] },
    dirty: false,
  })
  await expect(page.locator('.exam-question[data-question-id]')).toHaveCount(1)
}

const firstHeader = (page: Page) =>
  page.locator('.exam-workspace .exam-page').first().locator('.page-identity')
const field = (page: Page) => page.getByRole('textbox', { name: 'Header printed on the exam' })

test('the header line is reworded where it prints, with no Version label unshuffled', async ({ page }) => {
  await openExam(page)
  const header = firstHeader(page)
  await expect(field(page)).toHaveValue(/^Name: _+ {2}Class: _+ {2}Date: _+$/)

  await field(page).fill('Student: ________  Period: ____')
  await field(page).press('Enter')
  await expect(field(page)).not.toBeFocused()
  await expect(field(page)).toHaveValue('Student: ________  Period: ____')
  await expect(header.locator('.page-id')).toHaveText('')

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Export' }).getByLabel('Export Preview')
  const printed = preview.locator('.exam-page').first().locator('.page-identity')
  await expect(printed).toContainText('Student: ________  Period: ____')
  await expect(printed).not.toContainText('Class:')
  await expect(printed).not.toContainText('ID:')
})

test('one click puts the caret where it lands, as the title does', async ({ page }) => {
  await openExam(page)
  const box = (await field(page).boundingBox())!
  const length = (await field(page).inputValue()).length
  const caret = () => field(page).evaluate((input) => (input as HTMLInputElement).selectionStart)

  await field(page).click({ position: { x: box.width / 2, y: box.height / 2 } })
  await expect(field(page)).toBeFocused()
  const middle = await caret()
  expect(middle).toBeGreaterThan(length * 0.3)
  expect(middle).toBeLessThan(length * 0.7)

  await field(page).click({ position: { x: 2, y: box.height / 2 } })
  expect(await caret()).toBeLessThanOrEqual(1)
})

test('the field is as wide as its words, hides none of them, and stays inside its line', async ({ page }) => {
  await openExam(page)
  const header = firstHeader(page)
  const box = (await field(page).boundingBox())!
  const line = (await header.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(line.x + line.width)
  const fit = await field(page).evaluate((element) => {
    const input = element as HTMLInputElement
    const style = getComputedStyle(input)
    const context = document.createElement('canvas').getContext('2d')!
    context.font = `${style.fontSize} ${style.fontFamily}`
    return {
      text: context.measureText(input.value).width,
      width: input.offsetWidth,
      hidden: input.scrollWidth - input.clientWidth,
    }
  })
  expect(Math.abs(fit.width - fit.text)).toBeLessThanOrEqual(4)
  expect(fit.hidden).toBeLessThanOrEqual(1)
})

test('the margin restores the default header', async ({ page }) => {
  await openExam(page)
  const header = firstHeader(page)
  await field(page).fill('')
  await field(page).press('Escape')
  await expect(field(page)).toHaveValue('')
  await expect(header.locator('.page-id')).toHaveText('')

  await header.hover()
  await page.getByRole('button', { name: 'Restore the default header' }).click()
  await expect(field(page)).toHaveValue(/^Name: .*Date: _+$/)
})
