# T05: Browse Question Banks as restorable editor tabs

## What to build

Turn the editor's left pane into a tabbed Question Bank workspace. A teacher can launch directly into one bank, open and close additional banks, search and filter each tab independently, refresh without losing context, and browse with no active Exam. These tabs remain workspace state rather than Exam content.

## Acceptance criteria

- [ ] Launching a bank from outside the editor uses one-time bank intent, enters bank-only mode with that bank active, consumes the intent, and leaves the shared editor route.
- [ ] Bank-only mode shows no Exam document and offers an empty composition target plus actions to open an existing Exam or create a new Exam.
- [ ] Browsing, searching, filtering, creating, or editing bank content in bank-only mode does not create an Exam.
- [ ] An Open Question Bank picker inside the editor adds or focuses a bank tab without returning Home.
- [ ] One bank's rows are visible at a time; multi-pane bank display is not introduced.
- [ ] Each tab remembers independent stem search, Difficulty filters, and Topic filters.
- [ ] Closing a tab changes only workspace state and never removes Questions from an Exam or changes inferred bank usage.
- [ ] Workspace state is persisted separately from Exam state in IndexedDB and includes open bank IDs, active bank, per-tab filters, and pane state.
- [ ] Tab and filter changes never create unsaved Exam changes, enter Exam Undo, or alter Export.
- [ ] Bare editor refresh restores the last bank-only or Exam workspace from IndexedDB.
- [ ] Opening a missing bank reports that it is unavailable on this device and restores the last valid workspace.
- [ ] Dragging Questions between bank tabs is unavailable.
- [ ] Browser tests cover launch consumption, keyboard tab navigation, independent filters, refresh, focus, no-Exam behavior, and absence of authoring side effects.

## Blocked by

- T04 — Create and manage multiple reusable Question Banks.
