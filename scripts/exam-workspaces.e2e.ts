import { expect, test } from '@playwright/test'

test('the IndexedDB workspace service keeps UUID identities and recency apart from authoring writes', async ({ page }) => {
  await page.goto('/')
  // The image worker may take control and reload once on the first visit.
  await page.getByRole('heading', { name: 'Pick up where you left off', exact: true }).waitFor()
  const result = await page.evaluate(async () => {
    const { createExamWorkspaceService } = await import(
      /* @vite-ignore */ '/src/exam-workspaces.ts'
    ) as typeof import('../src/exam-workspaces')
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]
    let index = 0
    let tick = 0
    const workspaces = createExamWorkspaceService({
      createId: () => ids[index++]!,
      now: () => new Date(`2026-01-01T00:00:0${tick++}.000Z`),
    })
    const first = await workspaces.create()
    const second = await workspaces.create()
    await workspaces.backendFor(first.id).write({
      questionBank: { questions: [] },
      workingCopy: { title: 'First stored Exam', questionIds: [] },
      dirty: true,
    })
    await workspaces.backendFor(second.id).write({
      questionBank: { questions: [] },
      workingCopy: { title: 'Second stored Exam', questionIds: [] },
      dirty: true,
    })
    await workspaces.open(first.id)
    const opened = await workspaces.recent()
    // This is a background authoring write. It must not call `open` or change
    // the registry's last-opened order.
    await workspaces.backendFor(second.id).write({
      questionBank: { questions: [] },
      workingCopy: { title: 'Second changed in background', questionIds: [] },
      dirty: true,
    })
    return {
      first,
      second,
      active: await workspaces.activeId(),
      opened: opened.map((exam) => exam.id),
      afterBackgroundWrite: (await workspaces.recent()).map((exam) => ({ id: exam.id, title: exam.title })),
    }
  })

  expect(result.first.id).toBe('11111111-1111-4111-8111-111111111111')
  expect(result.second.id).toBe('22222222-2222-4222-8222-222222222222')
  expect(result.active).toBe(result.first.id)
  expect(result.opened).toEqual([result.first.id, result.second.id])
  expect(result.afterBackgroundWrite).toEqual([
    { id: result.first.id, title: 'First stored Exam' },
    { id: result.second.id, title: 'Second changed in background' },
  ])
})

test('a failed Save As leaves the source Exam and active workspace unchanged', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('heading', { name: 'Pick up where you left off', exact: true }).waitFor()
  const result = await page.evaluate(async () => {
    const { createExamWorkspaceService } = await import(
      /* @vite-ignore */ '/src/exam-workspaces.ts'
    ) as typeof import('../src/exam-workspaces')
    const sourceId = '33333333-3333-4333-8333-333333333333'
    const targetId = '44444444-4444-4444-8444-444444444444'
    const ids = [sourceId, targetId]
    const workspaces = createExamWorkspaceService({ createId: () => ids.shift()! })
    await workspaces.create()
    const sourceBackend = workspaces.backendFor(sourceId)
    const source = {
      questionBank: { questions: [] },
      workingCopy: { title: 'Source Exam', questionIds: [] },
      dirty: false,
    }
    await sourceBackend.commitSaved(source)

    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'exam-workspace'
        && (value as { examId?: string }).examId === targetId) {
        throw new DOMException('simulated registry failure', 'QuotaExceededError')
      }
      return originalPut.call(this, value, key)
    } as IDBObjectStore['put']
    let message = ''
    try {
      await workspaces.saveAs(sourceId, {
        sourceRestored: source,
        targetInitial: {
          ...source,
          workingCopy: { ...source.workingCopy, title: 'Source Exam Copy' },
        },
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    } finally {
      IDBObjectStore.prototype.put = originalPut
    }

    return {
      message,
      active: await workspaces.activeId(),
      targetExists: await workspaces.exists(targetId),
      recent: (await workspaces.recent()).map((exam) => exam.id),
      source: await sourceBackend.read(),
    }
  })

  expect(result.message).toBe('simulated registry failure')
  expect(result.active).toBe('33333333-3333-4333-8333-333333333333')
  expect(result.targetExists).toBe(false)
  expect(result.recent).toEqual(['33333333-3333-4333-8333-333333333333'])
  expect(result.source).toMatchObject({ workingCopy: { title: 'Source Exam' }, dirty: false })
})
