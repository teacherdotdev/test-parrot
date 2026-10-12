// The ProseMirror document that holds a question's stem and, for multiple
// choice, its choice nodes — or, for a matching set, its prompts and Word Bank.
// Questions are stored as plain JSON so the model and the store never need a
// live editor; only the Crepe dialog turns it back into a ProseMirror document.

import { isCentred, UNCENTRED_CONTAINERS } from './centring'
import { isLocked, type AnswerLock } from './locked-answers'
import { cleanBlankContent } from './blank'

export type ProseMirrorJSON = Record<string, unknown>

// The document nodes and marks export supports, named once.
//
// A node here must have a mapping in every one of: `doc-view.tsx` (how print
// draws it), `docx-export.ts` (how Word holds it), `export-fingerprint.ts` (the
// content line it reduces to) and `print-fingerprint.ts` (how that line is read
// back out of print's markup) — and a fixture in `export-fixtures.ts`, which is
// what `export-parity.test.ts` checks. A newly supported editor node that skips
// any of those fails its export coverage instead of quietly flattening.
//
// One place deliberately stays silent: `stem-preview.ts` carries its own short
// list of what a one-line Question Bank row can say, and a node absent from it
// is left out of the row rather than flattened into it. That is a presentation
// decision, not export coverage, so it is nobody's obligation until somebody
// decides how the node should read in a single line.
export const SUPPORTED_NODES = [
  'paragraph',
  'heading',
  'blockquote',
  'bullet_list',
  'ordered_list',
  'list_item',
  'code_block',
  'hr',
  'table',
  'table_header_row',
  'table_row',
  'table_header',
  'table_cell',
  'image',
  'image-block',
  'math_inline',
  'blank',
  'hardbreak',
  'text',
  'sideBySide',
  'sideBySidePanel',
] as const

export const SUPPORTED_MARKS = [
  'strong',
  'emphasis',
  'inlineCode',
  'strike_through',
  'subscript',
  'superscript',
  'link',
] as const

/** What a Pending Image names instead of Media Asset bytes: the Image Tag
 *  printed on its picture in a labeled copy of the Source Document, or only the
 *  1-based page the picture is on. An editor image node carries it as its
 *  `pending` attribute, with no source, until Resolve Images gives it one. */
export type PendingImageReference = { image: number } | { page: number }

/** The Pending Image an editor image node stands for, if it is one: what its
 *  `pending` attribute names, checked, so a malformed value never reaches a
 *  record as though it were one. */
export function pendingImageOf(node: ProseMirrorJSON): PendingImageReference | undefined {
  if (node.type !== 'image' && node.type !== 'image-block') return undefined
  const attrs = node.attrs as Record<string, unknown> | null | undefined
  const pending = attrs?.pending
  if (typeof pending !== 'object' || pending === null) return undefined
  const { image, page } = pending as { image?: unknown; page?: unknown }
  const positive = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1
  if (positive(image) && page === undefined) return { image }
  if (positive(page) && image === undefined) return { page }
  return undefined
}

export const emptyDoc: ProseMirrorJSON = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

function blankChoice(): ProseMirrorJSON {
  return {
    type: 'multipleChoiceChoice',
    attrs: { correct: false, id: '' },
    content: [{ type: 'paragraph' }],
  }
}

function attrsOf(value: unknown): Record<string, unknown> | undefined {
  const attrs = (value as { attrs?: unknown }).attrs
  if (typeof attrs !== 'object' || attrs === null || Array.isArray(attrs)) {
    return undefined
  }
  return { ...(attrs as Record<string, unknown>) }
}

/** Points a stored or imported value gives, when it gives any: a positive
 *  whole number. Anything else — absent, zero, a fraction, a string — reads as
 *  unpointed, so a record written before Points existed, or one an older build
 *  stored, needs no upgrade to be read (ADR-0042). The one guard, so the
 *  editor, the sheet, storage and import agree on what Points are. */
export function readPoints(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined
}

/** What a teacher typed into a Points field, read: a positive whole number,
 *  `null` for an empty field — which clears the Points — or `undefined` for
 *  anything else, which changes nothing. */
export function parsePointsInput(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return undefined
  return readPoints(Number(trimmed))
}

// Strip a document down to the shapes the editor schema accepts, so a document
// that has been round-tripped through storage always loads. `attrs` are carried
// through — they are where a heading's level, an image's source and a latex
// node's expression live, and the page renders all three. Choices keep their
// stable id and their boolean `correct`; a choice list is never left with fewer
// than the two answers the schema requires.
export function cleanDocument(value: ProseMirrorJSON): ProseMirrorJSON {
  const cleanNode = (node: ProseMirrorJSON, uncentred = false): ProseMirrorJSON => {
    const clean: ProseMirrorJSON = { type: String(node.type ?? 'paragraph') }
    const attrs = attrsOf(node)
    // A Centred block keeps `align: 'center'`; anything else — a left block,
    // the editor's null, a block in a list item or an answer — keeps none.
    if (attrs && 'align' in attrs && (uncentred || !isCentred(node))) delete attrs.align
    if (attrs) clean.attrs = attrs
    if (typeof node.text === 'string') clean.text = node.text
    if (Array.isArray(node.marks)) {
      clean.marks = node.marks.map((mark) => {
        const clean: ProseMirrorJSON = {
          type: String((mark as { type?: unknown }).type ?? ''),
        }
        const attrs = attrsOf(mark)
        if (attrs) clean.attrs = attrs
        return clean
      })
    }
    if (Array.isArray(node.content)) {
      const within = uncentred || UNCENTRED_CONTAINERS.has(String(node.type))
      clean.content = node.content.map((child) =>
        cleanNode(child as ProseMirrorJSON, within),
      )
    }
    if (node.type === 'multipleChoice') {
      const choices = Array.isArray(clean.content)
        ? (clean.content as ProseMirrorJSON[])
        : []
      while (choices.length < 2) choices.push(blankChoice())
      clean.content = choices
    } else if (node.type === 'multipleChoiceChoice') {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>
      // A Locked Answer's `locked` is kept only when the teacher decided it;
      // an undecided answer has none, and its wording decides (ADR-0038).
      clean.attrs = {
        correct: attrs.correct === true,
        id: typeof attrs.id === 'string' ? attrs.id : '',
        ...(typeof attrs.locked === 'boolean' ? { locked: attrs.locked } : {}),
      }
    } else if (node.type === 'matching') {
      clean.content = cleanMatchingContent(
        Array.isArray(clean.content) ? (clean.content as ProseMirrorJSON[]) : [],
      )
    } else if (node.type === 'matchingPrompt') {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>
      clean.attrs = {
        id: typeof attrs.id === 'string' ? attrs.id : '',
        answer: typeof attrs.answer === 'string' ? attrs.answer : '',
      }
    } else if (node.type === 'matchingAnswer') {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>
      clean.attrs = { id: typeof attrs.id === 'string' ? attrs.id : '' }
    } else if ((node.type === 'image' || node.type === 'image-block') && clean.attrs) {
      // A Pending Image keeps exactly what it names; every other image has
      // no `pending` at all, rather than the editor's empty default.
      const pending = pendingImageOf(node)
      const { pending: _pending, ...rest } = clean.attrs as Record<string, unknown>
      void _pending
      clean.attrs = pending ? { ...rest, pending: { ...pending } } : rest
    } else if (node.type === 'multipartParts') {
      clean.content = (Array.isArray(clean.content)
        ? (clean.content as ProseMirrorJSON[])
        : []
      ).filter((child) => child.type === 'multipartPart')
    } else if (node.type === 'multipartPart' || node.type === 'multipartSubpart') {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>
      clean.content = cleanPartContent(
        Array.isArray(clean.content) ? (clean.content as ProseMirrorJSON[]) : [],
        node.type === 'multipartPart',
      )
      // Points belong to a Part that answers, never to one holding Subparts,
      // and an unpointed one keeps no `points` at all — not the editor's null —
      // so a document saved before Points existed is saved unchanged.
      const points = readPoints(attrs.points)
      const answers = (clean.content as ProseMirrorJSON[]).at(-1)?.type !== 'multipartSubparts'
      clean.attrs = {
        id: typeof attrs.id === 'string' ? attrs.id : '',
        columns: attrs.columns === 1 || attrs.columns === 4 ? attrs.columns : 2,
        ...(points !== undefined && answers ? { points } : {}),
      }
    } else if (node.type === 'blank') {
      // A Blank's answer holds text and inline mathematics only, and a Blank
      // carries no attributes of its own.
      delete clean.attrs
      clean.content = cleanBlankContent(
        Array.isArray(clean.content) ? (clean.content as ProseMirrorJSON[]) : [],
      )
      if ((clean.content as ProseMirrorJSON[]).length === 0) delete clean.content
    } else if (node.type === 'multipartSubparts') {
      clean.content = (Array.isArray(clean.content)
        ? (clean.content as ProseMirrorJSON[])
        : []
      ).filter((child) => child.type === 'multipartSubpart')
    } else if (node.type === 'sideBySide') {
      // Panels only, and no more than three; one left is unwrapped by the
      // editor as soon as it loads.
      clean.content = (Array.isArray(clean.content)
        ? (clean.content as ProseMirrorJSON[])
        : []
      ).filter((child) => child.type === 'sideBySidePanel').slice(0, 3)
      if ((clean.content as ProseMirrorJSON[]).length === 0) {
        clean.content = [{ type: 'sideBySidePanel', content: [{ type: 'paragraph' }] }]
      }
    } else if (
      node.type === 'multipartPartStem'
      || node.type === 'suggestedAnswer'
      || node.type === 'sideBySidePanel'
    ) {
      if (!Array.isArray(clean.content) || clean.content.length === 0) {
        clean.content = [{ type: 'paragraph' }]
      }
    }
    return clean
  }
  return cleanNode(value)
}

function blankPrompt(): ProseMirrorJSON {
  return {
    type: 'matchingPrompt',
    attrs: { id: '', answer: '' },
    content: [{ type: 'paragraph' }],
  }
}

function blankBankAnswer(): ProseMirrorJSON {
  return {
    type: 'matchingAnswer',
    attrs: { id: '' },
    content: [{ type: 'paragraph' }],
  }
}

// A matching set's content in the one shape the schema accepts: its prompts,
// then its Word Bank, nothing else between or among them. A set is never left
// with fewer than one prompt to number or two answers to choose between, and a
// prompt whose answer no longer exists in the bank is unmatched rather than
// left pointing at nothing.
function cleanMatchingContent(nodes: ProseMirrorJSON[]): ProseMirrorJSON[] {
  const prompts = nodes.filter((node) => node.type === 'matchingPrompt')
  const bank = nodes.filter((node) => node.type === 'matchingAnswer')
  while (prompts.length < 1) prompts.push(blankPrompt())
  while (bank.length < 2) bank.push(blankBankAnswer())
  const bankIds = new Set(bank.map(choiceIdOf).filter(Boolean))
  for (const prompt of prompts) {
    const attrs = prompt.attrs as Record<string, unknown>
    if (!bankIds.has(String(attrs.answer))) attrs.answer = ''
  }
  return [...prompts, ...bank]
}

// A Part's or Subpart's content in the one shape the schema accepts: its
// stem, then the node that makes it the Part it is — its answers, or, for a
// Part only, the Subparts it holds. A Part that lost that node in storage, or
// kept a Subparts box with nothing in it, comes back as a Multiple Choice
// Part, the kind a new one starts as, rather than failing to load.
function cleanPartContent(nodes: ProseMirrorJSON[], holdsSubparts: boolean): ProseMirrorJSON[] {
  const stem = nodes.find((node) => node.type === 'multipartPartStem')
    ?? { type: 'multipartPartStem', content: [{ type: 'paragraph' }] }
  const answer = nodes.find(
    (node) =>
      node.type === 'multipleChoice'
      || node.type === 'suggestedAnswer'
      || (holdsSubparts && node.type === 'multipartSubparts' && childrenOf(node).length > 0),
  ) ?? { type: 'multipleChoice', content: [blankChoice(), blankChoice()] }
  return [stem, answer]
}

function childrenOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

// The `multipleChoice` node of a question document, or undefined when the
// question carries no answers. A document holds at most one.
export function multipleChoiceNodeOf(
  doc: ProseMirrorJSON,
): ProseMirrorJSON | undefined {
  return childrenOf(doc).find((node) => node.type === 'multipleChoice')
}

// The answers of a question document in authoring order — the order a version's
// `choiceOrder` permutes.
export function choiceNodesOf(doc: ProseMirrorJSON): ProseMirrorJSON[] {
  const list = multipleChoiceNodeOf(doc)
  if (!list) return []
  return childrenOf(list).filter((node) => node.type === 'multipleChoiceChoice')
}

export function choiceIdOf(node: ProseMirrorJSON): string {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  return typeof attrs.id === 'string' ? attrs.id : ''
}

export function choiceIsCorrect(node: ProseMirrorJSON): boolean {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  return attrs.correct === true
}

/** What the teacher decided about a choice's lock: `true` or `false`, or
 *  `null` when they never touched it and its wording decides. */
export function choiceLockOf(node: ProseMirrorJSON): AnswerLock {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  return typeof attrs.locked === 'boolean' ? attrs.locked : null
}

/** The words a node says: a line's text runs joined as written, and a space
 *  between lines and at every break. A picture or an equation says nothing. */
export function plainTextOf(node: ProseMirrorJSON): string {
  if (typeof node.text === 'string') return node.text
  if (node.type === 'hardbreak') return ' '
  const line = node.type === 'paragraph' || node.type === 'heading'
  return childrenOf(node).map(plainTextOf).join(line ? '' : ' ')
}

/** Whether a choice is a Locked Answer, keeping its letter wherever answers
 *  are shuffled: the teacher's decision, or else its wording. */
export function choiceIsLocked(node: ProseMirrorJSON): boolean {
  return isLocked(choiceLockOf(node), plainTextOf(node))
}

// The `matching` node of a question document, or undefined when the question
// is not a matching set. A document holds at most one.
export function matchingNodeOf(doc: ProseMirrorJSON): ProseMirrorJSON | undefined {
  return childrenOf(doc).find((node) => node.type === 'matching')
}

// A matching set's prompts — the items a student numbers off and matches — in
// authoring order, which is the order they print in.
export function matchingPromptNodesOf(doc: ProseMirrorJSON): ProseMirrorJSON[] {
  const set = matchingNodeOf(doc)
  if (!set) return []
  return childrenOf(set).filter((node) => node.type === 'matchingPrompt')
}

// A matching set's Word Bank in authoring order — the order a version's
// `choiceOrder` permutes, exactly as it permutes a Multiple Choice question's
// answers.
export function matchingBankNodesOf(doc: ProseMirrorJSON): ProseMirrorJSON[] {
  const set = matchingNodeOf(doc)
  if (!set) return []
  return childrenOf(set).filter((node) => node.type === 'matchingAnswer')
}

// The id of the Word Bank answer a prompt names, or '' when it names none.
export function promptAnswerIdOf(node: ProseMirrorJSON): string {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  return typeof attrs.answer === 'string' ? attrs.answer : ''
}

function isBlankParagraph(node: ProseMirrorJSON | undefined): boolean {
  return node?.type === 'paragraph' && childrenOf(node).length === 0
}

// The top-level blocks that visibly belong to a question stem. Crepe keeps one
// empty paragraph immediately before a multiple-choice block — or a matching
// set — as the editing boundary between the question and its answers. That
// boundary is not teacher-authored space, so the read-only and exported
// documents ignore it; any additional empty paragraphs remain and therefore
// still add space.
export function stemNodesOf(doc: ProseMirrorJSON): ProseMirrorJSON[] {
  const answers =
    multipleChoiceNodeOf(doc) ?? matchingNodeOf(doc) ?? multipartPartsNodeOf(doc)
  const stem = childrenOf(doc).filter((node) => node !== answers)
  return answers && isBlankParagraph(stem.at(-1)) ? stem.slice(0, -1) : stem
}

// The `multipartParts` node of a Multipart question document: the box that holds its
// Parts. Everything above it at the top level is the question's stem, the material its Parts share. A
// document holds at most one.
export function multipartPartsNodeOf(
  doc: ProseMirrorJSON,
): ProseMirrorJSON | undefined {
  return childrenOf(doc).find((node) => node.type === 'multipartParts')
}

// A Multipart question's Parts in authored order — the order they are lettered in.
export function multipartPartNodesOf(doc: ProseMirrorJSON): ProseMirrorJSON[] {
  const parts = multipartPartsNodeOf(doc)
  if (!parts) return []
  return childrenOf(parts).filter((node) => node.type === 'multipartPart')
}

// A Part's own stem, as blocks.
export function partStemNodesOf(part: ProseMirrorJSON): ProseMirrorJSON[] {
  const stem = childrenOf(part).find((node) => node.type === 'multipartPartStem')
  return stem ? childrenOf(stem) : []
}

// The node that answers a Part or Subpart: its `multipleChoice` list, or its
// `suggestedAnswer` block for a Short Answer one. Unlike a Short Answer
// question's, a Part's Suggested Answer stays inside the document, beside the
// stem it answers. A Part that holds Subparts has none: they answer for it.
export function partAnswerNodeOf(part: ProseMirrorJSON): ProseMirrorJSON | undefined {
  return childrenOf(part).find(
    (node) => node.type === 'multipleChoice' || node.type === 'suggestedAnswer',
  )
}

// A Part's Subparts in authored order — the order they are numbered (i), (ii)…
// in. Empty for a Part that answers itself, and for a Subpart, which never
// holds any (ADR-0043).
export function subpartNodesOf(part: ProseMirrorJSON): ProseMirrorJSON[] {
  if (part.type !== 'multipartPart') return []
  const box = childrenOf(part).find((node) => node.type === 'multipartSubparts')
  return box ? childrenOf(box).filter((node) => node.type === 'multipartSubpart') : []
}

// The `suggestedAnswer` node of a question document being edited, or undefined
// when there is none. It exists only inside the dialog's editor: a Question
// stores its Suggested Answer in its own field, and the document that reaches
// storage and export never carries one.
export function suggestedAnswerNodeOf(
  doc: ProseMirrorJSON,
): ProseMirrorJSON | undefined {
  return childrenOf(doc).find((node) => node.type === 'suggestedAnswer')
}

// The document to hand the editor for a Short Answer question: the stem with
// a Suggested Answer block at the end, holding the answer already saved for it.
// The block is always present, so an answer is typed rather than added.
export function withSuggestedAnswer(
  doc: ProseMirrorJSON,
  answer?: ProseMirrorJSON,
): ProseMirrorJSON {
  const content = answer ? childrenOf(answer) : []
  const without = withoutSuggestedAnswer(doc)
  const stem = childrenOf(without)
  return {
    ...without,
    content: [
      ...(stem.length > 0 ? stem : [{ type: 'paragraph' }]),
      {
        type: 'suggestedAnswer',
        content: content.length > 0 ? content : [{ type: 'paragraph' }],
      },
    ],
  }
}

// The stem the dialog saves: the edited document with its Suggested Answer
// block lifted out, along with the empty paragraph Crepe keeps on either side
// of the block as the editing boundary. That boundary is not teacher-authored
// space, so it is no more part of the stem than the block itself is.
export function withoutSuggestedAnswer(doc: ProseMirrorJSON): ProseMirrorJSON {
  const nodes = childrenOf(doc)
  const index = nodes.findIndex((node) => node.type === 'suggestedAnswer')
  if (index < 0) return { ...doc, content: [...nodes] }
  const before = nodes.slice(0, index)
  const after = nodes.slice(index + 1)
  const content = [
    ...(isBlankParagraph(before.at(-1)) && before.length > 1
      ? before.slice(0, -1)
      : before),
    ...(isBlankParagraph(after[0]) ? after.slice(1) : after),
  ]
  return {
    ...doc,
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  }
}

// The Suggested Answer the dialog saves, or undefined when the block was left
// visibly blank — an empty block is how a question says it has no Suggested
// Answer, so blank never saves a document made of empty paragraphs.
export function suggestedAnswerDocumentOf(
  doc: ProseMirrorJSON,
): ProseMirrorJSON | undefined {
  const node = suggestedAnswerNodeOf(doc)
  if (!node) return undefined
  const content = childrenOf(node)
  if (content.every(isBlankParagraph)) return undefined
  return { type: 'doc', content }
}

// The document with its multiple-choice node taken out, if it has one. A
// document holds at most one, so this is what switching a question to Open
// Response lifts out into the stash.
export function withoutMultipleChoice(doc: ProseMirrorJSON): ProseMirrorJSON {
  return {
    ...doc,
    content: childrenOf(doc).filter((node) => node.type !== 'multipleChoice'),
  }
}

// The document with the given multiple-choice node appended, replacing any
// already there — a document holds at most one. What switching a question
// back to Multiple Choice re-inserts.
export function withMultipleChoice(
  doc: ProseMirrorJSON,
  node: ProseMirrorJSON,
): ProseMirrorJSON {
  const without = withoutMultipleChoice(doc)
  return { ...without, content: [...childrenOf(without), node] }
}

// A copy of the document whose answers carry brand-new ids. Duplicating a
// question must not hand the copy the original's choice ids: a version's
// `choiceOrder` is keyed by choice id, so shared ids would make one question's
// ordering move the other's answers. A Multipart question's Parts and Subparts are renamed
// too, since their answer order and Work Space are keyed by their ids. A matching set's Word Bank is renamed the
// same way, and every prompt follows the answer it named to its new id, so the
// copy matches what the original matched.
export function withFreshChoiceIds(doc: ProseMirrorJSON): ProseMirrorJSON {
  const renamed = new Map<string, string>()
  const freshId = (id: string): string => {
    const next = crypto.randomUUID()
    if (id) renamed.set(id, next)
    return next
  }
  const fresh = (node: ProseMirrorJSON): ProseMirrorJSON => {
    const copy: ProseMirrorJSON = { ...node }
    const attrs = (node.attrs ?? {}) as Record<string, unknown>
    if (
      node.type === 'multipleChoiceChoice'
      || node.type === 'matchingPrompt'
      || node.type === 'matchingAnswer'
      || node.type === 'multipartPart'
      || node.type === 'multipartSubpart'
    ) {
      copy.attrs = { ...attrs, id: freshId(choiceIdOf(node)) }
    }
    if (Array.isArray(node.content)) {
      copy.content = (node.content as ProseMirrorJSON[]).map(fresh)
    }
    return copy
  }
  const rematch = (node: ProseMirrorJSON): ProseMirrorJSON => {
    if (node.type === 'matchingPrompt') {
      const answer = promptAnswerIdOf(node)
      return {
        ...node,
        attrs: {
          ...((node.attrs ?? {}) as Record<string, unknown>),
          answer: renamed.get(answer) ?? '',
        },
      }
    }
    if (!Array.isArray(node.content)) return node
    return { ...node, content: (node.content as ProseMirrorJSON[]).map(rematch) }
  }
  // Two passes: the Word Bank may follow the prompts that name it, so every
  // new id has to exist before any prompt can be pointed at one.
  return rematch(fresh(doc))
}
