// Fill in the Blank (ADR-0049): what a student sees, what the key records,
// and the editor command that makes a Blank from the selected words.

import { describe, expect, test } from 'bun:test'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { BLANK_LINE, blankAnswerBlocks, blankAnswersOf } from './blank'
import { toggleBlank } from './blank-editor'
import { createQuestion, SECTION_ORDER, type Question } from './exam'
import { exportDocumentFingerprint } from './export-fingerprint'
import { FIXTURES } from './export-fixtures'
import { buildExportDocument } from './export-plan'
import { copyBlocksOf, copyTextOf } from './question-copy'
import { cleanDocument, type ProseMirrorJSON } from './question-doc'
import { readingOfQuestion } from './question-reading-content'
import { SECTION_INSTRUCTIONS, SECTION_TITLE } from './section-headings'
import { stemPreview } from './stem-preview'

const text = (value: string, ...marks: string[]): ProseMirrorJSON =>
  marks.length > 0 ? { type: 'text', text: value, marks: marks.map((type) => ({ type })) } : { type: 'text', text: value }
const blank = (...answer: ProseMirrorJSON[]): ProseMirrorJSON =>
  answer.length > 0 ? { type: 'blank', content: answer } : { type: 'blank' }

function question(...inline: ProseMirrorJSON[]): Question {
  return {
    id: 'q',
    type: 'fill-in-the-blank',
    columns: 2,
    doc: { type: 'doc', content: [{ type: 'paragraph', content: inline }] },
  }
}

const fixture = FIXTURES.find((item) => item.name.startsWith('fill in the blank'))!

describe('a Fill in the Blank question', () => {
  test('is listed after Matching and before Short Answer, with its own Section wording', () => {
    expect(SECTION_ORDER.indexOf('fill-in-the-blank')).toBe(SECTION_ORDER.indexOf('matching') + 1)
    expect(SECTION_ORDER.indexOf('open')).toBe(SECTION_ORDER.indexOf('fill-in-the-blank') + 1)
    expect(SECTION_TITLE['fill-in-the-blank']).toBe('Fill in the Blank')
    expect(SECTION_INSTRUCTIONS['fill-in-the-blank']).toContain('missing word')
  })

  test('starts as an empty sentence with no Blank, which is incomplete rather than invalid', () => {
    const created = createQuestion('fill-in-the-blank')
    expect(created.doc).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(blankAnswersOf(created.doc)).toEqual([])
  })
})

describe('what a student sees', () => {
  const document = buildExportDocument(fixture.exam, fixture.arrangement, { test: true, answerKey: true })
  const lines = exportDocumentFingerprint(document)

  test('every Blank prints as the same line, whatever its answer, and never the answer', () => {
    const test = lines.test.join('\n')
    expect(test).toContain(`Water freezes at ${BLANK_LINE} degrees Celsius.`)
    expect(test).toContain(`The area of a circle is ${BLANK_LINE}, and its edge is called the ${BLANK_LINE}.`)
    expect(test).not.toContain('zero')
    expect(test).not.toContain('circumference')
    expect(test).not.toContain('pi r^2')
  })

  test('each question takes one number however many Blanks it holds', () => {
    const numbers = document.test.flatMap((item) => (item.kind === 'question' ? [item.question.number] : []))
    expect(numbers).toEqual([1, 2, 3])
  })

  test('has no Work Space beneath it', () => {
    for (const item of document.test) {
      if (item.kind === 'question') expect(item.question.workSpace).toBeNull()
    }
  })
})

describe('the Answer Key', () => {
  const document = buildExportDocument(fixture.exam, fixture.arrangement, { test: true, answerKey: true })
  const entries = document.answerKey.flatMap((item) => (item.kind === 'answer-key-entry' ? [item] : []))

  test('records each Blank’s answer in the order they appear, with its marks and maths', () => {
    expect(entries[1]?.suggestedAnswer).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'math_inline', attrs: { value: '\\pi r^2' } },
          { type: 'text', text: '; ' },
          { type: 'text', text: 'circumference', marks: [{ type: 'emphasis' }] },
        ],
      },
    ])
  })

  test('prints a question’s Points', () => {
    expect(entries[0]?.points).toBe(2)
  })

  test('has nothing to print for a question whose Blanks are all empty', () => {
    expect(entries[2]?.suggestedAnswer).toBeUndefined()
  })

  test('holds an empty Blank’s place beside answered ones', () => {
    const doc = question(blank(text('first')), text(' and '), blank()).doc
    expect(blankAnswerBlocks(doc)).toEqual([
      { type: 'paragraph', content: [text('first'), text('; '), text('—')] },
    ])
  })
})

describe('everywhere else a Blank is read', () => {
  const sentence = question(text('The factory can '), blank(text('recycle')), text(' used glass.'))

  test('Copy carries the line, never the answer', () => {
    const copied = copyTextOf([copyBlocksOf(sentence)])
    expect(copied).toBe(`The factory can ${BLANK_LINE} used glass.`)
  })

  test('a Question Bank row keeps the answer out of sight', () => {
    expect(stemPreview(sentence).text).toBe('The factory can ____ used glass.')
  })

  test('the Question Bank reading lists the answers under the sentence', () => {
    expect(readingOfQuestion(sentence).blankAnswers).toEqual([
      { type: 'paragraph', content: [text('recycle')] },
    ])
  })

  test('a cleaned document keeps a Blank’s text and maths, and nothing else', () => {
    const cleaned = cleanDocument(
      question(
        blank(
          text('two', 'strong'),
          { type: 'math_inline', attrs: { value: 'x' } },
          blank(text('nested')),
          { type: 'image', attrs: { src: 'a.png' } },
        ),
      ).doc,
    )
    expect(blankAnswersOf(cleaned)).toEqual([
      [text('two', 'strong'), { type: 'math_inline', attrs: { value: 'x' } }],
    ])
  })
})

describe('making a Blank in the editor', () => {
  // The editor's own nodes, as far as a Blank needs them.
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph+' },
      paragraph: { content: 'inline*', group: 'block' },
      text: { group: 'inline' },
      math_inline: { group: 'inline', inline: true, atom: true, attrs: { value: { default: '' } } },
      blank: { group: 'inline', inline: true, content: '(text | math_inline)*', defining: true },
    },
    marks: { emphasis: {} },
  })
  const p = (...content: Parameters<typeof schema.node>[2][]) => schema.node('paragraph', null, content.flat())
  const stateOf = (doc: ReturnType<typeof schema.node>, from: number, to = from) =>
    EditorState.create({ doc, selection: TextSelection.create(doc, from, to) })
  const run = (state: EditorState): EditorState => {
    let next = state
    toggleBlank(state, (tr) => {
      next = state.apply(tr)
    })
    return next
  }

  test('turns the selected words into a Blank whose answer they are', () => {
    // "The factory can recycle glass." — select "recycle".
    const doc = schema.node('doc', null, [p(schema.text('The factory can recycle glass.'))])
    const next = run(stateOf(doc, 17, 24))
    expect(next.doc.toJSON()).toEqual({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'The factory can ' },
          { type: 'blank', content: [{ type: 'text', text: 'recycle' }] },
          { type: 'text', text: ' glass.' },
        ],
      }],
    })
  })

  test('keeps several Blanks in one sentence', () => {
    const doc = schema.node('doc', null, [p(schema.text('red and blue'))])
    const once = run(stateOf(doc, 1, 4))
    // "and blue" now starts after the Blank's closing token.
    const end = once.doc.content.size - 1
    const twice = run(stateOf(once.doc, end - 4, end))
    expect(blankAnswersOf(twice.doc.toJSON())).toEqual([
      [{ type: 'text', text: 'red' }],
      [{ type: 'text', text: 'blue' }],
    ])
  })

  test('turns a Blank back into its words', () => {
    const doc = schema.node('doc', null, [p(schema.text('A '), schema.node('blank', null, [schema.text('word')]), schema.text('.'))])
    // The caret inside the Blank.
    const next = run(stateOf(doc, 5))
    expect(next.doc.toJSON()).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A word.' }] }],
    })
  })

  test('inserts an empty Blank with the caret in it', () => {
    const doc = schema.node('doc', null, [p(schema.text('Fill: '))])
    const next = run(stateOf(doc, 7))
    expect(next.doc.toJSON().content[0].content).toEqual([{ type: 'text', text: 'Fill: ' }, { type: 'blank' }])
    expect(next.selection.$from.parent.type.name).toBe('blank')
  })

  test('leaves a selection across paragraphs alone', () => {
    const doc = schema.node('doc', null, [p(schema.text('one')), p(schema.text('two'))])
    expect(toggleBlank(stateOf(doc, 2, 7))).toBe(false)
  })
})
