import { describe, expect, test } from 'bun:test'
import { createCanvas } from '@napi-rs/canvas'
import { Document, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import { analyzeWordDocument, labelWordDocument, labeledWordFilename, pictureForWordTag } from './word-document'

function picture(width: number, height: number, seed: number) {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = `rgb(${(seed * 70) % 256}, ${(seed * 130) % 256}, 180)`
  context.fillRect(0, 0, width, height)
  return new Uint8Array(canvas.toBuffer('image/png'))
}

/** A picture placed at a size in CSS pixels, which is how `docx` sizes one:
 *  a Letter page is 816 wide. */
const placed = (data: Uint8Array, width: number, height: number) =>
  new ImageRun({ type: 'png', data, transformation: { width, height } })

const MAP = picture(120, 80, 1)
const GRAPH = picture(90, 60, 2)
const EQUATION = picture(40, 12, 3)

async function wordDocument(...paragraphs: Paragraph[]) {
  const document = new Document({
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 } } }, children: paragraphs }],
  })
  return new Uint8Array(await Packer.toBuffer(document))
}

const unitTest = () => wordDocument(
  new Paragraph({ children: [new TextRun('1. Use the map to name the bus stop farthest east.')] }),
  new Paragraph({ children: [placed(MAP, 272, 180)] }),
  new Paragraph({ children: [new TextRun('2. Solve '), placed(EQUATION, 40, 12), new TextRun(' for x & y.')] }),
  new Paragraph({ children: [new TextRun('3. Which graph is increasing?')] }),
  new Paragraph({ children: [placed(GRAPH, 204, 136), placed(MAP, 204, 136)] }),
)

describe('reading a Word document for pictures', () => {
  test('tags each picture placed in it, in reading order, sized as a share of its page', async () => {
    const analysis = await analyzeWordDocument(await unitTest())
    expect(analysis.pageCount).toBe(1)
    expect(analysis.tags).toEqual([
      { tag: 1, page: 1, box: { left: 0, top: 0, right: 333.33, bottom: 170.45 }, width: 120, height: 80 },
      // A picture used twice is tagged each place it is placed.
      { tag: 2, page: 1, box: { left: 0, top: 0, right: 250, bottom: 128.79 }, width: 90, height: 60 },
      { tag: 3, page: 1, box: { left: 0, top: 0, right: 250, bottom: 128.79 }, width: 120, height: 80 },
    ])
  })

  test('leaves an equation-sized picture untagged', async () => {
    const analysis = await analyzeWordDocument(await unitTest())
    expect(analysis.tags.map(({ width }) => width)).not.toContain(40)
  })

  test('reads the document’s text, for checking a record against it', async () => {
    const analysis = await analyzeWordDocument(await unitTest())
    expect(analysis.pageText).toEqual([
      '1. Use the map to name the bus stop farthest east. 2. Solve for x & y. 3. Which graph is increasing?',
    ])
  })

  test('gives back the exact image file a tag names', async () => {
    const bytes = await unitTest()
    expect(await pictureForWordTag(bytes, { tag: 2 })).toEqual({ bytes: GRAPH, mimeType: 'image/png' })
    expect((await pictureForWordTag(bytes, { tag: 3 })).bytes).toEqual(MAP)
    await expect(pictureForWordTag(bytes, { tag: 4 })).rejects.toThrow('IMG 4 is not in this Word document.')
  })

  test('refuses a file that is not a Word document', async () => {
    await expect(analyzeWordDocument(new Uint8Array([37, 80, 68, 70]))).rejects.toThrow('not a Word document')
  })
})

/** A document written the way older Word versions write pictures: VML,
 *  and a drawing whose fallback copy repeats it for older readers. */
async function olderWordDocument() {
  const zip = new JSZip()
  const body = [
    '<w:p><w:r><w:t>Look at the map.</w:t></w:r></w:p>',
    '<w:p><w:r><w:pict><v:shape style="width:3in;height:2in"><v:imagedata r:id="rMap"/></v:shape></w:pict></w:r></w:p>',
    '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><wp:extent cx="2743200" cy="1828800"/>',
    '<a:graphic><a:blip r:embed="rGraph"/></a:graphic></wp:anchor></w:drawing></mc:Choice>',
    '<mc:Fallback><w:pict><v:shape style="width:216pt;height:144pt"><v:imagedata r:id="rGraph"/></v:shape>',
    '<w:t>Graph</w:t></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>',
  ].join('')
  zip.file('word/document.xml', `<w:document><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)
  zip.file('word/_rels/document.xml.rels', '<Relationships><Relationship Id="rMap" Target="media/map.png"/><Relationship Id="rGraph" Target="media/graph.png"/><Relationship Id="rLogo" Target="http://example.com/a.png" TargetMode="External"/></Relationships>')
  zip.file('word/media/map.png', MAP)
  zip.file('word/media/graph.png', GRAPH)
  return zip.generateAsync({ type: 'uint8array' })
}

test('reads older VML pictures, and a drawing’s fallback copy only once', async () => {
  const bytes = await olderWordDocument()
  const analysis = await analyzeWordDocument(bytes)
  expect(analysis.tags.map(({ tag, box }) => [tag, box.right])).toEqual([[1, 352.94], [2, 352.94]])
  expect(analysis.pageText).toEqual(['Look at the map.'])
  expect((await pictureForWordTag(bytes, { tag: 2 })).bytes).toEqual(GRAPH)
})

describe('labeling a Word document', () => {
  test('puts each tag just before its picture, and tags the copy the same way', async () => {
    const original = await unitTest()
    const labeled = await labelWordDocument(original)
    const xml = await (await JSZip.loadAsync(labeled)).file('word/document.xml')!.async('string')
    const labels = [...xml.matchAll(/<w:t xml:space="preserve"> (IMG \d+) <\/w:t><\/w:r><w:r>\s*<w:drawing>/g)].map((match) => match[1])
    expect(labels).toEqual(['IMG 1', 'IMG 2', 'IMG 3'])
    // The labels are text, so the labeled copy has the same pictures.
    expect((await analyzeWordDocument(labeled)).tags).toEqual((await analyzeWordDocument(original)).tags)
    expect((await pictureForWordTag(labeled, { tag: 1 })).bytes).toEqual(MAP)
  })

  test('names the labeled copy after the original', () => {
    expect(labeledWordFilename('Unit 4 test.docx')).toBe('Unit 4 test (labeled).docx')
  })
})
