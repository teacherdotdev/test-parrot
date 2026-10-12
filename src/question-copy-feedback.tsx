// The Copy action beside Edit, and what it says once it has run: a tick for
// a moment, or why it did not. The Question Bank Pop-over's cards say the
// same through `useQuestionCopy`.

import { CircleAlert, Copy, Check } from 'lucide-react'
import type { Question } from './exam'
import { COPY_FAILED_MESSAGE, type CopyState } from './use-question-copy'

/** The Copy action beside Edit. */
export function CopyQuestionButton({
  question,
  name,
  state,
  onCopy,
  className,
}: {
  question: Question
  name: string
  state: CopyState
  onCopy: (question: Question, view: Window) => void
  className: string
}) {
  const label = state === 'copied' ? 'Copied' : state === 'failed' ? COPY_FAILED_MESSAGE : `Copy ${name}`
  return <button
    type="button"
    className={className}
    aria-label={label}
    title={state === 'idle' ? 'Copy' : label}
    data-copy-state={state === 'idle' ? undefined : state}
    onClick={(event) => {
      event.stopPropagation()
      onCopy(question, event.currentTarget.ownerDocument.defaultView ?? window)
    }}
  >
    {state === 'copied' ? <Check aria-hidden="true" /> : state === 'failed' ? <CircleAlert aria-hidden="true" /> : <Copy aria-hidden="true" />}
    <span className="sr-only" role="status">{state === 'idle' ? '' : label}</span>
  </button>
}
