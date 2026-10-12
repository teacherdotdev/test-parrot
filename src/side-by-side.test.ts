import { describe, expect, test } from 'bun:test'
import { Schema, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import {
  addPanel,
  insertSideBySide,
  keepsSideBySidesInStems,
  misplacedSideBySides,
  removePanel,
  stackSideBySide,
  unwrapLonePanels,
} from './side-by-side'

// The editor's shapes that matter here: a stem of blocks, a Blockquote, a
// Multiple Choice answer, a Part's stem, and the Side-by-Side and its Panels.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    multipleChoiceChoice: { content: 'paragraph block*' },
    multipleChoice: { group: 'block', content: 'multipleChoiceChoice+' },
    multipartPartStem: { group: 'block', content: 'block+' },
    sideBySidePanel: { content: 'block+' },
    sideBySide: { group: 'block', content: 'sideBySidePanel{1,3}' },
  },
})

const p = (text?: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const panel = (...blocks: object[]) => ({ type: 'sideBySidePanel', content: blocks })
const sideBySide = (...panels: object[]) => ({ type: 'sideBySide', content: panels })

function stateOf(...blocks: object[]): EditorState {
  return EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content: blocks }) })
}

/** A stand-in view: it applies what it is sent, as the editor would once its
 *  plugins agreed. */
function viewOf(state: EditorState) {
  const view = {
    state,
    dispatch(tr: Transaction) {
      if (!keepsSideBySidesInStems(tr, view.state)) return
      let next = view.state.apply(tr)
      const unwrapped = unwrapLonePanels(next)
      if (unwrapped) next = next.apply(unwrapped)
      view.state = next
    },
  }
  return view
}

function blocksOf(doc: ProseNode): string[] {
  const names: string[] = []
  doc.forEach((node) => { names.push(`${node.type.name}${node.type.name === 'sideBySide' ? `:${node.childCount}` : ''}`) })
  return names
}

/** The position of the first node named `name`. */
function positionOf(doc: ProseNode, name: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === name) found = pos
    return found < 0
  })
  return found
}

describe('a Side-by-Side belongs in a stem', () => {
  test('counts one inside a Blockquote, a choice or a Panel as out of place, and none in a stem or a Part’s stem', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        sideBySide(panel(p('a')), panel(p('b'))),
        { type: 'multipartPartStem', content: [sideBySide(panel(p('c')), panel(p('d')))] },
        { type: 'blockquote', content: [sideBySide(panel(p('e')), panel(p('f')))] },
        {
          type: 'multipleChoice',
          content: [{ type: 'multipleChoiceChoice', content: [p('g'), sideBySide(panel(p('h')), panel(p('i')))] }],
        },
        sideBySide(panel(sideBySide(panel(p('j')), panel(p('k')))), panel(p('l'))),
      ],
    })
    expect(misplacedSideBySides(doc)).toBe(3)
  })

  test('refuses a change that moves one out of a stem, but lets a document already holding one be edited', () => {
    const state = stateOf(sideBySide(panel(p('a')), panel(p('b'))), { type: 'blockquote', content: [p('quote')] })
    const quote = positionOf(state.doc, 'blockquote')
    const node = schema.nodeFromJSON(sideBySide(panel(p('x')), panel(p('y'))))
    expect(keepsSideBySidesInStems(state.tr.insert(quote + 1, node), state)).toBe(false)
    expect(keepsSideBySidesInStems(state.tr.insert(state.doc.content.size, node), state)).toBe(true)

    const misplaced = stateOf({ type: 'blockquote', content: [sideBySide(panel(p('a')), panel(p('b')))] })
    expect(keepsSideBySidesInStems(misplaced.tr.insertText('!', 4), misplaced)).toBe(true)
  })
})

describe('editing a Side-by-Side', () => {
  test('inserts two empty Panels in place of an empty paragraph, with the cursor in the first', () => {
    const state = stateOf(p('Read both graphs.'), p())
    const view = viewOf(state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc))))
    expect(insertSideBySide(view)).toBe(true)
    expect(blocksOf(view.state.doc)).toEqual(['paragraph', 'sideBySide:2'])
    expect(view.state.selection.$from.node(-1).type.name).toBe('sideBySidePanel')
    expect(view.state.selection.$from.index(-2)).toBe(0)
  })

  test('inserts after a paragraph with writing in it, and nowhere but a stem', () => {
    const state = stateOf(p('Read both graphs.'))
    const view = viewOf(state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc))))
    insertSideBySide(view)
    expect(blocksOf(view.state.doc)).toEqual(['paragraph', 'sideBySide:2'])

    const quoted = stateOf({ type: 'blockquote', content: [p()] })
    const inQuote = viewOf(quoted.apply(quoted.tr.setSelection(TextSelection.atEnd(quoted.doc))))
    expect(insertSideBySide(inQuote)).toBe(false)
    expect(blocksOf(inQuote.state.doc)).toEqual(['blockquote'])
  })

  test('adds Panels up to three and no further', () => {
    const view = viewOf(stateOf(sideBySide(panel(p('a')), panel(p('b')))))
    expect(addPanel(view, 0)).toBe(true)
    expect(blocksOf(view.state.doc)).toEqual(['sideBySide:3'])
    expect(addPanel(view, 0)).toBe(false)
    expect(blocksOf(view.state.doc)).toEqual(['sideBySide:3'])
  })

  test('removing down to one Panel leaves that Panel’s blocks in the stem', () => {
    const view = viewOf(stateOf(p('before'), sideBySide(panel(p('graph f')), panel(p('graph g'))), p('after')))
    removePanel(view, positionOf(view.state.doc, 'sideBySidePanel'))
    expect(blocksOf(view.state.doc)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(view.state.doc.textContent).toBe('beforegraph gafter')
  })

  test('stacks its Panels’ blocks back into the stem, in order', () => {
    const view = viewOf(stateOf(sideBySide(panel(p('a'), p('b')), panel(p('c')), panel(p('d')))))
    stackSideBySide(view, 0)
    expect(blocksOf(view.state.doc)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph'])
    expect(view.state.doc.textContent).toBe('abcd')
  })
})
