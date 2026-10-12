import { describe, expect, test } from 'bun:test'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import { isSelectionCentred, toggleCentring, withAlign } from './centring-editor'

// The editor's shapes that matter here: paragraphs, a block picture, a table,
// a list, a Multiple Choice answer and a Panel — each centrable block with the
// `align` attribute `configureCentring` gives it.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: withAlign({ group: 'block', content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] }),
    'image-block': withAlign({ group: 'block', atom: true, attrs: { src: { default: '' } } }),
    table: withAlign({ group: 'block', content: 'table_row+', parseDOM: [{ tag: 'table' }], toDOM: () => ['table', ['tbody', 0]] }),
    table_row: { content: 'table_cell+' },
    table_cell: { content: 'paragraph+' },
    bullet_list: { group: 'block', content: 'list_item+' },
    list_item: { content: 'paragraph block*' },
    multipleChoice: { group: 'block', content: 'multipleChoiceChoice+' },
    multipleChoiceChoice: { content: 'paragraph block*' },
    sideBySide: { group: 'block', content: 'sideBySidePanel+' },
    sideBySidePanel: { content: 'block+' },
  },
})

const p = (text?: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const picture = { type: 'image-block', attrs: { src: '/fig.png' } }
const table = {
  type: 'table',
  content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [p('x')] }, { type: 'table_cell', content: [p('y')] }] }],
}

function stateOf(...blocks: object[]): EditorState {
  return EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content: blocks }) })
}

/** The document's centrable blocks, in order, as `name:align`. */
function alignments(state: EditorState): string[] {
  const found: string[] = []
  state.doc.descendants((node) => {
    if (node.type.spec.attrs?.align) found.push(`${node.type.name}:${node.attrs.align ?? 'left'}`)
    return true
  })
  return found
}

function toggled(state: EditorState): EditorState {
  let next = state
  expect(toggleCentring(state, (tr) => { next = state.apply(tr) })).toBe(true)
  return next
}

/** The position just inside the paragraph whose text is `text`. */
function inside(state: EditorState, text: string): number {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'paragraph' && node.textContent === text) found = pos + 1
    return true
  })
  return found
}

describe('Centre in the question editor', () => {
  test('centres the paragraph the cursor is in, and a second time puts it back to the left', () => {
    let state = stateOf(p('Look at the figure.'), p('Fig. 1.1'))
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, inside(state, 'Fig. 1.1'))))
    state = toggled(state)
    expect(alignments(state)).toEqual(['paragraph:left', 'paragraph:center'])
    expect(isSelectionCentred(state)).toBe(true)
    state = toggled(state)
    expect(alignments(state)).toEqual(['paragraph:left', 'paragraph:left'])
  })

  test('centres a figure and its caption selected together', () => {
    let state = stateOf(p('Intro'), picture, p('Fig. 1.1'))
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, inside(state, 'Intro') + 2, inside(state, 'Fig. 1.1') + 3)))
    state = toggled(state)
    expect(alignments(state)).toEqual(['paragraph:center', 'image-block:center', 'paragraph:center'])
  })

  test('centres a selected picture or table on its own', () => {
    let state = stateOf(p('Intro'), picture, table)
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, state.doc.child(0).nodeSize)))
    state = toggled(state)
    expect(alignments(state)).toEqual(['paragraph:left', 'image-block:center', 'table:left', 'paragraph:left', 'paragraph:left'])
    const tablePos = state.doc.child(0).nodeSize + state.doc.child(1).nodeSize
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, tablePos)))
    state = toggled(state)
    expect(alignments(state)).toEqual(['paragraph:left', 'image-block:center', 'table:center', 'paragraph:left', 'paragraph:left'])
  })

  test('centres a paragraph in a table cell or a Panel, not the table or Panel', () => {
    let state = stateOf(table, { type: 'sideBySide', content: [{ type: 'sideBySidePanel', content: [p('Panel text')] }] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, inside(state, 'y'))))
    state = toggled(state)
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, inside(state, 'Panel text'))))
    state = toggled(state)
    expect(alignments(state)).toEqual(['table:left', 'paragraph:left', 'paragraph:center', 'paragraph:center'])
  })

  test('centres all of a mixed selection when any of it is left', () => {
    let state = stateOf({ ...p('One'), attrs: { align: 'center' } }, p('Two'))
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, inside(state, 'Two') + 2)))
    expect(isSelectionCentred(state)).toBe(false)
    state = toggled(state)
    expect(alignments(state)).toEqual(['paragraph:center', 'paragraph:center'])
  })

  test('leaves a list item and an answer to the left', () => {
    let state = stateOf(
      { type: 'bullet_list', content: [{ type: 'list_item', content: [p('Item')] }] },
      { type: 'multipleChoice', content: [{ type: 'multipleChoiceChoice', content: [p('Answer')] }] },
    )
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, inside(state, 'Item'))))
    expect(toggleCentring(state)).toBe(false)
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, inside(state, 'Answer'))))
    expect(toggleCentring(state)).toBe(false)
  })
})

describe('a Centred block on the clipboard', () => {
  test('is written centred and read back centred, as is a paragraph centred elsewhere', () => {
    const spec = schema.nodes.paragraph!.spec
    const node = schema.nodes.paragraph!.create({ align: 'center' })
    expect(spec.toDOM!(node)).toEqual(['p', { 'data-align': 'center', style: 'text-align: center' }, 0])
    expect(spec.toDOM!(schema.nodes.paragraph!.create())).toEqual(['p', 0])
    const tableSpec = schema.nodes.table!.spec
    expect(tableSpec.toDOM!(schema.nodes.table!.createAndFill({ align: 'center' })!)).toEqual(
      ['table', { 'data-align': 'center', style: 'text-align: center' }, ['tbody', 0]],
    )
    const rule = spec.parseDOM![0] as { getAttrs: (dom: unknown) => unknown }
    const dom = (attrs: { align?: string; textAlign?: string }) => ({
      dataset: attrs.align ? { align: attrs.align } : {},
      style: { textAlign: attrs.textAlign ?? '' },
      getAttribute: () => null,
    })
    expect(rule.getAttrs(dom({ align: 'center' }))).toEqual({ align: 'center' })
    expect(rule.getAttrs(dom({ textAlign: 'center' }))).toEqual({ align: 'center' })
    expect(rule.getAttrs(dom({ textAlign: 'right' }))).toEqual({ align: null })
  })
})
