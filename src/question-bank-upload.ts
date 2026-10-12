import type { ImportProposal } from './package-import'
import type { FormatId } from './question-formats'
import { isQuestionFileName } from './question-formats/catalog'
import type { ForeignImage } from './question-formats/types'

/**
 * Reading a file a teacher has handed over, wherever they handed it over: the
 * import dialog takes the same PDF or JSON however it arrived and asks the
 * same question of it — what banks and Exams are in here?
 */

/** A JSON file or a package zip carries its record or package directly; a
 *  PDF carries it as an attachment. Nothing downstream can tell them apart,
 *  because what is inspected, verified and imported is the same either way. */
export function isRecordFile(file: File): boolean {
  return file.type === 'application/json' || /\.(json|parrot\.zip)$/i.test(file.name)
}

export async function inspectUploadedFile(file: File, options: { format?: FormatId } = {}): Promise<ImportProposal> {
  if (options.format || isQuestionFile(file)) return inspectQuestionFile(file, options)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const importer = await import('./package-import')
  if (isRecordFile(file)) return importer.inspectImportRecord(bytes)
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdf.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href
  return importer.inspectImportFile(bytes)
}

/**
 * A file this app cannot read at all — a scan, a screenshot, a PDF that did
 * not come from here — is not a broken import, it is a test that has not been
 * converted yet. That failure is answered with the way to convert it rather
 * than with a reading of what went wrong.
 */
export function needsConversion(reason: unknown): boolean {
  const code = reason instanceof Error && 'code' in reason ? reason.code : null
  return code === 'invalid-pdf' || code === 'missing-attachment'
}

/** A question file from another tool, by its name. A Word document may be one
 *  too, but is tried as one only where it could also be converted. */
export function isQuestionFile(file: File): boolean {
  const type = file.type.toLowerCase()
  if (isRecordFile(file) || type === 'application/pdf' || /\.(pdf|docx)$/i.test(file.name)) return false
  if (type.startsWith('image/')) return false
  return isQuestionFileName(file.name) || type.startsWith('text/')
}

/**
 * A question file from another tool, or a Word document written in one of
 * their formats, read with no AI into the same proposal a Test Parrot file
 * gives — with a note of the format it was read as and what did not come in.
 * Throws a `QuestionFileError` when it holds no questions in a known format.
 */
export async function inspectQuestionFile(file: File, options: { format?: FormatId } = {}): Promise<ImportProposal> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const [{ readQuestionFile, summaryOf }, importer] = await Promise.all([
    import('./question-formats'),
    import('./package-import'),
  ])
  const reading = await readQuestionFile(
    { name: file.name, bytes },
    { ...(options.format ? { format: options.format } : {}), convertImage: redrawAsPng },
  )
  const proposal = await importer.inspectImportValue(reading.record, undefined, reading.files)
  return { ...proposal, reading: summaryOf(reading) }
}

/** A GIF or BMP picture from a question file, redrawn as PNG so it can be a
 *  Media Asset. */
async function redrawAsPng(image: ForeignImage): Promise<ForeignImage | null> {
  if (typeof createImageBitmap !== 'function' || image.mimeType === 'image/svg+xml') return null
  const bitmap = await createImageBitmap(new Blob([image.bytes.slice()], { type: image.mimeType }))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return png ? { bytes: new Uint8Array(await png.arrayBuffer()), mimeType: 'image/png' } : null
  } finally {
    bitmap.close()
  }
}
