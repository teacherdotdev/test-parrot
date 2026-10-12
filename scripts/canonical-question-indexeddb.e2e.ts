import { expect, test } from '@playwright/test'

const sharedQuestion = {
  id: 'shared-mc', type: 'multiple-choice' as const, columns: 2 as const,
  doc: {
    type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Choose one' }] },
      { type: 'multipleChoice', content: ['a', 'b', 'c'].map((id) => ({
        type: 'multipleChoiceChoice', attrs: { id, correct: id === 'a' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
      })) },
    ],
  },
}

test('IndexedDB projection preserves stable arrangements and resets changed choice sets', async ({ page }) => {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  const result = await page.evaluate(async (question) => {
    const modulePath = '/src/exam-workspaces.ts'
    const { createExamWorkspaceService } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/exam-workspaces')
    const ids = ['first', 'second']
    const service = createExamWorkspaceService({ createId: () => ids.shift()! })
    const first = await service.create(question)
    const second = await service.create(question)
    for (const exam of [first, second]) {
      const backend = service.backendFor(exam.id)
      const working = (await backend.read())!
      const arranged = {
        ...working,
        workingCopy: { ...working.workingCopy, choiceOrder: { [question.id]: ['c', 'a', 'b'] } },
        dirty: exam.id === second.id,
      }
      await backend.commitSaved({ questionBank: arranged.questionBank, workingCopy: arranged.workingCopy })
      await backend.write(exam.id === second.id
        ? { ...arranged, workingCopy: { ...arranged.workingCopy, title: 'Unrelated edit' }, dirty: true }
        : { ...arranged, dirty: false })
    }
    const wording = structuredClone(question)
    wording.doc.content[0] = { type: 'paragraph', content: [{ type: 'text', text: 'Changed wording' }] }
    await service.propagateCanonicalQuestion(wording)
    const afterWording = await Promise.all([first, second].map(async (exam) => service.backendFor(exam.id).read()))
    const choices = structuredClone(wording)
    choices.doc.content[1].content.pop()
    await service.propagateCanonicalQuestion(choices)
    const afterChoices = await Promise.all([first, second].map(async (exam) => service.backendFor(exam.id).read()))
    return { afterWording, afterChoices }
  }, sharedQuestion)

  expect(result.afterWording.map((state) => state?.workingCopy.choiceOrder?.['shared-mc'])).toEqual([
    ['c', 'a', 'b'], ['c', 'a', 'b'],
  ])
  expect(result.afterWording[0]?.dirty).toBe(false)
  expect(result.afterWording[1]?.workingCopy.title).toBe('Unrelated edit')
  expect(result.afterWording[1]?.dirty).toBe(true)
  expect(result.afterChoices.map((state) => state?.workingCopy.choiceOrder?.['shared-mc'])).toEqual([undefined, undefined])
})

test('a failed cross-resource save restores the canonical Question and every Exam', async ({ page }) => {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  const result = await page.evaluate(async (question) => {
    const bankPath = '/src/question-bank-workspaces.ts'
    const examPath = '/src/exam-workspaces.ts'
    const { createQuestionBankWorkspaceService } = await import(/* @vite-ignore */ bankPath) as typeof import('../src/question-bank-workspaces')
    const { createExamWorkspaceService } = await import(/* @vite-ignore */ examPath) as typeof import('../src/exam-workspaces')
    const banks = createQuestionBankWorkspaceService({ createId: () => 'bank' })
    const bank = await banks.create()
    await banks.commit(bank.id, { kind: 'create-question', question })
    const exams = createExamWorkspaceService({ createId: () => 'exam' })
    const exam = await exams.create(question)
    const beforeExam = await exams.backendFor(exam.id).read()
    const beforeBank = await banks.read(bank.id)
    const edited = structuredClone(question)
    edited.doc.content[0] = { type: 'paragraph', content: [{ type: 'text', text: 'Must roll back' }] }
    let failed = false
    try {
      await banks.commitCanonicalQuestion(bank.id, edited, async () => {
        throw new Error('projection unavailable')
      })
    } catch { failed = true }
    return {
      failed,
      beforeExam,
      afterExam: await exams.backendFor(exam.id).read(),
      beforeBank,
      afterBank: await banks.read(bank.id),
    }
  }, sharedQuestion)
  expect(result.failed).toBe(true)
  expect(result.afterExam).toEqual(result.beforeExam)
  expect(result.afterBank).toEqual(result.beforeBank)
})
