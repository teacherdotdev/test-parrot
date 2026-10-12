import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inspectImportValue } from '../../package-import'
import { readQuestionFile } from '..'
import { blocksText } from '../rich-text'

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${path}`, import.meta.url)))
const encode = (text: string) => new TextEncoder().encode(text)

async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record, undefined, reading.files)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

describe('text2qti', () => {
  test('reads every example in text2qti’s README', async () => {
    const { reading, proposal, questions } = await read('quiz.txt', fixture('text2qti/readme-examples.txt'))
    expect(reading.format).toBe('text2qti')
    expect(proposal.banks).toHaveLength(1)
    expect(reading.record.bank.name).toBe('Addition')
    expect(reading.record.bank.description).toBe('Checking addition.')
    expect(reading.found).toBe(10)
    expect(reading.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(questions.map((question) => question.type)).toEqual([
      'multiple-choice', 'multiple-choice', 'short-answer', 'short-answer', 'short-answer', 'short-answer',
      'short-answer', 'short-answer', 'multiple-choice', 'short-answer',
    ])
    const [addition, dinosaurs, root2, root3, five, santa, essay, upload, wrapped, solution] = questions
    // `Points: 2` is the first question's Points alone; the rest give none.
    expect(questions.map((question) => question.points)).toEqual([2, ...questions.slice(1).map(() => undefined)])

    // Feedback is not part of the question or its choices.
    expect(text(addition!.stem)).toBe('What is 2+3?')
    expect(addition!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['6', false], ['1', false], ['5', true],
    ])
    expect(dinosaurs!.choices!.map((choice) => text(choice.content))).toEqual([
      'Woolly mammoth', 'Tyrannosaurus rex', 'Triceratops', 'Smilodon fatalis',
    ])
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(b, c)')

    expect(text(root2!.suggestedAnswer)).toBe('1.4142 (± 0.0001)')
    expect(text(root3!.suggestedAnswer)).toBe('1.2598 to 1.2600')
    expect(text(five!.suggestedAnswer)).toBe('5')
    expect(text(santa!.suggestedAnswer)).toBe('Santa / Santa Claus / Father Christmas / Saint Nicholas / Saint Nick')
    expect(text(essay!.stem)).toBe('Write an essay.')
    expect(essay!.suggestedAnswer).toBeUndefined()
    expect(text(upload!.stem)).toBe('Upload a file.')
    expect(reading.issues.find((issue) => issue.code === 'file-upload')?.message).toStartWith('Question 8 (line 43):')

    // Indented lines continue the question or choice above them, paragraph by paragraph.
    expect(text(wrapped!.stem)).toBe(
      'A question paragraph that is long enough to wrap onto a second line. The second line must be indented to match up with the start of the paragraph text on the first line.\nAnother paragraph.',
    )
    expect(wrapped!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['Correct answer.\nCorrect answer continued, so indentation.', true],
      ['Another answer.', false],
    ])
    // A solution, which only text2qti's solutions show, is the essay's suggested answer.
    expect(text(solution!.suggestedAnswer)).toBe(
      'This is important information about what the essay should cover.\nThis will only appear in the solutions, and can be as long or short as you wish.',
    )
  })

  test('brings in every question in a group, keeps Markdown and math, and never runs code', async () => {
    const { reading, questions } = await read('groups.txt', fixture('text2qti/group-and-code.txt'))
    expect(reading.format).toBe('text2qti')
    expect(questions.map((question) => question.type)).toEqual(['true-false', 'true-false', 'multiple-choice'])
    expect(questions[0]!.choices!.map((choice) => choice.correct)).toEqual([true, false])
    expect(reading.issues.map((issue) => [issue.severity, issue.code])).toEqual([
      ['warning', 'code-block-not-run'],
      ['info', 'question-group'],
    ])

    const newton = questions[2]!
    expect(newton.stem.content).toEqual([{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'What does ' },
        { type: 'text', text: 'Newton\'s second law', marks: [{ type: 'strong' }] },
        { type: 'text', text: ' say, with ' },
        { type: 'inline-math', source: 'F' },
        { type: 'text', text: ' in ' },
        { type: 'text', text: 'newtons', marks: [{ type: 'emphasis' }] },
        { type: 'text', text: '?' },
      ],
    }])
    expect(newton.choices!.map((choice) => choice.content.content)).toEqual([
      [{ type: 'paragraph', content: [{ type: 'inline-math', source: 'F = ma' }] }],
      [{ type: 'paragraph', content: [{ type: 'text', text: 'F = m / a', marks: [{ type: 'inline-code' }] }] }],
    ])
  })

  test('a question with no correct choice is left out, and says how to mark one', async () => {
    const { reading, questions } = await read('quiz.txt', encode('Quiz title: T\n\n1.  What is 2+3?\na)  6\nb)  5\n\n2.  Which?\n[*] this\n[ ] that\n'))
    expect(reading.format).toBe('text2qti')
    expect(questions).toHaveLength(1)
    expect(reading.issues.find((issue) => issue.code === 'no-correct-answer')?.message).toBe(
      'Question 1 (line 3): no choice is marked correct. Put * directly before the correct choice’s letter, e.g. “*c) 5”.',
    )
  })

  test('a plain numbered file with no text2qti markers is left to the Blackboard Test Generator', async () => {
    const { reading } = await read('plain.txt', encode('1.  What is 2+3?\na)  6\nb)  1\n*c) 5\n'))
    expect(reading.format).toBe('bb-generator')
  })

  test('keeps a group’s points per question, unless a question gives its own', async () => {
    const { reading, questions } = await read('quiz.txt', encode([
      'Quiz title: Rivers',
      '',
      'GROUP',
      'pick: 1',
      'points per question: 3',
      '1.  Which river is longest?',
      '*a)  The Nile',
      'b)  The Thames',
      '',
      'Points: 1',
      '2.  Which river is shortest?',
      'a)  The Nile',
      '*b)  The Thames',
      'END_GROUP',
      '',
      'Points: 1.5',
      '3.  Describe a river.',
      '____',
    ].join('\n')))
    expect(reading.format).toBe('text2qti')
    expect(questions.map((question) => question.points)).toEqual([3, 1, undefined])
  })
})
