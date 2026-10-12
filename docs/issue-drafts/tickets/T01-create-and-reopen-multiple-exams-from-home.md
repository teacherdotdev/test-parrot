# T01: Create and reopen multiple Exams from Home

## What to build

Introduce the first complete multi-Exam path in the fresh storage generation. Home starts empty, creates a normal blank **Untitled Exam**, lists recent Exams, and opens an Exam in the shared editor through a one-time launch parameter. The editor consumes that intent, persists its active workspace, and reloads the same Exam from IndexedDB. This ticket establishes stable Exam identities and the new screen/navigation shell without yet adding the full saved-versus-Working-Copy workflow.

## Acceptance criteria

- [ ] First use shows Home with an empty Recent Exams section and a visible New Exam action; loading Home alone creates no Exam.
- [ ] New Exam creates a stable Exam UUID with a blank persisted state and the name Untitled Exam, then opens the shared editor.
- [ ] Home lists Exams as cards with name, Question count, last-opened time, and a first-page or empty-page preview.
- [ ] Opening an Exam from Home uses one-time `exam` launch intent, consumes it, and leaves the browser on the shared editor route.
- [ ] Bare editor reload restores the active Exam from IndexedDB without flashing or creating a replacement Exam.
- [ ] Returning Home and reopening another Exam switches identities without overwriting the first Exam.
- [ ] Recent Exams are ordered by last opened; background state changes do not affect that order.
- [ ] A pristine empty Untitled Exam with no Export Records is removed when abandoned and by startup cleanup, while a renamed or otherwise changed empty Exam is retained.
- [ ] Unknown or stale Exam launch intent reports that the Exam is unavailable on this device and restores the last valid workspace instead of creating a new Exam.
- [ ] Home, Editor, About, and Privacy navigation works with browser Back at the screen level rather than replaying internal editor choices.
- [ ] Store, IndexedDB, and browser tests cover independent Exam identity, creation, reopening, recency, placeholder cleanup, missing launch intent, and reload restoration.

## Blocked by

- None (can start immediately).
