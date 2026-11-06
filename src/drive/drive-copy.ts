// A Drive Copy (ADR-0052): the PDF a Resource keeps in Drive. It is the
// Resource's ordinary file — a Question Bank File, or an Exam's test and
// answer key with its package — with two additions no exported PDF has: an
// identity map in the package zip, so Questions keep their own ids, and an
// "Open in Test Parrot" banner at the top of page 1.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, PDFHexString, StandardFonts, decodePDFRawStream, rgb } from 'pdf-lib'
import { choicesOf, type Question } from '../exam'
import type { QuestionBankRecordQuestion } from '../question-bank-export'

/** Where the identity map sits in the package zip. Importers that do not
 *  know it leave it alone: only `media/` files must all be used. */
export const IDENTITY_FILE = 'drive.json'
export const IDENTITY_FORMAT = 'test-parrot/drive-copy'

export type IdentityMap = {
  format: typeof IDENTITY_FORMAT
  version: 1
  resource: { kind: 'bank' | 'exam'; id: string; name: string }
  /** Package-local Question and answer ids → the local ids they came from. */
  ids: Record<string, string>
}

export function identityFile(resource: IdentityMap['resource'], ids: ReadonlyMap<string, string>): Uint8Array {
  const map: IdentityMap = { format: IDENTITY_FORMAT, version: 1, resource, ids: Object.fromEntries(ids) }
  return new TextEncoder().encode(JSON.stringify(map))
}

export function readIdentityFile(bytes: Uint8Array | undefined): IdentityMap | null {
  if (!bytes) return null
  try {
    const map = JSON.parse(new TextDecoder().decode(bytes)) as IdentityMap
    return map.format === IDENTITY_FORMAT && map.ids && typeof map.ids === 'object' ? map : null
  } catch {
    return null
  }
}

/** A Question Bank File's package-local ids for its Questions, which its
 *  record numbers by position, and for each one's answers. */
export function bankIdentities(questions: readonly Question[], recorded: readonly QuestionBankRecordQuestion[]): Map<string, string> {
  const ids = new Map<string, string>()
  questions.forEach((question, index) => {
    const record = recorded[index]
    if (!record) return
    ids.set(record.id, question.id)
    const recordAnswers = record.choices ?? record.wordBank ?? []
    choicesOf(question).forEach((choice, at) => {
      const answer = recordAnswers[at]
      if (answer) ids.set(answer.id, choice.id)
    })
  })
  return ids
}

/** `value` with every string and key that `map` names replaced by what it
 *  maps to. Fresh ids are random UUIDs, so nothing else ever matches. */
export function remapIds<T>(value: T, map: ReadonlyMap<string, string>): T {
  if (map.size === 0) return value
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') return map.get(item) ?? item
    if (Array.isArray(item)) return item.map(walk)
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [map.get(key) ?? key, walk(child)]))
    }
    return item
  }
  return walk(value) as T
}

/** What a banner link says about its file, so the page it opens can show
 *  the file before Google is asked for it. It is only a preview: what opens
 *  is what Drive holds. */
export type OpenLinkPreview = { kind: 'bank' | 'exam'; title: string; questions: number }

export function openUrl(
  fileId: string,
  preview?: OpenLinkPreview,
  origin = typeof window === 'undefined' ? 'https://testparrot.com' : window.location.origin,
) {
  const query = new URLSearchParams({ drive: fileId })
  if (preview) {
    query.set('kind', preview.kind)
    query.set('title', preview.title.slice(0, 80))
    query.set('questions', String(preview.questions))
  }
  return `${origin}/open?${query.toString()}`
}

/** The preview a banner link carries, or null for a bare link. */
export function readOpenLinkPreview(search: string): OpenLinkPreview | null {
  const query = new URLSearchParams(search)
  const kind = query.get('kind')
  const title = query.get('title')?.trim()
  const questions = Number(query.get('questions'))
  if ((kind !== 'bank' && kind !== 'exam') || !title) return null
  return { kind, title: title.slice(0, 80), questions: Number.isFinite(questions) && questions >= 0 ? Math.floor(questions) : 0 }
}

export const BANNER_TEXT = 'Open in Test Parrot'
const BANNER_HEIGHT = 22

/** The PDF with an "Open in Test Parrot" band across the top of page 1,
 *  linking to the file in Test Parrot. It sits in the top margin, above
 *  anything the page itself draws. */
export async function withOpenBanner(pdf: Uint8Array, url: string): Promise<Uint8Array> {
  const document = await PDFDocument.load(pdf)
  const page = document.getPage(0)
  const { width, height } = page.getSize()
  const font = await document.embedFont(StandardFonts.HelveticaBold)
  const small = await document.embedFont(StandardFonts.Helvetica)
  const top = height - BANNER_HEIGHT
  page.drawRectangle({ x: 0, y: top, width, height: BANNER_HEIGHT, color: rgb(0.93, 0.96, 0.94) })
  // Only WinAnsi characters: the standard font can draw nothing else.
  const label = `${BANNER_TEXT} >`
  const note = 'This is a Drive Copy kept by Test Parrot. Edit it in Test Parrot, not here.'
  const size = 9
  const labelWidth = font.widthOfTextAtSize(label, size)
  page.drawText(label, { x: 18, y: top + 7, size, font, color: rgb(0.05, 0.36, 0.22) })
  page.drawText(note, { x: 18 + labelWidth + 12, y: top + 7, size: 7.5, font: small, color: rgb(0.35, 0.38, 0.4) })
  const link = document.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [0, top, width, height],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
  })
  const annotations = page.node.lookup(PDFName.of('Annots'))
  const ref = document.context.register(link)
  if (annotations && 'push' in annotations) (annotations as unknown as { push(value: unknown): void }).push(ref)
  else page.node.set(PDFName.of('Annots'), document.context.obj([ref]))
  return document.save({ useObjectStreams: false })
}

/** The Test Parrot Package a Drive Copy carries, read with pdf-lib, which
 *  wrote it: no pdf.js worker is needed. Null when the PDF holds none this
 *  way, for the caller to try the general reader. */
export async function attachedPackage(pdf: Uint8Array, description: string): Promise<Uint8Array | null> {
  let document: PDFDocument
  try {
    document = await PDFDocument.load(pdf, { updateMetadata: false })
  } catch {
    return null
  }
  const names = document.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
  const list = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray)
  if (!list) return null
  for (let index = 1; index < list.size(); index += 2) {
    const spec = list.lookupMaybe(index, PDFDict)
    const desc = spec?.lookupMaybe(PDFName.of('Desc'), PDFString, PDFHexString)
    if (!spec || desc?.decodeText() !== description) continue
    const stream = spec.lookupMaybe(PDFName.of('EF'), PDFDict)?.lookup(PDFName.of('F'))
    if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode()
  }
  return null
}
