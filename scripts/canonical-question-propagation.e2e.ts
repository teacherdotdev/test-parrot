import { expect, test } from '@playwright/test'

const question = {
  id: 'shared-question',
  type: 'open' as const,
  columns: 1 as const,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original wording' }] }] },
}

test('a canonical edit propagates to clean and dirty Exams without manufacturing Exam activity', async ({ page }) => {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  const setup = await page.evaluate(async (shared) => {
    const banksModule = '/src/question-bank-workspaces.ts'
    const examsModule = '/src/exam-workspaces.ts'
    const { createQuestionBankWorkspaceService } = await import(/* @vite-ignore */ banksModule) as typeof import('../src/question-bank-workspaces')
    const { createExamWorkspaceService } = await import(/* @vite-ignore */ examsModule) as typeof import('../src/exam-workspaces')
    let clock = 0
    const now = () => new Date(1_800_000_000_000 + clock++ * 1_000)
    const bankIds = ['owning-bank', 'other-bank']
    const bankService = createQuestionBankWorkspaceService({ now, createId: () => bankIds.shift()! })
    const bank = await bankService.create()
    await bankService.commit(bank.id, { kind: 'rename', name: 'Biology' })
    await bankService.commit(bank.id, { kind: 'create-question', question: shared })
    const otherBank = await bankService.create()
    await bankService.commit(otherBank.id, { kind: 'rename', name: 'Chemistry' })
    const ids = ['clean-exam', 'dirty-exam', 'working-only-exam', 'saved-only-exam']
    const examService = createExamWorkspaceService({ now, createId: () => ids.shift()! })
    const clean = await examService.create(shared)
    const cleanBackend = examService.backendFor(clean.id)
    const cleanWorking = (await cleanBackend.read())!
    const cleanSaved = { questionBank: cleanWorking.questionBank, workingCopy: cleanWorking.workingCopy }
    await cleanBackend.commitSaved(cleanSaved)
    const dirty = await examService.create(shared)
    const dirtyBackend = examService.backendFor(dirty.id)
    const dirtyWorking = (await dirtyBackend.read())!
    await dirtyBackend.commitSaved({ questionBank: dirtyWorking.questionBank, workingCopy: dirtyWorking.workingCopy })
    await dirtyBackend.write({ ...dirtyWorking, workingCopy: { ...dirtyWorking.workingCopy, title: 'My unsaved title' }, dirty: true })
    const workingOnly = await examService.create(shared)
    const workingOnlyState = (await examService.backendFor(workingOnly.id).read())!
    await examService.backendFor(workingOnly.id).write({
      ...workingOnlyState,
      workingCopy: { ...workingOnlyState.workingCopy, title: 'Working only' },
      dirty: true,
    })
    const savedOnly = await examService.create(shared)
    const savedOnlyBackend = examService.backendFor(savedOnly.id)
    const savedOnlyState = (await savedOnlyBackend.read())!
    await savedOnlyBackend.commitSaved({ questionBank: savedOnlyState.questionBank, workingCopy: savedOnlyState.workingCopy })
    await savedOnlyBackend.write({
      ...savedOnlyState,
      workingCopy: { ...savedOnlyState.workingCopy, title: 'Saved only', questionIds: [] },
      dirty: true,
    })
    await bankService.openTab({ mode: 'exam', resourceId: clean.id }, otherBank.id)
    return { bankId: bank.id, bankUpdatedAt: (await bankService.read(bank.id))!.lastUpdatedAt, cleanId: clean.id, dirtyId: dirty.id }
  }, question)

  await page.goto(`/editor?exam=${setup.cleanId}`)
  await expect(page.getByRole('textbox', { name: 'Exam name' })).toBeVisible()
  const recentBefore = await page.evaluate(async () => {
    const examsModule = '/src/exam-workspaces.ts'
    const { createExamWorkspaceService } = await import(/* @vite-ignore */ examsModule) as typeof import('../src/exam-workspaces')
    return createExamWorkspaceService().recent()
  })
  await page.locator('.exam-question').dblclick()
  const dialog = page.getByRole('dialog', { name: 'Question editor' })
  await expect(dialog.locator('.front-matter-field').filter({ hasText: 'Question Bank' })).toContainText('Biology')
  await expect(page.getByRole('tab', { name: 'Chemistry' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Biology' })).toHaveCount(0)
  await dialog.locator('.milkdown').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('Edited everywhere')
  await dialog.getByRole('button', { name: 'Save question' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.exam-question')).toContainText('Edited everywhere')
  await expect(page.getByLabel('Working Copy status')).toHaveText('Saved')
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()

  const result = await page.evaluate(async ({ cleanId, dirtyId, bankId }) => {
    const examsModule = '/src/exam-workspaces.ts'
    const banksModule = '/src/question-bank-workspaces.ts'
    const { createExamWorkspaceService } = await import(/* @vite-ignore */ examsModule) as typeof import('../src/exam-workspaces')
    const { createQuestionBankWorkspaceService } = await import(/* @vite-ignore */ banksModule) as typeof import('../src/question-bank-workspaces')
    const service = createExamWorkspaceService()
    const clean = await service.backendFor(cleanId).read()
    const dirty = await service.backendFor(dirtyId).read()
    const bankUpdatedAt = (await createQuestionBankWorkspaceService().read(bankId))!.lastUpdatedAt
    return { clean, dirty, recent: await service.recent(), bankUpdatedAt }
  }, { cleanId: setup.cleanId, dirtyId: setup.dirtyId, bankId: setup.bankId })
  expect(JSON.stringify(result.clean)).toContain('Edited everywhere')
  expect(JSON.stringify(result.dirty)).toContain('Edited everywhere')
  expect(result.dirty?.workingCopy.title).toBe('My unsaved title')
  expect(result.dirty?.dirty).toBe(true)
  expect(result.bankUpdatedAt).not.toBe(setup.bankUpdatedAt)
  expect(result.recent.map(({ id, lastOpenedAt }) => ({ id, lastOpenedAt }))).toEqual(
    recentBefore.map(({ id, lastOpenedAt }) => ({ id, lastOpenedAt })),
  )
})
