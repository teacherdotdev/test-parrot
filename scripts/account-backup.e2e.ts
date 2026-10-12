import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

/** Creates a Question Bank holding one Question with an image in it. */
async function seedAccount(page: Page, bankName: string) {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await page.evaluate(async (name) => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    const { saveImage } = (await import(
      /* @vite-ignore */ '/src/local-images.ts'
    )) as typeof import('../src/local-images')
    const canvas = new OffscreenCanvas(4, 3)
    const context = canvas.getContext('2d')!
    context.fillStyle = '#9f5037'
    context.fillRect(0, 0, 4, 3)
    const src = await saveImage(await canvas.convertToBlob({ type: 'image/png' }))
    const banks = createQuestionBankWorkspaceService()
    const bank = await banks.create()
    await banks.commit(bank.id, { kind: 'rename', name })
    await banks.commit(bank.id, {
      kind: 'create-question',
      question: {
        id: `question-${crypto.randomUUID()}`,
        type: 'open',
        columns: 1,
        topics: [],
        doc: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Label the cell.' }] },
            { type: 'image', attrs: { src, alt: '', title: '' } },
          ],
        },
      },
    })
  }, bankName)
}

async function bankNames(page: Page) {
  return page.evaluate(async () => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    return (await createQuestionBankWorkspaceService().recent()).map((bank) => bank.name).sort()
  })
}

async function mediaCount(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('test-parrot-exams-v1')
    const database = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result) })
    const count = database.transaction('media-assets').objectStore('media-assets').count()
    const result = await new Promise<number>((resolve) => { count.onsuccess = () => resolve(count.result) })
    database.close()
    return result
  })
}

async function renameOnlyBank(page: Page, name: string) {
  await page.evaluate(async (next) => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    const banks = createQuestionBankWorkspaceService()
    const [bank] = await banks.recent()
    await banks.commit(bank!.id, { kind: 'rename', name: next })
  }, name)
}

function panel(page: Page) {
  return page.getByRole('region', { name: 'Where your work is stored' })
}

async function openPanel(page: Page) {
  await page.getByRole('button', { name: 'Where your work is stored' }).click()
  await expect(panel(page)).toBeVisible()
}

function backupCard(page: Page) {
  return page.getByRole('region', { name: 'Back up your work' })
}

test('a downloaded account backup restores every Question Bank and image', async ({ page }) => {
  await seedAccount(page, 'Biology Bank')
  await page.goto('/question-banks')
  await openPanel(page)
  await expect(panel(page)).toContainText('Your work is saved in your browser.')
  await expect(panel(page)).toContainText('Go to Settings to export your data.')
  await panel(page).getByRole('button', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)

  const downloading = page.waitForEvent('download')
  await backupCard(page).getByRole('button', { name: 'Download backup' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^test-parrot-account-\d{4}-\d{2}-\d{2}\.zip$/)
  const backup = await readFile((await download.path())!)

  // Work that happens after the backup is what a restore replaces.
  await renameOnlyBank(page, 'Renamed after backup')
  await seedAccount(page, 'Made after backup')
  expect(await bankNames(page)).toEqual(['Made after backup', 'Renamed after backup'])
  expect(await mediaCount(page)).toBe(1)

  // Settings is also a destination in the left nav.
  await page.goto('/question-banks')
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Choose an account backup to restore').setInputFiles({
    name: 'test-parrot-account.zip', mimeType: 'application/zip', buffer: backup,
  })
  const confirm = page.getByRole('dialog', { name: 'Restore this backup?' })
  await expect(confirm).toContainText('replaces every Exam, Question Bank')
  await confirm.getByRole('button', { name: 'Replace and reload' }).click()

  await expect(backupCard(page)).toBeVisible()
  await page.goto('/question-banks')
  await expect(page.getByRole('button', { name: `Open Biology Bank. 1` })).toBeVisible()
  await expect(page.getByRole('button', { name: `Open Made after backup. 1` })).toHaveCount(0)
  expect(await bankNames(page)).toEqual(['Biology Bank'])
  expect(await mediaCount(page)).toBe(1)
})

test('a file that is not a backup is refused without changing anything', async ({ page }) => {
  await seedAccount(page, 'Keep me')
  await page.goto('/settings')
  await page.getByLabel('Choose an account backup to restore').setInputFiles({
    name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip'),
  })
  await expect(backupCard(page).getByRole('alert')).toHaveText('This file is not a Test Parrot account backup.')
  await expect(page.getByRole('dialog', { name: 'Restore this backup?' })).toHaveCount(0)
  expect(await bankNames(page)).toEqual(['Keep me'])
})
