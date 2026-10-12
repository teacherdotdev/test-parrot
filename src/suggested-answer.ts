import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx'
import { createSlice } from '@milkdown/kit/ctx'
import { $nodeSchema, $prose, $view } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin } from '@milkdown/kit/prose/state'
import type { NodeView } from '@milkdown/kit/prose/view'

// Whether the question being edited keeps a Suggested Answer block. On for an
// Short Answer question in the editor, off everywhere else — a Multiple Choice
// question answers with its choices, and read-only views draw the stored
// Suggested Answer themselves rather than an editing region.
export const suggestedAnswerModeCtx = createSlice(false, 'suggestedAnswerMode')

export const suggestedAnswerMode = (enabled: boolean): MilkdownPlugin => (
  ctx,
) => {
  ctx.inject(suggestedAnswerModeCtx, enabled)
  return () => () => {
    ctx.remove(suggestedAnswerModeCtx)
  }
}

// The Suggested Answer region of a Short Answer question: one block holding a
// paragraph and any following blocks, exactly like a multiple-choice answer
// cell. It is authored inside the question document and lifted back out into
// the Question's own Suggested Answer when the dialog saves, so it never
// reaches storage or export.
export const suggestedAnswerSchema = $nodeSchema('suggestedAnswer', () => ({
  group: 'block',
  content: 'paragraph block*',
  defining: true,
  parseDOM: [{ tag: 'div[data-type="suggested-answer"]' }],
  toDOM: () => ['div', { 'data-type': 'suggested-answer' }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// Keep the block on the page. A teacher's answer is optional, so an empty block
// is the resting state rather than something to add: it is always there to type
// into, and leaving it empty is how a question ends up with no Suggested
// Answer. Backspacing or cutting it away therefore re-grows an empty one at the
// end of the document rather than removing the affordance for the rest of the
// editing session.
export const keepSuggestedAnswer = $prose((ctx: Ctx) =>
  new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!ctx.get(suggestedAnswerModeCtx)) return null
      if (!transactions.some((tr) => tr.docChanged)) return null
      let present = false
      newState.doc.forEach((node) => {
        if (node.type.name === 'suggestedAnswer') present = true
      })
      if (present) return null
      const block = newState.schema.nodes.suggestedAnswer
      const paragraph = newState.schema.nodes.paragraph
      if (!block || !paragraph) return null
      return newState.tr.insert(
        newState.doc.content.size,
        block.create(null, paragraph.create()),
      )
    },
  }),
)

// Node view: the label sits where a choice carries its radio, and the editable
// answer beside it. The label is the whole control — there is nothing to pick,
// so whatever is typed here is the Suggested Answer.
export const suggestedAnswerView = $view(
  suggestedAnswerSchema.node,
  () => (initialNode: ProseNode): NodeView => {
    let node: ProseNode = initialNode

    const dom = document.createElement('div')
    dom.className = 'sa-block'
    dom.dataset.type = 'suggested-answer'

    const label = document.createElement('div')
    label.className = 'sa-label'
    label.contentEditable = 'false'
    label.textContent = 'Suggested Answer'

    const contentDOM = document.createElement('div')
    contentDOM.className = 'sa-body'

    dom.append(label, contentDOM)

    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type !== node.type) return false
        node = next
        return true
      },
      ignoreMutation: (mutation) => label.contains(mutation.target),
      stopEvent: (event) => label.contains(event.target as Node),
    }
  },
)
