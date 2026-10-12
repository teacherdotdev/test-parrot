import JSZip from 'jszip'
import { isPicture, type PageBox } from './picture-rules'
import { SourceDocumentError, type ImageTag, type SourceDocumentAnalysis } from './source-document'

/**
 * A Word document (.docx) as a Source Document. It is read for pictures the
 * way a PDF is — every picture placed in the document's body gets an Image
 * Tag, in the order the document reads — and handed back as a labeled copy
 * with a red “IMG n” label just before each tagged picture. It never reads
 * Question Content out of the document: that comes only from the record the
 * assistant writes (ADR-0027).
 *
 * A picture's bytes are the image file the document itself keeps, so nothing
 * is rendered or re-encoded to find it. A Word document has no fixed pages, so
 * every tag is on page 1, and a picture's box is its size as a share of the
 * page it is laid out on. Tagging is a pure function of the document's bytes,
 * and a labeled copy tags the same way: its labels are text, not pictures.
 */

export const WORD_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const BODY = 'word/document.xml'
const RELATIONSHIPS = 'word/_rels/document.xml.rels'

/** The picture types a Media Asset can come from; Word's vector formats
 *  (EMF, WMF) and TIFF are left untagged, to be uploaded. */
const PICTURE_TYPES: Record<string, WordPicture['mimeType']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
}

export type WordPicture = {
  bytes: Uint8Array
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/bmp' | 'image/webp'
}

/** Letter, in twentieths of a point, for a document that does not say. */
const DEFAULT_PAGE = { width: 12240, height: 15840 }
const EMU_PER_TWIP = 635
const TWIPS_PER_POINT = 20

type Placement = {
  /** Where the placement starts in the body XML: the picture's own element. */
  at: number
  target: string
  box: PageBox
}

type ReadDocument = {
  zip: JSZip
  xml: string
  placements: Placement[]
}

async function readDocument(bytes: Uint8Array): Promise<ReadDocument> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new SourceDocumentError('This file is not a Word document Test Parrot can read. If it has a password, save it again without one.')
  }
  const body = zip.file(BODY)
  if (!body) throw new SourceDocumentError('This file is not a Word document Test Parrot can read.')
  const xml = await body.async('string')
  const relationships = await zip.file(RELATIONSHIPS)?.async('string') ?? ''
  return { zip, xml, placements: placementsOf(xml, targetsOf(relationships)) }
}

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]

/** Relationship id → the file it names inside the package. */
function targetsOf(relationships: string): Map<string, string> {
  const targets = new Map<string, string>()
  for (const [tag] of relationships.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attribute(tag, 'Id')
    const target = attribute(tag, 'Target')
    if (!id || !target || attribute(tag, 'TargetMode') === 'External') continue
    targets.set(id, target.startsWith('/') ? target.slice(1) : `word/${target}`)
  }
  return targets
}

/** The ranges of the body that only repeat what is before them: Word writes
 *  an older copy of some drawings for older readers to fall back on. */
function fallbacksOf(xml: string): [number, number][] {
  return [...xml.matchAll(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g)].map((match) => [match.index, match.index + match[0].length])
}

function pageOf(xml: string): { width: number; height: number } {
  const size = /<w:pgSz\b[^>]*>/.exec(xml)?.[0]
  const width = Number(size && attribute(size, 'w:w'))
  const height = Number(size && attribute(size, 'w:h'))
  return width > 0 && height > 0 ? { width, height } : DEFAULT_PAGE
}

/** A VML length, such as `2.5in` or `180pt`, in points. */
function points(value: string | undefined): number {
  const match = /^([\d.]+)(pt|in|cm|mm|px)?$/.exec(value?.trim() ?? '')
  if (!match) return 0
  const scale = { pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75 }[match[2] ?? 'px'] ?? 0
  return Number(match[1]) * scale
}

/**
 * Every picture placed in the document's body, in the order it reads: a
 * drawing (`<w:drawing>` with an `<a:blip>`), or an older VML picture
 * (`<w:pict>` with `<v:imagedata>`) outside a fallback copy.
 */
function placementsOf(xml: string, targets: ReadonlyMap<string, string>): Placement[] {
  const page = pageOf(xml)
  const fallbacks = fallbacksOf(xml)
  const inFallback = (at: number) => fallbacks.some(([start, end]) => at >= start && at < end)
  const box = (widthPoints: number, heightPoints: number): PageBox => ({
    left: 0,
    top: 0,
    right: Math.round(((widthPoints * TWIPS_PER_POINT) / page.width) * 100_000) / 100,
    bottom: Math.round(((heightPoints * TWIPS_PER_POINT) / page.height) * 100_000) / 100,
  })
  const placements: Placement[] = []
  for (const match of xml.matchAll(/<a:blip\b[^>]*>|<v:imagedata\b[^>]*>/g)) {
    if (inFallback(match.index)) continue
    const tag = match[0]
    if (tag.startsWith('<a:blip')) {
      const target = targets.get(attribute(tag, 'r:embed') ?? '')
      const at = xml.lastIndexOf('<w:drawing', match.index)
      if (!target || at < 0) continue
      const extent = /<wp:extent\b[^>]*>/.exec(xml.slice(at, match.index))?.[0] ?? ''
      const emuPerPoint = EMU_PER_TWIP * TWIPS_PER_POINT
      placements.push({
        at,
        target,
        box: box(Number(attribute(extent, 'cx')) / emuPerPoint || 0, Number(attribute(extent, 'cy')) / emuPerPoint || 0),
      })
    } else {
      const target = targets.get(attribute(tag, 'r:id') ?? '')
      const at = xml.lastIndexOf('<w:pict', match.index)
      if (!target || at < 0) continue
      const shape = /<v:shape\b[^>]*>/.exec(xml.slice(at, match.index))?.[0] ?? ''
      const style = new Map(
        (attribute(shape, 'style') ?? '').split(';').map((rule) => {
          const [name = '', value = ''] = rule.split(':')
          return [name.trim(), value.trim()] as const
        }),
      )
      placements.push({ at, target, box: box(points(style.get('width')), points(style.get('height'))) })
    }
  }
  return placements
}

const typeOf = (target: string) => PICTURE_TYPES[target.split('.').pop()?.toLowerCase() ?? '']

/** The placements that get a tag, with their tag numbers. */
function tagged(placements: readonly Placement[]): (Placement & { tag: number })[] {
  return placements
    .filter((placement) => typeOf(placement.target) && isPicture(placement.box))
    .map((placement, index) => ({ ...placement, tag: index + 1 }))
}

function le16(bytes: Uint8Array, at: number) {
  return bytes[at]! | (bytes[at + 1]! << 8)
}

async function pixelSize(picture: WordPicture): Promise<{ width: number; height: number }> {
  const { bytes, mimeType } = picture
  if (mimeType === 'image/gif') return { width: le16(bytes, 6), height: le16(bytes, 8) }
  if (mimeType === 'image/bmp') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) }
  }
  const { mediaDimensions } = await import('./question-bank-import')
  return mediaDimensions(mimeType, bytes) ?? { width: 0, height: 0 }
}

async function pictureAt(zip: JSZip, target: string): Promise<WordPicture> {
  const file = zip.file(target)
  const mimeType = typeOf(target)
  if (!file || !mimeType) throw new SourceDocumentError('This picture is missing from the Word document.')
  return { bytes: await file.async('uint8array'), mimeType }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decoded = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, name: string) =>
    name.startsWith('#x') || name.startsWith('#X')
      ? String.fromCodePoint(parseInt(name.slice(2), 16))
      : name.startsWith('#')
        ? String.fromCodePoint(Number(name.slice(1)))
        : ENTITIES[name] ?? entity,
  )

/** The body's text, paragraph by paragraph, for checking that a record came
 *  from this document. */
function textOf(xml: string): string {
  const fallbacks = fallbacksOf(xml)
  let text = ''
  for (const match of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<\/w:p>/g)) {
    if (fallbacks.some(([start, end]) => match.index >= start && match.index < end)) continue
    text += match[1] !== undefined ? decoded(match[1]) : ' '
  }
  return text.replace(/\s+/g, ' ').trim()
}

export async function analyzeWordDocument(bytes: Uint8Array): Promise<SourceDocumentAnalysis> {
  const { zip, xml, placements } = await readDocument(bytes)
  const tags: ImageTag[] = []
  for (const placement of tagged(placements)) {
    tags.push({
      tag: placement.tag,
      page: 1,
      box: placement.box,
      ...(await pixelSize(await pictureAt(zip, placement.target))),
    })
  }
  return { pageCount: 1, tags, pageText: [textOf(xml)] }
}

/** The image file a tag names, exactly as the document keeps it. */
export async function pictureForWordTag(bytes: Uint8Array, tag: Pick<ImageTag, 'tag'>): Promise<WordPicture> {
  const { zip, placements } = await readDocument(bytes)
  const placement = tagged(placements).find((candidate) => candidate.tag === tag.tag)
  if (!placement) throw new SourceDocumentError(`IMG ${tag.tag} is not in this Word document.`)
  return pictureAt(zip, placement.target)
}

/** A label run: white bold “IMG n” on the same red as a PDF's tags. */
const label = (tag: number) =>
  `<w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="D1141F"/></w:rPr><w:t xml:space="preserve"> IMG ${tag} </w:t></w:r>`

/** Where the run holding a picture starts, so a label can go just before it. */
function runStart(xml: string, at: number): number {
  return Math.max(xml.lastIndexOf('<w:r>', at), xml.lastIndexOf('<w:r ', at))
}

/**
 * The labeled copy: the original document with a red “IMG n” label in the
 * line just before each tagged picture. Only the body changes; every picture
 * stays exactly as it was.
 */
export async function labelWordDocument(bytes: Uint8Array): Promise<Uint8Array> {
  const { zip, xml, placements } = await readDocument(bytes)
  let labeled = xml
  // From the end, so every earlier position still holds.
  for (const placement of tagged(placements).reverse()) {
    const at = runStart(labeled, placement.at)
    if (at < 0) continue
    labeled = labeled.slice(0, at) + label(placement.tag) + labeled.slice(at)
  }
  zip.file(BODY, labeled)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: WORD_MIME_TYPE })
}

export function labeledWordFilename(name: string): string {
  const stem = name.replace(/\.docx$/i, '') || 'source'
  return `${stem} (labeled).docx`
}
