// The values a Question Bank's filters offer, wherever a bank is filtered:
// the pane beside an Exam, the Question Bank page and the Pop-over.

import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  SECTION_LABELS,
  SECTION_ORDER,
  type QuestionType,
} from './exam'
import type { DifficultyFilter, QuestionBankSort } from './question-bank-view'

export type FilterOption<T extends string> = { value: T; label: string }

// The fixed Question Sections, in the order the exam prints them.
export const TYPE_OPTIONS: FilterOption<QuestionType>[] = SECTION_ORDER.map((type) => ({
  value: type,
  label: SECTION_LABELS[type],
}))

export const DIFFICULTY_OPTIONS: FilterOption<DifficultyFilter>[] = [
  ...DIFFICULTIES.map((value) => ({ value, label: DIFFICULTY_LABELS[value] })),
  // Optional classification must never put a question out of reach.
  { value: 'unspecified', label: 'Unspecified' },
]

export const SORT_OPTIONS: readonly FilterOption<QuestionBankSort>[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'type', label: 'Question Type' },
  { value: 'difficulty', label: 'Difficulty' },
  { value: 'topic', label: 'Topic' },
]
