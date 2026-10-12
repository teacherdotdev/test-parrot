import { expect, test } from '@playwright/test'

test('Home creates a blank Exam that composes only from an open Question Bank', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Pick up where you left off', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Pick up where you left off' })).toContainText('Create your first Exam')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  await expect(page).toHaveURL(/\/editor$/)

  await expect(page.getByRole('textbox', { name: 'Exam name' })).toHaveValue('Untitled Exam')
  await expect(page.getByRole('main')).toContainText('Drag or add a Question from an open Question Bank')
  await expect(page.getByRole('button', { name: 'Insert your first question' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open Question Bank' })).toBeVisible()
})
