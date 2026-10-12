import type { FormatId } from './types'

/**
 * What a teacher is told about the question formats Test Parrot reads, kept
 * apart from the parsers so a drop zone can name them without loading them.
 */

/** Each format as a teacher knows it. */
export const FORMAT_LABELS: Record<FormatId, string> = {
  'bb-generator': 'Blackboard Test Generator text',
  'bb-tsv': 'Blackboard upload file (tab-delimited)',
  'bb-package': 'Blackboard pool or test export',
  qti: 'QTI (Canvas, Brightspace, Blackboard and others)',
  'moodle-xml': 'Moodle XML',
  gift: 'Moodle GIFT',
  aiken: 'Aiken',
  respondus: 'Respondus text',
  text2qti: 'text2qti',
  'd2l-csv': 'Brightspace (D2L) question CSV',
  'respondus-csv': 'Respondus CSV',
  kahoot: 'Kahoot spreadsheet',
  spreadsheet: 'Spreadsheet (CSV or Excel)',
  flashcards: 'Flashcards (Quizlet or Anki)',
}

/** The tools whose files a drop zone names, grouped as teachers meet them. */
export const SUPPORTED_SOURCES: readonly string[] = [
  'Blackboard Test Generator',
  'Blackboard',
  'Canvas',
  'Brightspace (D2L)',
  'Moodle (XML, GIFT, Aiken)',
  'QTI',
  'Respondus',
  'text2qti',
  'Kahoot',
  'Quizlet and Anki',
  'CSV and Excel spreadsheets',
]

/** The file names a question file from another tool is saved under. */
export const QUESTION_FILE_EXTENSIONS = [
  '.txt', '.text', '.csv', '.tsv', '.tab', '.xml', '.zip', '.imscc', '.gift', '.qti', '.dat', '.xlsx', '.md', '.aiken',
] as const

export function isQuestionFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return QUESTION_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}
