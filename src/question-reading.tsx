// A Question, read in full.
//
// The one place a bank's Question is drawn whole rather than as a row: its
// type and classification, the stem, the answers with the correct one
// marked, a matching set's items and Word Bank, a Short Answer's suggested
// answer, and a Multipart question's lettered Parts. The import dialog reads a file's banks this way before anything is
// imported, and the Question Bank page reads its own bank this way, so a bank
// looks the same on the way in as it does once it is here.
//
// It draws what it is handed and nothing else. Each caller turns its own
// Question shape — a record Question from a file, or an editor Question —
// into a `QuestionReadingContent`; the document fragments are already editor
// nodes by the time they arrive.

import { Check, Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { DifficultyBadge, TopicBadge } from './badges'
import { DocView } from './doc-view'
import type { QuestionReadingContent, QuestionReadingPart } from './question-reading-content'

/** A Locked Answer's mark: it keeps its letter when answers are shuffled. */
function LockMark() {
  return <Lock className="question-reading-locked" role="img" aria-label="Locked answer">
    <title>Locked: keeps its letter when answers are shuffled</title>
  </Lock>
}

/** A bank has no order, so its Questions carry no number. */
export function QuestionReading({
  content,
  aside,
}: {
  content: QuestionReadingContent
  /** Anything the surface adds to the head row — an "In exam" mark, an action. */
  aside?: ReactNode
}) {
  return <>
    <div className="question-reading-head">
      <span className="question-reading-type">{content.typeLabel}</span>
      {content.difficulty && <DifficultyBadge difficulty={content.difficulty} />}
      {content.topics.map((topic) => <TopicBadge key={topic} topic={topic} />)}
      {aside}
    </div>
    <DocView className="question-reading-stem" content={content.stem} />
    {content.choices && (
      <ol type="A" className="question-reading-choices">
        {content.choices.map((choice) => (
          <li key={choice.id} className={choice.correct ? 'is-correct' : undefined}>
            <DocView content={choice.content} />
            {choice.correct && (
              <Check className="question-reading-correct" role="img" aria-label="Correct answer" />
            )}
            {choice.locked && <LockMark />}
          </li>
        ))}
      </ol>
    )}
    {content.matching && (
      <div className="record-matching question-reading-matching">
        <ol className="record-matching-items">
          {content.matching.prompts.map((prompt) => (
            <li key={prompt.id}>
              <span
                className="record-matching-blank"
                aria-label={prompt.letter ? 'Matched answer' : 'Unmatched'}
              >
                {prompt.letter ?? '—'}
              </span>
              <DocView content={prompt.content} />
            </li>
          ))}
        </ol>
        <ol type="A" className="question-reading-choices">
          {content.matching.wordBank.map((answer) => (
            <li key={answer.id}>
              <DocView content={answer.content} />
            </li>
          ))}
        </ol>
      </div>
    )}
    {content.suggestedAnswer && (
      <section className="question-reading-answer">
        <h4>Suggested Answer</h4>
        <DocView content={content.suggestedAnswer} />
      </section>
    )}
    {content.blankAnswers && (
      <section className="question-reading-answer">
        <h4>Answers</h4>
        <DocView content={content.blankAnswers} />
      </section>
    )}
    {content.parts && (
      // The Multipart question is the stem above; its Parts follow, lettered as the
      // test prints them, each drawn the way a question of its kind is.
      <ol type="a" className="record-multipart-parts question-reading-parts">
        {content.parts.map((part) => <ReadingPart key={part.id} part={part} name={part.letter} />)}
      </ol>
    )}
  </>
}

// One Part, or one Subpart: its stem, then its answers — or, for a Part that
// holds Subparts, its lead-in and then its Subparts, numbered (i), (ii)…
// beneath it.
function ReadingPart({ part, name }: { part: QuestionReadingPart; name: string }) {
  return (
    <li aria-label={`Part ${name}, ${part.typeLabel}`}>
      <DocView className="question-reading-stem" content={part.stem} />
      {part.choices && (
        <ol type="A" className="question-reading-choices">
          {part.choices.map((choice) => (
            <li key={choice.id} className={choice.correct ? 'is-correct' : undefined}>
              <DocView content={choice.content} />
              {choice.correct && (
                <Check className="question-reading-correct" role="img" aria-label="Correct answer" />
              )}
              {choice.locked && <LockMark />}
            </li>
          ))}
        </ol>
      )}
      {part.suggestedAnswer && (
        <section className="question-reading-answer">
          <h4>Suggested Answer</h4>
          <DocView content={part.suggestedAnswer} />
        </section>
      )}
      {part.subparts && (
        <ol type="i" className="record-multipart-parts question-reading-parts">
          {part.subparts.map((subpart) => (
            <ReadingPart key={subpart.id} part={subpart} name={`${name} (${subpart.letter})`} />
          ))}
        </ol>
      )}
    </li>
  )
}
