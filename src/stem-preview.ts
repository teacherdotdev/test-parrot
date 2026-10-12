// The compact projection of one question, for a Question Bank row.
//
// A bank row is one line high and holds many questions, so it shows a
// deliberately reduced reading of the Question Content: the stem, flattened to
// a single line, with a badge where the line cannot carry what is there. It is
// a projection, not a rendering — the question popup remains the only place the
// whole of a question is presented.
//
// The projection is also what stem search reads, so what a teacher can find is
// exactly what the row showed them.

import { stemNodesOf, type ProseMirrorJSON } from './question-doc'
import { partsOf, promptsOf, type Question } from './exam'

/** Content a one-line row can only point at. */
export type StemPreviewBadge = 'image' | 'math'

/** A one-line reading of a question's stem. */
export type StemPreview = {
  /** The stem's prose, whitespace normalised to single spaces. */
  text: string
  /** Which kinds of non-prose content the stem holds, in the order the stem
   *  reaches them and each named once. */
  badges: StemPreviewBadge[]
  /** How many Parts a Multipart question holds — the row says so beside the Multipart question's
   *  own line. Absent for every other Question Type. */
  parts?: number
}

// The blocks whose text a single line can carry. Everything absent from this
// list contributes nothing: a table is a grid, a code block is preformatted
// lines, and flattening either into a row would misrepresent it rather than
// preview it. Listing what is carried, rather than what is dropped, keeps a
// newly supported node out of the row until somebody decides how it reads.
const PROSE_BLOCKS = new Set([
  'doc',
  'paragraph',
  'heading',
  'blockquote',
  'bullet_list',
  'ordered_list',
  'list_item',
  'sideBySide',
  'sideBySidePanel',
])

const BADGE_NODES: Record<string, StemPreviewBadge> = {
  image: 'image',
  'image-block': 'image',
  math_inline: 'math',
}

/**
 * The single line a Question Bank row shows for this question.
 *
 * Only the stem is read: answer choices and their correctness live behind the
 * popup, and a row that showed them would give the answer away while scanning.
 */
export function stemPreview(question: Question): StemPreview {
  const preview = previewOf(stemNodesOf(question.doc))
  // A Matching set whose directions are its Section's has a blank stem; its
  // Items say what it is about, and they give nothing away.
  if (question.type === 'matching' && !preview.text) {
    const items = promptsOf(question)
      .map(({ node }) => previewOf(Array.isArray(node.content) ? node.content as ProseMirrorJSON[] : []).text)
      .filter(Boolean)
    return { ...preview, text: items.join(' · ') }
  }
  if (question.type !== 'multipart') return preview
  const parts = partsOf(question)
  // A Multipart question with no shared material — as an exam board writes
  // one, its Parts asked straight away — is named by its first line: the
  // first Part's, or a Subpart's under a lead-in left blank.
  const text = preview.text || parts
    .flatMap((part) => [part.stem, ...part.subparts.map(({ stem }) => stem)])
    .map((stem) => previewOf(stem).text)
    .find(Boolean) || ''
  return { ...preview, text, parts: parts.length }
}

/**
 * Everything a stem search reads for this question: the row's own line and,
 * for a Multipart question, each Part's and Subpart's stem as well — a teacher looking for "Aldmere"
 * should find the Multipart question whether the word is in the passage or in the
 * question asked about it. Answers stay out of reach, as they do for any
 * question.
 */
export function searchableText(question: Question): string {
  return [
    stemPreview(question).text,
    ...partsOf(question).flatMap((part) =>
      [part, ...part.subparts].map((shown) => previewOf(shown.stem).text)),
  ].join(' ')
}

function previewOf(blocks: readonly ProseMirrorJSON[]): StemPreview {
  const parts: string[] = []
  const badges: StemPreviewBadge[] = []

  const read = (node: ProseMirrorJSON) => {
    const type = String(node.type ?? '')
    if (typeof node.text === 'string') {
      // Runs are concatenated, not joined: the spacing between a bold word and
      // the word after it is the one the teacher typed.
      parts.push(node.text)
      return
    }
    const badge = BADGE_NODES[type]
    if (badge) {
      if (!badges.includes(badge)) badges.push(badge)
      return
    }
    if (type === 'hardbreak') {
      parts.push(' ')
      return
    }
    // A Blank reads as a short line: its answer stays behind the popup, as
    // a choice's correctness does.
    if (type === 'blank') {
      parts.push('____')
      return
    }
    if (!PROSE_BLOCKS.has(type)) return
    // A block boundary is a space; the normalisation below makes it at most one.
    parts.push(' ')
    const content = Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
    for (const child of content) read(child)
    parts.push(' ')
  }

  for (const node of blocks) read(node)

  return { text: parts.join('').replace(/\s+/g, ' ').trim(), badges }
}
