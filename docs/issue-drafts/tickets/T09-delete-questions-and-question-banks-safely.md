# T09: Permanently delete Questions and Question Banks safely

## What to build

Add explicit, irreversible resource deletion with complete impact disclosure. A Question or Question Bank can be permanently removed from current authoring state, including every saved Exam and Working Copy that uses it, while immutable Export Records remain exact and unaffected.

## Acceptance criteria

- [ ] Permanent Question deletion is available from the full Question editor and is absent from compact editor-bank rows.
- [ ] An unused Question receives a lightweight irreversible confirmation.
- [ ] A used Question confirmation identifies every affected Exam before offering Delete and remove from N Exams.
- [ ] Confirmed Question deletion atomically removes the Question from its bank, every affected saved Exam, and every affected Working Copy while preserving unrelated Working Copy changes.
- [ ] Forced removal does not become an unsaved Exam edit and cannot be reversed through Discard or Exam Undo.
- [ ] Successful deletion closes the deleted Question's editor, clears selections and drag state, and clears affected Undo/Redo histories only after commit.
- [ ] Failed deletion changes no canonical, saved, working, or visible state.
- [ ] Question Bank deletion is available from Home and All Question Banks and is absent from the editor pane.
- [ ] A populated-bank confirmation shows the bank name, Question count, affected Exam count, per-Exam Question losses, and that Export History remains unchanged.
- [ ] Confirmed bank deletion atomically deletes every owned Question, removes those Questions from every saved Exam and Working Copy, closes related tabs/editors, and removes the bank from resource collections.
- [ ] Empty bank deletion uses a lighter but still irreversible confirmation.
- [ ] A named bank remains after its final Question is individually deleted; only a pristine empty Untitled Question Bank is automatically cleaned up.
- [ ] Exams remain even if deletion empties them, unless they independently satisfy the pristine Untitled Exam cleanup predicate.
- [ ] A bank-only workspace falls back to another open bank or the no-bank state after its active bank is deleted and never creates an Exam.
- [ ] All existing Export Records remain viewable and re-exportable with their historical Questions and media.
- [ ] Store, real IndexedDB, browser, accessibility, cancellation, and transaction-abort tests cover unused, shared, mixed saved/Working Copy, empty-bank, populated-bank, and historical-output cases.

## Blocked by

- T07 — Propagate canonical Question edits across live Exams.
- T08 — Complete Home and searchable resource collections.
