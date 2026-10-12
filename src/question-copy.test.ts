// Copy puts what a student reads on the clipboard, laid out as this copy asks,
// and nothing a teacher alone should see. What is asserted here is the pasted
// text itself — the lines, their letters, blanks and columns, and what is left
// out.

import { describe, expect, test } from 'bun:test'
import type { Question, QuestionType } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import { mark, paragraph, text } from './export-fixtures'
import {
  ANSWER_RULE,
  copyBlocksOf,
  copyHtmlOf,
  copyImageWidth,
  copyMediaOf,
  copyTextOf,
  mathKey,
  sizedMathSvg,
  type CopyFormat,
} from './question-copy'

function question(type: QuestionType, ...blocks: ProseMirrorJSON[]): Question {
  return { id: 'q1', type, columns: 1, doc: { type: 'doc', content: blocks } }
}

const choice = (id: string, correct: boolean, label: string): ProseMirrorJSON => ({
  type: 'multipleChoiceChoice',
  attrs: { id, correct },
  content: [paragraph(text(label))],
})

const choices = (...list: ProseMirrorJSON[]): ProseMirrorJSON => ({ type: 'multipleChoice', content: list })

const copied = (value: Question, format?: CopyFormat) => copyTextOf([copyBlocksOf(value, format)])
const pasted = (value: Question, format?: CopyFormat) => copyHtmlOf([copyBlocksOf(value, format)])

const planets = question(
  'multiple-choice',
  paragraph(text('Which planet is largest?')),
  paragraph(),
  choices(choice('a', false, 'Mars'), choice('b', true, 'Jupiter'), choice('c', false, 'Venus'), choice('d', false, 'Earth')),
)

const capitals = (answers: number) => question(
  'matching',
  paragraph(text('Match each capital to its country.')),
  paragraph(),
  {
    type: 'matching',
    content: [
      { type: 'matchingPrompt', attrs: { id: 'p1', answer: 'w2' }, content: [paragraph(text('Paris'))] },
      { type: 'matchingPrompt', attrs: { id: 'p2', answer: 'w1' }, content: [paragraph(text('Rome'))] },
      ...['Italy', 'France', 'Spain', 'Peru', 'Chile', 'Japan'].slice(0, answers).map((country, index) => (
        { type: 'matchingAnswer', attrs: { id: `w${index + 1}` }, content: [paragraph(text(country))] }
      )),
    ],
  },
)

describe('Copy', () => {
  test('a Multiple Choice question pastes its stem and lettered answers, with no mark on the correct one', () => {
    expect(copied(planets)).toBe('Which planet is largest?\nA. Mars\nB. Jupiter\nC. Venus\nD. Earth')
    const html = pasted(planets)
    expect(html).toContain('>B. Jupiter</p>')
    expect(html).not.toMatch(/correct|✓/i)
  })

  test('answers in columns paste as a borderless table filled down each column, as the test prints them', () => {
    const html = pasted(planets, { columns: 2 })
    expect(html).toContain('border="0"')
    const rows = [...html.matchAll(/<tr>(.*?)<\/tr>/g)].map(([row]) => [...row!.matchAll(/>([A-D]\. \w+)</g)].map(([, cell]) => cell))
    expect(rows).toEqual([['A. Mars', 'C. Venus'], ['B. Jupiter', 'D. Earth']])
    // Plain text has no columns, so the answers read in letter order.
    expect(copied(planets, { columns: 4 })).toBe('Which planet is largest?\nA. Mars\nB. Jupiter\nC. Venus\nD. Earth')
  })

  test('a True/False question pastes with the T and F to circle before its stem, as the test prints them', () => {
    const value = question(
      'true-false',
      paragraph(text('The sun is a star.')),
      paragraph(),
      choices(choice('t', true, 'True'), choice('f', false, 'False')),
    )
    expect(copied(value)).toBe('T  F  The sun is a star.')
  })

  test('a Matching set pastes its directions, lettered Word Bank and blank-led Items, never which answer each names', () => {
    expect(copied(capitals(2), { wordBank: 'above' })).toBe(
      'Match each capital to its country.\nA. Italy\nB. France\n_____ Paris\n_____ Rome',
    )
  })

  test('a short Word Bank goes beside its Items and a long one above them, unless this copy says otherwise', () => {
    expect(pasted(capitals(2))).toMatch(/<td[^>]*><p[^>]*>_____ Paris<\/p><p[^>]*>_____ Rome<\/p><\/td><td[^>]*><p[^>]*>A\. Italy/)
    expect(pasted(capitals(6))).not.toContain('<table')
    expect(pasted(capitals(6), { wordBank: 'beside' })).toContain('<table')
  })

  test('a Short Answer question pastes its stem alone, and the answer lines this copy asks for', () => {
    const value: Question = {
      ...question('open', paragraph(text('Explain photosynthesis.'))),
      suggestedAnswer: { type: 'doc', content: [paragraph(text('Plants turn light into sugar.'))] },
      difficulty: 'hard',
      topics: ['Biology'],
    }
    expect(copied(value)).toBe('Explain photosynthesis.')
    expect(pasted(value)).not.toMatch(/sugar|Biology|Hard/)
    expect(copied(value, { lines: 2 })).toBe(`Explain photosynthesis.\n${ANSWER_RULE}\n${ANSWER_RULE}`)
  })

  test('a Multipart question pastes its stem, then lettered Parts, each laid out as this copy says', () => {
    const value = question(
      'multipart',
      paragraph(text('A train leaves at noon.')),
      {
        type: 'multipartParts',
        content: [
          {
            type: 'multipartPart',
            attrs: { id: 'part1', columns: 1 },
            content: [
              { type: 'multipartPartStem', content: [paragraph(text('How fast is it?'))] },
              choices(choice('a', true, '60 mph'), choice('b', false, '90 mph')),
            ],
          },
          {
            type: 'multipartPart',
            attrs: { id: 'part2' },
            content: [
              { type: 'multipartPartStem', content: [paragraph(text('Where does it go?'))] },
              { type: 'suggestedAnswer', content: [paragraph(text('Chicago'))] },
            ],
          },
        ],
      },
    )
    expect(copied(value)).toBe(
      'A train leaves at noon.\na. How fast is it?\n    A. 60 mph\n    B. 90 mph\nb. Where does it go?',
    )
    expect(pasted(value)).toContain('margin:0 0 0 0.5in">A. 60 mph')
    const formatted = { parts: { part1: { columns: 2 as const }, part2: { lines: 1 } } }
    expect(pasted(value, formatted)).toContain('margin-left:0.5in"><table')
    expect(copied(value, formatted)).toEndWith(`b. Where does it go?\n    ${ANSWER_RULE}`)
  })

  test('several Questions paste in order, an empty line between each', () => {
    const first = question('open', paragraph(text('First?')))
    const second = question('open', paragraph(text('Second?')))
    expect(copyTextOf([copyBlocksOf(first), copyBlocksOf(second)])).toBe('First?\n\nSecond?')
    expect(copyHtmlOf([copyBlocksOf(first), copyBlocksOf(second)])).toContain('First?</p><p style="margin:0">&nbsp;</p><p')
  })

  test('formatting survives as rich text and is escaped rather than interpreted', () => {
    const value = question('open', paragraph(text('Solve '), text('carefully', mark('strong')), text(' <x & y>')))
    expect(pasted(value)).toContain('Solve <b>carefully</b> &lt;x &amp; y&gt;')
  })

  test('pictures and formulas are named once each, and paste as what they were made into', () => {
    const value = question(
      'open',
      paragraph(text('Find '), { type: 'math_inline', attrs: { value: 'x^2' } }, text('.')),
      { type: 'image-block', attrs: { src: '/local-images/abc', ratio: 0.5, caption: '' } },
      { type: 'image-block', attrs: { src: '/local-images/abc', ratio: 0.5, caption: '' } },
      { type: 'code_block', attrs: { language: 'LaTeX' }, content: [text('\\frac{1}{2}')] },
    )
    const blocks = copyBlocksOf(value)
    expect(copyMediaOf(blocks)).toEqual([
      { kind: 'math', source: 'x^2', display: false },
      { kind: 'image', key: '/local-images/abc@r0.5', src: '/local-images/abc', sizing: { ratio: 0.5 }, block: true },
      { kind: 'math', source: '\\frac{1}{2}', display: true },
    ])
    const media = {
      pictures: new Map([
        [mathKey('x^2', false), { src: 'data:image/png;base64,MATH', width: 20, height: 14 }],
        ['/local-images/abc@r0.5', { src: 'data:image/png;base64,PIC', width: 312, height: 200 }],
      ]),
      mathml: new Map([[mathKey('x^2', false), '<math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mi>x</mi><mn>2</mn></msup></math>']]),
    }
    const html = copyHtmlOf([blocks], media)
    expect(html).toContain('<img src="data:image/png;base64,MATH" width="20" height="14" alt="x^2">')
    expect(html).toContain('<img src="data:image/png;base64,PIC" width="312" height="200"')
    expect(html).not.toContain('/local-images/')
    // A formula that has not been made pastes as its own source.
    expect(html).toContain('\\frac{1}{2}')
    expect(copyTextOf([blocks])).toBe('Find $x^2$.\n[Picture]\n[Picture]\n$$\\frac{1}{2}$$')
    // For Word, a formula travels as MathML, which Word makes its own equation.
    const forWord = copyHtmlOf([blocks], media, 'word')
    expect(forWord).toContain('Find <math xmlns="http://www.w3.org/1998/Math/MathML"><msup>')
    expect(forWord).not.toContain('base64,MATH')
  })

  test('a Centred figure, caption and table paste centred, and a left paragraph does not', () => {
    const centred = { align: 'center' }
    const value = question(
      'open',
      paragraph(text('Study the figure.')),
      { type: 'image-block', attrs: { src: '/local-images/abc', caption: 'Fig. 1.1', align: 'center' } },
      { ...paragraph(text('Table 1.1')), attrs: centred },
      {
        type: 'table',
        attrs: centred,
        content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [{ ...paragraph(text('42')), attrs: centred }] }] }],
      },
    )
    const html = pasted(value)
    expect(html).toContain('<p style="margin:0 0 0 0in">Study the figure.</p>')
    expect(html).toContain('<p style="margin:0 0 0 0in;text-align:center"><i>Fig. 1.1</i></p>')
    expect(html).toContain('<p style="margin:0 0 0 0in;text-align:center">Table 1.1</p>')
    expect(html).toContain('<table align="center"')
    expect(html).toContain('<p style="margin:0 0 0 0in;text-align:center">42</p>')
    // The picture's own line is centred too.
    expect(html).toContain('<p style="margin:0 0 0 0in;text-align:center">[Fig. 1.1]</p>')
  })

  test('a picture pastes at its Authored Image Size against the page, never wider than the page', () => {
    expect(copyImageWidth(400, {})).toBe(400)
    expect(copyImageWidth(2000, {})).toBe(624)
    expect(copyImageWidth(400, { size: 0.5 })).toBe(312)
    // One no one has resized since Crepe's handle keeps the size it had.
    expect(copyImageWidth(2000, { ratio: 0.5 })).toBe(312)
  })

  test('each crop and size of one Media Asset pastes as its own picture', () => {
    const crop = { left: 0.1, top: 0.2, right: 0.6, bottom: 0.9, width: 800, height: 600 }
    const value = question(
      'open',
      { type: 'image-block', attrs: { src: '/local-images/abc', size: 0.4, crop, caption: '' } },
      { type: 'image-block', attrs: { src: '/local-images/abc', size: 0.4, caption: '' } },
      { type: 'image-block', attrs: { src: '/local-images/abc', size: 0.6, caption: '' } },
    )
    const requests = copyMediaOf(copyBlocksOf(value))
    expect(requests.map((request) => request.kind === 'image' && request.key)).toEqual([
      '/local-images/abc#crop=0.1,0.2,0.6,0.9@0.4',
      '/local-images/abc@0.4',
      '/local-images/abc@0.6',
    ])
    expect(requests[0]).toMatchObject({ crop })
  })

  test('a formula becomes a black picture sized in pixels rather than ex', () => {
    const sized = sizedMathSvg('<svg width="4ex" height="2ex" viewBox="0 0 1 1"><g fill="currentColor"/></svg>')
    expect(sized).toEqual({
      svg: '<svg width="90" height="45" viewBox="0 0 1 1"><g fill="#000"/></svg>',
      width: 30,
      height: 15,
    })
  })
})
