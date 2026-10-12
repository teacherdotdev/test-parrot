import { createCanvas } from '@napi-rs/canvas'
import { Document, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/** Fixtures for converting a test: a Source Document and what an assistant
 *  would write back for it. */

export function picture(width: number, height: number, seed: number) {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = `rgb(${(seed * 70) % 256}, ${(seed * 130) % 256}, 180)`
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#222'
  context.fillRect(width / 4, height / 4, width / 2, height / 2)
  return new Uint8Array(canvas.toBuffer('image/png'))
}

/** A two-page test with no Test Parrot attachment: a map on page 1, a graph
 *  and a line-drawn diagram (no embedded image, so no tag) on page 2. */
export async function sourceDocument() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const [map, graph] = await Promise.all([pdf.embedPng(picture(120, 80, 1)), pdf.embedPng(picture(120, 80, 2))])
  const first = pdf.addPage([612, 792])
  first.drawText('1. Use the map to name the bus stop farthest east.', { x: 60, y: 730, size: 12, font })
  first.drawImage(map, { x: 60, y: 480, width: 300, height: 200 })
  const second = pdf.addPage([612, 792])
  second.drawText('2. Which bus route has the most stops on the map?', { x: 60, y: 730, size: 12, font })
  second.drawText('3. Describe the graph of the function shown below.', { x: 60, y: 700, size: 12, font })
  second.drawImage(graph, { x: 60, y: 460, width: 300, height: 200 })
  second.drawText('4. Describe the circuit drawn below.', { x: 60, y: 420, size: 12, font })
  second.drawRectangle({ x: 60, y: 200, width: 300, height: 180, borderColor: rgb(0, 0, 0), borderWidth: 2 })
  second.drawText('5. Label the parts of the cell drawn below.', { x: 60, y: 160, size: 12, font })
  return Buffer.from(await pdf.save())
}

/** The same test as a Word document: the map and the graph are pictures in
 *  it, and the circuit and the cell are not. */
export async function wordSourceDocument() {
  const line = (text: string) => new Paragraph({ children: [new TextRun(text)] })
  const placed = (data: Uint8Array) => new Paragraph({
    children: [new ImageRun({ type: 'png', data, transformation: { width: 300, height: 200 } })],
  })
  const document = new Document({
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 } } },
      children: [
        line('1. Use the map to name the bus stop farthest east.'),
        placed(picture(120, 80, 1)),
        line('2. Which bus route has the most stops on the map?'),
        line('3. Describe the graph of the function shown below.'),
        placed(picture(120, 80, 2)),
        line('4. Describe the circuit drawn below.'),
        line('5. Label the parts of the cell drawn below.'),
      ],
    }],
  })
  return Buffer.from(await Packer.toBuffer(document))
}

export const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
export const doc = (...content: unknown[]) => ({ type: 'document', content })
const map = { type: 'block-image', pending: { image: 1 }, alt: 'Map of bus routes', caption: 'Bus routes, 2020' }

/** What an assistant would write back for that test. */
export function assistantPackage() {
  const questions = [
    { id: 'q1', type: 'short-answer', stem: doc(paragraph('Use the map to name the bus stop farthest east.'), map) },
    {
      id: 'q2',
      type: 'multiple-choice',
      stem: doc(map, paragraph('Which bus route has the most stops on the map?')),
      choices: [
        { id: 'q2-c1', content: doc(paragraph('Route 4')), correct: true },
        { id: 'q2-c2', content: doc(paragraph('Route 9')), correct: false },
      ],
    },
    {
      id: 'q3',
      type: 'short-answer',
      stem: doc(paragraph('Describe the graph of the function shown below.'), { type: 'block-image', pending: { image: 2 }, alt: 'Graph of a function' }),
    },
    {
      id: 'q4',
      type: 'short-answer',
      stem: doc(paragraph('Describe the circuit drawn below.'), { type: 'block-image', pending: { page: 2 }, alt: 'Circuit diagram' }),
    },
    {
      id: 'q5',
      type: 'short-answer',
      stem: doc(paragraph('Label the parts of the cell drawn below.'), { type: 'block-image', pending: { page: 2 }, alt: 'Cell diagram' }),
    },
  ]
  return Buffer.from(JSON.stringify({
    format: 'test-parrot/package',
    formatVersion: '0.1.0',
    generator: { name: 'Assistant', version: '1' },
    requiredFeatures: [],
    questionBanks: [{
      id: 'history',
      record: {
        format: 'test-parrot/question-bank',
        formatVersion: '0.7.0',
        generator: { name: 'Assistant', version: '1' },
        requiredFeatures: [],
        bank: { name: 'Bus Routes', questions },
        media: [],
      },
    }],
    exams: [{
      format: 'test-parrot/exam',
      formatVersion: '0.1.0',
      name: 'Bus Routes Quiz',
      positions: questions.map(({ id }) => ({ question: { bank: 'history', question: id } })),
    }],
  }))
}

