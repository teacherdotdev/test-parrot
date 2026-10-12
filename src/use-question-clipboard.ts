// Cmd/Ctrl-C and Cmd/Ctrl-V for one selectable pane — a Question Bank or the
// exam sheet. Copy and paste go to the same pane Cmd-A does (`paneTakesKeys`),
// and stand aside whenever text is being typed or selected: there they are the
// browser's. What a copy holds and a paste means is `question-clipboard.ts`.

import { useEffect, useRef, type RefObject } from 'react'
import { copyMathMode } from './copy-settings'
import type { Question } from './exam'
import { copyBlocksOf, copyContentOf, prepareCopyMedia } from './question-copy'
import { questionIdsInClipboard, withQuestionMarker } from './question-clipboard'
import type { SelectAllPane } from './select-all'
import { paneTakesKeys } from './use-select-all'

/** Whether the page has text selected, which a copy should copy as text. */
function selectingText(): boolean {
  const selection = document.getSelection()
  return selection !== null && !selection.isCollapsed && selection.toString().trim() !== ''
}

export function useQuestionClipboard(
  pane: SelectAllPane,
  root: RefObject<HTMLElement | null>,
  /** The selected Questions, in the order they are shown. */
  selected: readonly Question[],
  /** The Questions a paste names, in the order they were copied. */
  onPaste: (questionIds: string[]) => void,
) {
  const latest = useRef({ selected, onPaste })
  useEffect(() => {
    latest.current = { selected, onPaste }
  })

  // A copy is written at once, in the copy event; its pictures and formulas
  // are made ahead of it, as soon as a Question is selected.
  const selectedKey = selected.map(({ id }) => id).join(',')
  useEffect(() => {
    const math = copyMathMode()
    for (const question of latest.current.selected) void prepareCopyMedia(copyBlocksOf(question), math)
  }, [selectedKey])

  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const { selected } = latest.current
      if (event.defaultPrevented || !event.clipboardData || selected.length === 0) return
      if (selectingText() || !paneTakesKeys(pane, root.current, event.target)) return
      const content = copyContentOf(selected.map((question) => ({ question })), copyMathMode())
      event.clipboardData.setData('text/html', withQuestionMarker(content.html, selected.map(({ id }) => id)))
      event.clipboardData.setData('text/plain', content.text)
      event.preventDefault()
    }
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData) return
      if (!paneTakesKeys(pane, root.current, event.target)) return
      const ids = questionIdsInClipboard(event.clipboardData.getData('text/html'))
      if (!ids) return
      event.preventDefault()
      latest.current.onPaste(ids)
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [pane, root])
}
