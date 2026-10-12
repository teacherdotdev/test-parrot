// Composing a Working Copy with the pointer, in a real browser.
//
// The drop rule itself is a pure function proven in `src/workspace-drag.test.ts`,
// and what each authoring action does to the Question Bank and the Working Copy is
// proven at the store. What is proven here is the part only a browser has: that
// a gesture starting in one pane reaches a target in the other, that a release
// anywhere over the Working Copy lands at the nearest legal line and draws that
// line first, that a release outside it does nothing, and that a drop is one
// undoable authoring action whose result is selected and scrolled into view.

import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedAuthoringState } from './seed-authoring'
import type { Question, QuestionType } from '../src/exam'

const choice = (id: string, label: string) => ({
  type: 'multipleChoiceChoice',
  attrs: { correct: id.endsWith('-a'), id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: label }] }],
})

function question(id: string, stem: string, type: QuestionType): Question {
  const content: Record<string, unknown>[] = [
    { type: 'paragraph', content: [{ type: 'text', text: stem }] },
  ]
  if (type === 'multiple-choice') {
    content.push(
      { type: 'paragraph' },
      {
        type: 'multipleChoice',
        content: [choice(`${id}-a`, 'First'), choice(`${id}-b`, 'Second')],
      },
    )
  }
  return { id, type, columns: 2, doc: { type: 'doc', content } }
}

const QUESTIONS: Question[] = [
  question('mc1', 'Cell membranes', 'multiple-choice'),
  question('mc2', 'Enzyme kinetics', 'multiple-choice'),
  question('sa1', 'Explain osmosis', 'open'),
  question('mcSpare', 'Spare choice question', 'multiple-choice'),
  question('saSpare', 'Spare short answer', 'open'),
]

const bank = (page: Page) => page.getByRole('region', { name: 'Question Bank' })
const bankRow = (page: Page, stem: string) =>
  bank(page).getByRole('listitem').filter({ hasText: stem })
// Only real rendered questions: the off-screen measuring host and the drag
// preview both hold `.exam-question` markup, and neither is on the page.
const EXAM_QUESTION = '.exam-question[data-question-id]'
const examQuestions = (page: Page) => page.locator(EXAM_QUESTION)
const rendered = (page: Page, id: string) =>
  page.locator(`.exam-question[data-question-id="${id}"]`)

/** The rendered Working Copy, in the order it prints. */
async function renderedIds(page: Page): Promise<string[]> {
  return await page.locator(EXAM_QUESTION).evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.questionId ?? ''),
  )
}

async function openWorkspace(
  page: Page,
  questionIds: string[] = ['mc1', 'mc2', 'sa1'],
) {
  await seedAuthoringState(page, {
    questionBank: { questions: QUESTIONS },
    workingCopy: { title: 'Biology quiz', questionIds },
    dirty: false,
  })
  await expect(examQuestions(page)).toHaveCount(questionIds.length)
}

type Zone = 'top' | 'centre' | 'bottom'

/** A point inside a rendered question: near its top, near its bottom, or at
 *  its centre. */
async function zonePoint(target: Locator, zone: Zone) {
  const box = (await target.boundingBox())!
  return {
    x: box.x + box.width / 2,
    y:
      zone === 'top'
        ? box.y + 4
        : zone === 'bottom'
          ? box.y + box.height - 4
          : box.y + box.height / 2,
  }
}

/** Picks a Question Bank row up and holds it over a point, without releasing. */
async function pickUp(page: Page, stem: string, point: { x: number; y: number }) {
  const box = (await bankRow(page, stem).boundingBox())!
  await page.mouse.move(box.x + 30, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y, { steps: 10 })
}

/** One whole bank-to-draft gesture, released in the named zone. */
async function dragBankRowOnto(page: Page, stem: string, target: Locator, zone: Zone) {
  await pickUp(page, stem, await zonePoint(target, zone))
  // The target may have moved under the pointer while the preview was picked
  // up; aim once more before releasing so the release point is the tested one.
  const point = await zonePoint(target, zone)
  await page.mouse.move(point.x, point.y)
  await page.mouse.up()
}

test('the bottom edge of a rendered question Inserts after it', async ({ page }) => {
  await openWorkspace(page)

  await dragBankRowOnto(page, 'Spare choice question', rendered(page, 'mc1'), 'bottom')

  await expect(examQuestions(page)).toHaveCount(4)
  expect(await renderedIds(page)).toEqual(['mc1', 'mcSpare', 'mc2', 'sa1'])
  // Referenced, not copied: still five bank records, and the incoming one is
  // marked as being on the exam.
  await expect(bank(page).getByRole('listitem')).toHaveCount(QUESTIONS.length)
  await expect(bankRow(page, 'Spare choice question')).toContainText('In exam')
})

test('Shift-selected bank rows drag into the Working Copy together', async ({ page }) => {
  const selected = [
    question('target', 'Existing question', 'multiple-choice'),
    question('first', 'First selected question', 'multiple-choice'),
    question('second', 'Second selected question', 'multiple-choice'),
  ]
  await seedAuthoringState(page, {
    questionBank: { questions: selected },
    workingCopy: { title: 'Bulk drag', questionIds: ['target'] },
    dirty: false,
  })
  await expect(examQuestions(page)).toHaveCount(1)

  // Newest first: Shift-clicking from the second row to the first selects both.
  await bankRow(page, 'First selected question').click()
  await bankRow(page, 'Second selected question').click({ modifiers: ['Shift'] })
  await expect(bankRow(page, 'First selected question')).toHaveAttribute('aria-current', 'true')
  await expect(bankRow(page, 'Second selected question')).toHaveAttribute('aria-current', 'true')

  const target = rendered(page, 'target')
  await pickUp(page, 'Second selected question', await zonePoint(target, 'centre'))
  await expect(page.locator('.question-drag-preview')).toHaveAttribute('data-count', '2')
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['target', 'second', 'first'])
  await page.keyboard.press('Control+z')
  expect(await renderedIds(page)).toEqual(['target'])
})

test('the top edge of a rendered question Inserts before it', async ({ page }) => {
  await openWorkspace(page)

  await dragBankRowOnto(page, 'Spare choice question', rendered(page, 'mc1'), 'top')

  // The first position in a Question Section: the one no "after" can name.
  expect(await renderedIds(page)).toEqual(['mcSpare', 'mc1', 'mc2', 'sa1'])
})

test('the centre of a rendered question Inserts at its nearer edge, never Replaces', async ({ page }) => {
  await openWorkspace(page)

  await dragBankRowOnto(page, 'Spare choice question', rendered(page, 'mc2'), 'centre')

  // One more question, and the one under the pointer is still on the exam.
  expect(await renderedIds(page)).toHaveLength(4)
  expect(await renderedIds(page)).toContain('mc2')
  expect(await renderedIds(page)).toContain('mcSpare')
})

test('a question released in another Question Section lands at the nearest edge of its own', async ({ page }) => {
  await openWorkspace(page)

  // A Short Answer question flicked onto the first Multiple Choice question
  // goes to the top of the Short Answer section: the closest place it can go.
  await pickUp(page, 'Spare short answer', await zonePoint(rendered(page, 'mc1'), 'top'))
  await expect(rendered(page, 'sa1')).toHaveAttribute('data-drop', 'before')
  await expect(page.locator(`${EXAM_QUESTION}[data-drop]`)).toHaveCount(1)
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['mc1', 'mc2', 'saSpare', 'sa1'])
})

test('a question released in the margin beside the sheet still lands', async ({ page }) => {
  await openWorkspace(page)

  const sheet = (await page.locator('.exam-page').first().boundingBox())!
  const top = await zonePoint(rendered(page, 'mc1'), 'top')
  await pickUp(page, 'Spare choice question', { x: sheet.x - 8, y: top.y })
  await expect(rendered(page, 'mc1')).toHaveAttribute('data-drop', 'before')
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['mcSpare', 'mc1', 'mc2', 'sa1'])
})

test('feedback shows the landing line while dragging, and a release outside the Working Copy abandons', async ({ page }) => {
  await openWorkspace(page)
  const preview = page.locator('.question-drag-preview')
  const root = page.locator('html')

  await pickUp(page, 'Spare choice question', await zonePoint(rendered(page, 'mc1'), 'top'))

  // Active dragging: a page-owned preview, never the browser's, and the lifted
  // row dimmed in place so it stays findable underneath.
  await expect(preview).toBeVisible()
  await expect(bankRow(page, 'Spare choice question')).toHaveAttribute('data-dragging', 'true')
  await expect(rendered(page, 'mc1')).toHaveAttribute('data-drop', 'before')
  await expect(preview).toHaveAttribute('data-intent-label', 'Insert')

  const bottom = await zonePoint(rendered(page, 'mc1'), 'bottom')
  await page.mouse.move(bottom.x, bottom.y)
  await expect(rendered(page, 'mc1')).toHaveAttribute('data-drop', 'after')

  // Over a Short Answer question, the line moves to the nearest Multiple
  // Choice position rather than disappearing.
  const wrongSection = await zonePoint(rendered(page, 'sa1'), 'centre')
  await page.mouse.move(wrongSection.x, wrongSection.y)
  await expect(rendered(page, 'mc2')).toHaveAttribute('data-drop', 'after')
  await expect(page.locator(`${EXAM_QUESTION}[data-drop]`)).toHaveCount(1)

  // Back over the Question Bank there is nowhere to land, and the cursor says so.
  const home = (await bankRow(page, 'Spare choice question').boundingBox())!
  await page.mouse.move(home.x + 30, home.y + home.height / 2)
  await expect(page.locator(`${EXAM_QUESTION}[data-drop]`)).toHaveCount(0)
  await expect(root).toHaveAttribute('data-drag-intent', 'none')
  await expect(preview).toHaveAttribute('data-intent-label', '')

  // Releasing there changes nothing at all — not the exam, and not the history.
  await page.mouse.up()
  expect(await renderedIds(page)).toEqual(['mc1', 'mc2', 'sa1'])
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  await expect(preview).toHaveCount(0)
})

test('a Question Bank question already on the exam offers no gesture', async ({ page }) => {
  await openWorkspace(page)

  // A reference occurs at most once, so the row that is on the exam is not a
  // drag source: pressing and moving it selects it and nothing more.
  await expect(bankRow(page, 'Cell membranes')).not.toHaveAttribute('data-draggable', 'true')
  await expect(bankRow(page, 'Spare choice question')).toHaveAttribute('data-draggable', 'true')

  await pickUp(page, 'Cell membranes', await zonePoint(rendered(page, 'mc2'), 'centre'))
  await expect(page.locator('.question-drag-preview')).toHaveCount(0)
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['mc1', 'mc2', 'sa1'])
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
})

const newSectionTarget = (page: Page) => page.locator('[data-new-section-after]')

test('a question of a type the Exam has no Section for starts one from the target beneath a Section', async ({ page }) => {
  // Multiple Choice questions only: there is no Short Answer Section for a
  // Short Answer question to join, so it can only start one.
  await openWorkspace(page, ['mc1', 'mc2'])
  await expect(newSectionTarget(page)).toHaveCount(0)

  const box = (await bankRow(page, 'Spare short answer').boundingBox())!
  await page.mouse.move(box.x + 30, box.y + box.height / 2)
  await page.mouse.down()
  // Near the foot of the Multiple Choice Section, the target slides open…
  const foot = (await rendered(page, 'mc2').boundingBox())!
  await page.mouse.move(foot.x + foot.width / 2, foot.y + foot.height + 2, { steps: 8 })
  await expect(newSectionTarget(page)).toContainText('Drop here to create a new section with this')
  // …and makes a Section only when the release is over it.
  const target = (await newSectionTarget(page).boundingBox())!
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 6 })
  await expect(newSectionTarget(page)).toHaveAttribute('data-active', 'true')
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['mc1', 'mc2', 'saSpare'])
  await expect(newSectionTarget(page)).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Short Answer heading' })).toHaveValue('Short Answer')
})

test('an empty Working Copy offers its placeholder as the first-question drop target', async ({ page }) => {
  await openWorkspace(page, [])

  // A blank sheet already draws where the first question goes, so that is what
  // a gesture aims at — not a second offer pinned somewhere else.
  const placeholder = page.getByText('Drag or add a Question from an open Question Bank')
  await expect(placeholder).toBeVisible()

  const box = (await bankRow(page, 'Spare choice question').boundingBox())!
  await page.mouse.move(box.x + 30, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 60, { steps: 6 })

  const offer = (await placeholder.boundingBox())!
  await page.mouse.move(offer.x + offer.width / 2, offer.y + offer.height / 2, { steps: 6 })
  await expect(placeholder).toHaveAttribute('data-active', 'true')
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['mcSpare'])
  // Its job done, the placeholder is gone.
  await expect(placeholder).toHaveCount(0)
})

test('a bank-to-draft drop is exactly one undoable action, and redoes', async ({ page }) => {
  await openWorkspace(page)
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeDisabled()

  await dragBankRowOnto(page, 'Spare choice question', rendered(page, 'mc1'), 'bottom')
  expect(await renderedIds(page)).toEqual(['mc1', 'mcSpare', 'mc2', 'sa1'])

  await page.keyboard.press('Control+z')
  expect(await renderedIds(page)).toEqual(['mc1', 'mc2', 'sa1'])
  // One gesture, one step: a second undo has nothing of this drop left to take.
  await expect(undo).toBeDisabled()

  await page.keyboard.press('Control+Shift+z')
  expect(await renderedIds(page)).toEqual(['mc1', 'mcSpare', 'mc2', 'sa1'])
})

test('dragging inside the Working Copy reorders and never Replaces', async ({ page }) => {
  await openWorkspace(page)

  const target = rendered(page, 'mc2')
  const box = (await rendered(page, 'mc1').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const centre = await zonePoint(target, 'centre')
  await page.mouse.move(centre.x, centre.y, { steps: 10 })

  // The source pane is what gives the gesture its meaning: from within the Exam
  // Draft the centre of a question is a placement like any other, so there is
  // no Replace anywhere on it.
  await expect(target).toHaveAttribute('data-drop', 'after')
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['mc2', 'mc1', 'sa1'])
  // A reorder, not a composition: the same three questions on the exam.
  await expect(bank(page).getByText('In exam')).toHaveCount(3)
})

test('a reordering drag stays inside its own Question Section', async ({ page }) => {
  await openWorkspace(page)

  const box = (await rendered(page, 'mc1').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const shortAnswer = await zonePoint(rendered(page, 'sa1'), 'centre')
  await page.mouse.move(shortAnswer.x, shortAnswer.y, { steps: 10 })

  // Released over the Short Answer section, it goes to the foot of its own.
  await expect(rendered(page, 'mc2')).toHaveAttribute('data-drop', 'after')
  await page.mouse.up()

  expect(await renderedIds(page)).toEqual(['mc2', 'mc1', 'sa1'])
})

/** An exam long enough to run past one screen: fourteen Multiple Choice
 *  questions, then two Short Answer ones below them. */
async function openLongExam(page: Page) {
  const many: Question[] = [
    ...Array.from({ length: 14 }, (_, index) =>
      question(`l${index}`, `Long question ${index}`, 'multiple-choice'),
    ),
    question('s1', 'First short answer', 'open'),
    question('s2', 'Second short answer', 'open'),
    question('sSpare', 'Spare short answer', 'open'),
  ]
  await seedAuthoringState(page, {
    questionBank: { questions: many },
    workingCopy: {
      title: 'A long exam',
      questionIds: many.slice(0, 16).map((item) => item.id),
    },
    dirty: false,
  })
  await expect(examQuestions(page)).toHaveCount(16)
}

test('a composed question landing off screen is scrolled to', async ({ page }) => {
  await openLongExam(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(rendered(page, 's1')).not.toBeInViewport()

  // Released at the very top of the exam, among the Multiple Choice questions:
  // it lands at the top of the Short Answer section, sheets below.
  await pickUp(page, 'Spare short answer', await zonePoint(rendered(page, 'l0'), 'top'))
  await page.mouse.up()

  expect((await renderedIds(page)).slice(-3)).toEqual(['sSpare', 's1', 's2'])
  await expect(rendered(page, 'sSpare')).toBeInViewport()
})

test('a reordered question landing off screen is scrolled to', async ({ page }) => {
  await openLongExam(page)

  // Pick the last Short Answer question up, scroll the exam back to its top
  // while holding it, and release there.
  const box = (await rendered(page, 's2').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 20, { steps: 5 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(rendered(page, 's1')).not.toBeInViewport()
  const top = await zonePoint(rendered(page, 'l0'), 'top')
  await page.mouse.move(top.x, top.y, { steps: 5 })
  await page.mouse.up()

  expect((await renderedIds(page)).slice(-2)).toEqual(['s2', 's1'])
  await expect(rendered(page, 's2')).toBeInViewport()
})

test('a composed question is selected and revealed after repagination', async ({ page }) => {
  // Enough questions for the exam to run past one screen, so the incoming one
  // genuinely has to be brought into view rather than happening to be there.
  const many: Question[] = [
    ...Array.from({ length: 14 }, (_, index) =>
      question(`l${index}`, `Long question ${index}`, 'multiple-choice'),
    ),
    question('lSpare', 'The spare one', 'multiple-choice'),
  ]
  await seedAuthoringState(page, {
    questionBank: { questions: many },
    workingCopy: {
      title: 'A long exam',
      questionIds: many.slice(0, 14).map((item) => item.id),
    },
    dirty: false,
  })
  await expect(examQuestions(page)).toHaveCount(14)

  // Add the spare question — it lands at the end of its Question Section, past
  // the bottom of the exam — then look away from where it will land.
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(rendered(page, 'l13')).not.toBeInViewport()

  await bankRow(page, 'The spare one')
    .getByRole('button', { name: /to the exam$/ })
    .click()

  // Repagination waits for content to settle, so the question is not on a page
  // in the frame the action was taken. It is scrolled to once it is.
  await expect(rendered(page, 'lSpare')).toBeInViewport()
  await expect(rendered(page, 'lSpare')).toHaveClass(/exam-question--selected/)
})

test('a row still selects on click after another row has been dragged', async ({ page }) => {
  await openWorkspace(page)

  await dragBankRowOnto(page, 'Spare choice question', rendered(page, 'mc1'), 'bottom')

  // The press that finished a drag is not a click, but that is true of one
  // press on one row — not of every click that follows it anywhere in the bank.
  await bankRow(page, 'Explain osmosis').click()
  await expect(bankRow(page, 'Explain osmosis')).toHaveAttribute('aria-current', 'true')
})
