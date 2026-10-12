import { expect, test } from '@playwright/test'

test('on a short screen the slash menu’s Advanced group can still be reached and used', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 560 })
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  await page.getByRole('button', { name: 'New Question Bank' }).click()
  await page.getByRole('button', { name: 'Add Question' }).click()
  await page.getByRole('menuitem', { name: 'Multiple choice' }).click()

  const dialog = page.getByRole('dialog', { name: 'Question editor' })
  await expect(dialog).toBeVisible()
  await page.keyboard.type('Which of these is a table?')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  const menu = dialog.locator('.milkdown-slash-menu')
  await expect(menu).toBeVisible()

  await menu.locator('.tab-group li', { hasText: 'Advanced' }).click()

  // The whole menu stays in the editor, above the dialog's actions, so the
  // Advanced group it scrolled to is on screen rather than under the footer.
  const menuBox = (await menu.boundingBox())!
  const actionsBox = (await dialog.locator('.dialog-actions').boundingBox())!
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(actionsBox.y)
  await expect(menu.locator('.menu-group li', { hasText: 'Table' })).toBeInViewport({ ratio: 1 })
})
