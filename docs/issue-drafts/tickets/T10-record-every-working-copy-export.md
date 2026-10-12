# T10: Record every Working Copy export under its Exam

## What to build

Replace Version publication with event-oriented export for current work. Export snapshots the active Exam's visible Working Copy without saving it, creates one self-contained immutable Export Record for exactly the output produced, and downloads only after that record and its required media commit atomically.

## Acceptance criteria

- [ ] Normal Export accepts PDF or DOCX and Student Test, Answer Key, or both, defaulting to PDF and both documents.
- [ ] Format and Content Selection preferences are global export settings and never dirty or save an Exam.
- [ ] Export captures the visible Working Copy name, membership, question order, answer order, columns, exact current Question Content, correctness, formatting, and required Media Assets without updating saved Exam state.
- [ ] An unsaved rename appears in pages, filename, and Export Record while the saved Exam name remains unchanged.
- [ ] Every successful export appends a distinct immutable, undeletable Export Record under the Exam UUID, including output identical to an earlier record.
- [ ] No Version identity, adjective–noun naming, fingerprint deduplication, Question Revision reuse, or canonical unselected plan retention participates in domain behavior.
- [ ] The record retains only the selected format and Content Selection, a self-contained presentation snapshot, and its resolved Layout Plans; Media Assets remain content-addressed and shared.
- [ ] An empty Exam, unresolved required media, or pending/failed Working Copy backup blocks export with an actionable message.
- [ ] Missing Multiple Choice correctness remains exportable with a blank key entry; missing Difficulty and Topics never block export.
- [ ] Final submission captures the latest resolved Working Copy, refreshes stale preview when a live Question changed, and locks editor and dialog interaction during preparation.
- [ ] The complete artifact is packaged before one transaction commits the Export Record and required Media Assets; preparation or persistence failure produces neither history nor download.
- [ ] Download begins only after commit, and browser cancellation afterward does not roll history back.
- [ ] Normal filenames are `<Exam name>.pdf` and `<Exam name>.docx`.
- [ ] Cmd/Ctrl+P opens normal Export for the active non-empty Exam and native browser Print remains unavailable as a product path.
- [ ] Preparation, store, IndexedDB, adapter, browser, accessibility, failure, and parity tests cover unsaved Working Copies and repeated identical exports.

## Blocked by

- T02 — Save, discard, and recover each Exam Working Copy.
- T06 — Compose one Exam from Questions across open banks.
