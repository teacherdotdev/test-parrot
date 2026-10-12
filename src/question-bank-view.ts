// Browsing the Question Bank.
//
// The Question Bank stores questions in the order they were authored. A teacher
// browsing it starts with the opposite — the question just written, first —
// and may sort or narrow it by wording, Question Type, Difficulty and Topic.
// All of that is a *view*: it derives what to show from the bank and its view
// settings, and changes nothing. Search, filter and sort values never enter the
// authoring history. The editor workspace may persist them independently.

import {
  topicsOf,
  type Difficulty,
  type Question,
  type QuestionType,
} from './exam'
import type { QuestionBank } from './question-bank'
import { searchableText } from './stem-preview'

/** A Difficulty filter value. `'unspecified'` is the questions nobody has
 *  classified: optional Difficulty must never make a question unreachable. */
export type DifficultyFilter = Difficulty | 'unspecified'

/** The ordering applied after search and filters have chosen the visible rows. */
export type QuestionBankSort = 'newest' | 'oldest' | 'type' | 'difficulty' | 'topic'

/**
 * What the teacher has narrowed the Question Bank to.
 *
 * An empty list is no constraint at all rather than a constraint nothing
 * satisfies. Values within one category are alternatives (OR); the categories
 * and the search narrow each other (AND).
 */
export type QuestionBankFilter = {
  search: string
  types: readonly QuestionType[]
  difficulties: readonly DifficultyFilter[]
  /** Exact, trimmed Topic strings — the ones `topicOptions` offered. */
  topics: readonly string[]
  sort: QuestionBankSort
}

/** The unfiltered bank: every question, newest first. */
export const NO_FILTER: QuestionBankFilter = {
  search: '',
  types: [],
  difficulties: [],
  topics: [],
  sort: 'newest',
}

/** Whether anything is currently narrowing the bank — what tells "no questions
 *  match" from "no questions yet", and what a Clear control is offered for. */
export function isFilterActive(filter: QuestionBankFilter): boolean {
  return (
    filter.search.trim() !== ''
    || filter.types.length > 0
    || filter.difficulties.length > 0
    || filter.topics.length > 0
  )
}

/** The exact trimmed Topics the Question Bank currently holds, each once, for
 *  the Topic dropdown. Two spellings of one subject are two Topics: nothing
 *  here folds case or otherwise decides they are the same. */
export function topicOptions(bank: QuestionBank): string[] {
  const topics = new Set<string>()
  for (const question of bank.questions) {
    for (const topic of topicsOf(question)) {
      const trimmed = topic.trim()
      if (trimmed !== '') topics.add(trimmed)
    }
  }
  return [...topics].sort((one, other) => one.localeCompare(other))
}

function matchesSearch(question: Question, search: string): boolean {
  const wanted = search.trim().toLowerCase()
  if (wanted === '') return true
  // The projection the row showed, so what can be found is what was on screen —
  // and, for a Multipart question, the stems of the Parts the row counts: answer choices,
  // correctness and everything else behind the popup are out of reach of search
  // by construction rather than by a second rule.
  return searchableText(question).toLowerCase().includes(wanted)
}

function matchesDifficulty(
  question: Question,
  difficulties: readonly DifficultyFilter[],
): boolean {
  if (difficulties.length === 0) return true
  return difficulties.includes(question.difficulty ?? 'unspecified')
}

function matchesTopics(question: Question, topics: readonly string[]): boolean {
  if (topics.length === 0) return true
  const questionTopics = topicsOf(question).map((topic) => topic.trim())
  return topics.some((topic) => questionTopics.includes(topic))
}

function matches(question: Question, filter: QuestionBankFilter): boolean {
  return (
    matchesSearch(question, filter.search)
    && (filter.types.length === 0 || filter.types.includes(question.type))
    && matchesDifficulty(question, filter.difficulties)
    && matchesTopics(question, filter.topics)
  )
}

const TYPE_RANK: Record<QuestionType, number> = {
  'multiple-choice': 0,
  'true-false': 1,
  matching: 2,
  'fill-in-the-blank': 3,
  open: 4,
  multipart: 5,
}

const DIFFICULTY_RANK: Record<DifficultyFilter, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
  unspecified: 3,
}

function firstTopic(question: Question): string | null {
  const topics = topicsOf(question)
    .map((topic) => topic.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
  return topics[0] ?? null
}

/**
 * The Question Bank as the pane shows it: narrowed by the filters, then ordered
 * by the selected field. Equal values retain newest-first order, so sorting
 * never makes rows within one group jump back to authoring order.
 */
export function browseQuestionBank(
  bank: QuestionBank,
  filter: QuestionBankFilter,
): Question[] {
  const shown: Question[] = []
  for (let index = bank.questions.length - 1; index >= 0; index -= 1) {
    const question = bank.questions[index]!
    if (matches(question, filter)) shown.push(question)
  }

  switch (filter.sort ?? 'newest') {
    case 'type':
      return shown.sort((left, right) => TYPE_RANK[left.type] - TYPE_RANK[right.type])
    case 'difficulty':
      return shown.sort((left, right) =>
        DIFFICULTY_RANK[left.difficulty ?? 'unspecified']
        - DIFFICULTY_RANK[right.difficulty ?? 'unspecified'],
      )
    case 'topic':
      return shown.sort((left, right) => {
        const leftTopic = firstTopic(left)
        const rightTopic = firstTopic(right)
        if (leftTopic === null) return rightTopic === null ? 0 : 1
        if (rightTopic === null) return -1
        return leftTopic.localeCompare(rightTopic)
      })
    case 'newest':
      return shown
    case 'oldest':
      return shown.reverse()
  }
}
