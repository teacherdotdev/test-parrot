import { expect, test } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

test('the rendered exam preserves authored spaces and blank lines', async ({ page }) => {
  const authoring = {
    questionBank: {
      questions: [
        {
          id: 'q1',
          type: 'open',
          columns: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Show  your  work' }],
              },
              { type: 'paragraph' },
              { type: 'paragraph' },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Answer' }],
              },
            ],
          },
        },
      ],
    },
    workingCopy: { title: 'Whitespace repro', questionIds: ['q1'] },
    dirty: false,
  }
  await seedAuthoringState(page, authoring)


  const stem = page.locator('.question-stem')
  await expect(stem.locator('p')).toHaveCount(4)
  await expect(stem.locator('p').first()).toHaveText('Show  your  work')
  await expect
    .poll(() => stem.evaluate((element) => getComputedStyle(element).whiteSpace))
    .toBe('pre-wrap')

  const blankLineHeights = await stem.locator('p').evaluateAll((paragraphs) =>
    paragraphs.slice(1, 3).map((paragraph) => paragraph.getBoundingClientRect().height),
  )
  expect(blankLineHeights.every((height) => height > 0)).toBe(true)
})
