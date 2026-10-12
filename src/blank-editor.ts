// The Blank in the question editor: its schema, and the one command that
// makes a Blank from the selected words or turns one back into text. What a
// Blank is, and how every other view draws it, is in `blank.ts`.

import { $nodeSchema } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state'

export const blankSchema = $nodeSchema('blank', () => ({
  group: 'inline',
  inline: true,
  content: '(text | math_inline)*',
  // A selection that spans a Blank's edge takes the whole Blank, so a Blank is
  // never half-copied into a second one.
  defining: true,
  parseDOM: [{ tag: 'span[data-type="blank"]' }],
  toDOM: () => ['span', { 'data-type': 'blank', class: 'blank-chip' }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

/** The Blank the selection sits inside, with its position, if any. */
function enclosingBlank(state: EditorState): { node: ProseNode; pos: number } | null {
  const { $from, $to } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name !== 'blank') continue
    // Both ends inside the same Blank.
    if ($to.depth >= depth && $to.node(depth) === node) return { node, pos: $from.before(depth) }
    return null
  }
  return null
}

/** Whether the selection is inside a Blank, so the toolbar can show the
 *  control as on. */
export function isInBlank(state: EditorState): boolean {
  return enclosingBlank(state) !== null
}

/**
 * Turn the selection into a Blank, or a Blank back into text.
 *
 * Inside a Blank, the Blank is unwrapped and its answer stays as ordinary text.
 * Otherwise the selected words, within one paragraph, become the Blank's
 * answer; an empty selection inserts an empty Blank with the caret in it. A
 * selection across paragraphs, or holding anything a Blank cannot, is left
 * alone and the command reports that it did nothing.
 */
export function toggleBlank(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const blank = state.schema.nodes.blank
  if (!blank) return false
  const inside = enclosingBlank(state)
  if (inside) {
    if (dispatch) {
      const tr = state.tr.replaceWith(inside.pos, inside.pos + inside.node.nodeSize, inside.node.content)
      dispatch(tr.scrollIntoView())
    }
    return true
  }
  const { $from, $to, from, to, empty } = state.selection
  if (!$from.sameParent($to) || !$from.parent.inlineContent) return false
  if (!$from.parent.canReplaceWith($from.index(), $to.index(), blank)) return false
  if (empty) {
    if (dispatch) {
      const tr = state.tr.replaceSelectionWith(blank.create(), false)
      // The caret goes inside the new, empty Blank.
      tr.setSelection(TextSelection.create(tr.doc, from + 1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
  const content = state.doc.slice(from, to).content
  let fits = true
  content.forEach((node) => {
    if (!blank.contentMatch.matchType(node.type)) fits = false
  })
  if (!fits) return false
  if (dispatch) {
    const node = blank.create(null, content)
    const tr = state.tr.replaceWith(from, to, node)
    tr.setSelection(TextSelection.create(tr.doc, from + node.nodeSize))
    dispatch(tr.scrollIntoView())
  }
  return true
}


/** The Blank control's icon, for the toolbar and the slash menu: a word in a
 *  box with a line under it, drawn filled as Crepe's own icons are. */
export const blankIcon = `
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <path fill-rule="evenodd" d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v7h14V7H5Zm2 2h6v1.6H7V9Zm0 2.4h4v1.6H7v-1.6ZM3 18h18v2H3v-2Z" />
  </svg>`
