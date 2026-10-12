// A Blank: the place in a Fill in the Blank question's stem where a student
// writes, holding the answer the teacher wrote for it (ADR-0049).
//
// In the document it is an inline node whose content is its answer — text,
// with its marks, and inline mathematics — so the stem reads as the sentence
// the teacher wrote. The question editor shows that answer as a chip; every
// view a student sees draws `BLANK_LINE` in its place instead, one length
// whatever the answer, so the length is never a clue. The Answer Key reads the
// answers back out in the order the Blanks appear.

import type { ProseMirrorJSON } from './question-doc'

/** What a Blank prints as wherever a student sees it: on the exam sheet, in
 *  print, PDF and DOCX, and in Copy. */
export const BLANK_LINE = '________________'

/** The inline nodes a Blank's answer may hold. Anything else inside one —
 *  another Blank, a picture — is dropped when a document is cleaned. */
export const BLANK_CONTENT = ['text', 'math_inline'] as const

function childrenOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

/** Every Blank in a stored document, in the order they appear: each one's
 *  answer, as the inline content it holds. */
export function blankAnswersOf(doc: ProseMirrorJSON): ProseMirrorJSON[][] {
  const answers: ProseMirrorJSON[][] = []
  const visit = (node: ProseMirrorJSON) => {
    if (node.type === 'blank') {
      answers.push(childrenOf(node))
      return
    }
    childrenOf(node).forEach(visit)
  }
  visit(doc)
  return answers
}

/** A Blank's answer as plain text: its words, with inline mathematics as its
 *  source. For one-line places — a Question Bank row, a conversion report. */
export function blankAnswerText(answer: readonly ProseMirrorJSON[]): string {
  return answer
    .map((node) => {
      if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
      if (node.type === 'math_inline') {
        const value = (node.attrs as { value?: unknown } | undefined)?.value
        return typeof value === 'string' ? value : ''
      }
      return ''
    })
    .join('')
}

/** A Blank's answer kept to what a Blank holds, for a document being cleaned:
 *  text and inline mathematics, never another Blank or a picture. */
export function cleanBlankContent(content: readonly ProseMirrorJSON[]): ProseMirrorJSON[] {
  return content.filter((node) => (BLANK_CONTENT as readonly unknown[]).includes(node.type))
}

/** What the Answer Key prints for a Fill in the Blank question: one line of
 *  its Blanks' answers in order, `; ` between them, each with its own marks and
 *  mathematics. A Blank left empty holds its place as `—` beside others; a
 *  question whose Blanks are all empty, or that has none, has nothing to
 *  print. */
export function blankAnswerBlocks(doc: ProseMirrorJSON): ProseMirrorJSON[] {
  const answers = blankAnswersOf(doc)
  if (answers.every((answer) => answer.length === 0)) return []
  const content: ProseMirrorJSON[] = []
  answers.forEach((answer, index) => {
    if (index > 0) content.push({ type: 'text', text: '; ' })
    content.push(...(answer.length > 0 ? structuredClone(answer) : [{ type: 'text', text: '—' }]))
  })
  return [{ type: 'paragraph', content }]
}
