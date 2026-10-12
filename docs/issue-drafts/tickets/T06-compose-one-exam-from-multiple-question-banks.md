# T06: Compose one Exam from Questions across open banks

## What to build

Complete the many-to-many editing workflow. Teachers can add Questions from any open Question Bank to one Exam, create an Untitled Exam through the first composition gesture from bank-only mode, and use the retained manual composition actions with Exam-owned answer and column arrangement.

## Acceptance criteria

- [ ] Adding or dragging the first Question in bank-only mode atomically creates a blank-saved Untitled Exam and a Working Copy containing that Question.
- [ ] The first composition action associates the currently visible bank tabs with the new Exam workspace and shows Unsaved changes.
- [ ] Opening an Exam inside the editor keeps the currently visible bank tabs and makes them that Exam's remembered workspace; opening an Exam outside the editor restores its remembered tabs.
- [ ] An Exam may reference Questions from any number of banks, and a bank may contribute to any number of Exams; usage is derived from saved state and Working Copies rather than a second attachment list.
- [ ] The same Question ID appears at most once in one Exam, while Duplicate creates a new canonical Question in the original bank and inserts it after the original.
- [ ] Add/insert, manual Replace, Remove, same-section reorder, Duplicate, question shuffle, answer shuffle, and bulk column formatting remain complete Working Copy actions.
- [ ] Creating a Question directly from the Exam is unavailable; Questions are created in the active bank and added separately.
- [ ] Automatic Replace with Equivalent Questions is unavailable.
- [ ] Manual Replace accepts any unused Question in the same Question Section, preserves the outgoing position and column layout, and takes the incoming Question's authored answer order.
- [ ] Inserted Multiple Choice Questions inherit the visual neighbor's column layout: immediately above, or immediately below when first; an empty section starts at one column.
- [ ] Available column settings are exactly one, two, and four. Auto is unavailable.
- [ ] Remove clears that reference's answer order and column layout; re-adding follows normal insertion defaults.
- [ ] Duplicate initially preserves the visible answer order and column layout with fresh Question and choice identities.
- [ ] Each complete semantic command is one Undo step scoped to the active Exam.
- [ ] Store and browser tests cover cross-bank composition, first-drop creation, all input methods, section rules, presentation inheritance, no duplicate identity, and Undo/Redo.

## Blocked by

- T02 — Save, discard, and recover each Exam Working Copy.
- T05 — Browse Question Banks as restorable editor tabs.
