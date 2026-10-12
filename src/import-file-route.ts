import type { ImportProposal } from './package-import'
import { checkAgainstSourceDocument, pendingImagesOf, type SourceDocumentCheck } from './pending-images'
import { waitingImports, type WaitingImport } from './import-history'
import { inspectQuestionFile, inspectUploadedFile } from './question-bank-upload'
import { kindOfFile, startWaitingImport, unsupportedFileMessage } from './source-file'

/**
 * Where a file dropped to start an import goes. There is one way in, whatever
 * the file:
 *
 * - a question file from another tool — a Blackboard or Test Generator
 *   file, a QTI or Moodle export, a spreadsheet — is read as it is, with
 *   no AI, and so is a Word document written in one of those formats;
 * - a test — a PDF with no Test Parrot file in it, any other Word document,
 *   or a photo — starts a new import, which waits for the file its AI makes;
 * - the file an AI made (JSON) is the answer to the import in progress it
 *   matches, and continues that import;
 * - a Test Parrot file is imported as it is.
 *
 * AI-made JSON that matches no import in progress, and names pictures only a
 * test could supply, has nowhere to go: that is an error, with what to do.
 * One that names no pictures — made from a test given to the AI as text —
 * needs no test, and is imported as it is.
 */
export type ImportFileRoute =
  | { to: 'waiting'; waiting: WaitingImport }
  | { to: 'answer'; waitingImportId: string }
  | { to: 'import' }
  /** `aiMade` when the file is one an AI made and can make again. */
  | { to: 'error'; message: string; aiMade?: boolean }

export const NO_MATCHING_IMPORT_MESSAGE =
  'This file doesn’t match any test waiting in Imports. Drop the test it was made from first, then this file.'

/** What a teacher pastes back into the chat that made a file Test Parrot
 *  cannot import: the error, framed as a request the AI can act on without
 *  being told anything else. */
export function aiFixRequest(message: string): string {
  return `Test Parrot couldn’t import the file you made. It said:\n\n${message}\n\nPlease fix the file and give it back to me.`
}

/** The import in progress a file from an AI most clearly answers, if any. */
export async function bestWaitingImport(
  proposal: Pick<ImportProposal, 'banks'>,
): Promise<{ source: WaitingImport; check: SourceDocumentCheck } | null> {
  const candidates = (await waitingImports().catch(() => []))
    .map((source) => ({ source, check: checkAgainstSourceDocument(proposal, source) }))
    .filter(({ check }) => check.matches && check.stemsFound > 0)
    .sort((a, b) => b.check.stemsFound - a.check.stemsFound)
  return candidates[0] ?? null
}

const reasonOf = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback)

export async function routeImportFile(file: File): Promise<ImportFileRoute> {
  const kind = kindOfFile(file)
  if (kind === 'other') return { to: 'error', message: unsupportedFileMessage(file) }
  if (kind === 'questions') {
    try {
      await inspectQuestionFile(file)
      return { to: 'import' }
    } catch (reason) {
      return { to: 'error', message: reasonOf(reason, 'This file could not be read.') }
    }
  }
  if (kind === 'word') {
    // A Word document written in a question format needs no AI; any other
    // is a test to convert.
    try {
      await inspectQuestionFile(file)
      return { to: 'import' }
    } catch {
      // Converted below.
    }
  }
  if (kind === 'record') {
    let proposal: ImportProposal
    try {
      proposal = await inspectUploadedFile(file)
    } catch (reason) {
      return { to: 'error', message: reasonOf(reason, 'This file could not be read.'), aiMade: true }
    }
    const match = await bestWaitingImport(proposal)
    if (match) return { to: 'answer', waitingImportId: match.source.id }
    return pendingImagesOf(proposal).length > 0 ? { to: 'error', message: NO_MATCHING_IMPORT_MESSAGE } : { to: 'import' }
  }
  if (kind === 'pdf') {
    // A Question Bank File or an Exam PDF already is a Test Parrot file.
    try {
      await inspectUploadedFile(file)
      return { to: 'import' }
    } catch (reason) {
      const code = reason instanceof Error && 'code' in reason ? reason.code : null
      if (code !== 'missing-attachment') return { to: 'error', message: reasonOf(reason, 'This PDF could not be read.') }
    }
  }
  try {
    return { to: 'waiting', waiting: await startWaitingImport(file) }
  } catch (reason) {
    return { to: 'error', message: reasonOf(reason, 'This file could not be read.') }
  }
}
