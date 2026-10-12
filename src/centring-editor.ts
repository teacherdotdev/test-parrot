import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewCtx } from '@milkdown/kit/core'
import { imageBlockSchema } from '@milkdown/kit/component/image-block'
import { paragraphSchema } from '@milkdown/kit/preset/commonmark'
import { tableSchema } from '@milkdown/kit/preset/gfm'
import type { DOMOutputSpec, Node as ProseNode, NodeSpec, TagParseRule } from '@milkdown/kit/prose/model'
import { NodeSelection, Plugin, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose, $useKeymap } from '@milkdown/kit/utils'
import { CENTRABLE_NODES, CENTRE, UNCENTRED_CONTAINERS } from './centring'

// Centring in the question editor: the toolbar's Centre, Mod-Shift-E and a
// picture's context menu toggle `align: 'center'` on the paragraphs, block
// pictures and tables the selection touches (see `centring.ts`). Several
// blocks are centred together, and put back to the left together once all of
// them are centred. A list item's blocks and an answer's stay to the left.

/** The toolbar's Centre icon: lines of text centred under one another. */
export const centreIcon = `
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <path d="M4 5h16v2H4V5Zm3 4h10v2H7V9Zm-3 4h16v2H4v-2Zm3 4h10v2H7v-2Z" />
  </svg>`

type Target = { pos: number; node: ProseNode }

/** Whether a node at `pos` may be centred: a paragraph, picture or table
 *  outside any list item or answer. */
export function centrable(state: EditorState, pos: number, node: ProseNode): boolean {
  if (!CENTRABLE_NODES.has(node.type.name) || !node.type.spec.attrs?.align) return false
  const $pos = state.doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (UNCENTRED_CONTAINERS.has($pos.node(depth).type.name)) return false
  }
  return true
}

/** The blocks Centre acts on: a selected picture or table, or else every
 *  paragraph the selection touches and every picture and table it holds
 *  whole. */
export function centringTargets(state: EditorState): Target[] {
  const { selection } = state
  if (selection instanceof NodeSelection) {
    return centrable(state, selection.from, selection.node) ? [{ pos: selection.from, node: selection.node }] : []
  }
  const targets: Target[] = []
  const seen = new Set<number>()
  for (const range of selection.ranges) {
    const from = range.$from.pos
    const to = range.$to.pos
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (seen.has(pos)) return true
      const whole = pos >= from && pos + node.nodeSize <= to
      if (node.type.name === 'paragraph' || whole) {
        if (centrable(state, pos, node)) {
          seen.add(pos)
          targets.push({ pos, node })
        }
      }
      return true
    })
  }
  return targets
}

/** Whether everything Centre would act on is already centred. */
export function isSelectionCentred(state: EditorState): boolean {
  const targets = centringTargets(state)
  return targets.length > 0 && targets.every(({ node }) => node.attrs.align === CENTRE)
}

/** Centres the blocks the selection touches, or puts them back to the left
 *  when every one of them is centred already. */
export function toggleCentring(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const targets = centringTargets(state)
  if (targets.length === 0) return false
  if (dispatch) {
    const align = targets.every(({ node }) => node.attrs.align === CENTRE) ? null : CENTRE
    const tr = state.tr
    for (const { pos } of targets) tr.setNodeAttribute(pos, 'align', align)
    dispatch(tr.scrollIntoView())
  }
  return true
}

// ---- Schema ---------------------------------------------------------------

function alignFromDom(dom: HTMLElement): string | null {
  return dom.dataset.align === CENTRE || dom.style.textAlign === CENTRE || dom.getAttribute('align') === CENTRE
    ? CENTRE
    : null
}

/** `spec` with an `align` attribute, read from and written to the DOM so a
 *  Centred block keeps its centring when it is copied and pasted — and a
 *  paragraph pasted centred from another document arrives centred. */
export function withAlign<Spec extends NodeSpec>(spec: Spec): Spec {
  const toDOM = spec.toDOM
  return {
    ...spec,
    attrs: { ...spec.attrs, align: { default: null } },
    parseDOM: spec.parseDOM?.map((rule) => {
      if (!('tag' in rule)) return rule
      const getAttrs = (rule as TagParseRule).getAttrs
      return {
        ...rule,
        getAttrs: (dom: HTMLElement) => {
          const attrs = getAttrs ? getAttrs(dom) : null
          if (attrs === false) return false
          return { ...(attrs ?? {}), align: alignFromDom(dom) }
        },
      }
    }),
    toDOM: toDOM && ((node) => {
      const out = toDOM(node)
      if (node.attrs.align !== CENTRE || !Array.isArray(out)) return out
      const [tag, maybeAttrs, ...rest] = out as [string, ...unknown[]]
      const centred = { 'data-align': CENTRE, style: 'text-align: center' }
      const isAttrs = typeof maybeAttrs === 'object' && maybeAttrs !== null && !Array.isArray(maybeAttrs)
        && !(typeof Node !== 'undefined' && maybeAttrs instanceof Node)
      return (isAttrs
        ? [tag, { ...(maybeAttrs as Record<string, unknown>), ...centred }, ...rest]
        : [tag, centred, ...(maybeAttrs === undefined ? [] : [maybeAttrs]), ...rest]) as DOMOutputSpec
    }),
  }
}

/** Gives the editor's paragraph, block picture and table their `align`. */
export function configureCentring(ctx: Ctx) {
  for (const schema of [paragraphSchema, imageBlockSchema, tableSchema]) {
    ctx.update(schema.key, (prev) => (context) => withAlign(prev(context)))
  }
}

/** Marks every Centred block's own element, however it is drawn — Crepe draws
 *  pictures and tables with views of their own — so the stylesheet centres it. */
export const centringDecorations = $prose(() => new Plugin({
  props: {
    decorations(state) {
      const decorations: Decoration[] = []
      state.doc.descendants((node, pos) => {
        if (CENTRABLE_NODES.has(node.type.name) && node.attrs.align === CENTRE) {
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-align': CENTRE }))
        }
        return true
      })
      return DecorationSet.create(state.doc, decorations)
    },
  },
}))

/** Mod-Shift-E centres the selection, or puts it back to the left. */
export const centringKeymap = $useKeymap('centringKeymap', {
  ToggleCentre: {
    shortcuts: 'Mod-Shift-e',
    command: (ctx) => () => {
      const view = ctx.get(editorViewCtx)
      return toggleCentring(view.state, view.dispatch)
    },
  },
})

export function isCentreActive(ctx: Ctx): boolean {
  return isSelectionCentred(ctx.get(editorViewCtx).state)
}

export function toggleCentre(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx)
  toggleCentring(view.state, view.dispatch)
  view.focus()
}
