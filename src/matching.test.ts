import { describe, expect, test } from 'bun:test'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { bankLetter, newMatchingNode, setPromptAnswer } from './matching'

const schema = new Schema({
  nodes: {
    doc: { content: 'matching' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    matchingPrompt: {
      content: 'paragraph block*',
      attrs: { id: { default: '' }, answer: { default: '' } },
    },
    matchingAnswer: {
      content: 'paragraph block*',
      attrs: { id: { default: '' } },
    },
    matching: { content: 'matchingPrompt+ matchingAnswer+' },
  },
})

function build() {
  const prompt = schema.nodes.matchingPrompt!
  const answer = schema.nodes.matchingAnswer!
  const paragraph = schema.nodes.paragraph!
  const doc = schema.nodes.doc!.create(
    null,
    schema.nodes.matching!.create(null, [
      prompt.create({ id: 'p1', answer: '' }, paragraph.create()),
      prompt.create({ id: 'p2', answer: 'a1' }, paragraph.create()),
      answer.create({ id: 'a1' }, paragraph.create()),
      answer.create({ id: 'a2' }, paragraph.create()),
    ]),
  )
  let state = EditorState.create({ schema, doc })
  const view = {
    get state() {
      return state
    },
    dispatch(transaction: Parameters<typeof state.apply>[0]) {
      state = state.apply(transaction)
    },
  }
  return { get state() { return state }, view }
}

// The position directly before cell `index` of the single set.
function cellPos(state: EditorState, index: number) {
  const set = state.doc.firstChild!
  let pos = 1
  for (let i = 0; i < index; i += 1) pos += set.child(i).nodeSize
  return pos
}

describe('naming an item\'s answer', () => {
  test('sets the answer on that item alone', () => {
    const editor = build()
    expect(setPromptAnswer(editor.view, cellPos(editor.state, 0), 'a2')).toBe(true)
    const set = editor.state.doc.firstChild!
    expect([0, 1].map((i) => set.child(i).attrs.answer)).toEqual(['a2', 'a1'])
  })

  test('an empty id unmatches the item', () => {
    const editor = build()
    setPromptAnswer(editor.view, cellPos(editor.state, 1), '')
    expect(editor.state.doc.firstChild!.child(1).attrs.answer).toBe('')
  })

  test('is refused at a position that is not an item', () => {
    const editor = build()
    const before = editor.state
    expect(setPromptAnswer(editor.view, cellPos(editor.state, 2), 'a1')).toBe(false)
    expect(editor.state).toBe(before)
  })
})

describe('a new matching set', () => {
  test('opens with four blank items and four blank answers, nothing matched', () => {
    const node = newMatchingNode()
    const prompts = node.content.filter((cell) => cell.type === 'matchingPrompt')
    const answers = node.content.filter((cell) => cell.type === 'matchingAnswer')

    expect(prompts).toHaveLength(4)
    expect(answers).toHaveLength(4)
    // Items first, then the bank: the order the schema requires.
    expect(node.content.map((cell) => cell.type)).toEqual([
      ...prompts.map(() => 'matchingPrompt'),
      ...answers.map(() => 'matchingAnswer'),
    ])
    expect(prompts.every((cell) => (cell.attrs as { answer: string }).answer === '')).toBe(true)
    expect(node.content.every((cell) => cell.content[0]!.type === 'paragraph')).toBe(true)
  })

  test('gives every item and answer its own stable id', () => {
    const ids = [...newMatchingNode().content, ...newMatchingNode().content].map(
      (cell) => cell.attrs.id,
    )
    expect(new Set(ids).size).toBe(16)
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })
})

describe('word bank letters', () => {
  test('are the answer\'s position, and keep counting past Z', () => {
    expect([0, 1, 25, 26, 27].map(bankLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB'])
  })
})
