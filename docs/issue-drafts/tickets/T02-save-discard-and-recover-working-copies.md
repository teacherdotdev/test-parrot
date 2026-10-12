# T02: Save, discard, and recover each Exam Working Copy

## What to build

Give every Exam an explicitly saved state and one continuously backed-up Working Copy. Editing affects the Working Copy, Save deliberately updates the Exam, Discard restores saved Exam composition, and switching or refreshing safely resumes pending work. The editor clearly distinguishes intentional Save from browser-local recovery.

## Acceptance criteria

- [ ] Every Exam has one saved state and one Working Copy containing its visible name, Question references, order, answer order, and column layout.
- [ ] Editing updates the Working Copy and mirrors it to IndexedDB without changing the explicitly saved Exam.
- [ ] The editor presents Saved, Unsaved changes · backed up locally, Backing up…, and Backup failed states accessibly.
- [ ] Save commits the exact latest in-memory Working Copy, supersedes older pending writes, and becomes unavailable when nothing differs.
- [ ] Cmd/Ctrl+S invokes Save and suppresses native browser Save Page behavior.
- [ ] Save preserves session Undo history; undoing afterward changes the Working Copy and returns to an unsaved state.
- [ ] Discard restores saved Exam name, membership, order, answer order, and columns; it retains latest canonical Question Content, Export History, and workspace tabs, then clears Undo/Redo.
- [ ] A healthy backed-up Working Copy survives refresh and resource switching without a warning.
- [ ] Navigation or browser close warns only while the latest backup is pending or failed.
- [ ] Each Exam has an independent session Undo/Redo history; refresh clears command history without losing the Working Copy.
- [ ] Concurrent editor tabs are treated as unsupported, while write serialization or revision protection prevents stale completions from overwriting newer Save or backup state.
- [ ] Unit, real IndexedDB, keyboard, failure-path, and browser tests cover saved-versus-working state and reload recovery through public behavior.

## Blocked by

- T01 — Create and reopen multiple Exams from Home.
