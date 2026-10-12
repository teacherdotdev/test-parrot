// A Centred block: a paragraph, a block picture or a table that Question
// Content sets in the middle of its column rather than at its left — a figure,
// its "Fig. 1.1" caption, a "Table 1.1". Left is the default and centre the one
// other alignment, kept as the node's `align: 'center'`; a left block carries
// no `align` at all, so a document saved before centring existed is unchanged.
//
// Every output reads it through `isCentred` and nothing else, so the editor,
// the sheet, the PDF, DOCX, Copy and the Question Bank File agree on which
// blocks are centred.

import type { ProseMirrorJSON } from './question-doc'

export const CENTRE = 'center'

/** The nodes that may be centred. */
export const CENTRABLE_NODES: ReadonlySet<string> = new Set(['paragraph', 'image-block', 'table'])

/** What keeps the blocks inside it to the left: a list's item, which opens
 *  with its bullet or number, and a Multiple Choice answer, a matching Item
 *  and a Word Bank answer, which open with their letter or number. */
export const UNCENTRED_CONTAINERS: ReadonlySet<string> = new Set([
  'list_item',
  'multipleChoiceChoice',
  'matchingPrompt',
  'matchingAnswer',
])

/** Whether a node is a Centred block. */
export function isCentred(node: ProseMirrorJSON): boolean {
  if (!CENTRABLE_NODES.has(String(node.type))) return false
  const attrs = node.attrs as Record<string, unknown> | null | undefined
  return attrs?.align === CENTRE
}

/** A fingerprint line's kind, marked `:center` for a Centred block. */
export function centredKind(kind: string, node: ProseMirrorJSON): string {
  return isCentred(node) ? `${kind}:${CENTRE}` : kind
}
