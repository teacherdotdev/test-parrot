import { expect, test, type Page } from '@playwright/test'

async function seedResources(page: Page, count = 8) {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  return page.evaluate(async (amount) => {
    const { createExamWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/exam-workspaces.ts'
    )) as typeof import('../src/exam-workspaces')
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    const exams = createExamWorkspaceService()
    const banks = createQuestionBankWorkspaceService()
    const ids: { exams: string[]; banks: string[] } = { exams: [], banks: [] }
    for (let index = 0; index < amount; index += 1) {
      const bank = await banks.create()
      await banks.commit(bank.id, {
        kind: 'rename',
        name:
          index === 3 ? 'Special Biology Bank' : `Question Bank ${index + 1}`,
      })
      await banks.commit(bank.id, {
        kind: 'create-question',
        question: {
          id: `question-${index}`,
          type: 'open',
          columns: 1,
          topics: [index === 3 ? 'Cell division' : `Topic ${index + 1}`],
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text:
                      index === 4
                        ? 'Secret mitochondria content'
                        : `Question ${index + 1}`,
                  },
                ],
              },
            ],
          },
        },
      })
      ids.banks.push(bank.id)
      const exam = await exams.create(
        index === 3 ? (await banks.read(bank.id))!.questions[0] : undefined,
      )
      const backend = exams.backendFor(exam.id)
      const working = (await backend.read())!
      working.workingCopy.title =
        index === 2 ? 'Special Algebra Exam' : `Exam ${index + 1}`
      working.dirty = index === 3
      await backend.write(working)
      ids.exams.push(exam.id)
    }
    return ids
  }, count)
}

test('Home empty state explains local storage without creating resources', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persisted', {
      configurable: true,
      value: async () => false,
    })
  })
  await page.goto('/')
  const storage = page.getByRole('button', { name: 'Where your work is stored' })
  await expect(storage).toBeVisible()
  await storage.click()
  await expect(page.getByRole('region', { name: 'Where your work is stored' })).toContainText(
    'Your work is saved in your browser.',
  )
  await storage.click()
  await expect(
    page.getByRole('button', { name: 'Create your first Exam' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Create your first Question Bank' }),
  ).toBeVisible()

  const counts = await page.evaluate(async () => {
    const { createExamWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/exam-workspaces.ts'
    )) as typeof import('../src/exam-workspaces')
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    return [
      (await createExamWorkspaceService().recent()).length,
      (await createQuestionBankWorkspaceService().recent()).length,
    ]
  })
  expect(counts).toEqual([0, 0])
})

test('Home provides keyboard-operable horizontal previews and full collections', async ({
  page,
}) => {
  await seedResources(page)
  await page.goto('/')

  const exams = page.getByRole('list', { name: 'Recent Exams' })
  const banks = page.getByRole('region', { name: 'Question Banks' })
  await expect(exams.getByRole('listitem')).toHaveCount(6)
  await expect(banks.locator('.question-bank-card')).toHaveCount(8)
  await expect(exams.getByText('Unsaved changes')).toBeVisible()
  await expect(banks.getByText('Used in 1 Exam')).toBeVisible()
  expect(
    await exams.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true)
  await exams.hover()
  await page.mouse.wheel(600, 0)
  await expect
    .poll(() => exams.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0)

  await page.getByRole('link', { name: 'Exams', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/exams$/)
  await expect(
    page
      .getByRole('region', { name: 'Exams search results' })
      .getByRole('button', { name: /^Open / }),
  ).toHaveCount(8)
  const search = page.getByRole('searchbox', { name: 'Search Exams' })
  await search.fill('special algebra')
  await expect(page.getByRole('status')).toHaveText('1 Exam')
  await search.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Exam name' })).toHaveValue(
    'Special Algebra Exam',
  )
})

test('Question Bank search matches names and Topics, not Question Content', async ({
  page,
}) => {
  await seedResources(page, 6)
  await page.goto('/question-banks')
  const search = page.getByRole('searchbox', { name: 'Search Question Banks' })
  const results = page.getByRole('region', {
    name: 'Question Banks search results',
  })

  await search.fill('cell division')
  await expect(results.locator('.question-bank-card')).toHaveCount(1)
  await expect(results).toContainText('Special Biology Bank')
  await search.fill('mitochondria')
  await expect(
    page.getByText('No Question Banks match “mitochondria”'),
  ).toBeVisible()
})

test('a Question Bank card states how many Exams depend on it', async ({
  page,
}) => {
  await seedResources(page, 6)
  await page.goto('/question-banks')
  const search = page.getByRole('searchbox', { name: 'Search Question Banks' })
  await search.fill('Special Biology')
  const results = page.getByRole('region', {
    name: 'Question Banks search results',
  })
  await expect(results.getByText('Used in 1 Exam')).toBeVisible()
  await search.fill('Question Bank 1')
  await expect(results.getByText('Not used in any Exams')).toBeVisible()
})

test('meaningful Question Bank changes update recency while browsing, composition, and formatting do not', async ({
  page,
}) => {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  const result = await page.evaluate(async () => {
    const { createExamWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/exam-workspaces.ts'
    )) as typeof import('../src/exam-workspaces')
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    let tick = 0
    const now = () => new Date(1_800_000_000_000 + tick++ * 1_000)
    const banks = createQuestionBankWorkspaceService({
      now,
      createId: () => 'bank-recency',
    })
    const exams = createExamWorkspaceService({
      now,
      createId: () => 'exam-recency',
    })
    const bank = await banks.create()
    const createdAt = bank.lastUpdatedAt
    const question = {
      id: 'recency-question',
      type: 'open' as const,
      columns: 1 as const,
      topics: ['Biology'],
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Original' }] },
        ],
      },
    }
    const created = await banks.commit(bank.id, {
      kind: 'create-question',
      question,
    })
    const exam = await exams.create(question)
    await banks.open(bank.id)
    await banks.openTab({ mode: 'exam', resourceId: exam.id }, bank.id)
    await banks.updateFilter({ mode: 'exam', resourceId: exam.id }, bank.id, {
      search: 'Original',
      types: [],
      difficulties: [],
      topics: [],
    })
    const afterBrowsing = (await banks.read(bank.id))!.lastUpdatedAt
    const backend = exams.backendFor(exam.id)
    const working = (await backend.read())!
    working.workingCopy.columns = { [question.id]: 2 }
    await backend.write(working)
    const afterCompositionAndFormatting = (await banks.read(bank.id))!
      .lastUpdatedAt
    const editedQuestion = {
      ...question,
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Edited' }] },
        ],
      },
    }
    const edited = await banks.commitCanonicalQuestion(
      bank.id,
      editedQuestion,
      (canonical) => exams.propagateCanonicalQuestion(canonical),
    )
    return {
      createdAt,
      questionCreatedAt: created.lastUpdatedAt,
      afterBrowsing,
      afterCompositionAndFormatting,
      editedAt: edited.lastUpdatedAt,
    }
  })

  expect(result.questionCreatedAt).not.toBe(result.createdAt)
  expect(result.afterBrowsing).toBe(result.questionCreatedAt)
  expect(result.afterCompositionAndFormatting).toBe(result.questionCreatedAt)
  expect(result.editedAt).not.toBe(result.questionCreatedAt)
})

test('Home reports a remembered persistent-storage denial', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('test-parrot:persistent-storage-denied', 'true')
    Object.defineProperty(navigator.storage, 'persisted', {
      configurable: true,
      value: async () => false,
    })
  })
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText(
    'Persistent storage was denied',
  )
})
