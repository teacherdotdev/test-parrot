// Copying a Question, and what the control that did it shows afterwards.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Question } from './exam'
import { copyMathMode } from './copy-settings'
import { copyQuestions } from './question-copy'

/** How long "Copied" stays before the control goes back to rest. */
export const COPY_FEEDBACK_MS = 1_500

export type CopyState = 'idle' | 'copied' | 'failed'

/** Copy one Question, and what to show about it afterwards. */
export function useQuestionCopy(): {
  state: (questionId: string) => CopyState
  copy: (question: Question, view?: Window) => void
} {
  const [outcome, setOutcome] = useState<{ id: string; state: CopyState } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copy = useCallback((question: Question, view?: Window) => {
    const settle = (state: CopyState) => {
      if (timer.current) clearTimeout(timer.current)
      setOutcome({ id: question.id, state })
      timer.current = setTimeout(() => setOutcome(null), COPY_FEEDBACK_MS * (state === 'failed' ? 2 : 1))
    }
    // Laid out as the Question itself is, with mathematics as the Copy
    // settings say.
    copyQuestions([{ question }], copyMathMode(), view).then(() => settle('copied'), () => settle('failed'))
  }, [])
  const state = useCallback(
    (questionId: string) => (outcome?.id === questionId ? outcome.state : 'idle'),
    [outcome],
  )
  return { state, copy }
}

export const COPY_FAILED_MESSAGE = 'Could not copy — this browser refused the clipboard.'
