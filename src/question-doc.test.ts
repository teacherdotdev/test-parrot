import { describe, expect, test } from 'bun:test'
import {
  choiceIdOf,
  cleanDocument,
  choiceNodesOf,
  matchingBankNodesOf,
  matchingPromptNodesOf,
  multipleChoiceNodeOf,
  promptAnswerIdOf,
  stemNodesOf,
  suggestedAnswerDocumentOf,
  suggestedAnswerNodeOf,
  withFreshChoiceIds,
  withMultipleChoice,
  withSuggestedAnswer,
  withoutMultipleChoice,
  withoutSuggestedAnswer,
} from './question-doc'
import type { ProseMirrorJSON } from './question-doc'

function doc(...content: ProseMirrorJSON[]): ProseMirrorJSON {
  return { type: 'doc', content }
}

// A matching set whose prompts are `matches` (prompt id → answer id) and whose
// Word Bank is `bankIds`, in that order.
function matchingSet(matches: Record<string, string>, bankIds: string[]): ProseMirrorJSON {
  return {
    type: 'matching',
    content: [
      ...Object.entries(matches).map(([id, answer]) => ({
        type: 'matchingPrompt',
        attrs: { id, answer },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
      })),
      ...bankIds.map((id) => ({
        type: 'matchingAnswer',
        attrs: { id },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
      })),
    ],
  }
}

function choiceList(...ids: string[]): ProseMirrorJSON {
  return {
    type: 'multipleChoice',
    content: ids.map((id) => ({
      type: 'multipleChoiceChoice',
      attrs: { correct: id === ids[0], id },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
    })),
  }
}

describe('cleanDocument', () => {
  test('keeps a Centred paragraph, picture and table centred, and a left block free of any align', () => {
    const centred = { align: 'center' }
    const cleaned = cleanDocument(
      doc(
        { type: 'image-block', attrs: { src: '/a.png', align: 'center' } },
        { type: 'paragraph', attrs: centred, content: [{ type: 'text', text: 'Fig. 1.1' }] },
        {
          type: 'table',
          attrs: centred,
          content: [{
            type: 'table_row',
            content: [{ type: 'table_cell', content: [{ type: 'paragraph', attrs: centred }] }],
          }],
        },
        { type: 'paragraph', attrs: { align: null } },
        { type: 'heading', attrs: { level: 2, align: 'center' } },
        { type: 'paragraph', attrs: { align: 'right' } },
      ),
    )
    const [image, caption, table, left, heading, right] = cleaned.content as ProseMirrorJSON[]
    expect(image!.attrs).toEqual({ src: '/a.png', align: 'center' })
    expect(caption!.attrs).toEqual(centred)
    expect(table!.attrs).toEqual(centred)
    expect(JSON.stringify(table)).toContain('"table_cell","content":[{"type":"paragraph","attrs":{"align":"center"}')
    expect(left!.attrs).toEqual({})
    expect(heading!.attrs).toEqual({ level: 2 })
    expect(right!.attrs).toEqual({})
  })

  test('keeps the blocks of a list item or an answer to the left', () => {
    const centred = { type: 'paragraph', attrs: { align: 'center' } }
    const cleaned = cleanDocument(
      doc(
        { type: 'bullet_list', content: [{ type: 'list_item', content: [centred] }] },
        {
          type: 'multipleChoice',
          content: [
            { type: 'multipleChoiceChoice', attrs: { id: 'a', correct: true }, content: [centred] },
            { type: 'multipleChoiceChoice', attrs: { id: 'b', correct: false }, content: [centred] },
          ],
        },
      ),
    )
    expect(JSON.stringify(cleaned)).not.toContain('align')
  })

  test('keeps a heading its level', () => {
    const cleaned = cleanDocument(
      doc({
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Titration' }],
      }),
    )
    expect(cleaned).toEqual(
      doc({
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Titration' }],
      }),
    )
  })

  test('keeps an image its source', () => {
    const image = {
      type: 'image-block',
      attrs: { src: '/local-images/abc', caption: 'Setup', ratio: 1 },
    }
    expect(cleanDocument(doc(image))).toEqual(doc(image))
  })

  test('keeps a latex node its value', () => {
    const math = {
      type: 'paragraph',
      content: [{ type: 'math_inline', attrs: { value: 'H_2O' } }],
    }
    expect(cleanDocument(doc(math))).toEqual(doc(math))
  })

  test('keeps a link its href', () => {
    const paragraph = {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'source',
          marks: [{ type: 'link', attrs: { href: 'https://example.org', title: '' } }],
        },
      ],
    }
    expect(cleanDocument(doc(paragraph))).toEqual(doc(paragraph))
  })

  test('drops anything that is not part of a node', () => {
    const cleaned = cleanDocument(
      doc({
        type: 'paragraph',
        selected: true,
        content: [{ type: 'text', text: 'x', nodeSize: 3 }],
      }),
    )
    expect(cleaned).toEqual(
      doc({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }),
    )
  })

  test('normalises a choice to its correctness and its id', () => {
    const cleaned = cleanDocument(
      doc({
        type: 'multipleChoice',
        content: [
          {
            type: 'multipleChoiceChoice',
            attrs: { correct: 'yes', id: 7, stray: 1 },
            content: [{ type: 'paragraph' }],
          },
          {
            type: 'multipleChoiceChoice',
            attrs: { correct: true, id: 'c2' },
            content: [{ type: 'paragraph' }],
          },
        ],
      }),
    )
    const choices = choiceNodesOf(cleaned)
    expect(choices.map((choice) => choice.attrs)).toEqual([
      { correct: false, id: '' },
      { correct: true, id: 'c2' },
    ])
  })

  test('keeps a Side-by-Side to at most three Panels, none of them empty', () => {
    const cleaned = cleanDocument({
      type: 'doc',
      content: [
        {
          type: 'sideBySide',
          content: [
            { type: 'sideBySidePanel' },
            { type: 'paragraph' },
            { type: 'sideBySidePanel', content: [{ type: 'paragraph' }] },
            { type: 'sideBySidePanel', content: [{ type: 'paragraph' }] },
            { type: 'sideBySidePanel', content: [{ type: 'paragraph' }] },
          ],
        },
        { type: 'sideBySide' },
      ],
    })
    const [kept, emptied] = cleaned.content as ProseMirrorJSON[]
    const panels = kept!.content as ProseMirrorJSON[]
    expect(panels.map((panel) => panel.type)).toEqual(['sideBySidePanel', 'sideBySidePanel', 'sideBySidePanel'])
    expect(panels[0]!.content).toEqual([{ type: 'paragraph' }])
    expect((emptied!.content as ProseMirrorJSON[]).length).toBe(1)
  })

  test('never leaves a choice list with fewer than two answers', () => {
    const cleaned = cleanDocument(doc(choiceList('c1')))
    expect(choiceNodesOf(cleaned)).toHaveLength(2)
  })

  test('puts a matching set back in schema order and unmatches an item whose answer is gone', () => {
    const cleaned = cleanDocument(
      doc({
        type: 'matching',
        content: [
          { type: 'matchingAnswer', attrs: { id: 'a1' }, content: [{ type: 'paragraph' }] },
          { type: 'paragraph' },
          {
            type: 'matchingPrompt',
            attrs: { id: 'p1', answer: 'a1', stray: true },
            content: [{ type: 'paragraph' }],
          },
          {
            type: 'matchingPrompt',
            attrs: { id: 'p2', answer: 'a9' },
            content: [{ type: 'paragraph' }],
          },
        ],
      }),
    )
    expect(matchingPromptNodesOf(cleaned).map((prompt) => prompt.attrs)).toEqual([
      { id: 'p1', answer: 'a1' },
      { id: 'p2', answer: '' },
    ])
    // Padded to the two answers a set needs to choose between, and nothing
    // that is not a prompt or an answer survives inside it.
    const bank = matchingBankNodesOf(cleaned)
    expect(bank).toHaveLength(2)
    expect(bank[0]!.attrs).toEqual({ id: 'a1' })
    const set = (cleaned.content as ProseMirrorJSON[])[0]!
    expect((set.content as ProseMirrorJSON[]).map((node) => node.type)).toEqual([
      'matchingPrompt',
      'matchingPrompt',
      'matchingAnswer',
      'matchingAnswer',
    ])
  })
})

describe('stemNodesOf', () => {
  test('leaves out a matching set and the blank boundary paragraph before it', () => {
    const stem = { type: 'paragraph', content: [{ type: 'text', text: 'Match.' }] }
    const set = matchingSet({ p1: 'a1' }, ['a1', 'a2'])
    expect(stemNodesOf(doc(stem, { type: 'paragraph' }, set))).toEqual([stem])
    expect(stemNodesOf(doc(stem, set))).toEqual([stem])
  })
})

describe('withSuggestedAnswer and withoutSuggestedAnswer', () => {
  test('presents the stored answer in one inline editing document', () => {
    const stem = doc({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Explain osmosis.' }],
    })
    const answer = doc({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Water crosses a membrane.' }],
    })

    const editing = withSuggestedAnswer(stem, answer)

    expect(suggestedAnswerNodeOf(editing)?.content).toEqual(answer.content)
    expect(withoutSuggestedAnswer(editing)).toEqual(stem)
    expect(suggestedAnswerDocumentOf(editing)).toEqual(answer)
  })

  test('keeps a schema-valid blank stem while an untouched answer stays absent', () => {
    const editing = withSuggestedAnswer(doc({ type: 'paragraph' }))

    expect(withoutSuggestedAnswer(editing)).toEqual(doc({ type: 'paragraph' }))
    expect(suggestedAnswerDocumentOf(editing)).toBeUndefined()
  })
})

describe('withoutMultipleChoice and withMultipleChoice', () => {
  test('withoutMultipleChoice removes the choice list, keeping the rest of the document', () => {
    const stem = { type: 'paragraph', content: [{ type: 'text', text: 'stem' }] }
    const original = doc(stem, choiceList('c1', 'c2'))
    const lifted = withoutMultipleChoice(original)
    expect(lifted.content).toEqual([stem])
    expect(multipleChoiceNodeOf(lifted)).toBeUndefined()
    // The original document is untouched.
    expect(multipleChoiceNodeOf(original)).toBeDefined()
  })

  test('withMultipleChoice appends the given node to a document with none', () => {
    const stem = { type: 'paragraph' }
    const choices = choiceList('c1', 'c2')
    const withChoices = withMultipleChoice(doc(stem), choices)
    expect(withChoices.content).toEqual([stem, choices])
  })

  test('withMultipleChoice replaces an existing choice list rather than duplicating it', () => {
    const stem = { type: 'paragraph' }
    const original = doc(stem, choiceList('c1', 'c2'))
    const replacement = choiceList('c3', 'c4')
    const replaced = withMultipleChoice(original, replacement)
    expect(replaced.content).toEqual([stem, replacement])
  })
})

describe('withFreshChoiceIds', () => {
  test('gives every choice a new id so a duplicate shares none with its original', () => {
    const original = doc({ type: 'paragraph' }, choiceList('c1', 'c2'))
    const copy = withFreshChoiceIds(original)
    const ids = choiceNodesOf(copy).map(choiceIdOf)
    expect(new Set(ids).size).toBe(2)
    expect(ids).not.toContain('c1')
    expect(ids).not.toContain('c2')
  })

  test('renames a matching set\'s items and answers, and re-points every match at the new id', () => {
    const original = doc({ type: 'paragraph' }, matchingSet({ p1: 'a2', p2: '', p3: 'a2' }, ['a1', 'a2']))
    const copy = withFreshChoiceIds(original)
    const bank = matchingBankNodesOf(copy).map(choiceIdOf)
    const prompts = matchingPromptNodesOf(copy)
    expect(new Set([...bank, ...prompts.map(choiceIdOf)]).size).toBe(5)
    expect([...bank, ...prompts.map(choiceIdOf)]).not.toContain('a2')
    expect(prompts.map(promptAnswerIdOf)).toEqual([bank[1], '', bank[1]])
    expect(matchingPromptNodesOf(original).map(promptAnswerIdOf)).toEqual(['a2', '', 'a2'])
  })

  test('keeps everything else, correctness included, and leaves the original alone', () => {
    const original = doc({ type: 'paragraph' }, choiceList('c1', 'c2'))
    const copy = withFreshChoiceIds(original)
    expect(
      choiceNodesOf(copy).map((choice) => (choice.attrs as { correct: boolean }).correct),
    ).toEqual([true, false])
    expect(choiceNodesOf(copy).map((choice) => choice.content)).toEqual(
      choiceNodesOf(original).map((choice) => choice.content),
    )
    expect(choiceNodesOf(original).map(choiceIdOf)).toEqual(['c1', 'c2'])
  })
})
