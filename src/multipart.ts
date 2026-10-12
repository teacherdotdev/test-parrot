import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx'
import { createSlice } from '@milkdown/kit/ctx'
import { $nodeSchema, $prose, $view } from '@milkdown/kit/utils'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { multipleChoiceEditableCtx, newMultipleChoiceNode } from './multiple-choice'
import { parsePointsInput, readPoints } from './question-doc'

// A Multipart question: a stem — often shared material such as a passage, a
// quote, an image or a table — and the lettered Parts a student answers from
// it. The stem is written at the top of the document, unnested, exactly where
// any other question's stem goes.
// Below it one `multipartParts` box holds every Part; each Part carries its own
// stem and, nested inside it, the answer component a question of its kind
// already uses — a `multipleChoice` list or a `suggestedAnswer` block. Which
// of the two it holds is what kind of Part it is, so a Part's kind can never
// disagree with its answers.
//
// A Part may instead hold a `multipartSubparts` box in that place: its stem is
// then the lead-in to the Subparts in the box, and it answers nothing itself
// (ADR-0043). A Subpart is built exactly as an answering Part is — a stem,
// then a `multipleChoice` list or a `suggestedAnswer` block — but never holds a
// box of its own, so the schema itself keeps a Multipart question two levels deep.
//
// The editor does not letter Parts or number Subparts: their order is what
// labels them on the paper, and the editor shows that order directly.

// Whether the question being edited is a Multipart question. On for one in the editor,
// off everywhere else: it is what lets the Parts box be regrown if the teacher
// deletes it, since there is no other way to put one back.
export const multipartModeCtx = createSlice(false, 'multipartMode')

export const multipartMode = (enabled: boolean): MilkdownPlugin => (ctx) => {
  ctx.inject(multipartModeCtx, enabled)
  return () => () => {
    ctx.remove(multipartModeCtx)
  }
}

/** What a Part or Subpart that answers can be. */
export type PartKind = 'multiple-choice' | 'open'

/** What a Part's type menu offers: either kind of answer, or Subparts. */
export type PartShape = PartKind | 'subparts'

/** How each kind of Part is named on its tag and in the "Add Part" menu. */
export const PART_KIND_LABELS: Record<PartShape, string> = {
  'multiple-choice': 'Multiple Choice',
  open: 'Short Answer',
  subparts: 'Subparts',
}

// The blank answer component a Part of `kind` starts with.
function answerJSON(kind: PartKind) {
  return kind === 'multiple-choice'
    ? newMultipleChoiceNode()
    : { type: 'suggestedAnswer', content: [{ type: 'paragraph' }] }
}

function partJSON(kind: PartKind, type: 'multipartPart' | 'multipartSubpart' = 'multipartPart') {
  return {
    type,
    attrs: { id: crypto.randomUUID(), columns: 2 },
    content: [
      { type: 'multipartPartStem', content: [{ type: 'paragraph' }] },
      answerJSON(kind),
    ],
  }
}

/** The Parts box a new Multipart question opens with: one blank Multiple Choice Part. */
export function newMultipartPartsNode() {
  return { type: 'multipartParts', content: [partJSON('multiple-choice')] }
}

// A Part's stem: the question this Part asks, as any blocks — or, for a Part
// that holds Subparts, their lead-in. A Subpart's stem is one of these too.
export const multipartPartStemSchema = $nodeSchema('multipartPartStem', () => ({
  content: 'block+',
  defining: true,
  isolating: true,
  parseDOM: [{ tag: 'div[data-type="multipart-part-stem"]' }],
  toDOM: () => ['div', { 'data-type': 'multipart-part-stem' }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// One Part: its stem, then the answer component that makes it the kind of Part
// it is, or the Subparts it holds. `id` is the Part's stable identity — its
// answer order and Work Space on an Exam are keyed by it — and `columns` is the
// answer layout a Multiple Choice Part starts with, as a question's own
// `columns` is. `points` is what answering it is worth, `null` when it is
// unpointed; a Part that holds Subparts keeps none, its Subparts carry theirs
// (ADR-0042).
export const multipartPartSchema = $nodeSchema('multipartPart', () => ({
  content: 'multipartPartStem (multipleChoice | suggestedAnswer | multipartSubparts)',
  defining: true,
  isolating: true,
  attrs: { id: { default: '' }, columns: { default: 2 }, points: { default: null } },
  parseDOM: [
    {
      tag: 'div[data-type="multipart-part"]',
      getAttrs: (element) => ({
        id: (element as HTMLElement).getAttribute('data-id') ?? '',
        columns: Number((element as HTMLElement).getAttribute('data-columns')) || 2,
        points: readPoints(Number((element as HTMLElement).getAttribute('data-points'))) ?? null,
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'multipart-part',
      'data-id': node.attrs.id,
      'data-columns': node.attrs.columns,
      ...(node.attrs.points ? { 'data-points': node.attrs.points } : {}),
    },
    0,
  ],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// One Subpart: built as an answering Part is, under an id of its own that its
// answer order and Work Space are keyed by. It may hold no Subparts.
export const multipartSubpartSchema = $nodeSchema('multipartSubpart', () => ({
  content: 'multipartPartStem (multipleChoice | suggestedAnswer)',
  defining: true,
  isolating: true,
  attrs: { id: { default: '' }, columns: { default: 2 }, points: { default: null } },
  parseDOM: [
    {
      tag: 'div[data-type="multipart-subpart"]',
      getAttrs: (element) => ({
        id: (element as HTMLElement).getAttribute('data-id') ?? '',
        columns: Number((element as HTMLElement).getAttribute('data-columns')) || 2,
        points: readPoints(Number((element as HTMLElement).getAttribute('data-points'))) ?? null,
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'multipart-subpart',
      'data-id': node.attrs.id,
      'data-columns': node.attrs.columns,
      ...(node.attrs.points ? { 'data-points': node.attrs.points } : {}),
    },
    0,
  ],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// The box of a Part's Subparts. Never empty: removing the last Subpart turns
// its Part back into one that answers, so a Part never holds an empty box.
export const multipartSubpartsSchema = $nodeSchema('multipartSubparts', () => ({
  content: 'multipartSubpart+',
  defining: true,
  isolating: true,
  parseDOM: [{ tag: 'div[data-type="multipart-subparts"]' }],
  toDOM: () => ['div', { 'data-type': 'multipart-subparts' }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

// The box of Parts. It may be empty: a Multipart question with no Parts is incomplete
// rather than invalid, and the box stays to show where one goes.
export const multipartPartsSchema = $nodeSchema('multipartParts', () => ({
  group: 'block',
  content: 'multipartPart*',
  defining: true,
  isolating: true,
  parseDOM: [{ tag: 'div[data-type="multipart-parts"]' }],
  toDOM: () => ['div', { 'data-type': 'multipart-parts' }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))

/** What a Part or Subpart node is, read from what follows its stem: the
 *  answer component it holds, or — for a Part only — its Subparts. */
export function partKindOf(node: ProseNode): PartShape {
  const last = node.lastChild?.type.name
  if (last === 'multipartSubparts') return 'subparts'
  return last === 'suggestedAnswer' ? 'open' : 'multiple-choice'
}

const ANSWERING = new Set(['multipartPart', 'multipartSubpart'])

/** A Part's answers set aside while it is another kind, by Part id and kind.
 *  It lives only as long as one editing session: the document — what is saved
 *  — holds the answers of the kind the Part is, and nothing of the other. */
export type SetAsideAnswers = Map<string, Partial<Record<PartKind, ProseNode>>>

/** Make the Part or Subpart at `partPosition` one of `kind`. Its stem, id and
 *  columns stay; its answers are set aside in `setAside`, if given, and the
 *  answers it had when it was last `kind` come back — otherwise a blank set
 *  does — so switching away and back loses nothing. A Part that holds Subparts
 *  answers nothing to switch. */
export function setPartKind(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  partPosition: number,
  kind: PartKind,
  setAside?: SetAsideAnswers,
) {
  const part = view.state.doc.nodeAt(partPosition)
  if (!part || !ANSWERING.has(part.type.name)) return false
  const current = partKindOf(part)
  if (current === kind || current === 'subparts') return false
  const answer = part.lastChild!
  const id = String(part.attrs.id)
  const kept = setAside?.get(id) ?? {}
  setAside?.set(id, { ...kept, [current]: answer })
  const replacement = kept[kind] ?? view.state.schema.nodeFromJSON(answerJSON(kind))
  const answerEnd = partPosition + part.nodeSize - 1
  view.dispatch(view.state.tr.replaceWith(answerEnd - answer.nodeSize, answerEnd, replacement))
  return true
}

/** Give the Part or Subpart that answers at `partPosition` Points, or clear
 *  them with `null`. A Part that holds Subparts answers nothing, so it takes
 *  none: its Subparts carry the Points (ADR-0042). */
export function setPartPoints(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  partPosition: number,
  points: number | null,
) {
  const part = view.state.doc.nodeAt(partPosition)
  if (!part || !ANSWERING.has(part.type.name) || partKindOf(part) === 'subparts') return false
  if ((part.attrs.points ?? null) === points) return false
  view.dispatch(view.state.tr.setNodeMarkup(partPosition, undefined, { ...part.attrs, points }))
  return true
}

/**
 * Give the answering Part at `partPosition` Subparts. Its stem stays, as their
 * lead-in; its answers become Subpart (i), under a blank stem, so nothing typed
 * is lost (ADR-0043). Subpart (i) takes the Part's id, columns and Points with
 * them — it carries on as what the Part was, so the answer order and Work
 * Space an Exam set for the Part follow its answers, and its worth with them —
 * and the Part takes a fresh id and no Points, as a lead-in answers nothing.
 * The cursor lands in Subpart (i)'s stem.
 */
export function addSubparts(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  partPosition: number,
) {
  const part = view.state.doc.nodeAt(partPosition)
  if (part?.type.name !== 'multipartPart' || partKindOf(part) === 'subparts') return false
  const { schema } = view.state
  const answer = part.lastChild!
  const subpart = schema.nodes.multipartSubpart!.create(
    { id: part.attrs.id, columns: part.attrs.columns, points: part.attrs.points ?? null },
    [schema.nodes.multipartPartStem!.create(null, schema.nodes.paragraph!.create()), answer],
  )
  const answerEnd = partPosition + part.nodeSize - 1
  const answerStart = answerEnd - answer.nodeSize
  const tr = view.state.tr
    .replaceWith(answerStart, answerEnd, schema.nodes.multipartSubparts!.create(null, subpart))
    .setNodeMarkup(partPosition, undefined, {
      ...part.attrs,
      id: crypto.randomUUID(),
      ...('points' in part.attrs ? { points: null } : {}),
    })
  // Into Subpart (i)'s stem: past the box, the Subpart, the stem and the paragraph.
  tr.setSelection(TextSelection.near(tr.doc.resolve(answerStart + 4)))
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Append a blank Part of `kind` to the Parts box at `boxPosition` — or a
 *  blank Subpart to the Subparts box there — and put the cursor in its stem. */
export function addPart(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  boxPosition: number,
  kind: PartKind,
) {
  const box = view.state.doc.nodeAt(boxPosition)
  const type = box?.type.name === 'multipartParts'
    ? 'multipartPart'
    : box?.type.name === 'multipartSubparts' ? 'multipartSubpart' : null
  if (!box || !type) return false
  const part = view.state.schema.nodeFromJSON(partJSON(kind, type))
  const insertAt = boxPosition + box.nodeSize - 1
  const tr = view.state.tr.insert(insertAt, part)
  // Into the stem's first paragraph: past the Part, the stem and the paragraph.
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 3)))
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Move the Part — or Subpart — at `partPosition` so it lands before the one
 *  now at `targetIndex` among its siblings, or after the last, at their count.
 *  Nothing happens where it already is. */
export function movePartTo(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  partPosition: number,
  targetIndex: number,
) {
  const $part = view.state.doc.resolve(partPosition)
  const box = $part.parent
  if (box.type.name !== 'multipartParts' && box.type.name !== 'multipartSubparts') return false
  const index = $part.index()
  if (targetIndex === index || targetIndex === index + 1) return false
  if (targetIndex < 0 || targetIndex > box.childCount) return false
  const part = box.child(index)
  let target = $part.start()
  for (let i = 0; i < targetIndex; i += 1) target += box.child(i).nodeSize
  const tr = view.state.tr.delete(partPosition, partPosition + part.nodeSize)
  tr.insert(tr.mapping.map(target), part)
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Delete the Part at `partPosition`. The Parts box stays, however few Parts
 *  are left in it. */
export function deletePart(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  partPosition: number,
) {
  const part = view.state.doc.nodeAt(partPosition)
  if (part?.type.name !== 'multipartPart') return false
  view.dispatch(view.state.tr.delete(partPosition, partPosition + part.nodeSize))
  return true
}

/** Delete the Subpart at `subpartPosition`. The last one left is not deleted
 *  but taken back into its Part: the Part answers again with that Subpart's
 *  answers, and takes its id, columns and Points — the reverse of `addSubparts`, so
 *  adding Subparts and removing them again leaves the Part as it was. The
 *  Subpart's own stem goes with its box. */
export function deleteSubpart(
  view: Pick<EditorView, 'state' | 'dispatch'>,
  subpartPosition: number,
) {
  const subpart = view.state.doc.nodeAt(subpartPosition)
  if (subpart?.type.name !== 'multipartSubpart') return false
  const $subpart = view.state.doc.resolve(subpartPosition)
  const box = $subpart.parent
  if (box.childCount > 1) {
    view.dispatch(view.state.tr.delete(subpartPosition, subpartPosition + subpart.nodeSize))
    return true
  }
  const partPosition = $subpart.before($subpart.depth - 1)
  const part = $subpart.node($subpart.depth - 1)
  const tr = view.state.tr
    .replaceWith($subpart.before(), $subpart.after(), subpart.lastChild!)
    .setNodeMarkup(partPosition, undefined, {
      ...part.attrs,
      id: subpart.attrs.id,
      columns: subpart.attrs.columns,
      ...('points' in subpart.attrs ? { points: subpart.attrs.points } : {}),
    })
  view.dispatch(tr.scrollIntoView())
  return true
}

/**
 * Keep the Parts box on the page. A Multipart question without it has nowhere to put a
 * Part, and the editor offers no other way to put one back, so a selection
 * that swallowed the box — a select-all delete, a paste over everything —
 * regrows an empty one at the end. Off for every other question type.
 */
export const keepMultipartParts = $prose((ctx: Ctx) =>
  new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!ctx.get(multipartModeCtx)) return null
      if (!transactions.some((tr) => tr.docChanged)) return null
      let present = false
      newState.doc.forEach((node) => {
        if (node.type.name === 'multipartParts') present = true
      })
      if (present) return null
      const box = newState.schema.nodes.multipartParts
      if (!box) return null
      return newState.tr.insert(newState.doc.content.size, box.create())
    },
  }),
)

// Lucide's icons, as the rest of the app draws them, for chrome built outside
// React: the question types' own icons, and the ones a Part's controls use.
const ICON_PATHS = {
  'multiple-choice': ['M13 5h8', 'M13 12h8', 'M13 19h8', 'm3 17 2 2 4-4', 'm3 7 2 2 4-4'],
  open: ['M21 5H3', 'M15 12H3', 'M17 19H3'],
  // Lucide's list-tree: a lead-in with its Subparts beneath it.
  subparts: ['M21 12h-8', 'M21 6H8', 'M21 18h-8', 'M3 6v4c0 1.1.9 2 2 2h3', 'M3 10v6c0 1.1.9 2 2 2h3'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  plus: ['M5 12h14', 'M12 5v14'],
  check: ['M20 6 9 17l-5-5'],
  up: ['m5 12 7-7 7 7', 'M12 19V5'],
  down: ['M12 5v14', 'm19 12-7 7-7-7'],
  // The front matter's Type label.
  type: [
    'M12 22h6a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v6',
    'M14 2v5a1 1 0 0 0 1 1h5', 'M3 16v-1.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5V16', 'M6 22h2', 'M7 14v8',
  ],
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

/** A kind of Part drawn as the question type's badge: its icon and its name. */
function kindBadge(kind: PartShape) {
  const badge = document.createElement('span')
  badge.className = 'badge badge-type'
  badge.append(icon(kind), PART_KIND_LABELS[kind])
  return badge
}

/**
 * A button that opens a small menu of `kinds`, closed again by any press
 * outside it — the button never takes focus, so there is no blur to hear.
 * `choose` gets the kind picked.
 */
function kindMenu<Kind extends PartShape>(
  button: HTMLButtonElement,
  className: string,
  kinds: readonly Kind[],
  choose: (kind: Kind) => void,
) {
  const wrap = document.createElement('span')
  wrap.className = 'multipart-menu-anchor'
  const menu = document.createElement('div')
  menu.className = `multipart-menu ${className}`
  menu.setAttribute('role', 'menu')
  menu.hidden = true
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'false')

  const onOutsidePress = (event: MouseEvent) => {
    if (!wrap.contains(event.target as Node)) setOpen(false)
  }
  // Escape closes the menu and goes no further: the dialog around the editor
  // hears the same key as Cancel.
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
  }
  const setOpen = (open: boolean) => {
    menu.hidden = !open
    button.setAttribute('aria-expanded', String(open))
    if (open) {
      document.addEventListener('mousedown', onOutsidePress, true)
      document.addEventListener('keydown', onEscape, true)
    } else {
      document.removeEventListener('mousedown', onOutsidePress, true)
      document.removeEventListener('keydown', onEscape, true)
    }
  }
  const items = kinds.map((kind) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'multipart-menu-item'
    item.setAttribute('role', 'menuitem')
    item.setAttribute('aria-label', PART_KIND_LABELS[kind])
    item.append(kindBadge(kind))
    item.addEventListener('mousedown', (event) => {
      event.preventDefault()
      if (item.disabled) return
      setOpen(false)
      choose(kind)
    })
    menu.append(item)
    return { kind, item }
  })
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    setOpen(menu.hidden)
  })
  wrap.append(button, menu)
  return {
    wrap,
    close: () => setOpen(false),
    /** Mark the kind the Part already is, with the tick a chosen value has.
     *  A Part that holds Subparts answers nothing, so neither kind of answer
     *  is offered it: removing its last Subpart is what makes it answer again. */
    mark(chosen: PartShape) {
      for (const { kind, item } of items) {
        item.querySelector('.multipart-menu-check')?.remove()
        item.disabled = chosen === 'subparts' && kind !== 'subparts'
        if (kind === chosen) {
          const check = icon('check')
          check.classList.add('multipart-menu-check')
          item.append(check)
          item.setAttribute('aria-checked', 'true')
        } else item.removeAttribute('aria-checked')
        // Offered to a Part that answers, Subparts is something to add.
        if (kind === 'subparts') {
          item.setAttribute('aria-label', chosen === 'subparts' ? 'Subparts' : 'Add Subparts')
          const badge = item.querySelector('.badge')
          if (badge?.lastChild) {
            badge.lastChild.textContent = chosen === 'subparts' ? 'Subparts' : 'Add Subparts'
          }
        }
      }
    },
  }
}

function addPartButton(text: string) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'multipart-add-part'
  const label = document.createElement('span')
  label.textContent = text
  button.append(icon('plus'), label)
  return button
}

/** What a box of Parts or of Subparts is called on its chrome. */
type BoxWords = { className: string; title: string; add: string; empty: string | null }

const PARTS_WORDS: BoxWords = {
  className: 'multipart-parts',
  title: 'Parts',
  add: 'Add Part',
  empty: 'No parts yet.',
}

const SUBPARTS_WORDS: BoxWords = {
  className: 'multipart-parts multipart-subparts',
  title: 'Subparts',
  add: 'Add Subpart',
  // Never empty: removing the last Subpart takes the box away.
  empty: null,
}

// A box of Parts or Subparts: a heading ruled full width, with "+ Add Part"
// at its right end; the Parts under it; and "+ Add Part" again after the last
// of them. Either one offers the two kinds a Part can answer as.
// Editor only: read-only views draw a Multipart question from the plan.
function boxView(words: BoxWords) {
  return (ctx: Ctx) => {
    return (initialNode: ProseNode, view: EditorView, getPos: () => number | undefined): NodeView => {
      let node: ProseNode = initialNode
      const editable = () => ctx.get(multipleChoiceEditableCtx)
      const add = (kind: PartKind) => {
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        addPart(view, pos, kind)
        view.focus()
      }
      const kinds = ['multiple-choice', 'open'] as const

      const dom = document.createElement('div')
      dom.className = words.className
      dom.dataset.type = initialNode.type.name === 'multipartParts' ? 'multipart-parts' : 'multipart-subparts'

      const head = document.createElement('div')
      head.className = 'multipart-parts-head'
      head.contentEditable = 'false'
      const title = document.createElement('span')
      title.textContent = words.title
      const headAdd = kindMenu(addPartButton(words.add), 'multipart-menu--below multipart-menu--end', kinds, add)
      head.append(title, headAdd.wrap)

      const contentDOM = document.createElement('div')
      contentDOM.className = 'multipart-parts-list'

      const empty = document.createElement('p')
      empty.className = 'multipart-parts-empty'
      empty.contentEditable = 'false'
      empty.textContent = words.empty ?? ''

      const actions = document.createElement('div')
      actions.className = 'multipart-parts-actions'
      actions.contentEditable = 'false'
      const footAdd = kindMenu(addPartButton(words.add), 'multipart-menu--above', kinds, add)
      actions.append(footAdd.wrap)

      dom.append(head, contentDOM, ...(words.empty === null ? [] : [empty]), actions)

      const render = () => {
        empty.hidden = node.childCount > 0
        const shown = editable() ? '' : 'none'
        actions.style.display = shown
        headAdd.wrap.style.display = shown
      }
      render()

      const chrome = (target: EventTarget | null) =>
        head.contains(target as Node)
        || empty.contains(target as Node)
        || actions.contains(target as Node)

      return {
        dom,
        contentDOM,
        update(next) {
          if (next.type !== node.type) return false
          node = next
          render()
          return true
        },
        ignoreMutation: (mutation) => chrome(mutation.target),
        stopEvent: (event) => chrome(event.target),
        destroy: () => {
          headAdd.close()
          footAdd.close()
        },
      }
    }
  }
}

// Node view for the Parts box.
export const multipartPartsView = $view(multipartPartsSchema.node, boxView(PARTS_WORDS))

// Node view for a Part's Subparts box: the Parts box's chrome, one level in.
export const multipartSubpartsView = $view(multipartSubpartsSchema.node, boxView(SUBPARTS_WORDS))

// One Part or Subpart: one dashed box, drawn as a question of its kind. At the
// top, shaded, a header set as the question editor's front matter is — the
// Type label, then the Part's type as the question type's badge, which opens a
// menu to switch it — with the controls that move it up, move it down and
// delete it at the right; then, ruled off, its stem; then its answer component
// as the box's last cells, or a Part's Subparts.
function answeringView(subpart: boolean) {
  const noun = subpart ? 'subpart' : 'part'
  // A Part's menu offers Subparts too; a Subpart's never does (ADR-0043).
  const kinds: readonly PartShape[] = subpart
    ? ['multiple-choice', 'open']
    : ['multiple-choice', 'open', 'subparts']
  return (ctx: Ctx) => {
    // One editor's answers set aside by switching a Part's kind, so switching
    // back brings them again. Never saved: see `SetAsideAnswers`.
    const setAside: SetAsideAnswers = new Map()
    return (initialNode: ProseNode, view: EditorView, getPos: () => number | undefined): NodeView => {
      let node: ProseNode = initialNode
      const editable = () => ctx.get(multipleChoiceEditableCtx)

      const dom = document.createElement('div')
      dom.className = subpart ? 'multipart-part multipart-subpart' : 'multipart-part'
      dom.dataset.type = subpart ? 'multipart-subpart' : 'multipart-part'

      const header = document.createElement('div')
      header.className = 'multipart-part-header'
      header.contentEditable = 'false'

      const label = document.createElement('span')
      label.className = 'multipart-part-label'
      label.append(icon('type'), 'Type')

      const kindButton = document.createElement('button')
      kindButton.type = 'button'
      kindButton.className = 'multipart-part-kind'
      const kind = kindMenu(kindButton, 'multipart-menu--below', kinds, (next) => {
        if (!editable()) return
        const pos = getPos()
        if (pos == null) return
        if (next === 'subparts') addSubparts(view, pos)
        else setPartKind(view, pos, next, setAside)
        view.focus()
      })

      const controls = document.createElement('span')
      controls.className = 'multipart-part-controls'
      const control = (name: 'up' | 'down' | 'x', text: string, run: (pos: number) => void) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `multipart-part-control multipart-part-${name}`
        button.setAttribute('aria-label', text)
        button.title = text
        button.append(icon(name))
        button.addEventListener('mousedown', (event) => {
          event.preventDefault()
          if (!editable()) return
          const pos = getPos()
          if (pos == null) return
          run(pos)
          view.focus()
        })
        controls.append(button)
      }
      const indexAt = (pos: number) => view.state.doc.resolve(pos).index()
      control('up', `Move ${noun} up`, (pos) => movePartTo(view, pos, indexAt(pos) - 1))
      control('down', `Move ${noun} down`, (pos) => movePartTo(view, pos, indexAt(pos) + 2))
      control('x', `Delete ${noun}`, (pos) => (subpart ? deleteSubpart(view, pos) : deletePart(view, pos)))

      // What answering it is worth, beside its type: typed as a whole number,
      // and cleared by emptying the field. Anything else is put back as it
      // was when the field is left, so a stray letter never clears Points.
      // A Part that holds Subparts has no field, since its Subparts carry
      // the Points.
      const pointsField = document.createElement('label')
      pointsField.className = 'multipart-part-points'
      const pointsInput = document.createElement('input')
      pointsInput.type = 'text'
      pointsInput.inputMode = 'numeric'
      pointsInput.className = 'multipart-part-points-input'
      pointsInput.placeholder = '–'
      pointsInput.size = 2
      pointsInput.setAttribute('aria-label', `${subpart ? 'Subpart' : 'Part'} points`)
      const pointsWord = document.createElement('span')
      pointsWord.textContent = 'points'
      pointsField.append(pointsInput, pointsWord)
      const shownPoints = () => {
        const points = readPoints(node.attrs.points)
        return points === undefined ? '' : String(points)
      }
      const commitPoints = () => {
        const points = parsePointsInput(pointsInput.value)
        const pos = getPos()
        if (points !== undefined && editable() && pos != null) setPartPoints(view, pos, points)
        pointsInput.value = shownPoints()
      }
      pointsInput.addEventListener('change', commitPoints)
      pointsInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commitPoints()
          view.focus()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          pointsInput.value = shownPoints()
          view.focus()
        }
      })

      header.append(label, kind.wrap, pointsField, controls)

      const contentDOM = document.createElement('div')
      contentDOM.className = 'multipart-part-body'

      dom.append(header, contentDOM)

      const render = () => {
        const current = partKindOf(node)
        dom.dataset.kind = current
        kindButton.replaceChildren(kindBadge(current))
        kindButton.setAttribute(
          'aria-label',
          `${subpart ? 'Subpart' : 'Part'} type: ${PART_KIND_LABELS[current]}`,
        )
        kind.mark(current)
        const on = editable()
        kindButton.disabled = !on
        if (!on) kind.close()
        controls.style.display = on ? '' : 'none'
        pointsField.hidden = current === 'subparts'
        pointsInput.disabled = !on
        if (document.activeElement !== pointsInput) pointsInput.value = shownPoints()
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
        ignoreMutation: (mutation) => header.contains(mutation.target),
        stopEvent: (event) => header.contains(event.target as Node),
        destroy: () => kind.close(),
      }
    }
  }
}

// Node view for one Part.
export const multipartPartView = $view(multipartPartSchema.node, answeringView(false))

// Node view for one Subpart: a Part's box, one level in, offering only the two
// kinds a Subpart can answer as.
export const multipartSubpartView = $view(multipartSubpartSchema.node, answeringView(true))

// Node view for a Part's stem: the middle of the Part's box, under its header
// and over its answers, with a placeholder the stylesheet words for the Part's
// kind.
export const multipartPartStemView = $view(
  multipartPartStemSchema.node,
  () => (initialNode: ProseNode): NodeView => {
    let node: ProseNode = initialNode
    const dom = document.createElement('div')
    dom.className = 'multipart-part-stem'
    dom.dataset.type = 'multipart-part-stem'
    return {
      dom,
      contentDOM: dom,
      update(next) {
        if (next.type !== node.type) return false
        node = next
        return true
      },
    }
  },
)
