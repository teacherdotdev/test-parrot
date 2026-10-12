import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inspectImportValue } from '../../package-import'
import { readQuestionFile } from '..'
import { blankAnswers, blocksText } from '../rich-text'

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${path}`, import.meta.url)))
const encode = (text: string) => new TextEncoder().encode(text)

async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record, undefined, reading.files)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

const cards = (questions: { stem: { content: unknown[] }; suggestedAnswer?: { content: unknown[] } }[]) =>
  questions.map((question) => [text(question.stem), text(question.suggestedAnswer)])

describe('Flashcards', () => {
  test('reads Quizlet’s tab-separated export, each term asked with its definition as the answer', async () => {
    const { reading, proposal, questions } = await read('biology.txt', fixture('flashcards/quizlet-tab.txt'))
    expect(reading.format).toBe('flashcards')
    expect(proposal.banks).toHaveLength(1)
    expect(questions.every((question) => question.type === 'short-answer')).toBe(true)
    expect(cards(questions)).toEqual([
      ['photosynthesis', 'the process by which plants make food from light'],
      ['mitochondria', 'the powerhouse of the cell'],
      ['osmosis', 'diffusion of water through a membrane'],
      ['nucleus', 'the part of the cell that holds its DNA'],
    ])
    expect(reading.issues).toEqual([])
  })

  test('reads Quizlet’s dash and semicolon separators', async () => {
    const dashed = await read('cards.txt', encode('Paris - capital of France\nRome - capital of Italy - and of Lazio\n'))
    expect(dashed.reading.format).toBe('flashcards')
    expect(cards(dashed.questions)).toEqual([['Paris', 'capital of France'], ['Rome', 'capital of Italy - and of Lazio']])

    const oneLine = await read('cards.txt', encode('cat,a small feline;dog,a loyal canine;cow,gives milk'))
    expect(oneLine.reading.format).toBe('flashcards')
    expect(cards(oneLine.questions)).toEqual([['cat', 'a small feline'], ['dog', 'a loyal canine'], ['cow', 'gives milk']])
  })

  test('reads Anki’s export: its headers, HTML, tags and a cloze note', async () => {
    const { reading, questions } = await read('deck.txt', fixture('flashcards/anki-export.txt'))
    expect(reading.format).toBe('flashcards')
    expect(reading.confidence).toBeGreaterThan(0.9)
    // The deck names the bank.
    expect(reading.record.bank.name).toBe('Cells')
    expect(questions).toHaveLength(3)
    expect(text(questions[0]!.stem)).toBe('Mitochondria')
    expect(questions[0]!.suggestedAnswer!.content[0]).toMatchObject({
      content: [{ text: 'The ' }, { text: 'powerhouse', marks: [{ type: 'strong' }] }, { text: ' of the cell' }],
    })
    expect(questions[0]!.topics).toEqual(['cells', 'energy'])
    expect(questions[1]!.type).toBe('fill-in-the-blank')
    expect(text(questions[1]!.stem)).toBe('The _____ holds the cell\'s DNA.')
    expect(blankAnswers(questions[1]!.stem.content)).toEqual(['nucleus'])
  })

  test('an Anki cloze note with several clozes is one Fill in the Blank question, its Blanks in order', async () => {
    const deck = '#separator:tab\n#html:false\nA {{c1::comet}} has a tail and an {{c2::asteroid}} does not.\t\n'
    const { questions } = await read('deck.txt', encode(deck))
    expect(questions).toHaveLength(1)
    expect(questions[0]!.type).toBe('fill-in-the-blank')
    expect(text(questions[0]!.stem)).toBe('A _____ has a tail and an _____ does not.')
    expect(blankAnswers(questions[0]!.stem.content)).toEqual(['comet', 'asteroid'])
  })

  test('says which line is not a card', async () => {
    const lines = Array.from({ length: 12 }, (_, index) => `term ${index}\tdefinition ${index}`)
    lines.splice(4, 0, 'a line with no definition')
    const { reading, questions } = await read('cards.txt', encode(lines.join('\n')))
    expect(reading.format).toBe('flashcards')
    expect(questions).toHaveLength(12)
    expect(reading.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      message: 'Question 5 (line 5): it has no definition: a card is a term and a definition, separated by a tab, a comma or a dash.',
    }))
  })
})
