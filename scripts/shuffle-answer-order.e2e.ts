// Shuffling selected Multiple Choice answer orders through the keyboard context
// menu. The store tests own the model rule; this proves the rendered Draft has
// its own arrangement, keeps correctness with stable choices, and undoes once.

import { expect, test } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

function question(id: string, choiceIds: string[], correctId: string) {
  return {
    id,
    type: 'multiple-choice' as const,
    columns: 1 as const,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `Question ${id}` }],
        },
        {
          type: 'multipleChoice',
          content: choiceIds.map((choiceId) => ({
            type: 'multipleChoiceChoice',
            attrs: { correct: choiceId === correctId, id: `${id}-${choiceId}` },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: choiceId }] }],
          })),
        },
      ],
    },
  }
}

test('keyboard Shuffle answer order varies selected Multiple Choice questions and undoes once', async ({ page }) => {
  const first = question('m1', ['a', 'b', 'c'], 'b')
  const second = question('m2', ['d', 'e'], 'd')
  const shortAnswer = {
    id: 'o1', type: 'open' as const, columns: 1 as const,
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Short answer' }] }] },
  }
  await seedAuthoringState(page, {
    questionBank: { questions: [first, second, shortAnswer] },
    workingCopy: { title: 'Answer shuffle', questionIds: ['m1', 'm2', 'o1'] },
    dirty: false,
  })
  await page.reload()

  const questions = page.locator('.exam-question')
  await questions.nth(0).click()
  await questions.nth(1).click({ modifiers: ['Control'] })
  await questions.nth(2).click({ modifiers: ['Control'] })

  const answerContent = (index: number) => questions.nth(index).locator('.choice-body').allTextContents()
  const beforeFirst = await answerContent(0)
  const beforeSecond = await answerContent(1)
  await page.getByRole('button', { name: 'Actions for question 1' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Vary answers' }).press('ArrowRight')
  await page.getByRole('menuitem', { name: 'Shuffle answers' }).press('Enter')

  expect(await answerContent(0)).not.toEqual(beforeFirst)
  expect(await answerContent(1)).not.toEqual(beforeSecond)
  await expect(page.getByRole('status')).toHaveText('Shuffled answer order.')

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => answerContent(0)).toEqual(beforeFirst)
  await expect.poll(() => answerContent(1)).toEqual(beforeSecond)
})
