import { expect, test } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

const choice = (id: string) => ({
  type: 'multipleChoiceChoice',
  attrs: { correct: false, id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
})

const question = (id: string) => ({
  id,
  type: 'multiple-choice',
  columns: 1,
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

test('column formatting applies to a large multi-page selection', async ({ page }) => {
  const ids = Array.from({ length: 12 }, (_unused, index) => `q${index + 1}`)
  await seedAuthoringState(page, {
    questionBank: { questions: ids.map(question) },
    workingCopy: { title: 'Bulk format repro', questionIds: ids },
    dirty: false,
  })

  const questions = page.locator('.exam-question')
  await expect(questions).toHaveCount(ids.length)
  await questions.first().click()
  for (let index = 1; index < ids.length; index += 1) {
    await questions.nth(index).click({ modifiers: ['Shift'] })
  }
  await expect(page.locator('.exam-question--selected')).toHaveCount(ids.length)

  await questions.last().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Answer columns' }).hover()
  await page.getByRole('menuitemradio', { name: '2 columns' }).click()

  await expect(page.locator('.choice-grid[data-columns="2"]')).toHaveCount(ids.length)
})
