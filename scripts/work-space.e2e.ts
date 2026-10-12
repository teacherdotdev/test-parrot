// Room for a student's work below a Short Answer question.
//
// Work space is set on the exam sheet, never in the question editor: how much
// room an answer needs depends on the test and on what shares the page. What
// a browser has to show is that the sheet's own controls — the menu and the
// bar under the question — open, size and shut that room, that it reaches the
// foot of the page when asked to, and that it stays put across a reload.

import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

const shortAnswer = (id: string, text: string) => ({
  id,
  type: 'open',
  columns: 2,
  doc: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  },
})

const multipleChoice = {
  id: 'mc',
  type: 'multiple-choice',
  columns: 2,
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Pick one.' }] },
      {
        type: 'multipleChoice',
        content: ['a', 'b'].map((answer) => ({
          type: 'multipleChoiceChoice',
          attrs: { correct: answer === 'a', id: `mc-${answer}` },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: answer }] }],
        })),
      },
    ],
  },
}

async function openExam(
  page: Page,
  workSpace?: Record<string, { height: number; style: 'blank' | 'lines'; fill: boolean }>,
) {
  await seedAuthoringState(page, {
    questionBank: {
      questions: [
        multipleChoice,
        shortAnswer('q1', 'Explain your reasoning.'),
        shortAnswer('q2', 'Describe the result.'),
      ],
    },
    workingCopy: {
      title: 'Work space',
      questionIds: ['mc', 'q1', 'q2'],
      ...(workSpace ? { workSpace } : {}),
    },
    dirty: false,
  } as never)
  await expect(page.locator('.exam-question')).toHaveCount(3)
}

const question = (page: Page, text: string) =>
  page.locator('.exam-question', { hasText: text })

async function chooseWorkSpace(page: Page, text: string, option: string) {
  await question(page, text).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Work space' }).press('ArrowRight')
  await page.getByRole('menuitemradio', { name: option }).click()
}

test('the menu opens lined or blank room below a Short Answer question and takes it away', async ({ page }) => {
  await openExam(page)
  const first = question(page, 'Explain your reasoning.')

  await chooseWorkSpace(page, 'Explain your reasoning.', 'Lined space')
  await expect(first.locator('.work-space-line')).toHaveCount(4)

  await chooseWorkSpace(page, 'Explain your reasoning.', 'Blank space')
  await expect(first.locator('.work-space')).toHaveAttribute('data-style', 'blank')
  await expect(first.locator('.work-space-line')).toHaveCount(0)

  await chooseWorkSpace(page, 'Explain your reasoning.', 'None')
  await expect(first.locator('.work-space')).toHaveCount(0)
})

test('work space is a Short Answer setting, absent from other questions', async ({ page }) => {
  await openExam(page)

  await question(page, 'Pick one.').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Answer columns' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Work space' })).toHaveCount(0)
  await expect(page.getByRole('menuitemcheckbox', { name: 'Fill rest of page' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await expect(question(page, 'Pick one.').getByRole('separator', { name: /Work space/ })).toHaveCount(0)
  await expect(page.getByRole('separator', { name: /Work space/ })).toHaveCount(2)
})

test('dragging the bar under a question opens room the next question moves down for', async ({ page }) => {
  await openExam(page, { q1: { height: 64, style: 'lines', fill: false } })
  const first = question(page, 'Explain your reasoning.')
  const next = question(page, 'Describe the result.')
  await expect(first.locator('.work-space-line')).toHaveCount(2)
  const nextTopBefore = (await next.boundingBox())!.y

  await first.hover()
  const bar = page.getByRole('separator', { name: 'Work space for question 2' })
  const box = (await bar.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 50, { steps: 5 })
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 96, { steps: 5 })
  await page.mouse.up()

  // Three more ruled lines, and the question below moved down by their height.
  await expect(first.locator('.work-space-line')).toHaveCount(5)
  await expect(bar).toHaveAttribute('aria-valuenow', '5')
  await expect.poll(async () => Math.round((await next.boundingBox())!.y - nextTopBefore)).toBe(96)

  // One gesture, one Undo step.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(first.locator('.work-space-line')).toHaveCount(2)
})

test('the bar takes the keyboard a line at a time', async ({ page }) => {
  await openExam(page, { q1: { height: 64, style: 'lines', fill: false } })
  const bar = page.getByRole('separator', { name: 'Work space for question 2' })

  await bar.focus()
  await page.keyboard.press('ArrowDown')
  await expect(question(page, 'Explain your reasoning.').locator('.work-space-line')).toHaveCount(3)
  await page.keyboard.press('Home')
  await expect(question(page, 'Explain your reasoning.').locator('.work-space')).toHaveCount(0)
})

test('filling the rest of the page runs the room to its foot and moves the next question on', async ({ page }) => {
  await openExam(page, { q1: { height: 64, style: 'lines', fill: false } })

  await question(page, 'Explain your reasoning.').click({ button: 'right' })
  await page.getByRole('menuitemcheckbox', { name: 'Fill rest of page' }).click()

  const pages = page.locator('.exam-page')
  await expect(pages.nth(0).locator('.exam-question', { hasText: 'Describe the result.' })).toHaveCount(0)
  await expect(pages.nth(1).locator('.exam-question', { hasText: 'Describe the result.' })).toHaveCount(1)
  // The ruled room ends at the foot of the first page's content box: inside
  // it, and short of it by no more than one ruled line plus the gap every
  // question leaves below itself.
  const space = (await question(page, 'Explain your reasoning.').locator('.work-space').boundingBox())!
  const content = (await pages.nth(0).locator('.page-content').boundingBox())!
  const leftOver = content.y + content.height - (space.y + space.height)
  expect(leftOver).toBeGreaterThanOrEqual(0)
  expect(leftOver).toBeLessThan(26 + 32)

  await question(page, 'Explain your reasoning.').click({ button: 'right' })
  await expect(page.getByRole('menuitemcheckbox', { name: 'Fill rest of page' })).toHaveAttribute('aria-checked', 'true')
})

test('work space survives a reload', async ({ page }) => {
  await openExam(page)
  await chooseWorkSpace(page, 'Describe the result.', 'Lined space')
  await expect(question(page, 'Describe the result.').locator('.work-space-line')).toHaveCount(4)

  await page.reload()

  await expect(question(page, 'Describe the result.').locator('.work-space-line')).toHaveCount(4)
})
