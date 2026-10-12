import { expect, test, type Locator } from '@playwright/test'

async function selectText(container: Locator, text: string, occurrence = 0) {
  await container.evaluate((element, { text, occurrence }) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    let node = walker.nextNode()
    while (node) {
      nodes.push(node as Text)
      node = walker.nextNode()
    }
    const content = nodes.map((item) => item.data).join('')
    let start = -1
    let from = 0
    for (let index = 0; index <= occurrence; index += 1) {
      start = content.indexOf(text, from)
      if (start < 0) break
      from = start + text.length
    }
    if (start >= 0) {
      const boundaryAt = (offset: number) => {
        let consumed = 0
        for (const item of nodes) {
          if (offset <= consumed + item.length) {
            return { node: item, offset: offset - consumed }
          }
          consumed += item.length
        }
        throw new Error('Selection boundary falls outside the editor')
      }
      const first = boundaryAt(start)
      const last = boundaryAt(start + text.length)
      const range = document.createRange()
      range.setStart(first.node, first.offset)
      range.setEnd(last.node, last.offset)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      element.dispatchEvent(new Event('selectionchange', { bubbles: true }))
      return
    }
    throw new Error(`Could not select ${JSON.stringify(text)}`)
  }, { text, occurrence })
}

async function pasteContent(
  target: Locator,
  content: { plain: string; html?: string },
) {
  await target.evaluate((element, { plain, html }) => {
    const clipboard = new DataTransfer()
    clipboard.setData('text/plain', plain)
    if (html) clipboard.setData('text/html', html)
    element.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    }))
  }, content)
}

test('authors can apply and persist semantic script formatting', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Exam' }).first().click()
  await page.getByRole('button', { name: 'Insert your first question' }).click()
  await page.getByRole('menuitem', { name: 'Multiple choice' }).click()

  const dialog = page.getByRole('dialog', { name: 'Question editor' })
  const editor = dialog.locator('.ProseMirror')
  await editor.locator('> p').first().fill('H2O and cm2')

  await selectText(editor, '2')
  await page.getByRole('button', { name: 'Subscript' }).click()
  await expect(editor.locator('sub')).toHaveText('2')

  await page.getByRole('button', { name: 'Save question' }).click()
  const question = page.locator('.exam-question').first()
  await expect(question.locator('.question-stem sub')).toHaveText('2')

  await question.dblclick()
  await expect(dialog.locator('.ProseMirror sub')).toHaveText('2')

  await selectText(editor, '2')
  await page.getByRole('button', { name: 'Superscript' }).click()
  await expect(editor.locator('sup')).toHaveText('2')
  await expect(editor.locator('sub')).toHaveCount(0)

  await selectText(editor, 'H2O')
  await page.getByRole('button', { name: 'Superscript' }).click()
  await expect(editor.locator('sup')).toHaveText('H2O')

  await selectText(editor, 'H2O')
  await page.getByRole('button', { name: 'Superscript' }).click()
  await expect(editor.locator('sup')).toHaveCount(0)

  await editor.locator('> p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Control+.')
  await page.keyboard.type('2')
  await expect(editor.locator('sup')).toHaveText('2')

  await page.keyboard.press('Control+.')
  await page.keyboard.type('B')
  await expect(editor.locator('sup')).toHaveText('2')

  await page.keyboard.press('Control+.')
  await page.keyboard.press('Control+,')
  await page.keyboard.type('3')
  await expect(editor.locator('sub')).toHaveText('3')
  await expect(editor.locator('sup')).toHaveText('2')

  await page.keyboard.press('Enter')
  await page.keyboard.type('plain')
  const newParagraph = editor.locator('> p').nth(1)
  await expect(newParagraph).toHaveText('plain')
  await expect(newParagraph.locator('sub, sup')).toHaveCount(0)

  const firstChoice = editor.locator('.mc-choice-body').first()
  await firstChoice.locator('p').fill('CO2 answer')
  await selectText(firstChoice, '2')
  const subscript = page.getByRole('button', { name: 'Subscript' })
  await expect(subscript).toHaveAttribute('title', 'Subscript (Ctrl+,)')
  await expect(subscript).toHaveAttribute('aria-keyshortcuts', 'Control+,')
  await expect(page.getByRole('button', { name: 'Superscript' })).toHaveAttribute(
    'title',
    'Superscript (Ctrl+.)',
  )
  await subscript.click()
  await expect(firstChoice.locator('sub')).toHaveText('2')

  await selectText(firstChoice, '2')
  await page.getByRole('button', { name: 'Bold' }).click()
  await expect(firstChoice.locator('sub strong, strong sub')).toHaveText('2')

  const secondChoice = editor.locator('.mc-choice-body').nth(1)
  await secondChoice.locator('p').fill('code plus x')
  await selectText(secondChoice, 'code')
  await page.getByRole('button', { name: 'Inline code' }).click()
  await selectText(secondChoice, 'code plus x')
  await subscript.click()
  await expect(secondChoice.locator('code')).toHaveText('code')
  await expect(secondChoice.locator('code sub, sub code')).toHaveCount(0)
  await expect(secondChoice.locator('sub')).toHaveText(' plus x')

  const thirdChoice = editor.locator('.mc-choice-body').nth(2)
  await thirdChoice.locator('p').fill('Rich ')
  await thirdChoice.locator('p').press('End')
  await pasteContent(thirdChoice.locator('p'), {
    plain: 'A23',
    html: '<span>A<sub>2</sub><sup>3</sup></span>',
  })
  await expect(thirdChoice.locator('sub')).toHaveText('2')
  await expect(thirdChoice.locator('sup')).toHaveText('3')

  await selectText(thirdChoice, 'Rich A23')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.keyboard.press('Control+c')
  const copied = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    const read = async (type: string) =>
      item.types.includes(type) ? await (await item.getType(type)).text() : ''
    return { html: await read('text/html'), plain: await read('text/plain') }
  })
  expect(copied.plain).toBe('Rich A23')
  expect(copied.html).toMatch(/<sub\b[^>]*>2<\/sub>/)
  expect(copied.html).toMatch(/<sup\b[^>]*>3<\/sup>/)

  const fourthChoice = editor.locator('.mc-choice-body').nth(3)
  await fourthChoice.locator('p').fill('Plain ')
  await fourthChoice.locator('p').click()
  await page.keyboard.press('End')
  await pasteContent(fourthChoice.locator('p'), { plain: 'H2O' })
  await expect(fourthChoice).toHaveText('Plain H2O')
  await expect(fourthChoice.locator('sub, sup')).toHaveCount(0)

  await fourthChoice.locator('p').fill('Plain H2O left m right')
  await selectText(fourthChoice, 'm')
  await page.getByRole('button', { name: 'Inline math' }).click()
  const inlineMath = fourthChoice.locator('[data-type="math_inline"]')
  await expect(inlineMath).toHaveCount(1)
  await fourthChoice.locator('p').click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.getByRole('button', { name: 'Subscript' }).click()
  await expect(fourthChoice.locator('sub [data-type="math_inline"]')).toHaveCount(0)
  await expect(inlineMath).toHaveCount(1)

  await selectText(secondChoice, 'plus x')
  await expect(page.locator('.milkdown-toolbar')).toHaveCSS(
    'background-color',
    'rgb(255, 253, 248)',
  )
  await expect(editor).toHaveCSS('caret-color', 'rgb(78, 59, 47)')
  await page.mouse.move(0, 0)
  await expect(subscript).toHaveCSS('background-color', 'rgb(244, 224, 207)')
  await expect(subscript.locator('svg')).toHaveCSS('fill', 'rgb(159, 80, 55)')
  await subscript.hover()
  await expect(subscript).toHaveCSS('background-color', 'rgb(242, 230, 216)')

  await page.getByRole('button', { name: 'Save question' }).click()
  await expect(question.locator('.choice-body').first().locator('sub')).toHaveText('2')
  await expect(
    question.locator('.choice-body').filter({ hasText: 'code plus x' }).locator('code'),
  ).toHaveText('code')

  // Reopened, the formatting is still in the document it was written into.
  await question.dblclick()
  await expect(editor.locator('.mc-choice-body').first().locator('sub')).toHaveText('2')
  await page.getByRole('button', { name: 'Save question' }).click()

  await question.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  const questions = page.locator('.exam-question')
  await expect(questions).toHaveCount(2)
  await expect(questions.nth(1).locator('.choice-body').first().locator('sub')).toHaveText('2')
})
