import { expect, test } from '@playwright/test'

test('Ctrl/Cmd+Z undo and Ctrl/Cmd+Shift+Z redo workspace edits', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  const title = page.getByRole('textbox', { name: 'Exam name' })
  const original = await title.inputValue()

  await title.fill('Control shortcut edit')
  await page.keyboard.press('Control+z')
  await expect(title).toHaveValue(original)
  await page.keyboard.press('Control+Shift+z')
  await expect(title).toHaveValue('Control shortcut edit')

  await title.fill('Command shortcut edit')
  await page.keyboard.press('Meta+z')
  await expect(title).toHaveValue('Control shortcut edit')
})

test('Ctrl/Cmd+Enter saves the question dialog', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()

  await page.getByRole('button', { name: 'Insert your first question' }).click()
  await page.getByRole('menuitem', { name: 'Multiple choice' }).click()
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeVisible()
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeHidden()
  await expect(page.locator('.exam-question')).toHaveCount(1)

  // The sheet's own way to write another one, now that there is a question to
  // add it below.
  await page.getByRole('button', { name: 'Actions for question 1' }).click()
  await page.getByRole('menuitem', { name: 'Add question below' }).click()
  await page.keyboard.press('Meta+Enter')
  await expect(page.getByRole('dialog', { name: 'Question editor' })).toBeHidden()
  await expect(page.locator('.exam-question')).toHaveCount(2)
})
