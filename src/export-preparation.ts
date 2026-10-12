// Pure preparation for one Export Record event.
//
// The Working Copy is resolved into the selected Layout Plans exactly once.
// Those plans are the self-contained historical presentation: later viewing
// and re-export never consult canonical Questions or run the layout engine.

import type { Exam, Arrangement, RandomSource } from './exam'
import {
  numberLabelOf,
  planExport,
  type ExportContentSelection,
  type LayoutPlan,
  type Measure,
} from './export-plan'
import { imageSourcesOf } from './export-media'
import {
  DEFAULT_VERSION_COUNT,
  NO_SHUFFLE,
  maxVersionCount,
  shuffledArrangements,
  shufflesAnything,
  versionCountError,
  versionNames,
  type ShuffleOptions,
} from './export-versions'
import { pendingImageOf, type ProseMirrorJSON } from './question-doc'

export type ExportFormat = 'pdf' | 'docx'

export type ExportConfiguration = {
  format: ExportFormat
  selection: ExportContentSelection
  /** What to shuffle into Versions. Absent, or nothing on, prints the
   *  Working Copy's own arrangement. */
  shuffle?: ShuffleOptions
  /** How many shuffled Versions to print; read only when shuffling. */
  versionCount?: number
}

export const DEFAULT_EXPORT_CONFIGURATION: ExportConfiguration = {
  format: 'pdf',
  selection: { test: true, answerKey: true },
}

const EXPORT_PREFERENCES_KEY = 'test-parrot-export-preferences-v1'

/** Export preferences are global UI settings, not authoring persistence. */
export function readExportPreferences(): ExportConfiguration {
  if (typeof localStorage === 'undefined') return DEFAULT_EXPORT_CONFIGURATION
  try {
    const value = JSON.parse(localStorage.getItem(EXPORT_PREFERENCES_KEY) ?? '') as Partial<ExportConfiguration>
    if (
      (value.format === 'pdf' || value.format === 'docx')
      && typeof value.selection?.test === 'boolean'
      && typeof value.selection.answerKey === 'boolean'
      && (value.selection.test || value.selection.answerKey)
    ) {
      return { format: value.format, selection: { ...value.selection } }
    }
  } catch {
    // Missing or malformed preferences fall back to the product defaults.
  }
  return DEFAULT_EXPORT_CONFIGURATION
}

export function writeExportPreferences(configuration: ExportConfiguration): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(EXPORT_PREFERENCES_KEY, JSON.stringify(configuration))
}

export type ShufflePreferences = { shuffle: ShuffleOptions; versionCount: number }

const DEFAULT_SHUFFLE_PREFERENCES: ShufflePreferences = {
  shuffle: NO_SHUFFLE,
  versionCount: DEFAULT_VERSION_COUNT,
}

const SHUFFLE_PREFERENCES_KEY = 'test-parrot-export-shuffle-v1'

function storedShufflePreferences(): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SHUFFLE_PREFERENCES_KEY) ?? '')
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** How an Exam was last shuffled for export. A UI preference kept per Exam,
 *  never authoring state: it neither dirties nor saves the Exam. */
export function readShufflePreferences(examId: string): ShufflePreferences {
  if (typeof localStorage === 'undefined') return DEFAULT_SHUFFLE_PREFERENCES
  const value = storedShufflePreferences()[examId] as Partial<ShufflePreferences> | undefined
  // Each half stands alone, so a count box left empty keeps the checkboxes.
  const shuffle = typeof value?.shuffle?.questions === 'boolean' && typeof value.shuffle.answers === 'boolean'
    ? { questions: value.shuffle.questions, answers: value.shuffle.answers }
    : DEFAULT_SHUFFLE_PREFERENCES.shuffle
  const versionCount = Number.isInteger(value?.versionCount) && value!.versionCount! >= 1
    ? value!.versionCount!
    : DEFAULT_SHUFFLE_PREFERENCES.versionCount
  return { shuffle, versionCount }
}

export function writeShufflePreferences(examId: string, preferences: ShufflePreferences): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(
    SHUFFLE_PREFERENCES_KEY,
    JSON.stringify({ ...storedShufflePreferences(), [examId]: preferences }),
  )
}

export type ExportRecord = {
  id: string
  examId: string
  capturedName: string
  createdAt: string
  format: ExportFormat
  selection: ExportContentSelection
  questionCount: number
  plans: LayoutPlan[]
  mediaHashes: string[]
  sourceRecordId?: string
  /** The Test Parrot Package this export's PDF carries, exactly as attached,
   *  so a re-export attaches the same bytes: a package zip with its pictures
   *  (ADR-0036), or JSON on a record made before it. Only a PDF including
   *  the answer key has one. It sits beside the plans, not in them: nothing
   *  about the pages depends on it. */
  examPackage?: Uint8Array | string
  /** The names of the shuffled Versions this export printed, in order. Absent
   *  when it shuffled nothing, as on every record made before Versions
   *  existed. Each plan names its Version in `arrangement.version`. */
  versions?: string[]
  /** What the export shuffled to make its Versions; present exactly when
   *  `versions` is. */
  shuffle?: ShuffleOptions
}

export type ExportHistory = { records: ExportRecord[] }

export const EMPTY_EXPORT_HISTORY: ExportHistory = { records: [] }

export type PreparationProgress = {
  stage: 'planning' | 'resolving'
  completed: number
  total: number
}

export type PreparedExport = {
  documents: LayoutPlan[]
  filename: string
  record: ExportRecord
}

export type PreparationRequest = {
  examId: string
  exam: Exam
  arrangement: Arrangement
  configuration: ExportConfiguration
  history: ExportHistory
  measure: Measure
  createdAt: string
  createId?: () => string
  /** What shuffled Versions are drawn from. The same source reproduces the
   *  same Versions and names, which is how the Export Preview and the export
   *  it previews agree. */
  random?: RandomSource
  onProgress?: (progress: PreparationProgress) => void
}

const TEST_ONLY: ExportContentSelection = { test: true, answerKey: false }
const KEY_ONLY: ExportContentSelection = { test: false, answerKey: true }
const OWNED_MEDIA = /^\/local-images\/([a-f0-9]{64})$/

export function sanitizeExamTitle(title: string): string {
  const safe = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
  return safe || 'Untitled Exam'
}

export function exportFilename(title: string, format: ExportFormat): string {
  return `${sanitizeExamTitle(title)}.${format}`
}

export function docxFilename(title: string): string {
  return exportFilename(title, 'docx')
}

export function pdfFilename(title: string): string {
  return exportFilename(title, 'pdf')
}

/** Kept for adapter fingerprint compatibility; this is not domain identity. */
export function arrangementRange(labels: readonly string[]): string {
  const first = labels[0] ?? ''
  const last = labels.at(-1) ?? first
  return labels.length > 1 ? `${first}-${last}` : first
}

function mediaHashesOf(plans: readonly LayoutPlan[]): string[] {
  return [...new Set(imageSourcesOf(plans).map((source) => {
    const hash = OWNED_MEDIA.exec(source)?.[1]
    if (!hash) {
      throw new Error(
        `Required media ${source} is not owned by this exam. Re-add the affected image and try again.`,
      )
    }
    return hash
  }))]
}

function historicalRecord(
  source: ExportRecord,
  createdAt: string,
  createId: () => string,
): ExportRecord {
  return {
    ...structuredClone(source),
    id: createId(),
    createdAt,
    sourceRecordId: source.id,
  }
}

/** A record narrowed to some of its Versions: only stored plans are kept, in
 *  their recorded order, and nothing is planned, shuffled or named. Its format
 *  and Content Selection are frozen as they were exported. */
function withVersions(record: ExportRecord, versions: readonly string[]): ExportRecord {
  const names = (record.versions ?? []).filter((name) => versions.includes(name))
  if (names.length === 0) {
    throw new Error('Choose at least one Version this export printed.')
  }
  const plans = record.plans.filter((plan) => names.includes(plan.arrangement.version ?? ''))
  return { ...record, plans, mediaHashes: mediaHashesOf(plans), versions: names }
}

/**
 * Select a historical artifact without current authoring or layout input:
 * all of it, or — for a shuffled export — some of its Versions. Either way it
 * is a new Export Record of stored plans, and never a new Version.
 */
export function prepareHistoricalExport({
  record,
  versions,
  createdAt,
  createId = () => crypto.randomUUID(),
}: {
  record: ExportRecord
  /** The Versions to print again; every one the record printed when absent. */
  versions?: readonly string[]
  createdAt: string
  createId?: () => string
}): PreparedExport {
  const source = versions === undefined ? record : withVersions(record, versions)
  const copied = historicalRecord(source, createdAt, createId)
  return {
    documents: copied.plans,
    filename: exportFilename(copied.capturedName, copied.format),
    record: copied,
  }
}

/** Every Version name an Exam's Export History has already printed. */
function usedVersionNames(history: ExportHistory): Set<string> {
  return new Set(history.records.flatMap((record) => record.versions ?? []))
}

/** The papers one export prints: the Working Copy's own arrangement, unnamed,
 *  or — when it shuffles — only shuffled Versions, each newly named. */
function versionsToPrint({
  exam,
  arrangement,
  configuration,
  history,
  random,
  createId,
}: {
  exam: Exam
  arrangement: Arrangement
  configuration: ExportConfiguration
  history: ExportHistory
  random: RandomSource
  createId: () => string
}): { arrangement: Arrangement; name?: string }[] {
  const { shuffle } = configuration
  if (!shuffle || !shufflesAnything(shuffle)) return [{ arrangement }]
  const count = configuration.versionCount ?? DEFAULT_VERSION_COUNT
  const refusal = versionCountError(count, maxVersionCount(exam, arrangement, shuffle))
  if (refusal) throw new Error(refusal)
  const arrangements = shuffledArrangements({ exam, arrangement, shuffle, count, random, createId })
  const names = versionNames(count, usedVersionNames(history), random)
  return arrangements.map((paper, index) => ({ arrangement: paper, name: names[index]! }))
}

/**
 * An Exam cannot be exported while a Question it uses still has a Pending
 * Image: a printed test with a hole where a graph belongs is not a test. The
 * refusal names those Questions by the numbers they print under, so the
 * teacher can find them on the sheet.
 */
export class PicturesNeededError extends Error {
  constructor(readonly questionNumbers: readonly string[]) {
    const [last, ...rest] = [...questionNumbers].reverse()
    const named = rest.length ? `${rest.reverse().join(', ')} and ${last}` : last
    super(
      questionNumbers.length === 1
        ? `Question ${named} still needs a picture. Resolve it before exporting.`
        : `Questions ${named} still need pictures. Resolve them before exporting.`,
    )
    this.name = 'PicturesNeededError'
  }
}

function hasPendingImage(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPendingImage)
  if (!value || typeof value !== 'object') return false
  const node = value as ProseMirrorJSON
  return pendingImageOf(node) !== undefined || hasPendingImage(node.content)
}

function refusePendingImages(exam: Exam, testOf: () => LayoutPlan): void {
  const needing = new Set(
    exam.questions
      .filter((question) => hasPendingImage(question.doc) || hasPendingImage(question.suggestedAnswer))
      .map(({ id }) => id),
  )
  if (needing.size === 0) return
  const numbers = new Map<string, string>()
  for (const page of testOf().pages) {
    for (const item of page.items) {
      if (item.kind === 'question' && needing.has(item.question.id)) {
        numbers.set(item.question.id, numberLabelOf(item.question))
      }
    }
  }
  throw new PicturesNeededError([...numbers.values()])
}

/** Resolve the visible Working Copy into one immutable export event. */
export function prepareExport({
  examId,
  exam,
  arrangement,
  configuration,
  history,
  measure,
  createdAt,
  createId = () => crypto.randomUUID(),
  random = Math.random,
  onProgress,
}: PreparationRequest): PreparedExport {
  if (exam.questions.length === 0) {
    throw new Error('Add at least one question to the Exam before exporting.')
  }
  if (!configuration.selection.test && !configuration.selection.answerKey) {
    throw new Error('Choose the student test, the answer key, or both.')
  }

  // Named by the numbers the teacher sees in the Working Copy, not a
  // shuffled Version's, so the refusal points at the sheet being edited.
  refusePendingImages(exam, () => planExport({ exam, arrangement, selection: TEST_ONLY, measure }))
  const papers = versionsToPrint({ exam, arrangement, configuration, history, random, createId })
  const total = papers.length * 2
  let completed = 0
  const planned = papers.map(({ arrangement: paper, name }) => {
    const plan = (selection: ExportContentSelection) => {
      const result = planExport({
        exam,
        arrangement: paper,
        selection,
        measure,
        ...(name !== undefined ? { version: name } : {}),
      })
      onProgress?.({ stage: 'planning', completed: ++completed, total })
      return result
    }
    return { test: plan(TEST_ONLY), answerKey: plan(KEY_ONLY) }
  })
  // Every Version's test, then every Version's key: tests go out in stacks,
  // and the keys stay with the teacher.
  const documents = [
    ...(configuration.selection.test ? planned.map(({ test }) => test) : []),
    ...(configuration.selection.answerKey ? planned.map(({ answerKey }) => answerKey) : []),
  ]
  onProgress?.({ stage: 'resolving', completed: 1, total: 1 })
  const versions = papers.flatMap(({ name }) => (name !== undefined ? [name] : []))

  const record: ExportRecord = {
    id: createId(),
    examId,
    capturedName: exam.title,
    createdAt,
    format: configuration.format,
    selection: { ...configuration.selection },
    questionCount: exam.questions.length,
    plans: structuredClone(documents),
    mediaHashes: mediaHashesOf(documents),
    ...(versions.length > 0 ? { versions, shuffle: { ...configuration.shuffle! } } : {}),
  }
  return {
    documents,
    filename: exportFilename(exam.title, configuration.format),
    record,
  }
}

export function plansOf(prepared: PreparedExport): LayoutPlan[] {
  return prepared.documents
}
