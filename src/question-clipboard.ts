// Cmd/Ctrl-C and Cmd/Ctrl-V for Questions.
//
// A copy is a Copy (see CONTEXT.md): the selected Questions' student-facing
// content, ready for another document, and nothing changes. Beside that
// content it carries a marker naming the Questions, so a paste back into Test
// Parrot knows what they were: into a Question Bank, new Questions like them,
// as Duplicate makes; onto the exam sheet, the Questions themselves, added as
// a bank's Add would. The marker is an empty element another document drops,
// so a paste into Word or Google Docs is only the content.
//
// The marker names Questions by id, so a paste finds them in this browser's
// own storage; one copied on another device names Questions that are not here,
// and the paste reports that it found nothing to add.

const ATTRIBUTE = 'data-test-parrot-questions'

/** The marker's own record: which Questions a copy holds, in order. */
type QuestionClipboardRecord = { version: 1; questions: string[] }

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const unescapeAttribute = (value: string): string =>
  value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/** A copy's HTML with the marker naming its Questions placed first. */
export function withQuestionMarker(html: string, questionIds: readonly string[]): string {
  const record: QuestionClipboardRecord = { version: 1, questions: [...questionIds] }
  return `<span ${ATTRIBUTE}="${escapeAttribute(JSON.stringify(record))}"></span>${html}`
}

/** The Questions a pasted HTML names, in order, or `null` when it is not a
 *  copy of Questions — anything else pasted is left to whatever takes it. */
export function questionIdsInClipboard(html: string): string[] | null {
  const match = new RegExp(`${ATTRIBUTE}=(?:"([^"]*)"|'([^']*)')`).exec(html)
  if (!match) return null
  try {
    const record = JSON.parse(unescapeAttribute(match[1] ?? match[2] ?? '')) as Partial<QuestionClipboardRecord>
    if (record.version !== 1 || !Array.isArray(record.questions)) return null
    const ids = record.questions.filter((id): id is string => typeof id === 'string' && id !== '')
    return ids.length > 0 ? [...new Set(ids)] : null
  } catch {
    return null
  }
}

/** What a paste onto the exam sheet adds: the located Questions the Exam does
 *  not already hold, in the order they were copied — a Question occurs at
 *  most once in an Exam. */
export function questionsToAdd<T extends { id: string }>(
  located: readonly T[],
  alreadyOnExam: ReadonlySet<string>,
): T[] {
  return located.filter(({ id }) => !alreadyOnExam.has(id))
}

/** How a paste is described when it is done, for the status line. */
export function pastedSummary(added: number, skipped: number, copied: number): string {
  const questions = (count: number) => `${count} question${count === 1 ? '' : 's'}`
  if (copied === 0) return 'Nothing to paste: the copied questions aren’t in this browser.'
  if (added === 0) return skipped > 0 ? 'Those questions are already on this exam.' : 'Nothing to paste.'
  const missing = copied - added - skipped
  return [
    `Pasted ${questions(added)}`,
    skipped > 0 ? `${skipped} already on this exam` : '',
    missing > 0 ? `${missing} no longer in this browser` : '',
  ].filter(Boolean).join('; ') + '.'
}
