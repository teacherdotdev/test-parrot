// What each Question Section prints above its questions, and how large.
//
// Every section has a default heading and a default line of directions — what a
// school test usually says. An Exam may reword either for any of its sections,
// or clear one so it is not printed at all, and may print every section heading
// at one of three sizes. That wording and size are this Exam's presentation,
// like its work space: the same Question Section on another Exam still says what
// it said before (ADR-0025).
//
// Only departures from the default are stored. A section nobody has reworded
// has no entry, a part of it nobody has reworded has no key, and a part set
// back to its default loses its key again — so an Exam that has never been
// touched stores nothing, and a default that is later improved reaches every
// Exam that never changed it.

import type { QuestionType } from './exam'

// The section headings and directions a school test carries. The `'open'`
// question type prints under "Short Answer".
export const SECTION_TITLE: Record<QuestionType, string> = {
  'multiple-choice': 'Multiple Choice',
  'true-false': 'True/False',
  matching: 'Matching',
  'fill-in-the-blank': 'Fill in the Blank',
  open: 'Short Answer',
  multipart: 'Multipart',
}

export const SECTION_INSTRUCTIONS: Record<QuestionType, string> = {
  'multiple-choice':
    'Identify the choice that best completes the statement or answers the question.',
  'true-false':
    'Circle T if the statement is true and F if it is false.',
  matching:
    'Match each item with the correct answer from the word bank. Write its letter in the blank.',
  'fill-in-the-blank': 'Complete each sentence by writing the missing word or words on each line.',
  open: 'Answer the following questions in the space provided. Show all work.',
  multipart: 'Answer every part of each question.',
}

/** An Exam's own wording for one section. An absent key is the default; an
 *  empty string is a part the teacher cleared, which prints nothing. */
export type SectionHeadingText = { title?: string; instructions?: string }

/** Every section an Exam has reworded, by Question Type. */
export type SectionHeadings = Partial<Record<QuestionType, SectionHeadingText>>

/** How large every section heading, and its directions, print on one Exam. */
export type HeadingSize = 'small' | 'normal' | 'large'

export const HEADING_SIZES: readonly HeadingSize[] = ['small', 'normal', 'large']

/** Today's size, and the size of an Exam that has never chosen one. */
export const DEFAULT_HEADING_SIZE: HeadingSize = 'normal'

export const HEADING_SIZE_LABELS: Record<HeadingSize, string> = {
  small: 'Small',
  normal: 'Normal',
  large: 'Large',
}

/** One section's heading as it prints on this Exam. */
export type ResolvedSectionHeading = {
  title: string
  instructions: string
  /** Whether either part differs from the default — what offers a reset. */
  edited: boolean
}

/** The one reader: the Exam's wording where it has some, the default elsewhere. */
export function sectionHeadingOf(
  headings: SectionHeadings | undefined,
  section: QuestionType,
): ResolvedSectionHeading {
  const own = headings?.[section]
  return {
    title: own?.title ?? SECTION_TITLE[section],
    instructions: own?.instructions ?? SECTION_INSTRUCTIONS[section],
    edited: own?.title !== undefined || own?.instructions !== undefined,
  }
}

/** A rewording of one section. `null` sets a part back to its default; an
 *  absent key leaves it as it is. */
export type SectionHeadingChange = {
  title?: string | null
  instructions?: string | null
}

/**
 * `headings` with one section reworded, kept to its departures from the
 * default: a part equal to its default is dropped, a section with no parts left
 * is dropped, and an Exam with no sections left stores nothing (`undefined`).
 */
export function withSectionHeading(
  headings: SectionHeadings | undefined,
  section: QuestionType,
  change: SectionHeadingChange,
): SectionHeadings | undefined {
  const current = headings?.[section] ?? {}
  const part = (
    key: keyof SectionHeadingText,
    fallback: string,
  ): string | undefined => {
    const next = key in change ? change[key] : current[key]
    return next === null || next === undefined || next === fallback ? undefined : next
  }
  const title = part('title', SECTION_TITLE[section])
  const instructions = part('instructions', SECTION_INSTRUCTIONS[section])
  const next: SectionHeadings = { ...headings }
  if (title === undefined && instructions === undefined) {
    delete next[section]
  } else {
    next[section] = {
      ...(title !== undefined ? { title } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
    }
  }
  return Object.keys(next).length > 0 ? next : undefined
}

const SECTIONS = new Set<string>(Object.keys(SECTION_TITLE))

/** Whether a stored value is section wording this build can print. The single
 *  guard, so storage and import agree on what a readable record is. */
export function isSectionHeadings(value: unknown): value is SectionHeadings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value).every(([section, text]) => {
    if (!SECTIONS.has(section)) return false
    if (typeof text !== 'object' || text === null || Array.isArray(text)) return false
    const { title, instructions, ...rest } = text as Record<string, unknown>
    return (
      Object.keys(rest).length === 0
      && (title === undefined || typeof title === 'string')
      && (instructions === undefined || typeof instructions === 'string')
    )
  })
}

export function isHeadingSize(value: unknown): value is HeadingSize {
  return HEADING_SIZES.includes(value as HeadingSize)
}

/** How large an Exam's questions and answers print — everything a page packs
 *  but its headings. The same three steps as the headings, chosen apart from
 *  them; `'normal'` is today's type. */
export type TextSize = HeadingSize

export const TEXT_SIZES: readonly TextSize[] = HEADING_SIZES

export const DEFAULT_TEXT_SIZE: TextSize = 'normal'

export const isTextSize: (value: unknown) => value is TextSize = isHeadingSize

/** Whether two Exams word every section alike. Absent and empty agree. */
export function sameSectionHeadings(
  left: SectionHeadings | undefined,
  right: SectionHeadings | undefined,
): boolean {
  const sections = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])
  for (const section of sections as Set<QuestionType>) {
    const first = left?.[section]
    const second = right?.[section]
    if (first?.title !== second?.title || first?.instructions !== second?.instructions) {
      return false
    }
  }
  return true
}
