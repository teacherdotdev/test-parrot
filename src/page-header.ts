// What a test page's header line says, beside the paper's ID.
//
// Every test page opens with one line of blanks for the student — Name, Class
// and Date on the first page, a Name blank alone on later ones — and the
// paper's ID against the right margin. An Exam may reword either line, as it
// rewords its section headings, typed where it prints; the ID is the one thing
// the header fills in for each paper, so it is never part of the text (ADR-0026).
//
// Only departures from the default are stored, exactly as `section-headings.ts`
// stores them: an Exam that has never touched its header stores nothing, and a
// line set back to its default loses its key again.

/** Which test pages a header line prints on. */
export type HeaderLine = 'first' | 'later'

export const HEADER_LINES: readonly HeaderLine[] = ['first', 'later']

// Underscores are the blanks, so the line is plain text — what is typed is
// exactly what prints, in every output. The default's fit on one line beside
// the ID at the sheet's type, with the name given the longest.
const blank = (length: number) => '_'.repeat(length)

export const DEFAULT_HEADER: Record<HeaderLine, string> = {
  first: `Name: ${blank(18)}  Class: ${blank(11)}  Date: ${blank(11)}`,
  later: `Name: ${blank(18)}`,
}

/** An Exam's own header lines. An absent key is the default; an empty string
 *  is a line the teacher cleared, which leaves the ID alone. */
export type ExamHeader = Partial<Record<HeaderLine, string>>

/** The one reader: the Exam's line where it has one, the default elsewhere. */
export function headerLineOf(header: ExamHeader | undefined, line: HeaderLine): string {
  return header?.[line] ?? DEFAULT_HEADER[line]
}

/** `header` with one line set, `null` meaning its default, kept to its
 *  departures: an Exam with no lines left stores nothing (`undefined`). */
export function withHeaderLine(
  header: ExamHeader | undefined,
  line: HeaderLine,
  text: string | null,
): ExamHeader | undefined {
  const next: ExamHeader = { ...header }
  if (text === null || text === DEFAULT_HEADER[line]) delete next[line]
  else next[line] = text
  return Object.keys(next).length > 0 ? next : undefined
}

/** Whether a stored value is a header this build can print — the single guard
 *  storage and import share. */
export function isExamHeader(value: unknown): value is ExamHeader {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([line, text]) => HEADER_LINES.includes(line as HeaderLine) && typeof text === 'string',
  )
}

/** Whether two Exams print the same header. Absent and empty agree. */
export function sameExamHeader(
  left: ExamHeader | undefined,
  right: ExamHeader | undefined,
): boolean {
  return HEADER_LINES.every((line) => left?.[line] === right?.[line])
}
