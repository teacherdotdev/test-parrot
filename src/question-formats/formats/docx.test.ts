import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { inspectImportValue } from '../../package-import'
import { readQuestionFile } from '..'
import { blocksText } from '../rich-text'
import { readZip } from '../zip'
import { wordText } from './docx'

/**
 * Word documents built here, part by part, the way Word saves them: a
 * paragraph (`w:p`) of runs (`w:r`) of text (`w:t`), and lists that store
 * only a pointer (`w:numPr`) into `word/numbering.xml`.
 */

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type Paragraph = string | { text: string; numId?: number; ilvl?: number; style?: string; runs?: string }

function paragraph(value: Paragraph): string {
  const { text, numId, ilvl, style, runs } = typeof value === 'string' ? { text: value } : value
  const numPr = numId !== undefined ? `<w:numPr><w:ilvl w:val="${ilvl ?? 0}"/><w:numId w:val="${numId}"/></w:numPr>` : ''
  const pStyle = style ? `<w:pStyle w:val="${style}"/>` : ''
  const pPr = numPr || pStyle ? `<w:pPr>${pStyle}${numPr}</w:pPr>` : ''
  const content = runs ?? (text ? `<w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r>` : '')
  return `<w:p>${pPr}${content}</w:p>`
}

const QUESTION_LIST = `
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="2">
    <w:lvl w:ilvl="0"><w:start w:val="4"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/><w:suff w:val="space"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>
  <w:num w:numId="4"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="10"/></w:lvlOverride></w:num>
`

const STYLES = `
  <w:style w:type="paragraph" w:styleId="Question"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Answer"><w:basedOn w:val="Question"/><w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr></w:style>
`

async function docx(paragraphs: (Paragraph | { table: Paragraph[][] })[], numbering = QUESTION_LIST, styles = STYLES) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  const body = paragraphs.map((each) =>
    typeof each === 'object' && 'table' in each
      ? `<w:tbl>${each.table.map((row) => `<w:tr>${row.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
      : paragraph(each),
  ).join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`)
  zip.file('word/numbering.xml', `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}>${numbering}</w:numbering>`)
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}>${styles}</w:styles>`)
  return zip.generateAsync({ type: 'uint8array' })
}

const textOf = async (bytes: Uint8Array) => wordText((await readZip(bytes))!)

async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record, undefined, reading.files)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

describe('Word document text', () => {
  test('reads the tagged format typed into Word as the Blackboard Test Generator’s', async () => {
    const bytes = await docx([
      'MC',
      'Which planet is closest to the Sun?',
      'Venus',
      'Earth',
      '*Mercury',
      'Mars',
      '',
      'TF',
      'The Sun is a planet.',
      '*F',
    ])
    expect(await textOf(bytes)).toBe([
      'MC',
      'Which planet is closest to the Sun?',
      'Venus', 'Earth', '*Mercury', 'Mars', '', 'TF', 'The Sun is a planet.', '*F',
    ].join('\n'))
    const { reading, proposal, questions } = await read('planets.docx', bytes)
    expect(reading.format).toBe('bb-generator')
    expect(proposal.banks).toHaveLength(1)
    expect(reading.issues).toEqual([])
    expect(questions.map((question) => question.type)).toEqual(['multiple-choice', 'true-false'])
    expect(questions[0]!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['Venus', false], ['Earth', false], ['Mercury', true], ['Mars', false],
    ])
    expect(questions[1]!.choices!.map((choice) => choice.correct)).toEqual([false, true])
  })

  test('counts Word’s automatic numbering back in, so an auto-numbered Respondus list reads as typed', async () => {
    const bytes = await docx([
      { text: 'Who determined the exact speed of light?', numId: 1 },
      { text: 'Albert Einstein', numId: 1, ilvl: 1 },
      { text: 'Albert Michelson', numId: 1, ilvl: 1 },
      { text: 'Thomas Edison', numId: 1, ilvl: 1 },
      '',
      { text: 'Which is a noble gas?', numId: 1 },
      { text: 'Oxygen', numId: 1, ilvl: 1 },
      { text: 'Neon', numId: 1, ilvl: 1 },
      '',
      'Answers:',
      { text: 'B', numId: 4 },
      { text: 'B', numId: 4 },
    ], QUESTION_LIST.replace('<w:num w:numId="4"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="10"/></w:lvlOverride></w:num>',
      '<w:num w:numId="4"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'))
    expect(await textOf(bytes)).toBe([
      '1. Who determined the exact speed of light?',
      'a) Albert Einstein',
      'b) Albert Michelson',
      'c) Thomas Edison',
      '',
      '2. Which is a noble gas?',
      'a) Oxygen',
      'b) Neon',
      '',
      'Answers:',
      '1. B',
      '2. B',
    ].join('\n'))
    const { reading, questions } = await read('respondus.docx', bytes)
    expect(reading.format).toBe('respondus')
    expect(questions.map((question) => question.choices!.map((choice) => choice.correct))).toEqual([
      [false, true, false],
      [false, true],
    ])
  })

  test('numbering from paragraph styles, restarts, starts, bullets, tables, tabs and breaks', async () => {
    const bytes = await docx([
      { text: 'First', style: 'Question' },
      { text: 'yes', style: 'Answer' },
      { text: 'no', style: 'Answer' },
      { text: 'Second', style: 'Question' },
      { text: 'again', style: 'Answer' },
      { text: 'A bullet', numId: 2 },
      { text: 'Fourth', numId: 3 },
      { text: 'Fifth', numId: 3 },
      { text: 'Tenth', numId: 4 },
      { table: [['cell one', 'cell two'], ['cell three', '']] },
      { text: '', runs: '<w:r><w:t>left</w:t><w:tab/><w:t>right</w:t><w:br/><w:t>below</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:ins><w:r><w:t> added</w:t></w:r></w:ins>' },
      { text: '', runs: '<w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:t>2</w:t></w:r><w:r><w:sym w:font="Symbol" w:char="F02A"/><w:t>b) 5</w:t></w:r>' },
    ])
    expect(await textOf(bytes)).toBe([
      '1. First',
      'a) yes',
      'b) no',
      '2. Second',
      'a) again',
      'A bullet',
      'IV. Fourth',
      'V. Fifth',
      '10. Tenth',
      'cell one',
      'cell two',
      'cell three',
      '',
      'left\tright',
      'below added',
      '2*b) 5',
    ].join('\n'))
  })

  test('a Word document with no questions in a known format says so in Word’s terms', async () => {
    const bytes = await docx(['Dear parents,', '', 'The field trip is on Friday.'])
    await expect(readQuestionFile({ name: 'letter.docx', bytes })).rejects.toThrow(
      'Test Parrot could not find questions written in a format it knows in this Word document.',
    )
  })

  test('a broken document.xml reads as no text, never a crash', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document><w:body><w:p>')
    const files = (await readZip(await zip.generateAsync({ type: 'uint8array' })))!
    expect(await wordText(files)).toBe('')
  })
})
