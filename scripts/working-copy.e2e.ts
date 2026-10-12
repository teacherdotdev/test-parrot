import { expect, test } from '@playwright/test'

test('Save, local recovery, and Discard keep an Exam Working Copy distinct from its saved Exam', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  const name = page.getByRole('textbox', { name: 'Exam name' })
  await name.fill('Saved composition')

  await page.keyboard.press('Control+S')
  const workingCopyStatus = page.getByLabel('Working Copy status')
  await expect(workingCopyStatus).toHaveText('Saved')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()

  await name.fill('Recovered Working Copy')
  await expect(workingCopyStatus).toHaveText('Unsaved changes · backed up locally')

  await page.reload()
  await expect(name).toHaveValue('Recovered Working Copy')
  await expect(workingCopyStatus).toHaveText('Unsaved changes · backed up locally')

  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Discard changes' }).click()
  await expect(name).toHaveValue('Saved composition')
  await expect(workingCopyStatus).toHaveText('Saved')
})

test('Save As moves a changed Working Copy into a named independent Exam', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  const name = page.getByRole('textbox', { name: 'Exam name' })
  await name.fill('Original exam')
  await page.keyboard.press('Control+S')
  await name.fill('Changed exam')

  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Save As' }).click()

  await expect(name).toHaveValue('Changed exam Copy')
  await expect(page.getByLabel('Working Copy status')).toHaveText('Saved')

  // The current editing session moved with the new Exam: its earlier rename
  // remains undoable and is now unsaved relative to the copied initial state.
  await page.keyboard.press('Control+Z')
  await expect(name).toHaveValue('Original exam')
  await expect(page.getByLabel('Working Copy status')).toHaveText('Unsaved changes · backed up locally')
  await page.keyboard.press('Control+Shift+S')
  await expect(name).toHaveValue('Original exam Copy')

  await page.getByRole('button', { name: 'Test Parrot home' }).click()
  await expect(page.getByRole('button', { name: 'Changed exam Copy' })).toBeVisible()
  await page.locator('.exam-card').filter({
    has: page.getByRole('heading', { name: 'Original exam', exact: true }),
  }).click()
  await expect(name).toHaveValue('Original exam')
})
