// A Multipart question, in a real browser.
//
// The plan's tests cover how a Multipart question numbers, letters and breaks across
// pages. These cover what only a browser can show: that the question editor
// lays a Multipart question out the way the paper does — the shared material unnested at the
// top, a "Parts" heading, each Part a box headed with its type and holding
// the answer component a question of that kind uses — that Parts can be
// added, moved, deleted and switched between kinds there, and that the sheet
// prints them lettered under the Multipart question's one number.
//
// A seeded Exam is enough to look at the sheet and the editor, but saving an
// edit needs a Question Bank the bank service knows, so the tests that save
// write their Multipart question through the bank's own menu.

import { expect, test, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

const aldmere = {
  id: 's1',
  type: 'multipart',
  columns: 2,
  doc: {
    type: 'doc',
    content: [
      paragraph('The power of the Kingdom was fading by 1450.'),
      paragraph('Source: A Short History of Aldmere, 1998 (adapted)'),
      {
        type: 'multipartParts',
        content: [
          {
            type: 'multipartPart',
            attrs: { id: 's1-a', columns: 2 },
            content: [
              { type: 'multipartPartStem', content: [paragraph('Which region was controlled in 1450?')] },
              {
                type: 'multipleChoice',
                content: ['Western Hills', 'Northern Coast'].map((answer, index) => ({
                  type: 'multipleChoiceChoice',
                  attrs: { correct: index === 1, id: `s1-a${index}` },
                  content: [paragraph(answer)],
                })),
              },
            ],
          },
          {
            type: 'multipartPart',
            attrs: { id: 's1-b', columns: 2 },
            content: [
              { type: 'multipartPartStem', content: [paragraph('Identify an issue faced in the 1600s.')] },
              { type: 'suggestedAnswer', content: [paragraph('Its harbors silted up.')] },
            ],
          },
        ],
      },
    ],
  },
}

async function openExam(page: Page) {
  await seedAuthoringState(page, {
    questionBank: { questions: [aldmere] },
    workingCopy: { title: 'Multipart', questionIds: ['s1'] },
    dirty: false,
  } as never)
  await expect(page.locator('.exam-question')).toHaveCount(1)
}

const editor = (page: Page) => page.getByRole('dialog', { name: 'Question editor' })
const partTags = (page: Page) => editor(page).locator('.multipart-part-header')

test('the sheet prints the Multipart question under one number with its Parts lettered beneath it', async ({ page }) => {
  await openExam(page)
  await expect(page.getByRole('heading', { name: 'Multipart', exact: true }).first()).toBeVisible()
  const question = page.locator('.exam-question')
  await expect(question.locator('.question-count')).toHaveText('1.')
  await expect(question.locator('.part-count')).toHaveText(['a.', 'b.'])
  await expect(question).toContainText('The power of the Kingdom was fading by 1450.')
  await expect(question).toContainText('Which region was controlled in 1450?')
  await expect(question.locator('.choice-grid')).toContainText('Northern Coast')
  // The Suggested Answer is the Answer Key's, never the student's.
  await expect(question).not.toContainText('Its harbors silted up.')
})

test('the editor nests the Parts under the Multipart question, each tagged with its letter and kind', async ({ page }) => {
  await openExam(page)
  await page.locator('.exam-question').dblclick()
  await expect(editor(page)).toBeVisible()

  await expect(editor(page).getByText('Parts', { exact: true })).toBeVisible()
  await expect(partTags(page)).toHaveCount(2)
  await expect(partTags(page).nth(0)).toContainText('Multiple Choice')
  await expect(partTags(page).nth(1)).toContainText('Short Answer')
  await expect(editor(page).locator('.multipart-part').nth(0).locator('[data-type="multiple-choice"]')).toBeVisible()
  await expect(editor(page).locator('.multipart-part').nth(1).getByText('Suggested Answer')).toBeVisible()
})

/** A new Multipart question, written through the bank's own Add Question menu. */
async function newMultipart(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Question Bank' }).first().click()
  await page.getByRole('button', { name: 'New question' }).click()
  await page.getByRole('menuitem', { name: 'Multipart' }).click()
  await expect(editor(page)).toBeVisible()
}

test('a new Multipart question opens with one blank Multiple Choice Part, and the bank counts its Parts', async ({ page }) => {
  await newMultipart(page)
  await expect(partTags(page)).toHaveCount(1)
  await expect(partTags(page).first()).toContainText('Multiple Choice')

  // The cursor starts in the stem, unnested at the top.
  await page.keyboard.type('A quotation to read.')
  await page.keyboard.press('Control+Enter')
  await expect(editor(page)).toBeHidden()

  // The bank page reads the Multipart question out whole, its Parts lettered under it.
  const questions = page.getByRole('list', { name: 'Questions' }).locator(':scope > li')
  await expect(questions).toHaveCount(1)
  await expect(questions).toContainText('A quotation to read.')
  await expect(questions.getByRole('listitem', { name: /^Part [a-z],/ })).toHaveCount(1)
})

test('a Part is added, moved and deleted, and saving keeps exactly that', async ({ page }) => {
  await newMultipart(page)
  await page.keyboard.type('A quotation to read.')

  // "Add Part" is offered twice: at the end of the Parts heading, and after
  // the last Part.
  await expect(editor(page).getByRole('button', { name: 'Add Part' })).toHaveCount(2)
  await editor(page).getByRole('button', { name: 'Add Part' }).last().click()
  await editor(page).getByRole('menuitem', { name: 'Short Answer' }).click()
  await expect(partTags(page)).toHaveCount(2)
  await expect(partTags(page).nth(1)).toContainText('Short Answer')
  // The cursor lands in the new Part's stem, so typing writes its question.
  await page.keyboard.type('Explain one factor.')
  await expect(editor(page).locator('.multipart-part').nth(1)).toContainText('Explain one factor.')

  // Moving it up puts it first.
  await partTags(page).nth(1).getByRole('button', { name: 'Move part up' }).click()
  await expect(editor(page).locator('.multipart-part')).toHaveCount(2)
  await expect(editor(page).locator('.multipart-part').nth(0)).toContainText('Explain one factor.')
  await expect(partTags(page).nth(0)).toContainText('Short Answer')

  // Deleting the blank Multiple Choice Part, now second, leaves one Part.
  await partTags(page).nth(1).getByRole('button', { name: 'Delete part' }).click()
  await expect(partTags(page)).toHaveCount(1)

  await editor(page).getByRole('button', { name: 'Save question' }).click()
  await expect(editor(page)).toBeHidden()

  const bank = page.getByRole('region', { name: 'Question Bank' })
  await expect(bank.getByRole('listitem', { name: /^Part [a-z],/ })).toHaveCount(1)
  await expect(bank.getByRole('listitem', { name: /^Part a,/ })).toContainText('Explain one factor.')
  // Opened again, the Multipart question holds exactly what was saved.
  await bank.getByRole('button', { name: 'Edit A quotation to read.' }).click()
  await expect(editor(page)).toBeVisible()
  await expect(partTags(page)).toHaveCount(1)
  await expect(partTags(page).first()).toContainText('Short Answer')
  await expect(editor(page).locator('.multipart-part')).toContainText('Explain one factor.')
})

test('each Part of a Multipart question gets the sheet controls a question of its kind has', async ({ page }) => {
  await openExam(page)
  await page.locator('.exam-question').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Part b · Work space' }).press('ArrowRight')
  await page.getByRole('menuitemradio', { name: 'Lined space' }).click()
  const partB = page.locator('.multipart-part-print').nth(1)
  await expect(partB.locator('.work-space-line')).toHaveCount(4)

  await page.locator('.exam-question').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Part a · Answer columns' }).press('ArrowRight')
  await page.getByRole('menuitemradio', { name: '1 column' }).click()
  await expect(page.locator('.multipart-part-print').nth(0).locator('.choice-grid')).toHaveAttribute('data-columns', '1')
})

test('a Part switches kind from its type badge, and switching back brings its answers again', async ({ page }) => {
  await newMultipart(page)
  const part = editor(page).locator('.multipart-part').first()
  const switchTo = async (kind: string) => {
    await partTags(page).first().getByRole('button', { name: /^Part type:/ }).click()
    await editor(page).getByRole('menuitem', { name: kind }).click()
  }

  await part.locator('.mc-choice-body').first().click()
  await page.keyboard.type('Northern Coast')
  await switchTo('Short Answer')
  await expect(partTags(page).first()).toContainText('Short Answer')
  await expect(part.getByText('Suggested Answer')).toBeVisible()
  await expect(part.locator('[data-type="multiple-choice"]')).toHaveCount(0)

  await part.locator('.sa-body').click()
  await page.keyboard.type('Its harbors silted up.')
  await switchTo('Multiple Choice')
  await expect(part.locator('.mc-choice-body').first()).toHaveText('Northern Coast')
  await expect(part).not.toContainText('Its harbors silted up.')
  await switchTo('Short Answer')
  await expect(part.locator('.sa-body')).toHaveText('Its harbors silted up.')
})
