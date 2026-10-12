import { expect, test } from '@playwright/test'

test('typed -> and <- become real arrows', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  await page.getByRole('button', { name: 'Insert your first question' }).click()
  await page.getByRole('menuitem', { name: 'Multiple choice' }).click()

  const dialog = page.getByRole('dialog', { name: 'Question editor' })
  const editor = dialog.locator('.ProseMirror')
  await editor.locator('> p').first().click()
  await page.keyboard.type('solid -> liquid <- gas')

  await expect(editor).toContainText('solid → liquid ← gas')

  // And it is the arrow that is saved, not the two characters that produced it.
  await page.keyboard.press('Control+Enter')
  await expect(dialog).toBeHidden()
  await expect(page.locator('.exam-question').first()).toContainText(
    'solid → liquid ← gas',
  )
})
