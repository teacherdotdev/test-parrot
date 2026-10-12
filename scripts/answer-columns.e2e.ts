// How many columns a question's answers lay out in.
//
// The count is the teacher's, always: there is no setting that measures the
// answers and decides for them. What a browser has to show is that the menu
// offers only real counts, and that a question written beside another one opens
// laid out the way that one is — which is what makes the setting something a
// teacher touches once rather than once per question.

import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

const choice = (id: string) => ({
  type: 'multipleChoiceChoice',
  attrs: { correct: false, id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
})

const question = (id: string, columns: number) => ({
  id,
  type: 'multiple-choice',
  columns,
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: `Question ${id}` }] },
      {
        type: 'multipleChoice',
        content: ['a', 'b', 'c', 'd'].map((answer) => choice(`${id}-${answer}`)),
      },
    ],
  },
})

async function openExam(page: Page, columns: number) {
  await seedAuthoringState(page, {
    questionBank: { questions: [question('q1', columns), question('q2', 2)] },
    workingCopy: { title: 'Answer columns', questionIds: ['q1'] },
    dirty: false,
  })
  await expect(page.locator('.exam-question')).toHaveCount(1)
}

test('the menu offers counts and nothing that decides for itself', async ({ page }) => {
  await openExam(page, 1)

  await page.locator('.exam-question').first().click({ button: 'right' })
  const answerColumns = page.getByRole('menuitem', { name: 'Answer columns' })
  await answerColumns.press('ArrowRight')
  await expect(page.getByRole('menuitemradio', { name: '1 column' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: '2 columns' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: '4 columns' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: 'Auto' })).toHaveCount(0)

  await page.getByRole('menuitem', { name: 'Edit question' }).hover()
  await expect(page.getByRole('menuitemradio', { name: '1 column' })).toHaveCount(0)
})

test('a slow pointer crosses from the row to its submenu without the submenu closing', async ({ page }) => {
  await openExam(page, 1)

  await page.locator('.exam-question').first().click({ button: 'right' })
  const answerColumns = page.getByRole('menuitem', { name: 'Answer columns' })
  await answerColumns.hover()
  const fourColumns = page.getByRole('menuitemradio', { name: '4 columns' })
  await expect(fourColumns).toBeVisible()

  // Walk the pointer from the row's middle to the option in small steps, the
  // way a hand does, through the strip between the menu and its flyout.
  const from = (await answerColumns.boundingBox())!
  const to = (await fourColumns.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 40 })
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.locator('.choice-grid[data-columns="4"]')).toHaveCount(1)
})

test('an inserted bank Question inherits its visual neighbor Working Copy layout', async ({ page }) => {
  // The canonical Question starts in two columns. Change only this Exam's
  // layout, then verify the new question follows the visible arrangement.
  await openExam(page, 2)

  await page.locator('.exam-question').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Answer columns' }).press('ArrowRight')
  await page.getByRole('menuitemradio', { name: '1 column' }).click()
  await expect(page.locator('.choice-grid[data-columns="1"]')).toHaveCount(1)

  await page.getByRole('button', { name: 'Add Question q2 to the exam' }).click()

  // Both, not just the seeded one: insertion inherited the visible layout.
  await expect(page.locator('.choice-grid')).toHaveCount(2)
  await expect(page.locator('.choice-grid[data-columns="1"]')).toHaveCount(2)
})

test('the first Multiple Choice Question in an empty section uses one column', async ({ page }) => {
  await seedAuthoringState(page, {
    questionBank: { questions: [question('q1', 4)] },
    workingCopy: { title: 'Answer columns', questionIds: [] },
    dirty: false,
  })
  await page.getByRole('button', { name: 'Add Question q1 to the exam' }).click()

  await expect(page.locator('.choice-grid[data-columns="1"]')).toHaveCount(1)
})
