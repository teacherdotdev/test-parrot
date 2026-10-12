/** What deleting an Exam is about to do, said before it happens (ADR-0047):
 *  the Exam by name, and how many Export Records go with it. */
export type ExamDeletionSummary = {
  examId: string
  title: string
  exportCount: number
}

export function examDeletionMessage({ title, exportCount }: Pick<ExamDeletionSummary, 'title' | 'exportCount'>) {
  const exports = exportCount === 0
    ? ''
    : `This also deletes its ${exportCount} ${exportCount === 1 ? 'export' : 'exports'}. Files you’ve already downloaded aren’t affected. `
  return {
    title: `Delete “${title}”?`,
    body: `${exports}This can’t be undone.`,
  }
}
