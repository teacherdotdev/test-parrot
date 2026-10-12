// Cmd-A (Ctrl-A elsewhere): select every Question in one pane.
//
// The Exam editor shows two selectable panes side by side, each with its own
// selection, so one key press has to choose between them. The rule: the pane
// the teacher last pressed the pointer in or moved focus into. A press or
// focus anywhere else — the toolbar, the split handle — leaves that choice as
// it was. Until either pane has been touched, or once the touched pane has
// gone, it is the Exam draft: that is the document the editor is for.
//
// This file is the decision alone, kept free of the DOM so it can be tested;
// `use-select-all.ts` is the listener that feeds it.

export type SelectAllPane = 'question-bank' | 'exam-draft'

/** What a key press says, so this can be asked without a real `KeyboardEvent`. */
export type SelectAllKey = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Cmd-A or Ctrl-A, either accepted on any platform as the Pop-over does, and
 *  nothing with Shift or Option held, which name other commands. */
export function isSelectAllKey(event: SelectAllKey): boolean {
  return event.key.toLowerCase() === 'a'
    && (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
}

/** Which mounted pane Cmd-A selects in, if any. See the rule above. */
export function selectAllPane(
  mounted: readonly SelectAllPane[],
  lastTouched: SelectAllPane | null,
): SelectAllPane | null {
  if (lastTouched && mounted.includes(lastTouched)) return lastTouched
  if (mounted.includes('exam-draft')) return 'exam-draft'
  return mounted[0] ?? null
}

/** Every id once, in the order first shown. The draft can list a Question on
 *  both the test and the answer key. */
export function distinctIds(orderedIds: readonly string[]): string[] {
  return [...new Set(orderedIds)]
}
