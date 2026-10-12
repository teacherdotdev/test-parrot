# T13: Remove the superseded Version workflow and verify the redesign

## What to build

Contract the temporary compatibility surface after every replacement workflow exists. Remove the former one-bank/one-Exam-Draft and immutable-Version behavior, retire stale terminology and controls, and verify the complete Home → multi-bank editor → Save/Save As → Export History experience as one coherent product.

## Acceptance criteria

- [ ] Version, Version History, Exam Draft, Question Revision, Question Reconciliation, Use as Draft, adjective–noun naming, and fingerprint-based history deduplication are absent from current product-facing UI and domain interfaces.
- [ ] Legacy automatic Replace with Equivalent Questions and its menu entries, state transitions, and browser coverage are removed.
- [ ] Legacy direct Question creation from the Exam is removed; Question creation occurs only in an active bank.
- [ ] Legacy historical restore/reconciliation dialogs, stale-revision paths, compatibility helpers, and browser tests are removed once no replacement ticket calls them.
- [ ] Old single-bank/single-draft storage code is unreachable; startup uses only the fresh multi-resource IndexedDB generation and ignores prior generations.
- [ ] Export Fingerprint remains only where required for adapter parity or diagnostics and cannot influence Export Record identity, naming, or deduplication.
- [ ] Current documentation uses Question Bank, Question, Exam, Working Copy, Export Record, and Export History consistently; implementation-oriented export documentation is updated to describe running code.
- [ ] Existing supported authoring and rich-content behavior remains intact: Short Answer, Suggested Answer, selection, drag/drop, Question Sections, images, links, formatting, answer correctness, answer columns, pagination, and answer keys.
- [ ] A complete browser journey creates banks, creates and saves Exams, composes across banks, uses Save As, edits shared Questions, exports unsaved work, browses and re-exports history, refreshes, and returns through Home without stale controls or terminology.
- [ ] Unit tests, real IndexedDB tests, all Playwright tests, build, lint, and the documented heavyweight export comparison pass from a clean checkout.
- [ ] The implementation's accepted ADR statuses and domain glossary match the redesigned behavior, with superseded ADRs retained only as history.

## Blocked by

- T03 — Move current work into a new Exam with Save As.
- T08 — Complete Home and searchable resource collections.
- T09 — Permanently delete Questions and Question Banks safely.
- T11 — Browse and exactly re-export per-Exam Export History.
- T12 — Complete local durability and Media Asset lifecycle.
