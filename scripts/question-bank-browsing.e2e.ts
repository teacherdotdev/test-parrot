// Browsing and composing from the Question Bank, in a real browser.
//
// The projection, the search and the filter algebra are proven as pure rules in
// the unit suite. What is proven here is what only a browser can show: what a
// compact row actually says, that a click selects while a double-click or Enter
// opens the popup, that the filter controls narrow the bank the way the rules
// say, and that the keyboard composition path puts a bank question onto the
// Working Copy through the same authoring operations as everything else.

import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'
import type { Question, QuestionType } from '../src/exam'

const choice = (id: string, label: string) => ({
  type: 'multipleChoiceChoice',
  attrs: { correct: id.endsWith('-a'), id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: label }] }],
})

function question(
  id: string,
  stem: string,
  extra: Partial<Question> & { choices?: string[] } = {},
): Question {
  const { choices, ...rest } = extra
  const content: Record<string, unknown>[] = [
    { type: 'paragraph', content: [{ type: 'text', text: stem }] },
  ]
  if (choices) {
    content.push(
      { type: 'paragraph' },
      {
        type: 'multipleChoice',
        content: choices.map((label, index) =>
          choice(`${id}-${'abcd'[index]}`, label),
        ),
      },
    )
  }
  return {
    id,
    type: (choices ? 'multiple-choice' : 'open') as QuestionType,
    columns: 2,
    doc: { type: 'doc', content },
    ...rest,
  }
}

// One bank with something of every kind in it, so a single fixture can carry
// the projection, the filters and the composition tests.
const QUESTIONS: Question[] = [
  question('q1', 'Photosynthesis in leaves', {
    difficulty: 'easy',
    topics: ['Biology'],
    choices: ['Chlorophyll', 'Keratin'],
  }),
  question('q2', 'Mitosis and meiosis', {
    difficulty: 'hard',
    topics: ['Cell division'],
  }),
  question('q3', 'Photosynthesis at night', {
    topics: ['Biology', 'Plants'],
    choices: ['Nothing happens', 'It reverses'],
  }),
  question('q4', 'Read the graph', {
    difficulty: 'medium',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read the graph, then evaluate ' },
            { type: 'math_inline', attrs: { value: 'PV = nRT' } },
          ],
        },
        { type: 'image-block', attrs: { src: '/local-images/graph.png' } },
      ],
    },
  }),
]

const bank = (page: Page) => page.getByRole('region', { name: 'Question Bank' })
const rows = (page: Page) => bank(page).getByRole('listitem')
const row = (page: Page, stem: string) =>
  bank(page).getByRole('listitem').filter({ hasText: stem })
const search = (page: Page) =>
  page.getByRole('searchbox', { name: 'Search question stems' })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Question editor' })

async function openBank(page: Page, questionIds: string[] = ['q1', 'q2']) {
  await seedAuthoringState(page, {
    questionBank: { questions: QUESTIONS },
    workingCopy: { title: 'Biology quiz', questionIds },
    dirty: false,
  })
  await expect(rows(page)).toHaveCount(QUESTIONS.length)
}

/** Chooses values in one of the bank's filter dropdowns. */
async function filterBy(page: Page, category: string, ...values: string[]) {
  await bank(page).getByRole('button', { name: category, exact: true }).click()
  for (const value of values) {
    await page.getByRole('checkbox', { name: value, exact: true }).check()
  }
  await page.keyboard.press('Escape')
}

test('a compact row shows the stem, its classification and nothing hidden', async ({ page }) => {
  await openBank(page)

  // Newest first, and filtering never gets to rewrite that.
  await expect(rows(page).nth(0)).toContainText('Read the graph')
  await expect(rows(page).nth(3)).toContainText('Photosynthesis in leaves')

  const leaves = row(page, 'Photosynthesis in leaves')
  await expect(leaves).toContainText('Multiple choice')
  await expect(leaves).toContainText('Easy')
  await expect(leaves).toContainText('Biology')
  await expect(leaves).toContainText('In exam')
  // Answer choices and their correctness stay behind the popup.
  await expect(bank(page)).not.toContainText('Chlorophyll')
  await expect(bank(page)).not.toContainText('Keratin')

  // Content a single line cannot carry is a badge instead.
  const graph = row(page, 'Read the graph')
  await expect(graph).toContainText('Math')
  await expect(graph).toContainText('Image')
  await expect(graph).not.toContainText('nRT')
  await expect(graph).toContainText('Short answer')
})

test('a click selects a row while a double-click, Enter or Edit opens the popup', async ({ page }) => {
  await openBank(page)

  await row(page, 'Mitosis and meiosis').click()
  await expect(row(page, 'Mitosis and meiosis')).toHaveAttribute('aria-current', 'true')
  await expect(dialog(page)).toBeHidden()

  await row(page, 'Mitosis and meiosis').dblclick()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('Mitosis and meiosis')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await row(page, 'Photosynthesis at night').focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('Photosynthesis at night')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await row(page, 'Read the graph').getByRole('button', { name: /^Edit / }).click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('Read the graph')
})

test('search matches stems only, and clearing it restores the bank', async ({ page }) => {
  await openBank(page)

  await search(page).fill('PHOTOSYNTHESIS')
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).nth(0)).toContainText('Photosynthesis at night')
  await expect(rows(page).nth(1)).toContainText('Photosynthesis in leaves')

  // An answer choice is not the stem, so it is not searched.
  await search(page).fill('Chlorophyll')
  await expect(rows(page)).toHaveCount(0)
  await expect(bank(page)).toContainText('No questions match')

  await bank(page).getByRole('button', { name: 'Clear filters' }).click()
  await expect(search(page)).toHaveValue('')
  await expect(rows(page)).toHaveCount(QUESTIONS.length)
  await expect(rows(page).nth(0)).toContainText('Read the graph')
})

test('filter values combine with OR inside a category and AND across them', async ({ page }) => {
  await openBank(page)

  await filterBy(page, 'Difficulty', 'Easy', 'Hard')
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).nth(0)).toContainText('Mitosis and meiosis')
  await expect(rows(page).nth(1)).toContainText('Photosynthesis in leaves')

  await filterBy(page, 'Question Type', 'Multiple choice')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).nth(0)).toContainText('Photosynthesis in leaves')

  await bank(page).getByRole('button', { name: 'Clear filters' }).click()
  await filterBy(page, 'Difficulty', 'Unspecified')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).nth(0)).toContainText('Photosynthesis at night')

  await bank(page).getByRole('button', { name: 'Clear filters' }).click()
  await filterBy(page, 'Topic', 'Plants')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).nth(0)).toContainText('Photosynthesis at night')

  await bank(page).getByRole('button', { name: 'Clear filters' }).click()
  await search(page).fill('photosynthesis')
  await filterBy(page, 'Topic', 'Cell division')
  await expect(rows(page)).toHaveCount(0)
})

test('Add all composes only the filtered questions as one action', async ({ page }) => {
  await openBank(page, [])
  await filterBy(page, 'Topic', 'Biology')
  await expect(rows(page)).toHaveCount(2)

  await bank(page).getByRole('button', { name: 'Add all', exact: true }).click()

  const examQuestions = page.locator('.exam-question[data-question-id]')
  await expect(examQuestions).toHaveCount(2)
  await expect(examQuestions).toContainText(['Photosynthesis at night', 'Photosynthesis in leaves'])
  await expect(page.locator('.exam-question[data-question-id="q2"]')).toHaveCount(0)
  await expect(page.locator('.exam-question[data-question-id="q4"]')).toHaveCount(0)
  await expect(bank(page).getByRole('button', { name: 'Add all', exact: true })).toBeDisabled()

  // One bulk command, one undo step.
  await page.keyboard.press('Control+z')
  await expect(examQuestions).toHaveCount(0)
})

test('browsing the Question Bank is not an authoring action', async ({ page }) => {
  await openBank(page)
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeDisabled()

  await search(page).fill('photosynthesis')
  await filterBy(page, 'Topic', 'Biology')
  await row(page, 'Photosynthesis at night').click()

  // Nothing to undo: search, filters and row selection are transient UI state.
  await expect(undo).toBeDisabled()

  // And they are not remembered, because they were never authoring data.
  await page.reload()
  await expect(rows(page)).toHaveCount(QUESTIONS.length)
  await expect(search(page)).toHaveValue('')
})

test('an empty Question Bank reads differently from one nothing matches', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  await expect(bank(page)).toContainText('No questions yet')

  await openBank(page)
  await search(page).fill('nothing whatsoever')
  await expect(bank(page)).toContainText('No questions match')
  await expect(bank(page)).not.toContainText('No questions yet')
})

test('a highlighted row is let go of by pressing Escape or by pressing elsewhere', async ({ page }) => {
  await openBank(page)

  // Highlighting a row is a place to read from, not a state to get stuck in.
  await row(page, 'Photosynthesis at night').click()
  await expect(row(page, 'Photosynthesis at night')).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('Escape')
  await expect(row(page, 'Photosynthesis at night')).not.toHaveAttribute('aria-current', 'true')

  await row(page, 'Photosynthesis at night').click()
  await expect(row(page, 'Photosynthesis at night')).toHaveAttribute('aria-current', 'true')
  await bank(page).getByRole('heading', { name: 'Question Bank' }).click()
  await expect(row(page, 'Photosynthesis at night')).not.toHaveAttribute('aria-current', 'true')
})

test('a filter list stays over the bank rather than the sheet beside it', async ({ page }) => {
  await openBank(page)

  // The filters sit at the bank's right-hand end, so a list dropped from the
  // last of them is the one that would hang over the divider and the rendered
  // page — which paint over it, because the bank pane is its own stacking
  // context. Geometry is the claim, so it is measured.
  await bank(page).getByRole('button', { name: 'Difficulty', exact: true }).click()
  const list = page.getByRole('group', { name: 'Difficulty' })
  await expect(list).toBeVisible()

  const bankBox = (await bank(page).boundingBox())!
  const listBox = (await list.boundingBox())!
  expect(listBox.x).toBeGreaterThanOrEqual(bankBox.x)
  expect(listBox.x + listBox.width).toBeLessThanOrEqual(bankBox.x + bankBox.width)

  // Over the bank, not under it: every option is hittable.
  await page.getByRole('checkbox', { name: 'Unspecified', exact: true }).check()
  await expect(page.getByRole('checkbox', { name: 'Unspecified', exact: true })).toBeChecked()
})
