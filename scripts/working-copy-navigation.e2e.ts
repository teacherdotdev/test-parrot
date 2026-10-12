import { expect, test } from '@playwright/test'

async function openEditor(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  await page.getByRole('textbox', { name: 'Exam name' }).waitFor()
}

test('in-app navigation warns only while a Working Copy backup is pending', async ({ page }) => {
  await openEditor(page)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'authoring-state') {
        throw new DOMException('Injected Working Copy failure', 'DataCloneError')
      }
      return original.call(this, value, key)
    }
    ;(window as unknown as { confirmCalls: string[] }).confirmCalls = []
    window.confirm = (message) => {
      ;(window as unknown as { confirmCalls: string[] }).confirmCalls.push(message)
      return false
    }
  })

  await page.getByRole('textbox', { name: 'Exam name' }).fill('Backup fails')
  await expect(page.getByLabel('Working Copy status')).toHaveText('Backup failed')
  await page.getByRole('link', { name: 'about' }).click()
  expect(await page.evaluate(() =>
    (window as unknown as { confirmCalls: string[] }).confirmCalls,
  )).toHaveLength(1)
  await expect(page.getByRole('textbox', { name: 'Exam name' })).toBeVisible()

  // A healthy backed-up copy changes routes without a confirmation.
  await page.reload()
  await page.getByRole('textbox', { name: 'Exam name' }).waitFor()
  await page.getByRole('link', { name: 'about' }).click()
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible()
})
