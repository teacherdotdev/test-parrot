import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx'
import { createSlice } from '@milkdown/kit/ctx'
import { $nodeSchema, $prose, $useKeymap, $view } from '@milkdown/kit/utils'
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import type { Command } from '@milkdown/kit/prose/state'
import { splitBlock } from '@milkdown/kit/prose/commands'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { isLocked, type AnswerLock } from './locked-answers'

// Whether the radio buttons can change the correct answer. Off in read-only
// previews, on inside the question editor.
export const multipleChoiceEditableCtx = createSlice(
  false,
  'multipleChoiceEditable',
)

// Whether the answer list is the fixed pair a True/False question asks with.
// On for a True/False question in the editor, off everywhere else: its two
// answers are the question type rather than authored content, so the teacher
// picks which of them is correct and nothing else about the pair is editable.
export const multipleChoiceFixedCtx = createSlice(false, 'multipleChoiceFixed')

export const multipleChoiceMode = (
  editable: boolean,
  fixedChoices = false,
): MilkdownPlugin => (ctx) => {
  ctx.inject(multipleChoiceEditableCtx, editable)
  ctx.inject(multipleChoiceFixedCtx, fixedChoices)
  return () => () => {
    ctx.remove(multipleChoiceEditableCtx)
    ctx.remove(multipleChoiceFixedCtx)
  }
}

// Mark one choice as correct and clear the rest, so the radios stay mutually
// exclusive. `choicePosition` is the position directly before a choice node.
export function selectCorrectChoice(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  choicePosition: number,
) {
  const $choice = view.state.doc.resolve(choicePosition)
  const parent = $choice.parent
  if (parent.type.name !== 'multipleChoice') return false
  const tr = view.state.tr
  let pos = $choice.start()
  parent.forEach((child) => {
    const correct = pos === choicePosition
    if (child.attrs.correct !== correct) {
      tr.setNodeMarkup(pos, undefined, { ...child.attrs, correct })
    }
    pos += child.nodeSize
  })
  if (tr.docChanged) view.dispatch(tr)
  return true
}

/** Whether a choice is a Locked Answer: the teacher's decision when there is
 *  one, otherwise what its words say (ADR-0038). */
export function choiceNodeIsLocked(node: ProseNode): boolean {
  return isLocked(node.attrs.locked as AnswerLock, node.textBetween(0, node.content.size, ' ', ' '))
}

// Record the teacher's own decision about one choice's lock, which from then
// on outranks its wording. `choicePosition` is the position directly before a
// choice node.
export function setChoiceLock(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  choicePosition: number,
  locked: boolean,
) {
  const choice = view.state.doc.nodeAt(choicePosition)
  if (choice?.type.name !== 'multipleChoiceChoice') return false
  if (choice.attrs.locked !== locked) {
    view.dispatch(
      view.state.tr.setNodeMarkup(choicePosition, undefined, { ...choice.attrs, locked }),
    )
  }
  return true
}

/** Where answer `index` of `count` lands when it moves one place up (`-1`)
 *  or down (`1`), or null when it is already at that end of the list. */
export function answerMoveTarget(count: number, index: number, direction: 1 | -1): number | null {
  const target = index + direction
  return index >= 0 && index < count && target >= 0 && target < count ? target : null
}

/** Where a new answer goes among answers locked as `locked` says: just before
 *  the trailing run of Locked Answers — every locked answer after the last
 *  unlocked one — so an answer like “None of the above” stays last however
 *  many answers are added above it. A locked answer with an unlocked one after
 *  it is not trailing and changes nothing. When every answer is locked, as a
 *  teacher may lock a list kept in ascending order, there is no answer for the
 *  new one to join, and it goes at the end. */
export function newAnswerIndex(locked: readonly boolean[]): number {
  let index = locked.length
  while (index > 0 && locked[index - 1]) index -= 1
  return index === 0 ? locked.length : index
}

/** The position inside the answer list `list`, which starts at `listPosition`
 *  (directly before it), where a new answer is inserted (see newAnswerIndex). */
export function newChoicePosition(list: ProseNode, listPosition: number): number {
  const locked: boolean[] = []
  list.forEach((child) => locked.push(choiceNodeIsLocked(child)))
  const index = newAnswerIndex(locked)
  let pos = listPosition + 1
  for (let i = 0; i < index; i += 1) pos += list.child(i).nodeSize
  return pos
}

/** Move the answer at `choicePosition` (directly before a choice) one place up
 *  (`-1`) or down (`1`) in its list, as one transaction, so one undo puts it
 *  back. The choice keeps its id, correctness and lock — the lock governs
 *  shuffling, not authoring, so a Locked Answer moves like any other and its
 *  new place is the authored one it keeps. A cursor in either of the two
 *  answers that trade places travels with its answer. */
export function moveChoice(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  choicePosition: number,
  direction: 1 | -1,
) {
  const { state } = view
  const $choice = state.doc.resolve(choicePosition)
  const list = $choice.parent
  if (list.type.name !== 'multipleChoice') return false
  const index = $choice.index()
  const target = answerMoveTarget(list.childCount, index, direction)
  if (target === null) return false
  const firstIndex = Math.min(index, target)
  const first = list.child(firstIndex)
  const second = list.child(firstIndex + 1)
  const from = direction === -1 ? choicePosition - first.nodeSize : choicePosition
  const middle = from + first.nodeSize
  const to = middle + second.nodeSize
  const tr = state.tr.replaceWith(from, to, [second, first])
  // Each position inside the pair follows the answer it was in.
  const follow = (pos: number) =>
    pos > from && pos < middle ? pos + second.nodeSize
      : pos > middle && pos < to ? pos - first.nodeSize
        : null
  const { selection } = state
  if (selection instanceof TextSelection) {
    const anchor = follow(selection.anchor)
    const head = follow(selection.head)
    if (anchor !== null && head !== null) {
      tr.setSelection(TextSelection.create(tr.doc, anchor, head))
    }
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

// A single answer. Behaves like a list item: it holds a paragraph (and any
// following blocks) and its correctness is a plain boolean. Its `locked` is
// the teacher's decision about whether it keeps its letter when answers are
// shuffled, or null while they have made none and its wording decides.
export const multipleChoiceChoiceSchema = $nodeSchema(
  'multipleChoiceChoice',
  () => ({
    content: 'paragraph block*',
    defining: true,
    // `id` gives each choice a stable identity so ProseMirror matches node
    // views by choice rather than by markup. Without it every choice looks
    // identical bar `correct`, and PM reuses/reorders the radio DOM when the
    // correct flag moves, leaving stale radios checked. See uniqueChoiceIds.
    attrs: { correct: { default: false }, id: { default: '' }, locked: { default: null } },
    parseDOM: [
      {
        tag: 'div[data-type="multiple-choice-choice"]',
        getAttrs: (element) => {
          const locked = (element as HTMLElement).getAttribute('data-locked')
          return {
            correct: (element as HTMLElement).getAttribute('data-correct') === 'true',
            id: (element as HTMLElement).getAttribute('data-id') ?? '',
            locked: locked === 'true' ? true : locked === 'false' ? false : null,
          }
        },
      },
    ],
    toDOM: (node) => [
      'div',
      {
        'data-type': 'multiple-choice-choice',
        'data-correct': String(node.attrs.correct === true),
        'data-id': node.attrs.id,
        ...(typeof node.attrs.locked === 'boolean'
          ? { 'data-locked': String(node.attrs.locked) }
          : {}),
      },
      0,
    ],
    parseMarkdown: { match: () => false, runner: () => undefined },
    toMarkdown: { match: () => false, runner: () => undefined },
  }),
)

// The list of answers. Like a bullet list: a block that contains choices.
export const multipleChoiceSchema = $nodeSchema('multipleChoice', () => ({
  group: 'block',
  content: 'multipleChoiceChoice+',
  parseDOM: [{ tag: 'div[data-type="multiple-choice"]' }],
  toDOM: () => ['div', { 'data-type': 'multiple-choice' }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// Depth of the nearest enclosing node of one of `names` — an answer cell of
// some kind — or 0 if the position is in none. Shared with the matching set's
// cells, which are edited the same way a choice is.
export function cellDepthOf($pos: ResolvedPos, names: ReadonlySet<string>) {
  let depth = $pos.depth
  while (depth > 0 && !names.has($pos.node(depth).type.name)) depth -= 1
  return depth
}

const CHOICE = new Set(['multipleChoiceChoice'])

function choiceDepthOf($pos: ResolvedPos) {
  return cellDepthOf($pos, CHOICE)
}

// Enter inside a cell adds a newline within it (a new paragraph), like typing
// in a table cell — it never leaves or splits the list. Elsewhere it returns
// false so normal editing is untouched.
export function newlineInCell(names: ReadonlySet<string>): Command {
  return (state, dispatch) => {
    if (cellDepthOf(state.selection.$from, names) === 0) return false
    return splitBlock(state, dispatch)
  }
}

const newlineInChoice = newlineInCell(CHOICE)

// Tab / Shift-Tab move between cells, like a table. Tab past the last cell adds
// a new empty choice (its id is filled in by uniqueChoiceIds).
function moveBetweenChoices(direction: 1 | -1, createAtEnd: boolean): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    const depth = choiceDepthOf($from)
    if (depth === 0) return false
    const listDepth = depth - 1
    const list = $from.node(listDepth)
    const listStart = $from.start(listDepth)
    const target = $from.index(listDepth) + direction
    if (target < 0) return false

    if (target >= list.childCount) {
      if (!createAtEnd) return false
      if (dispatch) {
        const paragraph = state.schema.nodes.paragraph
        if (!paragraph) return false
        const choice = list.child(0).type.create({ correct: false, id: '' }, paragraph.create())
        // Above any trailing Locked Answers, as the Add answer button does.
        const insertAt = newChoicePosition(list, $from.before(listDepth))
        const tr = state.tr.insert(insertAt, choice)
        tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 2)))
        dispatch(tr.scrollIntoView())
      }
      return true
    }

    if (dispatch) {
      let pos = listStart
      for (let index = 0; index < target; index += 1) pos += list.child(index).nodeSize
      const selection = TextSelection.near(state.doc.resolve(pos + 2), direction)
      dispatch(state.tr.setSelection(selection).scrollIntoView())
    }
    return true
  }
}

// Arrow-Down at the last line of the last answer doesn't leave the list yet: it
// focuses the "Add answer" button (armed state), so typing there starts a new
// answer. A second Arrow-Down from the button leaves the component as usual.
const armAddAnswerOnDown: Command = (state, _dispatch, view) => {
  if (!view) return false
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return false
  const { $from } = selection
  const depth = choiceDepthOf($from)
  if (depth === 0) return false
  const list = $from.node(depth - 1)
  if ($from.index(depth - 1) !== list.childCount - 1) return false // not the last answer
  const choice = $from.node(depth)
  if ($from.index(depth) !== choice.childCount - 1) return false // not the last line's block
  if (!view.endOfTextblock('down')) return false // not on the last visual line
  const dom = view.nodeDOM($from.before(depth - 1))
  const button = dom instanceof HTMLElement ? dom.querySelector('.mc-add-choice') : null
  if (!(button instanceof HTMLElement)) return false
  button.focus()
  return true
}

// Alt-ArrowUp / Alt-ArrowDown move the answer holding the cursor one place, as
// the row's arrow buttons do; the cursor goes with it.
export function moveChoiceWithCursor(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    const depth = choiceDepthOf($from)
    if (depth === 0) return false
    const list = $from.node(depth - 1)
    if (answerMoveTarget(list.childCount, $from.index(depth - 1), direction) === null) {
      return true // at the end already: nothing moves, and the key does nothing else
    }
    if (dispatch) moveChoice({ state, dispatch }, $from.before(depth), direction)
    return true
  }
}

// A fixed list has no editable cells at all, so every command that types into
// one, walks between them or grows the list stands down and lets normal editing
// through.
function unlessFixed(ctx: Ctx, command: Command): Command {
  return (state, dispatch, view) =>
    ctx.get(multipleChoiceFixedCtx) ? false : command(state, dispatch, view)
}

// Rearranging answers is authoring, so a read-only preview lets the keys through.
function whenEditable(ctx: Ctx, command: Command): Command {
  return (state, dispatch, view) =>
    ctx.get(multipleChoiceEditableCtx) ? command(state, dispatch, view) : false
}

export const multipleChoiceKeymap = $useKeymap('multipleChoiceKeymap', {
  NewlineInChoice: {
    shortcuts: 'Enter',
    priority: 100,
    command: (ctx) => unlessFixed(ctx, newlineInChoice),
  },
  ArmAddAnswer: {
    shortcuts: 'ArrowDown',
    priority: 100,
    command: (ctx) => unlessFixed(ctx, armAddAnswerOnDown),
  },
  NextChoice: {
    shortcuts: 'Tab',
    priority: 100,
    command: (ctx) => unlessFixed(ctx, moveBetweenChoices(1, true)),
  },
  PrevChoice: {
    shortcuts: 'Shift-Tab',
    priority: 100,
    command: (ctx) => unlessFixed(ctx, moveBetweenChoices(-1, false)),
  },
  MoveChoiceUp: {
    shortcuts: 'Alt-ArrowUp',
    priority: 100,
    command: (ctx) => unlessFixed(ctx, whenEditable(ctx, moveChoiceWithCursor(-1))),
  },
  MoveChoiceDown: {
    shortcuts: 'Alt-ArrowDown',
    priority: 100,
    command: (ctx) => unlessFixed(ctx, whenEditable(ctx, moveChoiceWithCursor(1))),
  },
})

// The nodes that carry a stable id: a choice, a matching set's prompts and
// Word Bank answers, and a Multipart question's Parts and Subparts — which ProseMirror matches node
// views by and an arrangement's `choiceOrder` is keyed by.
const ID_BEARING = new Set([
  'multipleChoiceChoice',
  'matchingPrompt',
  'matchingAnswer',
  'multipartPart',
  'multipartSubpart',
])

// Guarantee every choice carries a unique id. New choices (Enter-split, paste,
// or legacy docs) arrive with an empty id; give those a fresh one. Duplicate
// ids (e.g. a copied choice) are reassigned too, keeping the first occurrence —
// so a prompt that named a Word Bank answer still names the original after the
// answer is copied.
export const uniqueChoiceIds = $prose(
  () => new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      const seen = new Set<string>()
      const tr = newState.tr
      let changed = false
      newState.doc.descendants((node, pos) => {
        if (!ID_BEARING.has(node.type.name)) return
        const id = node.attrs.id
        if (!id || seen.has(id)) {
          const nextId = crypto.randomUUID()
          seen.add(nextId)
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: nextId })
          changed = true
        } else {
          seen.add(id)
        }
      })
      return changed ? tr : null
    },
  }),
)

function choiceJSON(text?: string, correct = false) {
  return {
    type: 'multipleChoiceChoice',
    attrs: { correct, id: crypto.randomUUID() },
    content: [
      text
        ? { type: 'paragraph', content: [{ type: 'text', text }] }
        : { type: 'paragraph' },
    ],
  }
}

export function newMultipleChoiceNode() {
  return {
    type: 'multipleChoice',
    content: Array.from({ length: 4 }, () => choiceJSON()),
  }
}

/** The two answers a True/False question asks with, in the order a student
 *  reads them. They are the question type spelled out rather than authored
 *  content: the teacher picks which one is correct and never rewrites either,
 *  and the printed test shows a blank instead of the pair. */
export const TRUE_FALSE_LABELS = ['True', 'False'] as const

export function newTrueFalseNode() {
  return {
    type: 'multipleChoice',
    content: TRUE_FALSE_LABELS.map((label) => choiceJSON(label)),
  }
}

/**
 * Keep the fixed pair on the page. A True/False question without its two
 * answers is not a True/False question, and the editor offers no way to put
 * them back, so a selection that swallowed the block — a select-all delete, a
 * paste over everything, a drag of the whole node out of the document — regrows
 * it at the end rather than leaving a question that cannot be answered or
 * exported. Off for every other question type, whose answer list is authored.
 */
export const keepFixedChoices = $prose((ctx: Ctx) =>
  new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!ctx.get(multipleChoiceFixedCtx)) return null
      if (!transactions.some((tr) => tr.docChanged)) return null
      let present = false
      newState.doc.forEach((node) => {
        if (node.type.name === 'multipleChoice') present = true
      })
      if (present) return null
      const list = newState.schema.nodes.multipleChoice
      const choice = newState.schema.nodes.multipleChoiceChoice
      const paragraph = newState.schema.nodes.paragraph
      if (!list || !choice || !paragraph) return null
      return newState.tr.insert(
        newState.doc.content.size,
        list.create(
          null,
          TRUE_FALSE_LABELS.map((label) =>
            choice.create(
              { correct: false, id: crypto.randomUUID() },
              paragraph.create(null, newState.schema.text(label)),
            ),
          ),
        ),
      )
    },
  }),
)

const PADLOCK = 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z'

// Lucide's padlock, shut or open, and its arrows for moving an answer.
const ROW_ICON_PATHS = {
  locked: [PADLOCK, 'M7 11V7a5 5 0 0 1 10 0v4'],
  unlocked: [PADLOCK, 'M7 11V7a5 5 0 0 1 9.9-1'],
  up: ['m5 12 7-7 7 7', 'M12 19V5'],
  down: ['M12 5v14', 'm19 12-7 7-7-7'],
} as const

// An answer row's control icon, drawn the way the editor's other row controls
// draw theirs.
function rowIcon(name: keyof typeof ROW_ICON_PATHS) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) svg.setAttribute(key, value)
  for (const d of ROW_ICON_PATHS[name]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}

// Each answer row's move buttons, by row element, for the list's node view to
// relabel: a row's letter and whether it is first or last change whenever an
// answer is added, removed or moved, which its own node view never hears of.
const rowMoveButtons = new WeakMap<HTMLElement, { up: HTMLButtonElement; down: HTMLButtonElement }>()

/** Letter an answer by its place in the list, as it reads in the editor. */
function answerLetter(index: number) {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1)
}

// Node view for a choice: a non-editable radio button on the left, the
// editable answer content, and at the right the buttons that move the answer
// up and down, then the lock that keeps the answer's letter when answers are
// shuffled — all shown on hover or while the row holds the cursor, and the
// lock always while it is locked. Everything else (add/remove/navigate) is handled by ProseMirror's
// native list and block editing.
export const multipleChoiceChoiceView = $view(
  multipleChoiceChoiceSchema.node,
  (ctx: Ctx) => {
    return (initialNode, view, getPos): NodeView => {
      let node: ProseNode = initialNode
      const editable = () => ctx.get(multipleChoiceEditableCtx)
      // Read once, at construction: a node view lives as long as the editor,
      // and the mode is a property of the question being edited rather than
      // something that changes under it.
      const fixed = ctx.get(multipleChoiceFixedCtx)

      const dom = document.createElement('div')
      dom.className = fixed ? 'mc-choice mc-choice--fixed' : 'mc-choice'
      dom.dataset.type = 'multiple-choice-choice'

      const control = document.createElement('label')
      control.className = 'mc-choice-control'
      control.contentEditable = 'false'

      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.className = 'mc-choice-radio'
      radio.setAttribute('aria-label', 'Mark this answer correct')
      control.append(radio)

      // A fixed answer is drawn rather than edited: with no contentDOM,
      // ProseMirror has nowhere to put a cursor, so the pair cannot be
      // retyped, split or deleted while the radios still work normally.
      const contentDOM = fixed ? undefined : document.createElement('div')
      const body = contentDOM ?? document.createElement('div')
      body.className = 'mc-choice-body'

      // A True/False pair never moves, so it has nothing to lock.
      const lock = fixed ? undefined : document.createElement('button')
      if (lock) {
        lock.type = 'button'
        lock.className = 'mc-choice-lock'
        lock.contentEditable = 'false'
        lock.setAttribute('aria-label', 'Lock answer position')
        const toggle = () => {
          if (!editable()) return
          const pos = getPos()
          if (pos == null) return
          setChoiceLock(view, pos, !choiceNodeIsLocked(node))
        }
        // Mousedown, as the radio does, so the text cursor stays put; a click
        // with no pointer behind it is the keyboard pressing the button.
        lock.addEventListener('mousedown', (event) => {
          event.preventDefault()
          toggle()
        })
        lock.addEventListener('click', (event) => {
          event.preventDefault()
          if (event.detail === 0) toggle()
        })
      }

      // A True/False pair has a fixed order, so it has nothing to move either.
      const moveButton = (direction: 1 | -1) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `mc-choice-move mc-choice-move-${direction === -1 ? 'up' : 'down'}`
        button.contentEditable = 'false'
        button.append(rowIcon(direction === -1 ? 'up' : 'down'))
        const move = (fromKeyboard: boolean) => {
          if (!editable()) return
          const pos = getPos()
          if (pos == null) return
          const $pos = view.state.doc.resolve(pos)
          const index = $pos.index()
          const listPosition = $pos.before()
          if (!moveChoice(view, pos, direction)) return
          if (!fromKeyboard) return
          // The row was redrawn in its new place; keep the keyboard on the
          // same button there, or on its partner once this end is reached.
          // A microtask, so the list has relabelled the rows first.
          queueMicrotask(() => {
            const list = view.state.doc.nodeAt(listPosition)
            if (list?.type.name !== 'multipleChoice') return
            let target = listPosition + 1
            for (let i = 0; i < index + direction; i += 1) target += list.child(i).nodeSize
            const row = view.nodeDOM(target)
            const buttons = row instanceof HTMLElement ? rowMoveButtons.get(row) : undefined
            if (!buttons) return
            const same = direction === -1 ? buttons.up : buttons.down
            const other = direction === -1 ? buttons.down : buttons.up
            ;(same.disabled ? other : same).focus()
          })
        }
        button.addEventListener('mousedown', (event) => {
          event.preventDefault()
          move(false)
        })
        button.addEventListener('click', (event) => {
          event.preventDefault()
          if (event.detail === 0) move(true)
        })
        return button
      }
      const moves = fixed ? undefined : { up: moveButton(-1), down: moveButton(1) }
      if (moves) rowMoveButtons.set(dom, moves)
      const tools = [...(moves ? [moves.up, moves.down] : []), ...(lock ? [lock] : [])]

      dom.append(control, body, ...tools)

      let drawnLock: boolean | undefined
      const render = () => {
        radio.checked = node.attrs.correct === true
        radio.disabled = !editable()
        dom.dataset.correct = String(node.attrs.correct === true)
        if (fixed) body.textContent = node.textContent
        if (moves) {
          moves.up.hidden = !editable()
          moves.down.hidden = !editable()
        }
        if (lock) {
          const locked = choiceNodeIsLocked(node)
          dom.dataset.locked = String(locked)
          lock.hidden = !editable()
          lock.setAttribute('aria-pressed', String(locked))
          if (drawnLock !== locked) {
            drawnLock = locked
            lock.replaceChildren(rowIcon(locked ? 'locked' : 'unlocked'))
            lock.title = locked
              ? 'Locked: keeps its letter when answers are shuffled. Click to unlock.'
              : 'Lock this answer so it keeps its letter when answers are shuffled'
          }
        }
      }

      const activate = () => {
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        // Stable choice ids let ProseMirror repaint the right radios in place,
        // so simply writing the doc is enough — no manual DOM juggling.
        selectCorrectChoice(view, pos)
      }

      // Act on mousedown (the event ProseMirror uses for selection) and prevent
      // its default so the text cursor stays where it is.
      radio.addEventListener('mousedown', (event) => {
        event.preventDefault()
        activate()
      })
      radio.addEventListener('click', (event) => event.preventDefault())

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
          fixed
          || control.contains(mutation.target)
          || tools.some((tool) => tool.contains(mutation.target)),
        stopEvent: (event) =>
          fixed
          || control.contains(event.target as Node)
          || tools.some((tool) => tool.contains(event.target as Node)),
      }
    }
  },
)

// Node view for the whole list: the choices plus an "Add answer" button beneath
// them (editor only). The button appends an empty choice and drops the cursor
// into it; its id is filled in by uniqueChoiceIds.
export const multipleChoiceView = $view(
  multipleChoiceSchema.node,
  (ctx: Ctx) => {
    return (initialNode, view, getPos): NodeView => {
      let node: ProseNode = initialNode
      const editable = () => ctx.get(multipleChoiceEditableCtx)
      const fixed = ctx.get(multipleChoiceFixedCtx)

      const dom = document.createElement('div')
      dom.dataset.type = 'multiple-choice'
      if (fixed) dom.dataset.fixed = 'true'

      const contentDOM = document.createElement('div')
      contentDOM.className = 'mc-choices'

      const addButton = document.createElement('button')
      addButton.type = 'button'
      addButton.className = 'mc-add-choice'
      addButton.contentEditable = 'false'
      const plus = document.createElement('span')
      plus.className = 'mc-add-plus'
      plus.textContent = '+'
      const caret = document.createElement('span')
      caret.className = 'mc-add-caret'
      const label = document.createElement('span')
      label.className = 'mc-add-label'
      label.textContent = 'Add answer'
      addButton.append(plus, caret, label)

      // Append a new answer (optionally seeded with a typed character) and put
      // the cursor in it. Its id is filled in by uniqueChoiceIds.
      const addAnswer = (text?: string) => {
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        const paragraph = view.state.schema.nodes.paragraph
        const choiceType = view.state.schema.nodes.multipleChoiceChoice
        if (!paragraph || !choiceType) return
        const body = text
          ? paragraph.create(null, view.state.schema.text(text))
          : paragraph.create()
        const choice = choiceType.create({ correct: false, id: '' }, body)
        // Above any trailing Locked Answers, so “None of the above” stays last.
        const insertAt = newChoicePosition(node, pos)
        const tr = view.state.tr.insert(insertAt, choice)
        const caretPos = insertAt + 2 + (text ? text.length : 0)
        tr.setSelection(TextSelection.near(tr.doc.resolve(caretPos)))
        view.dispatch(tr.scrollIntoView())
        view.focus()
      }

      // Move the editor selection to the given position and refocus the editor.
      const selectAt = (position: number, bias: 1 | -1) => {
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.near(view.state.doc.resolve(position), bias))
            .scrollIntoView(),
        )
        view.focus()
      }

      addButton.addEventListener('mousedown', (event) => {
        event.preventDefault()
        addAnswer()
      })
      // Armed = the button holds focus (see armAddAnswerOnDown).
      addButton.addEventListener('focus', () =>
        addButton.classList.add('mc-add-choice--armed'),
      )
      addButton.addEventListener('blur', () =>
        addButton.classList.remove('mc-add-choice--armed'),
      )
      addButton.addEventListener('keydown', (event) => {
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          selectAt(pos + node.nodeSize - 2, -1) // back to the end of the last answer
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          selectAt(pos + node.nodeSize, 1) // leave the component (or stay if nothing follows)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          addAnswer()
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
          event.preventDefault()
          addAnswer(event.key)
        }
      })

      // Name each row's move buttons by its letter, and disable the one that
      // would carry the first answer up or the last one down. Run once the
      // rows are drawn in their new order, after this view's own update.
      let relabelQueued = false
      const relabel = () => {
        relabelQueued = false
        const rows = [...contentDOM.children].filter(
          (row): row is HTMLElement => row instanceof HTMLElement && rowMoveButtons.has(row),
        )
        rows.forEach((row, index) => {
          const { up, down } = rowMoveButtons.get(row)!
          const letter = answerLetter(index)
          for (const [button, text, atEnd] of [
            [up, `Move answer ${letter} up`, index === 0],
            [down, `Move answer ${letter} down`, index === rows.length - 1],
          ] as const) {
            button.setAttribute('aria-label', text)
            button.title = `${text} (${direction(button)})`
            button.disabled = atEnd
          }
        })
      }
      // The shortcut as the keyboard in front of the teacher labels it.
      const alt = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥' : 'Alt+'
      const direction = (button: HTMLButtonElement) =>
        `${alt}${button.classList.contains('mc-choice-move-up') ? '↑' : '↓'}`

      const render = () => {
        // A True/False question's pair is not a list to add to, so the
        // affordance is absent rather than present and inert.
        addButton.style.display = editable() && !fixed ? '' : 'none'
        if (!fixed && !relabelQueued) {
          relabelQueued = true
          queueMicrotask(relabel)
        }
      }

      dom.append(contentDOM, addButton)
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
        ignoreMutation: (mutation) => addButton.contains(mutation.target),
        stopEvent: (event) => addButton.contains(event.target as Node),
      }
    }
  },
)
