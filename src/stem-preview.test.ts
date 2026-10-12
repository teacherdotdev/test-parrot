// The compact projection a Question Bank row shows, and the text stem search
// reads. What is asserted here is the whole of the rule: one line, stem only,
// and nothing the row cannot show honestly.

import { describe, expect, test } from 'bun:test'
import type { Question } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import { paragraph, text } from './export-fixtures'
import { stemPreview } from './stem-preview'

function question(...blocks: ProseMirrorJSON[]): Question {
  return {
    id: 'q1',
    type: 'open',
    columns: 2,
    doc: { type: 'doc', content: blocks },
  }
}

function choice(id: string, correct: boolean, label: string): ProseMirrorJSON {
  return {
    type: 'multipleChoiceChoice',
    attrs: { correct, id },
    content: [paragraph(text(label))],
  }
}

function multipleChoice(stem: string, ...choices: ProseMirrorJSON[]): Question {
  return {
    ...question(paragraph(text(stem)), paragraph(), {
      type: 'multipleChoice',
      content: choices,
    }),
    type: 'multiple-choice',
  }
}

describe('the stem preview', () => {
  test('reads the stem as one line with authored whitespace normalised', () => {
    const preview = stemPreview(
      question(
        paragraph(text('  Which  gas   do plants  ')),
        paragraph(text('take in?\n')),
      ),
    )

    expect(preview.text).toBe('Which gas do plants take in?')
  })

  test('keeps authored spacing inside a line rather than splitting marked runs', () => {
    const preview = stemPreview(
      question(
        paragraph(
          text('Name the '),
          text('largest', { type: 'strong' }),
          text(' planet.'),
        ),
      ),
    )

    expect(preview.text).toBe('Name the largest planet.')
  })

  test('leaves answer choices and their correctness out of the line', () => {
    const preview = stemPreview(
      multipleChoice(
        'Which is a mammal?',
        choice('c1', false, 'Shark'),
        choice('c2', true, 'Whale'),
      ),
    )

    expect(preview.text).toBe('Which is a mammal?')
    expect(preview.text).not.toContain('Whale')
  })

  test('shows Image and Math as badges instead of their content', () => {
    const preview = stemPreview(
      question(
        paragraph(
          text('Using '),
          { type: 'math_inline', attrs: { value: 'PV = nRT' } },
          text(', explain the graph.'),
        ),
        {
          type: 'image-block',
          attrs: { src: '/local-images/graph.png', caption: 'Pressure' },
        },
      ),
    )

    // The badges say the content is there; the line stays readable prose, so
    // neither the LaTeX source nor the image's file name reaches it.
    expect(preview.badges).toEqual(['math', 'image'])
    expect(preview.text).not.toContain('nRT')
    expect(preview.text).not.toContain('graph.png')
  })

  test('names each kind of badge once, however often it appears', () => {
    const preview = stemPreview(
      question(
        paragraph(
          { type: 'math_inline', attrs: { value: 'a^2' } },
          { type: 'math_inline', attrs: { value: 'b^2' } },
        ),
      ),
    )

    expect(preview.badges).toEqual(['math'])
  })

  test('omits content a single line cannot carry honestly', () => {
    const preview = stemPreview(
      question(
        {
          type: 'code_block',
          attrs: { language: 'python' },
          content: [text('total = 0\nfor item in items:')],
        },
        { type: 'hr' },
        paragraph(text('What does this print?')),
        {
          type: 'table',
          content: [
            {
              type: 'table_row',
              content: [
                { type: 'table_cell', content: [paragraph(text('Sodium'))] },
              ],
            },
          ],
        },
      ),
    )

    expect(preview.text).toBe('What does this print?')
  })

  test('names a Matching set with a blank stem by its Items, never its Word Bank', () => {
    const set = (...stem: ProseMirrorJSON[]): Question => ({
      id: 'q1',
      type: 'matching',
      columns: 2,
      doc: {
        type: 'doc',
        content: [...stem, {
          type: 'matching',
          content: [
            { type: 'matchingPrompt', attrs: { id: 'p1', answer: 'a2' }, content: [paragraph(text('Fast-moving electrons'))] },
            { type: 'matchingPrompt', attrs: { id: 'p2', answer: 'a1' }, content: [paragraph(text('A change in a nucleus'))] },
            { type: 'matchingAnswer', attrs: { id: 'a1' }, content: [paragraph(text('nuclear reaction'))] },
            { type: 'matchingAnswer', attrs: { id: 'a2' }, content: [paragraph(text('beta radiation'))] },
          ],
        }],
      },
    })
    expect(stemPreview(set(paragraph())).text).toBe('Fast-moving electrons · A change in a nucleus')
    expect(stemPreview(set(paragraph(text('Match each term.')))).text).toBe('Match each term.')
  })

  test('is empty for a question nothing has been written into yet', () => {
    expect(stemPreview(question(paragraph()))).toEqual({ text: '', badges: [] })
  })
})
