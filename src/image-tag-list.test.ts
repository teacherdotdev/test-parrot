import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { IMAGE_TAGS_SLOT, NO_LABELED_COPY, fillImageTags } from './image-tag-list'
import type { ImageTag } from './source-document'

const instructions = await Bun.file(join(import.meta.dir, '..', 'public', 'extract.md')).text()
const tag = (number: number, page: number): ImageTag => ({
  tag: number,
  page,
  box: { left: 100, top: 100, right: 400, bottom: 300 },
  width: 40,
  height: 30,
})

describe('the instructions an assistant is given', () => {
  test('keep one image tag slot, describe Pending Images, and never ask for embedded bytes', () => {
    expect(instructions.split(IMAGE_TAGS_SLOT)).toHaveLength(2)
    expect(instructions).toContain('"pending": { "image": 3 }')
    expect(instructions).toContain('Do not create Media Assets, and never write base64.')
    expect(instructions).not.toContain('does not describe it yet')
    expect(instructions).toContain('./formats/question-bank/0.10.0/schema.json')
  })

  test('ask for a test’s own Sections in printed order, linking an example that exists', async () => {
    expect(instructions).toContain('one Exam Record `0.5.0`')
    expect(instructions).toContain('./formats/exam/0.5.0/schema.json')
    expect(instructions).not.toMatch(/\.\/formats\/exam\/0\.[0-4]\.0\//)
    expect(instructions).toContain('It never sorts them by Question Type')
    const example = './formats/package/0.1.0/examples/printed-test.json'
    expect(instructions).toContain(example)
    expect(await Bun.file(join(import.meta.dir, '..', 'public', example)).exists()).toBe(true)
  })

  test('ask for answers only where the source gives them, and for the whole file again after a correction', () => {
    expect(instructions).toContain('**Mark an answer only where the source gives one**')
    expect(instructions).toContain('### Corrections')
    expect(instructions).toContain('deliver the **whole corrected file** again')
  })

  test('show a table as a block of its own', () => {
    expect(instructions).toContain('### Tables')
    expect(instructions).toContain('never inside a paragraph or under any member but `content`')
  })

  test('list a Source Document’s tags by page', () => {
    const filled = fillImageTags(instructions, [tag(1, 1), tag(2, 1), tag(3, 3), tag(4, 3), tag(5, 4)])

    expect(filled).not.toContain(IMAGE_TAGS_SLOT)
    expect(filled).toContain('Test Parrot printed 5 tags on it:\n\n- page 1: IMG 1, IMG 2\n- page 3: IMG 3, IMG 4\n- page 4: IMG 5')
  })

  test('say there is no labeled copy when no Source Document was uploaded first', () => {
    const filled = fillImageTags(instructions, null)

    expect(filled).not.toContain(IMAGE_TAGS_SLOT)
    expect(filled).toContain(NO_LABELED_COPY)
    expect(filled).not.toContain('IMG 1')
  })

  test('say so when a labeled copy has no pictures to tag', () => {
    expect(fillImageTags(instructions, [])).toContain('found no pictures to tag in this document')
  })

  test('list a Word document’s tags without pages, which it does not have', () => {
    const filled = fillImageTags(instructions, [tag(1, 1), tag(2, 1)], 'word')

    expect(filled).toContain('This is a labeled Word document. Test Parrot put 2 tags in it, each just before its picture:\n\n- IMG 1, IMG 2')
    expect(filled).toContain('`"pending": { "page": 1 }`')
    expect(filled).not.toContain('- page 1:')
    expect(fillImageTags(instructions, [], 'word')).toContain('found no pictures stored in this Word document')
  })
})
