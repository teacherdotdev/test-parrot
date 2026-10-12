import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx'
import { createSlice } from '@milkdown/kit/ctx'
import { $nodeSchema, $prose, $useKeymap, $view } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import type { Command } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import {
  cellDepthOf,
  multipleChoiceEditableCtx,
  newlineInCell,
} from './multiple-choice'

// A matching set: the items a student numbers off on the left and the Word
// Bank they match them against on the right. Both live in one `matching`
// block — prompts first, then the bank — so the editor draws them as the two
// columns the paper prints, and a question holds at most one set.
//
// A prompt names the answer it matches by the answer's stable id rather than
// by its letter: letters are positions, and an arrangement that shuffles the
// bank moves the letters while every match stays put.

// Whether the question being edited is a matching set. On for one in the
// editor, off everywhere else: it is what lets the set be regrown if the
// teacher deletes it, since there is no other way to put one back.
export const matchingModeCtx = createSlice(false, 'matchingMode')

export const matchingMode = (enabled: boolean): MilkdownPlugin => (ctx) => {
  ctx.inject(matchingModeCtx, enabled)
  return () => () => {
    ctx.remove(matchingModeCtx)
  }
}

const MATCHING_CELLS = new Set(['matchingPrompt', 'matchingAnswer'])

/** The letter a Word Bank answer earns from its position — 'A', 'B', … then
 *  'AA', 'AB', … — which is what a prompt's blank asks for on paper. */
export function bankLetter(index: number): string {
  let letter = ''
  let remaining = index
  do {
    letter = String.fromCharCode(65 + (remaining % 26)) + letter
    remaining = Math.floor(remaining / 26) - 1
  } while (remaining >= 0)
  return letter
}

/** How many prompts and answers a fresh set opens with: enough to see the
 *  shape of the thing, and the count the request that added the type
 *  described. */
const NEW_SET_SIZE = 4

function promptJSON() {
  return {
    type: 'matchingPrompt',
    attrs: { id: crypto.randomUUID(), answer: '' },
    content: [{ type: 'paragraph' }],
  }
}

function answerJSON() {
  return {
    type: 'matchingAnswer',
    attrs: { id: crypto.randomUUID() },
    content: [{ type: 'paragraph' }],
  }
}

export function newMatchingNode() {
  return {
    type: 'matching',
    content: [
      ...Array.from({ length: NEW_SET_SIZE }, promptJSON),
      ...Array.from({ length: NEW_SET_SIZE }, answerJSON),
    ],
  }
}

// One item to match. Behaves like a choice: it holds a paragraph (and any
// following blocks), and which answer it names is a plain attribute.
export const matchingPromptSchema = $nodeSchema('matchingPrompt', () => ({
  content: 'paragraph block*',
  defining: true,
  // `id` gives each prompt a stable identity so ProseMirror matches node views
  // by prompt rather than by markup, as a choice's id does. `answer` is the id
  // of the Word Bank answer it matches, or '' while unmatched.
  attrs: { id: { default: '' }, answer: { default: '' } },
  parseDOM: [
    {
      tag: 'div[data-type="matching-prompt"]',
      getAttrs: (element) => ({
        id: (element as HTMLElement).getAttribute('data-id') ?? '',
        answer: (element as HTMLElement).getAttribute('data-answer') ?? '',
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'matching-prompt',
      'data-id': node.attrs.id,
      'data-answer': node.attrs.answer,
    },
    0,
  ],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// One Word Bank answer. It carries no correctness of its own: an answer is
// correct for whichever prompts name it, and a distractor is one no prompt
// does.
export const matchingAnswerSchema = $nodeSchema('matchingAnswer', () => ({
  content: 'paragraph block*',
  defining: true,
  attrs: { id: { default: '' } },
  parseDOM: [
    {
      tag: 'div[data-type="matching-answer"]',
      getAttrs: (element) => ({
        id: (element as HTMLElement).getAttribute('data-id') ?? '',
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    { 'data-type': 'matching-answer', 'data-id': node.attrs.id },
    0,
  ],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// The set: its prompts, then its Word Bank. The order is the schema's, so a
// set can never end up with an answer among its prompts, and neither list can
// be emptied — a set with nothing to number or nothing to choose from is not a
// matching set.
export const matchingSchema = $nodeSchema('matching', () => ({
  group: 'block',
  content: 'matchingPrompt+ matchingAnswer+',
  parseDOM: [{ tag: 'div[data-type="matching"]' }],
  toDOM: () => ['div', { 'data-type': 'matching' }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// Name the answer a prompt matches. `promptPosition` is the position directly
// before a prompt node; `answerId` is a Word Bank answer's id, or '' to leave
// the prompt unmatched.
export function setPromptAnswer(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  promptPosition: number,
  answerId: string,
) {
  const node = view.state.doc.nodeAt(promptPosition)
  if (node?.type.name !== 'matchingPrompt') return false
  if (node.attrs.answer === answerId) return true
  view.dispatch(
    view.state.tr.setNodeMarkup(promptPosition, undefined, {
      ...node.attrs,
      answer: answerId,
    }),
  )
  return true
}

/** The Word Bank of the set enclosing a prompt, as ids in authored order —
 *  the order that gives each answer its letter in the editor. */
function bankIdsOf(set: ProseNode): string[] {
  const ids: string[] = []
  set.forEach((child) => {
    if (child.type.name === 'matchingAnswer') ids.push(String(child.attrs.id))
  })
  return ids
}

// Tab / Shift-Tab move between cells — down the prompts, then down the bank —
// like a table. Tab past the last answer adds a new one (its id is filled in
// by uniqueChoiceIds).
function moveBetweenCells(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    const depth = cellDepthOf($from, MATCHING_CELLS)
    if (depth === 0) return false
    const setDepth = depth - 1
    const set = $from.node(setDepth)
    const setStart = $from.start(setDepth)
    const target = $from.index(setDepth) + direction
    if (target < 0) return false

    if (target >= set.childCount) {
      if (direction < 0) return false
      if (dispatch) {
        const paragraph = state.schema.nodes.paragraph
        const answer = state.schema.nodes.matchingAnswer
        if (!paragraph || !answer) return false
        const setEnd = $from.end(setDepth)
        const tr = state.tr.insert(setEnd, answer.create({ id: '' }, paragraph.create()))
        tr.setSelection(TextSelection.near(tr.doc.resolve(setEnd + 2)))
        dispatch(tr.scrollIntoView())
      }
      return true
    }

    if (dispatch) {
      let pos = setStart
      for (let index = 0; index < target; index += 1) pos += set.child(index).nodeSize
      const selection = TextSelection.near(state.doc.resolve(pos + 2), direction)
      dispatch(state.tr.setSelection(selection).scrollIntoView())
    }
    return true
  }
}

export const matchingKeymap = $useKeymap('matchingKeymap', {
  NewlineInMatchingCell: {
    shortcuts: 'Enter',
    priority: 100,
    command: () => newlineInCell(MATCHING_CELLS),
  },
  NextMatchingCell: {
    shortcuts: 'Tab',
    priority: 100,
    command: () => moveBetweenCells(1),
  },
  PrevMatchingCell: {
    shortcuts: 'Shift-Tab',
    priority: 100,
    command: () => moveBetweenCells(-1),
  },
})

/**
 * Keep the set on the page. A matching question without its prompts and Word
 * Bank is not a matching question, and the editor offers no way to put them
 * back, so a selection that swallowed the block regrows an empty set at the end
 * rather than leaving a question that cannot be answered or exported. Off for
 * every other question type.
 */
export const keepMatching = $prose((ctx: Ctx) =>
  new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!ctx.get(matchingModeCtx)) return null
      if (!transactions.some((tr) => tr.docChanged)) return null
      let present = false
      newState.doc.forEach((node) => {
        if (node.type.name === 'matching') present = true
      })
      if (present) return null
      if (!newState.schema.nodes.matching) return null
      return newState.tr.insert(
        newState.doc.content.size,
        newState.schema.nodeFromJSON(newMatchingNode()),
      )
    },
  }),
)

// The pick control in each prompt is a select listing the bank's letters. The
// bank is not the prompt's own content, so ProseMirror never tells a prompt's
// node view that the bank changed under it — an answer added, removed or
// reordered renumbers every letter without touching a single prompt node. So
// the selects are brought up to date after every state change here, from the
// document itself, rather than by each node view guessing.
function syncPicks(view: EditorView) {
  view.state.doc.forEach((node, offset) => {
    if (node.type.name !== 'matching') return
    const bank = bankIdsOf(node)
    const signature = bank.join(' ')
    let childPos = offset + 1
    node.forEach((child) => {
      if (child.type.name === 'matchingPrompt') {
        const dom = view.nodeDOM(childPos)
        const select =
          dom instanceof HTMLElement ? dom.querySelector('select.matching-pick') : null
        if (select instanceof HTMLSelectElement) {
          if (select.dataset.bank !== signature) {
            select.replaceChildren(
              new Option('—', ''),
              ...bank.map((id, index) => new Option(bankLetter(index), id)),
            )
            select.dataset.bank = signature
          }
          const answer = String(child.attrs.answer)
          select.value = bank.includes(answer) ? answer : ''
        }
      }
      childPos += child.nodeSize
    })
  })
}

export const syncMatchingPicks = $prose(
  () =>
    new Plugin({
      view: (view) => {
        syncPicks(view)
        return { update: syncPicks }
      },
    }),
)

// Node view for a prompt: the pick control on the left, where a choice carries
// its radio and the paper carries the blank, and the editable item beside it.
export const matchingPromptView = $view(
  matchingPromptSchema.node,
  (ctx: Ctx) => {
    return (initialNode, view, getPos): NodeView => {
      let node: ProseNode = initialNode
      const editable = () => ctx.get(multipleChoiceEditableCtx)

      const dom = document.createElement('div')
      dom.className = 'matching-prompt'
      dom.dataset.type = 'matching-prompt'

      const control = document.createElement('label')
      control.className = 'matching-pick-control'
      control.contentEditable = 'false'

      const select = document.createElement('select')
      select.className = 'matching-pick'
      select.setAttribute('aria-label', 'Answer this item matches')
      control.append(select)

      const contentDOM = document.createElement('div')
      contentDOM.className = 'matching-body'

      dom.append(control, contentDOM)

      const render = () => {
        select.disabled = !editable()
        dom.dataset.answer = String(node.attrs.answer)
      }

      select.addEventListener('change', () => {
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        setPromptAnswer(view, pos, select.value)
      })

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
        ignoreMutation: (mutation) => control.contains(mutation.target),
        stopEvent: (event) => control.contains(event.target as Node),
      }
    }
  },
)

// Node view for a Word Bank answer: its letter on the left — drawn by the
// stylesheet from its position, so it renumbers as the bank does — and the
// editable answer beside it.
export const matchingAnswerView = $view(
  matchingAnswerSchema.node,
  () => (initialNode: ProseNode): NodeView => {
    let node: ProseNode = initialNode

    const dom = document.createElement('div')
    dom.className = 'matching-answer'
    dom.dataset.type = 'matching-answer'

    const letter = document.createElement('span')
    letter.className = 'matching-letter'
    letter.contentEditable = 'false'

    const contentDOM = document.createElement('div')
    contentDOM.className = 'matching-body'

    dom.append(letter, contentDOM)

    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type !== node.type) return false
        node = next
        return true
      },
      ignoreMutation: (mutation) => letter.contains(mutation.target),
      stopEvent: (event) => letter.contains(event.target as Node),
    }
  },
)

// Node view for the whole set: a heading over each column, the two columns,
// and an "Add item" / "Add answer" button under each (editor only). Either
// button appends an empty cell to its column and drops the cursor into it;
// its id is filled in by uniqueChoiceIds.
export const matchingView = $view(
  matchingSchema.node,
  (ctx: Ctx) => {
    return (initialNode, view, getPos): NodeView => {
      let node: ProseNode = initialNode
      const editable = () => ctx.get(multipleChoiceEditableCtx)

      const dom = document.createElement('div')
      dom.className = 'matching-set'
      dom.dataset.type = 'matching'

      const heads = document.createElement('div')
      heads.className = 'matching-heads'
      heads.contentEditable = 'false'
      for (const text of ['Items', 'Word bank']) {
        const head = document.createElement('span')
        head.textContent = text
        heads.append(head)
      }

      const contentDOM = document.createElement('div')
      contentDOM.className = 'matching-grid'

      const actions = document.createElement('div')
      actions.className = 'matching-actions'
      actions.contentEditable = 'false'

      const addButton = (label: string, kind: 'matchingPrompt' | 'matchingAnswer') => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'matching-add'
        const plus = document.createElement('span')
        plus.className = 'mc-add-plus'
        plus.textContent = '+'
        const text = document.createElement('span')
        text.className = 'mc-add-label'
        text.textContent = label
        button.append(plus, text)
        button.addEventListener('mousedown', (event) => {
          event.preventDefault()
          add(kind)
        })
        actions.append(button)
        return button
      }

      // Append an empty cell to its column: a prompt goes after the last
      // prompt, an answer after the last answer, and the cursor follows it.
      const add = (kind: 'matchingPrompt' | 'matchingAnswer') => {
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        const paragraph = view.state.schema.nodes.paragraph
        const cellType = view.state.schema.nodes[kind]
        if (!paragraph || !cellType) return
        const attrs = kind === 'matchingPrompt' ? { id: '', answer: '' } : { id: '' }
        const cell = cellType.create(attrs, paragraph.create())
        let insertAt = pos + 1
        node.forEach((child) => {
          if (kind === 'matchingAnswer' || child.type.name === 'matchingPrompt') {
            insertAt += child.nodeSize
          }
        })
        const tr = view.state.tr.insert(insertAt, cell)
        tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 2)))
        view.dispatch(tr.scrollIntoView())
        view.focus()
      }

      addButton('Add item', 'matchingPrompt')
      addButton('Add answer', 'matchingAnswer')

      const render = () => {
        actions.style.display = editable() ? '' : 'none'
      }

      dom.append(heads, contentDOM, actions)
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
        ignoreMutation: (mutation) =>
          heads.contains(mutation.target) || actions.contains(mutation.target),
        stopEvent: (event) =>
          heads.contains(event.target as Node) || actions.contains(event.target as Node),
      }
    }
  },
)
