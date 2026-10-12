import { expect, test, type Page } from '@playwright/test'

async function createQuestion(page: Page, stem: string, type = 'Multiple choice') {
  await page.getByRole('button', { name: 'Add Question' }).click()
  await page.getByRole('menuitem', { name: type }).click()
  await page.keyboard.type(stem)
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeHidden()
}

test('Home creates and independently reopens durable Question Banks', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Question Banks' }).getByRole('button', { name: 'New Question Bank' })).toBeVisible()

  await page.getByRole('button', { name: 'New Question Bank' }).first().click()
  const name = page.getByRole('textbox', { name: 'Question Bank name' })
  await expect(name).toHaveValue('Untitled Question Bank')
  await name.fill('Biology')
  await createQuestion(page, 'Which animal is a mammal?')
  await expect(page.getByRole('region', { name: 'Question Bank' }).getByRole('listitem')).toContainText('Which animal is a mammal?')
  // The Question Bank page is not the Exam editor: nothing here composes an Exam.
  await expect(page.getByRole('button', { name: /^Add .* to the exam$/ })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Exam name' })).toHaveCount(0)

  await page.reload()
  await expect(name).toHaveValue('Biology')
  await expect(page.getByRole('region', { name: 'Question Bank' })).toContainText('Which animal is a mammal?')
  await page.getByRole('button', { name: 'Test Parrot home' }).click()
  await expect(page.getByRole('button', { name: 'Biology' })).toContainText('1 Question')

  await page.getByRole('button', { name: 'New Question Bank' }).first().click()
  await name.fill('Chemistry')
  await createQuestion(page, 'What is the symbol for oxygen?', 'Short answer')
  await page.getByRole('button', { name: 'Test Parrot home' }).click()
  const bankCards = page.getByRole('region', { name: 'Question Banks' }).locator('.question-bank-card')
  await expect(bankCards).toHaveCount(2)
  await expect(bankCards.nth(0)).toContainText('Chemistry')
  await expect(bankCards.nth(1)).toContainText('Biology')

  await page.getByRole('button', { name: 'Biology' }).click()
  await expect(name).toHaveValue('Biology')
  await expect(page.getByRole('region', { name: 'Question Bank' })).toContainText('Which animal is a mammal?')
  await expect(page).toHaveURL(/\/question-bank\?id=/)
})

test('IndexedDB enforces one bank owner and substantive update timestamps', async ({ page }) => {
  // About loads the same browser storage adapter without Home's intentional
  // placeholder sweep racing these deliberately incremental adapter calls.
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  const result = await page.evaluate(async () => {
    const { createQuestionBankWorkspaceService } = await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    ) as typeof import('../src/question-bank-workspaces')
    let day = 1
    const ids = ['bank-a', 'bank-b']
    const service = createQuestionBankWorkspaceService({
      now: () => new Date(`2026-01-${String(day++).padStart(2, '0')}T00:00:00.000Z`),
      createId: () => ids.shift()!,
    })
    const first = await service.create()
    const second = await service.create()
    const question = {
      id: 'question-a',
      type: 'open' as const,
      columns: 1 as const,
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Owned once' }] }] },
    }
    const created = await service.commit(first.id, { kind: 'create-question', question })
    const beforeOpen = created.lastUpdatedAt
    await service.open(first.id)
    const afterOpen = (await service.read(first.id))!.lastUpdatedAt
    const duplicated = await service.commit(first.id, { kind: 'duplicate-question', questionId: question.id })
    const duplicateId = duplicated.questions.find((candidate) => candidate.id !== question.id)!.id
    const editedQuestion = {
      ...question,
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited durably' }] }] },
    }
    const edited = await service.commit(first.id, { kind: 'update-question', question: editedQuestion })
    const deleted = await service.permanentlyDeleteQuestion(first.id, duplicateId, async () => ({
      rollback: async () => undefined,
      finalize: async () => undefined,
    }))
    const renamed = await service.commit(first.id, { kind: 'rename', name: 'Biology' })
    let ownershipError = ''
    try {
      await service.commit(second.id, { kind: 'create-question', question })
    } catch (error) {
      ownershipError = error instanceof Error ? error.message : String(error)
    }
    return {
      firstId: first.id,
      secondId: second.id,
      questionId: (await service.read(first.id))!.questions[0]?.id,
      secondCount: (await service.read(second.id))!.questions.length,
      beforeOpen,
      afterOpen,
      ownershipError,
      updateTimes: [created.lastUpdatedAt, duplicated.lastUpdatedAt, edited.lastUpdatedAt, deleted!.lastUpdatedAt, renamed.lastUpdatedAt],
      finalName: (await service.read(first.id))!.name,
      finalQuestionText: JSON.stringify((await service.read(first.id))!.questions[0]?.doc),
      recent: (await service.recent()).map((bank) => bank.id),
    }
  })

  expect(result.firstId).toBe('bank-a')
  expect(result.secondId).toBe('bank-b')
  expect(result.questionId).toBe('question-a')
  expect(result.secondCount).toBe(0)
  expect(result.afterOpen).toBe(result.beforeOpen)
  expect(result.ownershipError).toContain('already belongs')
  expect(result.updateTimes).toEqual([...result.updateTimes].sort())
  expect(new Set(result.updateTimes).size).toBe(result.updateTimes.length)
  expect(result.finalName).toBe('Biology')
  expect(result.finalQuestionText).toContain('Edited durably')
  expect(result.recent[0]).toBe('bank-a')
})

test('an abandoned placeholder bank is removed, while a renamed empty bank remains', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Question Bank' }).first().click()
  await page.getByRole('button', { name: 'Test Parrot home' }).click()
  await expect(page.getByRole('region', { name: 'Question Banks' }).getByRole('button', { name: 'New Question Bank' })).toBeVisible()

  await page.getByRole('button', { name: 'New Question Bank' }).first().click()
  const name = page.getByRole('textbox', { name: 'Question Bank name' })
  await name.fill('Empty but intentional')
  await name.press('Enter')
  await page.getByRole('button', { name: 'Test Parrot home' }).click()
  await expect(page.getByRole('button', { name: 'Empty but intentional' })).toContainText('0 Questions')
})
