import {
  RECORD_TYPE_ORDER,
  type QuestionBankRecord,
  type QuestionBankRecordQuestion,
  type QuestionBankRecordQuestionType,
} from './question-bank-export'

/**
 * How a Question Bank File lays out its bank: one section per Question Type,
 * in Test Parrot's Section order, and within each a group per Topic, so the
 * front matter can link every type and every Topic to where it starts.
 *
 * A Question with several Topics is placed once, under its first, and still
 * shows all of them; one with none goes in a last group of its own. Every
 * Question therefore appears exactly once, and the counts add up.
 */

export type OutlineQuestion = {
  question: QuestionBankRecordQuestion
  /** Its number in the file, counting down the whole preview from 1. */
  number: number
}

export type OutlineTopicGroup = {
  /** The Topic, or null for the Questions that have none. */
  topic: string | null
  questions: OutlineQuestion[]
}

export type OutlineSection = {
  type: QuestionBankRecordQuestionType
  count: number
  groups: OutlineTopicGroup[]
}

export type QuestionBankFileOutline = {
  sections: OutlineSection[]
  difficulties: { easy: number; medium: number; hard: number; unrated: number }
}

export function questionBankFileOutline(record: Pick<QuestionBankRecord, 'bank'>): QuestionBankFileOutline {
  const difficulties = { easy: 0, medium: 0, hard: 0, unrated: 0 }
  for (const question of record.bank.questions) {
    difficulties[question.difficulty ?? 'unrated'] += 1
  }
  let number = 0
  const sections = RECORD_TYPE_ORDER.flatMap((type): OutlineSection[] => {
    const questions = record.bank.questions.filter((question) => question.type === type)
    if (questions.length === 0) return []
    const byTopic = new Map<string | null, QuestionBankRecordQuestion[]>()
    for (const question of questions) {
      const topic = question.topics?.[0] ?? null
      byTopic.set(topic, [...(byTopic.get(topic) ?? []), question])
    }
    const topics = [...byTopic.keys()]
      .filter((topic): topic is string => topic !== null)
      .sort((left, right) => left.localeCompare(right))
    const order: (string | null)[] = byTopic.has(null) ? [...topics, null] : topics
    const groups = order.map((topic) => ({
      topic,
      questions: byTopic.get(topic)!.map((question) => ({ question, number: (number += 1) })),
    }))
    return [{ type, count: questions.length, groups }]
  })
  return { sections, difficulties }
}

/** Where an outline entry lands, for a link or a bookmark to point at. */
export function sectionKey(type: QuestionBankRecordQuestionType): string {
  return `type:${type}`
}

export function topicKey(type: QuestionBankRecordQuestionType, topic: string | null): string {
  return `topic:${type}:${topic ?? ''}`
}

export const NO_TOPIC_LABEL = 'No topic'

/** Where a Question Bank File's notice points: Test Parrot's Import dialog. */
export const IMPORT_URL = 'https://testparrot.com/imports/new'
