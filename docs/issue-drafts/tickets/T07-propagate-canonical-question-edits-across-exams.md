# T07: Propagate canonical Question edits across live Exams

## What to build

Make live Question references observable and safe across multiple Exams. Editing one canonical Question updates every saved Exam and Working Copy that references it without manufacturing Exam edits, while Exam-specific presentation survives compatible changes and resets predictably when the choice set changes.

## Acceptance criteria

- [ ] Opening a Question from an Exam uses the same canonical editor as its owning Question Bank and identifies the owning bank without changing the active bank tab.
- [ ] The full Question editor shows Used in N Exams and can list each Exam using the Question, including whether usage is in saved state, Working Copy, or both.
- [ ] Compact rows in the editor's Question Bank pane do not show global Exam usage.
- [ ] Saving Question Content or Metadata commits the canonical record once and updates every visible and persisted Exam projection after commit.
- [ ] Referencing Exams do not become unsaved, move in Recent Exams, update last-opened metadata, or receive Exam Undo entries because a canonical Question changed.
- [ ] A referencing Exam with unrelated Working Copy changes retains those changes while resolving the edited Question.
- [ ] Wording, formatting, correctness, and answer wording edits preserve each Exam's answer order when the complete stable choice-ID set remains unchanged.
- [ ] Adding or removing choice IDs clears that Question's answer arrangement from every saved Exam and Working Copy, causing complete authored order to apply without dirtying those Exams.
- [ ] Question Type cannot be changed after creation.
- [ ] Editing through the Exam updates the owning Question Bank's last-updated time and position in Recently Updated Question Banks.
- [ ] Persistence failure leaves the canonical Question and every Exam unchanged and keeps the Question editor available for correction or retry.
- [ ] Application-boundary, IndexedDB, and browser tests cover one Question used by several clean and dirty Exams, stable and changed choice sets, timestamp behavior, and failure atomicity.

## Blocked by

- T06 — Compose one Exam from Questions across open banks.
