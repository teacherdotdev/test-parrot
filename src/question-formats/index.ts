import { toRecord, type ConvertedRecord } from './record'
import { decodeText } from './text'
import { readZip, zipFile, ZipLimitError } from './zip'
import { FORMATS } from './formats'
import { FORMAT_LABELS } from './catalog'
import { wordText } from './formats/docx'
import type { ForeignImage, FormatId, FormatInput, FormatSpec, ZipFiles } from './types'

export type { FormatId, ImportIssue } from './types'
export { FORMATS } from './formats'
export { FORMAT_LABELS, QUESTION_FILE_EXTENSIONS, SUPPORTED_SOURCES, isQuestionFileName } from './catalog'

/**
 * Reading a question file from another tool — a learning management system's
 * export, a test generator's output, a spreadsheet — into a Question Bank
 * Record, with no AI anywhere: every format is recognised by rules and read
 * by its own parser, so the same file always gives the same questions.
 *
 * Recognising a file scores it against every format, then reads it with the
 * few that score best and keeps the reading that brought in the most. The
 * teacher sees which format won, and can choose another.
 */

export type QuestionFileCandidate = { id: FormatId; label: string; score: number }

export type QuestionFileReading = ConvertedRecord & {
  format: FormatId
  label: string
  /** How many questions the file held, including any left out. */
  found: number
  /** Every format the file could be, best first, for “Read as”. */
  candidates: QuestionFileCandidate[]
  /** How sure the choice of format is, from 0 to 1. */
  confidence: number
  word: boolean
}

export type ReadQuestionFileOptions = {
  /** Read the file as this format, whatever it looks like. */
  format?: FormatId
  convertImage?: (image: ForeignImage) => Promise<ForeignImage | null>
}

/** What a teacher is told about a reading: everything but the record. */
export type QuestionFileSummary = Pick<
  QuestionFileReading,
  'format' | 'label' | 'found' | 'imported' | 'issues' | 'candidates' | 'confidence'
> & {
  /** Whether the questions came out of a Word document, which could be
   *  converted by an AI instead. */
  word: boolean
}

export function summaryOf(reading: QuestionFileReading): QuestionFileSummary {
  const { format, label, found, imported, issues, candidates, confidence, word } = reading
  return { format, label, found, imported, issues, candidates, confidence, word }
}

/** Why a file could not be read as questions, in words a teacher can act on. */
export class QuestionFileError extends Error {
  constructor(
    message: string,
    readonly code: 'not-recognized' | 'no-questions' | 'unsafe-archive',
  ) {
    super(message)
    this.name = 'QuestionFileError'
  }
}

const EXTENSION = /\.[^./]+$/

/** A bank name from a file name: `Chapter 3 quiz.txt` → `Chapter 3 quiz`. */
export function bankNameFromFile(name: string): string {
  const base = name.replace(/^.*[\\/]/, '').replace(EXTENSION, '').replace(/[_]+/g, ' ').trim()
  return base || 'Imported questions'
}

async function inputOf(name: string, bytes: Uint8Array): Promise<FormatInput & { word: boolean }> {
  let zip: ZipFiles | null | undefined
  let zipError: unknown
  try {
    zip = await readZip(bytes)
  } catch (reason) {
    zipError = reason
    zip = null
  }
  if (zipError instanceof ZipLimitError) throw new QuestionFileError(zipError.message, 'unsafe-archive')
  const word = Boolean(zip && zipFile(zip, 'word/document.xml'))
  let text: string
  if (zip) text = word ? await wordText(zip) : ''
  else text = decodeText(bytes).text
  return { name, bytes, word, text: () => text, zip: async () => zip ?? null }
}

const MIN_CONFIDENCE = 0.5

async function tryFormat(format: FormatSpec, input: FormatInput, score: number, options: ReadQuestionFileOptions) {
  try {
    const result = await format.parse(input)
    const converted = await toRecord(result, { bankName: bankNameFromFile(input.name), convertImage: options.convertImage })
    const found = Math.max(result.found, converted.imported)
    const share = found ? converted.imported / found : 0
    const confidence = converted.imported ? 0.5 * score + 0.5 * share : 0
    return { format, converted, found, confidence }
  } catch {
    return null
  }
}

/** How likely a file is each format, best first; formats it cannot be are left out. */
export async function candidatesFor(input: FormatInput): Promise<QuestionFileCandidate[]> {
  const scored = await Promise.all(
    FORMATS.map(async (format) => {
      let score = 0
      try {
        score = await format.detect(input)
      } catch {
        score = 0
      }
      return { id: format.id, label: FORMAT_LABELS[format.id], score: Math.max(0, Math.min(1, score)) }
    }),
  )
  // Stable: formats listed first win a tie, the more specific before the general.
  return scored.filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score)
}

export async function readQuestionFile(
  file: { name: string; bytes: Uint8Array },
  options: ReadQuestionFileOptions = {},
): Promise<QuestionFileReading> {
  const input = await inputOf(file.name, file.bytes)
  const candidates = await candidatesFor(input)

  let best: Awaited<ReturnType<typeof tryFormat>> = null
  if (options.format) {
    const format = FORMATS.find(({ id }) => id === options.format)
    if (!format) throw new QuestionFileError('Test Parrot does not know that format.', 'not-recognized')
    const score = candidates.find(({ id }) => id === format.id)?.score ?? 0
    best = await tryFormat(format, input, Math.max(score, 0.5), options)
    if (!best || !best.converted.imported) {
      const problems = best?.converted.issues.filter((issue) => issue.severity === 'error') ?? []
      throw new QuestionFileError(
        problems.length
          ? `No questions could be read from this file as ${FORMAT_LABELS[format.id]}. The first problem: ${problems[0]!.message}`
          : `No questions could be read from this file as ${FORMAT_LABELS[format.id]}.`,
        'no-questions',
      )
    }
  } else {
    const trials = await Promise.all(
      candidates.filter(({ score }) => score >= 0.3).slice(0, 3).map((candidate) =>
        tryFormat(FORMATS.find(({ id }) => id === candidate.id)!, input, candidate.score, options)),
    )
    for (const trial of trials) {
      if (trial && (!best || trial.confidence > best.confidence + 1e-9)) best = trial
    }
    if (!best || best.confidence < MIN_CONFIDENCE) {
      throw new QuestionFileError(notRecognizedMessage(file.name, input.word), 'not-recognized')
    }
  }

  return {
    ...best.converted,
    format: best.format.id,
    label: FORMAT_LABELS[best.format.id],
    found: best.found,
    confidence: best.confidence,
    word: input.word,
    candidates: candidates.length ? candidates : [{ id: best.format.id, label: FORMAT_LABELS[best.format.id], score: best.confidence }],
  }
}

function notRecognizedMessage(name: string, word: boolean): string {
  if (word) {
    return 'Test Parrot could not find questions written in a format it knows in this Word document.'
  }
  return `Test Parrot could not find questions in “${name}” written in a format it knows. ` +
    'Check it is one of the formats listed, or convert it with your AI instead.'
}
