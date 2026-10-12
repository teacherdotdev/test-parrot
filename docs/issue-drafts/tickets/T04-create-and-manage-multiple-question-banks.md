# T04: Create and manage multiple reusable Question Banks

## What to build

Introduce multiple independent Question Banks in the fresh generation. Teachers can create an Untitled Question Bank, create and edit canonical Questions within it, and return to distinct banks without an Exam. Confirmed bank changes persist immediately and bank update metadata reflects substantive content changes.

## Acceptance criteria

- [ ] First use shows an empty Question Bank area on Home and a New Question Bank action; loading Home alone creates no bank.
- [ ] New Question Bank creates a stable bank UUID named Untitled Question Bank and opens the shared editor in bank-only mode.
- [ ] Each Question has one stable identity and exactly one owning Question Bank.
- [ ] New Question is available only with an active bank and creates the Question in that bank without creating or modifying an Exam.
- [ ] Question Type is fixed at creation; Difficulty and Topics remain optional organization metadata.
- [ ] Question and bank rename changes commit directly to IndexedDB; there is no bank-level Working Copy or Save action.
- [ ] A confirmed Question save becomes visible only after durable commit. Failure leaves canonical and visible state unchanged and preserves the editor's inputs for retry.
- [ ] A pristine empty Untitled Question Bank is removed when abandoned, while a renamed or populated empty bank remains.
- [ ] Bank creation, rename, and Question creation, duplication, editing, or deletion update `lastUpdatedAt`; opening, searching, filtering, Exam composition, and export do not.
- [ ] Editing a canonical Question through any surface updates its owning bank's timestamp.
- [ ] Multiple banks and Questions survive refresh independently in IndexedDB.
- [ ] Unit, IndexedDB, and browser tests cover independent ownership, immediate persistence, failure behavior, placeholder cleanup, and update timestamps.

## Blocked by

- T01 — Create and reopen multiple Exams from Home.
