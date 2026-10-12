// The Question Bank page's left panel: the bank, outlined.
//
// Two ways into the same Questions. The Outline counts them by Question Type;
// the Topics list every tag the bank uses. Choosing a type or a topic narrows
// the cards beside it through the same filter the search and the Difficulty
// list write, so there is one idea of "what is showing" and it survives a
// reload.
//
// A bank has no order, so nothing here is numbered, and counts are always the
// whole bank's — the outline describes the bank, not the current filter.

import type { ComponentType } from 'react'
import { AlignLeft, BookOpenText, Library, Link2, ListChecks, TextCursorInput, ToggleLeft } from 'lucide-react'
import { TopicSwatch } from './badges'
import { SECTION_LABELS, SECTION_ORDER, topicsOf, type Question, type QuestionType } from './exam'
import { topicOptions, type QuestionBankFilter } from './question-bank-view'

const TYPE_ICONS: Record<QuestionType, ComponentType<{ 'aria-hidden'?: boolean }>> = {
  'multiple-choice': ListChecks,
  'true-false': ToggleLeft,
  matching: Link2,
  'fill-in-the-blank': TextCursorInput,
  open: AlignLeft,
  multipart: BookOpenText,
}

export function QuestionBankOutline({
  questions,
  filter,
  onFilterChange,
}: {
  /** The whole bank. */
  questions: readonly Question[]
  filter: QuestionBankFilter
  onFilterChange: (filter: QuestionBankFilter) => void
}) {
  const topics = topicOptions({ questions: [...questions] })
  // Choosing in the outline is choosing one way in: a type or a topic, not a
  // combination of both. Search, Difficulty and sort are left as they are.
  const scope = (next: Partial<Pick<QuestionBankFilter, 'types' | 'topics'>>) =>
    onFilterChange({ ...filter, types: [], topics: [], ...next })
  const everything = filter.types.length === 0 && filter.topics.length === 0
  const onlyType = filter.topics.length === 0 && filter.types.length === 1 ? filter.types[0] : null
  const onlyTopic = filter.types.length === 0 && filter.topics.length === 1 ? filter.topics[0] : null

  return <nav className="bank-outline" aria-label="Question Bank outline">
    <section>
      <h3>Outline</h3>
      <button
        type="button"
        className="bank-outline-row"
        aria-pressed={everything}
        onClick={() => scope({})}
      >
        <Library aria-hidden />
        <span>All questions</span>
        <small>{questions.length}</small>
      </button>
      {SECTION_ORDER.map((type) => {
        const count = questions.filter((question) => question.type === type).length
        if (count === 0) return null
        const Icon = TYPE_ICONS[type]
        return <button
          type="button"
          className="bank-outline-row"
          key={type}
          aria-pressed={onlyType === type}
          onClick={() => scope(onlyType === type ? {} : { types: [type] })}
        >
          <Icon aria-hidden />
          <span>{SECTION_LABELS[type]}</span>
          <small>{count}</small>
        </button>
      })}
    </section>
    <section>
      <h3>Topics</h3>
      {topics.length === 0
        ? <p className="bank-outline-empty">No topics yet. Topics added to a Question are listed here.</p>
        : topics.map((topic) => (
          <button
            type="button"
            className="bank-outline-row"
            key={topic}
            aria-pressed={onlyTopic === topic}
            onClick={() => scope(onlyTopic === topic ? {} : { topics: [topic] })}
          >
            {/* The icon wears the topic's colour, so it matches the tag on
                every Question that carries it. */}
            <TopicSwatch topic={topic} />
            <span>{topic}</span>
            <small>{questions.filter((question) => topicsOf(question).includes(topic)).length}</small>
          </button>
        ))}
    </section>
  </nav>
}
