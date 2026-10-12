# T08: Complete Home and searchable resource collections

## What to build

Complete resource discovery around the new model. Home presents parallel preview rows for Recent Exams and Recently Updated Question Banks, while searchable full collection screens make every permanent resource reachable. Cards communicate the state needed to resume work and the reuse impact of shared banks.

## Acceptance criteria

- [ ] Home shows horizontally scrolling Recent Exams and Recently Updated Question Banks sections, each with New and View all actions.
- [ ] First use shows useful empty states and creates no resource merely by loading Home.
- [ ] Recent Exams are ordered only by last opened, not Save, export, live Question propagation, or cleanup.
- [ ] Exam cards show Working Copy first-page or empty-page preview, Exam name, opened time, Question count, and Unsaved changes when applicable.
- [ ] Recently Updated Question Banks are ordered by bank creation, rename, or Question creation, duplication, editing, or deletion.
- [ ] Question Bank cards show name, updated time, Question count, representative Topics, and Used in N Exams.
- [ ] Opening, searching, filtering, adding an existing Question to an Exam, Exam formatting, and export do not update bank recency.
- [ ] Editing a canonical Question through the Exam does update the owning bank's recency.
- [ ] View all Exams opens a searchable collection containing every Exam; search matches Exam names.
- [ ] View all Question Banks opens a searchable collection containing every bank; search matches bank names and Topic labels, not Question Content.
- [ ] A bank's usage view lists each current Exam once with saved/Working Copy usage and opens the chosen Exam through the ordinary external editor launch.
- [ ] Opening an Exam from Home or a collection restores its remembered bank tabs; opening a bank enters bank-only mode.
- [ ] Export Records are absent from Home and the full resource collections.
- [ ] Home explains browser-local storage and whether persistent storage was denied.
- [ ] Browser tests cover empty, populated, overflowing, searched, keyboard-operated, and screen-reader-visible collection states and verify ordering through meaningful user actions.

## Blocked by

- T03 — Move current work into a new Exam with Save As.
- T04 — Create and manage multiple reusable Question Banks.
- T07 — Propagate canonical Question edits across live Exams.
