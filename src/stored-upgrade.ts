// Reading what an earlier build of the editor stored.
//
// Questions and drafts live in the teacher's browser, written by whichever
// build of the editor they last used. A build that renamed something must
// still read what its predecessor wrote, or the first edit after an update
// writes a blank draft over the teacher's work. This is where each such rename
// is undone on the way in, so everything downstream reads only current shapes.

import type { Question } from './exam'
import type { ProseMirrorJSON } from './question-doc'

// The Multipart Question Type was first built as "Stimulus", and a question
// written then carries that type and those node names.
const RENAMED_NODES: Readonly<Record<string, string>> = {
  stimulusParts: 'multipartParts',
  stimulusPart: 'multipartPart',
  stimulusPartStem: 'multipartPartStem',
}

function renamedNodes(node: ProseMirrorJSON): ProseMirrorJSON {
  const renamed = typeof node.type === 'string' ? RENAMED_NODES[node.type] : undefined
  const content = Array.isArray(node.content)
    ? (node.content as ProseMirrorJSON[]).map(renamedNodes)
    : undefined
  return {
    ...node,
    ...(renamed ? { type: renamed } : {}),
    ...(content ? { content } : {}),
  }
}

// Points were first built as "Marks", and a question written then carries
// `marks` on itself, or on a Part's or Subpart's node.
function pointsFromMarks(node: ProseMirrorJSON): ProseMirrorJSON {
  const attrs = node.attrs as Record<string, unknown> | undefined
  const content = Array.isArray(node.content)
    ? (node.content as ProseMirrorJSON[]).map(pointsFromMarks)
    : undefined
  if (attrs && 'marks' in attrs && (node.type === 'multipartPart' || node.type === 'multipartSubpart')) {
    const { marks, ...rest } = attrs
    return { ...node, attrs: { ...rest, points: rest.points ?? marks }, ...(content ? { content } : {}) }
  }
  return content ? { ...node, content } : node
}

/** A stored question in its current shape. A question that is already current
 *  is returned as it is. */
export function upgradeStoredQuestion(question: Question): Question {
  let upgraded = question
  if ((upgraded.type as string) === 'stimulus') {
    upgraded = { ...upgraded, type: 'multipart', doc: renamedNodes(upgraded.doc) }
  }
  if ('marks' in upgraded) {
    const { marks, ...rest } = upgraded as Question & { marks?: number }
    const points = rest.points ?? marks
    upgraded = points === undefined ? rest : { ...rest, points }
  }
  if (upgraded.type === 'multipart') upgraded = { ...upgraded, doc: pointsFromMarks(upgraded.doc) }
  return upgraded
}
