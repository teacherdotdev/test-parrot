# T12: Complete local durability and Media Asset lifecycle

## What to build

Complete the local-first durability contract for the redesigned resources. Meaningful authoring requests persistent browser storage, Home explains the actual durability boundary, and content-addressed Media Assets remain available exactly as long as current or historical resources require them.

## Acceptance criteria

- [ ] After the first meaningful Exam or Question Bank state commits, the application requests persistent browser storage.
- [ ] Creating or opening a pristine disposable Untitled placeholder does not trigger the request.
- [ ] Persistent-storage denial is treated as weaker durability rather than authoring or export failure and is explained distinctly from quota or transaction errors.
- [ ] Home clearly states that Exams, Question Banks, Working Copies, and Export History are saved in this browser and that important work should be exported or backed up externally.
- [ ] The product makes no claim of cloud sync, accounts, cross-device recovery, or compliance-grade archival storage.
- [ ] Media bytes are owned at ingestion, identified by content hash, and deduplicated across Questions, Exams, Working Copies, and Export Records.
- [ ] A Media Asset remains protected while any canonical Question, saved Exam, Working Copy, or Export Record references it.
- [ ] Garbage collection removes only Media Assets with no current or historical references and never breaks historical view or re-export.
- [ ] Question or bank deletion can release current references, but Export Record references continue to retain historical media.
- [ ] Missing or corrupt required Media Assets block normal and historical export with an actionable error and no partial Export Record.
- [ ] Real IndexedDB and browser tests cover permission grant/denial, quota/transaction failure, deduplication, reference retention, garbage collection, deleted current Questions, reload, and media-bearing historical re-export.

## Blocked by

- T09 — Permanently delete Questions and Question Banks safely.
- T11 — Browse and exactly re-export per-Exam Export History.
