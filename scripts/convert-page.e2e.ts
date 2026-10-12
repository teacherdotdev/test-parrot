import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { assistantPackage, picture, sourceDocument, wordSourceDocument } from './pending-images-fixtures'

/**
 * Converting a test starts from one drop zone, and shows only the path the
 * dropped file needs.
 */

/** The instructions a step downloads, as the teacher's AI reads them. */
async function downloadedInstructions(page: Page, steps: Locator) {
  const download = page.waitForEvent('download')
  await steps.getByRole('button', { name: 'Download the instructions' }).click()
  return readFile(await (await download).path(), 'utf8')
}

async function textOnlyPdf() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.addPage([612, 792]).drawText('1. Name the largest planet.', { x: 60, y: 730, size: 12, font })
  return Buffer.from(await pdf.save())
}

test('the convert page asks only for the test, then opens its import with the path it needs', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/get-started/convert')
  await expect(page.getByText('Drop your test here to get started')).toBeVisible()
  const steps = page.getByRole('region', { name: 'Convert your test' })
  await expect(steps).toHaveCount(0)

  // A PDF with pictures starts an import, opened in Imports, and goes to the
  // AI as a labeled copy.
  await page.getByLabel('Your test, a question file, or the file your AI gave back').setInputFiles({ name: 'unit-test.pdf', mimeType: 'application/pdf', buffer: await sourceDocument() })
  await expect(page).toHaveURL(/\/import\?id=/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Converting unit-test.pdf')
  await expect(page.getByLabel('About this import')).toContainText('Pictures detected2')
  await expect(steps.getByRole('button', { name: 'Download the labeled PDF' })).toBeVisible()
  await expect(steps).toContainText('Attach both downloads and send.')
  await expect(steps).not.toContainText('seven days')
  // A reload, while the teacher is in their AI chat, comes back to it.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Converting unit-test.pdf')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // A PDF that has no pictures needs no labeled copy.
  await page.goto('/get-started/convert')
  await page.getByLabel('Your test, a question file, or the file your AI gave back').setInputFiles({ name: 'planets.pdf', mimeType: 'application/pdf', buffer: await textOnlyPdf() })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Converting planets.pdf')
  await expect(page.getByLabel('About this import')).toContainText('Pictures detected0')
  await expect(steps.getByRole('button', { name: 'Download the labeled PDF' })).toHaveCount(0)
  expect(await downloadedInstructions(page, steps)).toContain('found no pictures to tag in this document')
  await expect(steps.getByRole('button', { name: 'Downloaded' })).toBeVisible()

  // A photo is converted as it is, and its pictures are cropped after.
  await page.goto('/get-started/convert')
  await page.getByLabel('Your test, a question file, or the file your AI gave back').setInputFiles({ name: 'quiz-photo.png', mimeType: 'image/png', buffer: Buffer.from(picture(600, 800, 3)) })
  await expect(page.getByLabel('About this import')).toContainText('Pictures detectedCropped after importing')
  await expect(steps).toContainText('Attach the instructions and your photo')
  // The whole step opens the list of assistants.
  await steps.getByRole('button', { name: 'Open your AI' }).click()
  await expect(steps.getByRole('menu', { name: 'Open an AI assistant' }).getByRole('menuitem')).toHaveText(['ChatGPT', 'Claude', 'Gemini'])
  await page.keyboard.press('Escape')
  await expect(steps.getByRole('menu')).toHaveCount(0)
  expect(await downloadedInstructions(page, steps)).toContain('There is no labeled copy of this source')

  const photoPackage = JSON.parse(assistantPackage().toString())
  const questions = photoPackage.questionBanks[0].record.bank.questions
  photoPackage.questionBanks[0].record.bank.questions = [{
    ...questions[0],
    stem: { type: 'document', content: [questions[0].stem.content[0], { type: 'block-image', pending: { page: 1 }, alt: 'Map' }] },
  }]
  photoPackage.exams[0].positions = [{ question: { bank: 'history', question: 'q1' } }]
  // The step itself chooses the file, as the drop below it does.
  const chooser = page.waitForEvent('filechooser')
  await steps.getByRole('button', { name: 'Drop the file it gives back' }).click()
  expect((await chooser).isMultiple()).toBe(false)
  await steps.getByLabel('File from your AI').setInputFiles({ name: 'quiz.parrot.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(photoPackage)) })
  const dialog = page.getByRole('dialog', { name: 'Import' })
  const photoPicture = dialog.getByLabel('Test preview').getByRole('button', { name: /^Question 1: / })
  await expect(photoPicture).toHaveAccessibleName('Question 1: picture needed. Change picture')
  await photoPicture.click()
  await dialog.getByRole('complementary', { name: 'Picture for Question 1' }).getByRole('button', { name: 'Crop from a page' }).click()
  const cropper = dialog.getByRole('group', { name: 'Crop a picture from a page' })
  await expect(cropper).toContainText('Page 1 of 1')
  await cropper.getByRole('button', { name: 'Use the whole page' }).click()
  await expect(photoPicture).toContainText('Cropped from page 1')
})

test('a Word document goes to the AI as a labeled copy, and its pictures come from the document', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/get-started/convert')
  const steps = page.getByRole('region', { name: 'Convert your test' })
  await page.getByLabel('Your test, a question file, or the file your AI gave back').setInputFiles({
    name: 'unit-test.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await wordSourceDocument(),
  })
  await expect(page.getByLabel('About this import')).toContainText('Pictures detected2')
  await expect(steps).toContainText('Attach both downloads and send.')

  const download = page.waitForEvent('download')
  await steps.getByRole('button', { name: 'Download the labeled document' }).click()
  expect((await download).suggestedFilename()).toBe('unit-test (labeled).docx')
  const instructions = await downloadedInstructions(page, steps)
  expect(instructions).toContain('This is a labeled Word document. Test Parrot put 2 tags in it, each just before its picture:\n\n- IMG 1, IMG 2')

  await steps.getByLabel('File from your AI').setInputFiles({ name: 'unit-test.parrot.json', mimeType: 'application/json', buffer: assistantPackage() })
  const dialog = page.getByRole('dialog', { name: 'Import' })
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  const preview = dialog.getByLabel('Test preview')
  await expect(preview.getByRole('status').filter({ hasText: /picture/ }))
    .toHaveText('3 of 5 pictures detected from unit-test.docx. Click a picture to change it.', { timeout: 30000 })
  const map = preview.getByRole('button', { name: /^Question 1: / })
  await expect(map).toContainText('Detected image · IMG 1')

  // A picture Word does not store as an image is uploaded: there is no page
  // to crop it from.
  await preview.getByRole('button', { name: /^Question 4: / }).click()
  const circuit = dialog.getByRole('complementary', { name: 'Picture for Question 4' })
  await expect(circuit.getByRole('button', { name: 'Crop from a page' })).toHaveCount(0)
  await circuit.getByLabel('Upload a picture for Question 4').setInputFiles({ name: 'circuit.png', mimeType: 'image/png', buffer: Buffer.from(picture(90, 60, 4)) })
  await expect(preview.getByRole('button', { name: /^Question 4: / })).toContainText('Uploaded')
})

test('a file from an AI that matches no import in progress, and needs its test’s pictures, is refused', async ({ page }) => {
  await page.goto('/get-started/convert')
  await page.getByLabel('Your test, a question file, or the file your AI gave back').setInputFiles({
    name: 'unit-test.parrot.json',
    mimeType: 'application/json',
    buffer: assistantPackage(),
  })
  await expect(page.getByRole('alert')).toHaveText('This file doesn’t match any test waiting in Imports. Drop the test it was made from first, then this file.')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/get-started\/convert$/)
})
