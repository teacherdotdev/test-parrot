import { expect, test, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

async function resourceCount(page: Page) {
  return page.evaluate(async () => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    return (await createQuestionBankWorkspaceService().recent()).length
  })
}

async function questionBankPdf(name = 'Portable chemistry') {
  const record = {
    format: 'test-parrot/question-bank',
    formatVersion: '0.1.0',
    generator: { name: 'Independent Generator', version: '1' },
    requiredFeatures: [],
    bank: {
      name,
      description: 'A shared chemistry bank.',
      author: 'Ada Teacher',
      license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
      questions: [{
        id: 'q1', type: 'multiple-choice', difficulty: 'easy', topics: ['Atoms'],
        stem: { type: 'document', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Which particle is neutral?' }] }] },
        choices: [
          { id: 'q1-c1', content: { type: 'document', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Proton' }] }] }, correct: false },
          { id: 'q1-c2', content: { type: 'document', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Neutron' }] }] }, correct: true },
        ],
      }],
    },
    media: [],
  }
  const pdf = await PDFDocument.create()
  pdf.addPage()
  await pdf.attach(new TextEncoder().encode(JSON.stringify(record)), 'pdfcx.json', {
    description: 'pdf-canonical-extraction', mimeType: 'application/json',
  })
  return Buffer.from(await pdf.save({ useObjectStreams: false }))
}

test('imports a validated PDF as a durable independent bank and allows duplicate names', async ({ page }) => {
  await page.goto('/question-banks')
  await expect(page.getByRole('heading', { name: 'Question Banks', exact: true })).toBeVisible()
  const before = await resourceCount(page)
  const trigger = page.getByRole('button', { name: 'Import', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Import Question Bank' })
  await expect(dialog.getByLabel('Question Bank PDF')).toBeFocused()
  await dialog.getByLabel('Question Bank PDF').setInputFiles({ name: 'chemistry.pdf', mimeType: 'application/pdf', buffer: await questionBankPdf() })
  await expect(dialog).toContainText('1')
  await dialog.getByLabel('New Question Bank name').fill('My Chemistry')
  await dialog.getByRole('button', { name: 'Import Question Bank' }).click()
  await expect(page).toHaveURL(/\/question-bank\?id=/)
  await expect(page.getByRole('textbox', { name: 'Question Bank name' })).toHaveValue('My Chemistry')
  await expect(page.getByRole('region', { name: 'Question Bank', exact: true })).toContainText('Which particle is neutral?')
  expect(await resourceCount(page)).toBe(before + 1)

  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Question Bank name' })).toHaveValue('My Chemistry')
  await expect(page.getByRole('region', { name: 'Question Bank', exact: true })).toContainText('Which particle is neutral?')

  await page.goto('/question-banks')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const again = page.getByRole('dialog', { name: 'Import Question Bank' })
  await again.getByLabel('Question Bank PDF').setInputFiles({ name: 'chemistry.pdf', mimeType: 'application/pdf', buffer: await questionBankPdf('My Chemistry') })
  await again.getByRole('button', { name: 'Import Question Bank' }).click()
  await expect(page).toHaveURL(/\/question-bank\?id=/)
  await expect(page.getByRole('textbox', { name: 'Question Bank name' })).toHaveValue('My Chemistry')
  await expect.poll(() => resourceCount(page)).toBe(before + 2)
})

test('cancellation and invalid files preserve resources and restore useful focus', async ({ page }) => {
  await page.goto('/question-banks')
  await expect(page.getByRole('heading', { name: 'Question Banks', exact: true })).toBeVisible()
  const before = await resourceCount(page)
  const trigger = page.getByRole('button', { name: 'Import', exact: true })
  await trigger.click()
  let dialog = page.getByRole('dialog', { name: 'Import Question Bank' })
  await dialog.getByLabel('Question Bank PDF').setInputFiles({ name: 'chemistry.pdf', mimeType: 'application/pdf', buffer: await questionBankPdf() })
  await expect(dialog.getByLabel('New Question Bank name')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  expect(await resourceCount(page)).toBe(before)

  await trigger.click()
  dialog = page.getByRole('dialog', { name: 'Import Question Bank' })
  await dialog.getByLabel('Question Bank PDF').setInputFiles({ name: 'hostile.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await expect(dialog.getByRole('alert')).toContainText('not a valid PDF')
  await expect(dialog.getByLabel('Question Bank PDF')).toBeFocused()
  expect(await resourceCount(page)).toBe(before)
})

test('the review owns the viewport: the page behind it does not scroll', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 420 })
  await page.goto('/question-banks')
  await expect(page.getByRole('heading', { name: 'Question Banks', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import Question Bank' })
  await dialog.getByLabel('Question Bank PDF').setInputFiles({ name: 'chemistry.pdf', mimeType: 'application/pdf', buffer: await questionBankPdf() })
  await expect(dialog.getByLabel('New Question Bank name')).toBeVisible()
  // The page underneath is taller than the window, so it could scroll.
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true)

  await page.mouse.move(8, 8)
  await page.mouse.wheel(0, 600)
  await page.getByRole('heading', { name: 'Import Question Bank' }).hover()
  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
})

test('at a narrow width the import rail fills its row down to the actions and scrolls to its note', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 800 })
  await page.goto('/question-banks')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import Question Bank' })
  await dialog.getByLabel('Question Bank PDF').setInputFiles({ name: 'chemistry.pdf', mimeType: 'application/pdf', buffer: await questionBankPdf() })
  const rail = dialog.locator('.bank-import-controls')
  await expect(rail.getByLabel('New Question Bank name')).toBeVisible()

  // The rail goes under the questions and reaches the footer: no blank band
  // between the last row the rail shows and the dialog's actions.
  const railBox = (await rail.boundingBox())!
  const actionsBox = (await dialog.locator('.dialog-actions').boundingBox())!
  expect(Math.abs(railBox.y + railBox.height - actionsBox.y)).toBeLessThanOrEqual(1)

  // Its last line is reachable by scrolling the rail itself.
  await rail.hover()
  await page.mouse.wheel(0, 2000)
  await expect(rail.getByText('Import always creates a new Question Bank.')).toBeInViewport({ ratio: 1 })
})
