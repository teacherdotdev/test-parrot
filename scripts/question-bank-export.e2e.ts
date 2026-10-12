import { expect, test, type Page } from '@playwright/test'

async function seed(page: Page) {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  return page.evaluate(async () => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    const service = createQuestionBankWorkspaceService({
      createId: () => 'bank-export',
    })
    const bank = await service.create()
    await service.commit(bank.id, {
      kind: 'rename',
      name: 'Chemistry: Review / 1',
    })
    await service.commit(bank.id, {
      kind: 'create-question',
      question: {
        id: 'question-first',
        type: 'open',
        columns: 1,
        difficulty: 'hard',
        topics: ['Matter'],
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Explain conservation of mass.' },
              ],
            },
          ],
        },
        suggestedAnswer: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Matter is not created or destroyed.' },
              ],
            },
          ],
        },
      },
    })
    await service.commit(bank.id, {
      kind: 'create-question',
      question: {
        id: 'question-second',
        type: 'multiple-choice',
        columns: 4,
        difficulty: 'easy',
        topics: ['Atoms'],
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Which particle is neutral?' }],
            },
            {
              type: 'multipleChoice',
              content: [
                {
                  type: 'multipleChoiceChoice',
                  attrs: { id: 'choice-a', correct: false },
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Proton' }],
                    },
                  ],
                },
                {
                  type: 'multipleChoiceChoice',
                  attrs: { id: 'choice-b', correct: true },
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Neutron' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    })
    return bank.id
  })
}

async function counts(page: Page, bankId: string) {
  return page.evaluate(async (id) => {
    const { createExamWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/exam-workspaces.ts'
    )) as typeof import('../src/exam-workspaces')
    const service = createExamWorkspaceService()
    const exams = await service.recent()
    const histories = await Promise.all(
      exams.map((exam) => service.backendFor(exam.id).readExportHistory()),
    )
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    const bank = await createQuestionBankWorkspaceService().read(id)
    return {
      exams: exams.length,
      history: histories.reduce(
        (sum, history) => sum + history.records.length,
        0,
      ),
      bankUpdatedAt: bank?.lastUpdatedAt,
      bankQuestionIds: bank?.questions.map((question) => question.id),
    }
  }, bankId)
}

test('teacher exports the complete active Question Bank without Exam or history side effects', async ({
  page,
}) => {
  const bankId = await seed(page)
  await page.goto(`/question-bank?id=${bankId}`)
  const before = await counts(page, bankId)

  // A visible filter must not change the authoritative stored order or scope.
  await page
    .getByRole('searchbox', { name: 'Search question stems' })
    .fill('neutral')
  await page.getByRole('button', { name: 'Export Question Bank' }).click()

  const preview = page.getByRole('dialog', { name: 'Export Question Bank' })
  await expect(preview).toContainText(
    'Teacher Question Bank containing answers',
  )
  await expect(preview).toContainText('2 Questions')
  await expect(preview).toContainText('Explain conservation of mass.')
  await expect(preview).toContainText('Matter is not created or destroyed.')
  await expect(preview).toContainText('Which particle is neutral?')
  await expect(preview).toContainText('Neutron')
  await expect(preview).toContainText('Correct answer')

  const downloadPromise = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'Download PDF' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(
    'chemistry-review-1.question-bank.pdf',
  )
  expect(await counts(page, bankId)).toEqual(before)
  await expect(
    page.getByRole('tab', { name: 'Chemistry: Review / 1' }),
  ).toHaveAttribute('aria-selected', 'true')
})

test('export dialog traps focus and cancellation produces no download', async ({ page }) => {
  const bankId = await seed(page)
  await page.goto(`/question-bank?id=${bankId}`)
  const trigger = page.getByRole('button', { name: 'Export Question Bank' })
  await trigger.focus()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Export Question Bank' })
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Download PDF' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  expect(downloads).toEqual([])
})

test('empty bank explains why export is unavailable and an open edit must be resolved', async ({
  page,
}) => {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  const emptyId = await page.evaluate(async () => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    return (
      await createQuestionBankWorkspaceService({
        createId: () => 'empty-export',
      }).create()
    ).id
  })
  await page.goto(`/question-bank?id=${emptyId}`)
  await expect(page.getByRole('button', { name: 'Export Question Bank' })).toBeDisabled()
  await expect(
    page.getByText('At least one Question is required.'),
  ).toBeVisible()

  const bankId = await seed(page)
  await page.goto(`/question-bank?id=${bankId}`)
  await page
    .getByRole('button', { name: /Edit Explain conservation of mass/ })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Question editor' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export Question Bank' })).toBeDisabled()
  await expect(
    page.getByText('Save or cancel the open Question edit before exporting.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Export Question Bank' })).toBeVisible()
})
