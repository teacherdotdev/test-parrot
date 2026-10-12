import type { Ctx } from '@milkdown/kit/ctx'
import { $nodeSchema, $prose, $view } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { multipleChoiceEditableCtx } from './multiple-choice'

// A Side-by-Side: two or three equal Panels laid across one line of a stem —
// two graphs, two tables, a table beside a graph, a picture beside its text.
// Each Panel holds any blocks a stem can, but never another Side-by-Side, and a
// Side-by-Side belongs only to a stem: a Question's or a Part's, never an
// answer, a Blockquote or a table cell. The schema cannot say that — a Panel's
// blocks are the same `block` group a Side-by-Side is in — so the placement is
// kept by `keepSideBySidesInStems` instead.
//
// There is nothing to arrange: Panels are equal, their pictures and tables are
// centred across them, and they are centred against the tallest. The editor
// adds a Panel, removes one, and stacks a Side-by-Side back into the stem.

export const MAX_PANELS = 3

/** The slash menu's "Side by side" icon: two columns in a frame, filled as the
 *  menu fills its own icons. */
export const sideBySideIcon = `
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <path fill-rule="evenodd" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v14h6V5H5Zm8 0v14h6V5h-6Z" />
  </svg>`

type Editing = Pick<EditorView, 'state' | 'dispatch'>

function panelJSON() {
  return { type: 'sideBySidePanel', content: [{ type: 'paragraph' }] }
}

/** A new Side-by-Side: two empty Panels. */
export function newSideBySideJSON() {
  return { type: 'sideBySide', content: [panelJSON(), panelJSON()] }
}

// One Panel: any blocks.
export const sideBySidePanelSchema = $nodeSchema('sideBySidePanel', () => ({
  content: 'block+',
  defining: true,
  isolating: true,
  parseDOM: [{ tag: 'div[data-type="side-by-side-panel"]' }],
  toDOM: () => ['div', { 'data-type': 'side-by-side-panel' }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// The Side-by-Side: its Panels. One Panel is only ever passing through — see
// `unwrapLonePanels` — and the schema holds no more than three.
export const sideBySideSchema = $nodeSchema('sideBySide', () => ({
  group: 'block',
  content: `sideBySidePanel{1,${MAX_PANELS}}`,
  defining: true,
  isolating: true,
  parseDOM: [{ tag: 'div[data-type="side-by-side"]' }],
  toDOM: () => ['div', { 'data-type': 'side-by-side' }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// The nodes a Side-by-Side may sit directly inside: the top of the question
// document, which is its stem, and a Part's stem.
const STEMS = new Set(['doc', 'multipartPartStem'])

/** How many Side-by-Sides in `doc` sit anywhere but directly in a stem. */
export function misplacedSideBySides(doc: ProseNode): number {
  let misplaced = 0
  doc.descendants((node, _pos, parent) => {
    if (node.type.name === 'sideBySide' && !STEMS.has(parent?.type.name ?? '')) {
      misplaced += 1
    }
    return true
  })
  return misplaced
}

/** Whether a change may stand: it may not put a Side-by-Side where one does
 *  not belong. Counted rather than found, so a document that arrived already
 *  holding one out of place can still be edited. */
export function keepsSideBySidesInStems(tr: Transaction, before: EditorState): boolean {
  if (!tr.docChanged) return true
  return misplacedSideBySides(tr.doc) <= misplacedSideBySides(before.doc)
}

/** The change that turns every Side-by-Side left with one Panel back into
 *  that Panel's blocks, in its place in the stem — or null when none is. */
export function unwrapLonePanels(state: EditorState): Transaction | null {
  const lone: { pos: number; node: ProseNode }[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'sideBySide' && node.childCount === 1) lone.push({ pos, node })
    return true
  })
  if (lone.length === 0) return null
  const tr = state.tr
  // Last first, so every earlier position still holds.
  for (const { pos, node } of lone.reverse()) {
    tr.replaceWith(pos, pos + node.nodeSize, node.firstChild!.content)
  }
  return tr
}

/** Put a new Side-by-Side where the cursor is: in place of an empty block,
 *  after a block with writing in it. The cursor lands in its first Panel.
 *  Nothing happens where a Side-by-Side may not go. */
export function insertSideBySide(view: Editing): boolean {
  const { state } = view
  const { $from } = state.selection
  if ($from.depth < 1) return false
  const block = $from.node($from.depth)
  const container = $from.node($from.depth - 1)
  if (!STEMS.has(container.type.name)) return false
  const node = state.schema.nodeFromJSON(newSideBySideJSON())
  const start = $from.before($from.depth)
  const end = $from.after($from.depth)
  const blank = block.isTextblock && block.content.size === 0
  const tr = blank ? state.tr.replaceWith(start, end, node) : state.tr.insert(end, node)
  const at = blank ? start : end
  // Into the first Panel's paragraph: past the Side-by-Side and the Panel.
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 3)))
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Add an empty Panel at the end of the Side-by-Side at `pos`, and put the
 *  cursor in it. Nothing happens once it has three. */
export function addPanel(view: Editing, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos)
  if (node?.type.name !== 'sideBySide' || node.childCount >= MAX_PANELS) return false
  const panel = view.state.schema.nodeFromJSON(panelJSON())
  const at = pos + node.nodeSize - 1
  const tr = view.state.tr.insert(at, panel)
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2)))
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Remove the Panel at `pos`, and what it holds. A Side-by-Side left with one
 *  Panel becomes that Panel's blocks (see `unwrapLonePanels`). */
export function removePanel(view: Editing, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos)
  if (node?.type.name !== 'sideBySidePanel') return false
  const tr = view.state.tr.delete(pos, pos + node.nodeSize)
  view.dispatch(tr)
  return true
}

/** Stack the Side-by-Side at `pos` back into the stem: its Panels' blocks, in
 *  order, where it was. */
export function stackSideBySide(view: Editing, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos)
  if (node?.type.name !== 'sideBySide') return false
  const blocks: ProseNode[] = []
  node.forEach((panel) => panel.forEach((block) => { blocks.push(block) }))
  view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, blocks).scrollIntoView())
  return true
}

/** Keeps every Side-by-Side in a stem, and unwraps one left with one Panel. */
export const keepSideBySidesInStems = $prose(() =>
  new Plugin({
    filterTransaction(tr, state) {
      return keepsSideBySidesInStems(tr, state)
    },
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      return unwrapLonePanels(newState)
    },
  }),
)

// Lucide's icons, drawn outside React as the Multipart chrome draws them.
const ICON_PATHS = {
  plus: ['M5 12h14', 'M12 5v14'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  // "Rows 2": stack the Panels back into the stem.
  stack: ['M3 12h18', 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
} as const

function icon(name: keyof typeof ICON_PATHS) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) svg.setAttribute(key, value)
  for (const d of ICON_PATHS[name]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}

function control(name: keyof typeof ICON_PATHS, label: string, run: () => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'side-by-side-control'
  button.title = label
  button.setAttribute('aria-label', label)
  button.append(icon(name))
  // The button never takes focus, so the caret stays where the teacher left it.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    run()
  })
  return button
}

// Node view for a Side-by-Side: its Panels in a row, and on hover "Add panel"
// and "Stack panels" above it. Editor only: read-only views draw it from
// `doc-view.tsx`.
export const sideBySideView = $view(sideBySideSchema.node, (ctx: Ctx) => {
  return (initialNode, view, getPos): NodeView => {
    let node: ProseNode = initialNode
    const editable = () => ctx.get(multipleChoiceEditableCtx)
    const at = (run: (pos: number) => boolean) => () => {
      if (!editable()) return
      const pos = getPos()
      if (pos == null) return
      run(pos)
      view.focus()
    }

    const dom = document.createElement('div')
    dom.className = 'side-by-side'
    dom.dataset.type = 'side-by-side'

    const controls = document.createElement('div')
    controls.className = 'side-by-side-controls'
    controls.contentEditable = 'false'
    const add = control('plus', 'Add panel', at((pos) => addPanel(view, pos)))
    const stack = control('stack', 'Stack panels', at((pos) => stackSideBySide(view, pos)))
    controls.append(add, stack)

    const contentDOM = document.createElement('div')
    contentDOM.className = 'side-by-side-panels'

    dom.append(controls, contentDOM)

    const render = () => {
      contentDOM.style.gridTemplateColumns = `repeat(${Math.max(1, node.childCount)}, minmax(0, 1fr))`
      add.disabled = node.childCount >= MAX_PANELS
      controls.style.display = editable() ? '' : 'none'
    }
    render()

    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type !== node.type) return false
        node = next
        render()
        return true
      },
      stopEvent: (event) => controls.contains(event.target as Node),
      ignoreMutation: (mutation) =>
        mutation.type !== 'selection' && controls.contains(mutation.target),
    }
  }
})

// Node view for one Panel: its blocks, and on hover "Remove panel".
export const sideBySidePanelView = $view(sideBySidePanelSchema.node, (ctx: Ctx) => {
  return (_initialNode, view, getPos): NodeView => {
    const editable = () => ctx.get(multipleChoiceEditableCtx)
    const dom = document.createElement('div')
    dom.className = 'side-by-side-panel'
    dom.dataset.type = 'side-by-side-panel'
    const remove = control('x', 'Remove panel', () => {
      if (!editable()) return
      const pos = getPos()
      if (pos == null) return
      removePanel(view, pos)
      view.focus()
    })
    remove.classList.add('side-by-side-remove')
    remove.contentEditable = 'false'
    const contentDOM = document.createElement('div')
    contentDOM.className = 'side-by-side-panel-content'
    dom.append(remove, contentDOM)
    remove.style.display = editable() ? '' : 'none'
    return {
      dom,
      contentDOM,
      stopEvent: (event) => remove.contains(event.target as Node),
      ignoreMutation: (mutation) =>
        mutation.type !== 'selection' && remove.contains(mutation.target),
    }
  }
})
