// The coloured marks a question's classification wears: its Difficulty and its
// Topics. One module, because the popup that sets them and the Question Bank
// row that shows them must agree — a Topic that is one colour in the front
// matter and another in the bank would read as two Topics.

import { SignalHigh, SignalLow, SignalMedium, Tag } from 'lucide-react'
import { DIFFICULTY_LABELS, type Difficulty } from './exam'
import type { ReactNode } from 'react'
import { topicTint } from './topic-tint'

/** Difficulty is ordered, so it is drawn as a rising signal rather than three
 *  unrelated pictures: the mark says which of the three it is even where the
 *  colour cannot. */
const DIFFICULTY_ICONS: Record<Difficulty, ReactNode> = {
  easy: <SignalLow />,
  medium: <SignalMedium />,
  hard: <SignalHigh />,
}

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className="badge badge-difficulty" data-difficulty={difficulty}>
      {DIFFICULTY_ICONS[difficulty]}
      {DIFFICULTY_LABELS[difficulty]}
    </span>
  )
}

/** A topic's tag icon alone, in the topic's own colours — for a list that
 *  names the topic in plain text beside it. */
export function TopicSwatch({ topic }: { topic: string }) {
  return (
    <span className="topic-swatch" data-tint={topicTint(topic)} aria-hidden="true">
      <Tag />
    </span>
  )
}

export function TopicBadge({ topic }: { topic: string }) {
  return (
    <span className="badge badge-topic" data-tint={topicTint(topic)}>
      {topic}
    </span>
  )
}
