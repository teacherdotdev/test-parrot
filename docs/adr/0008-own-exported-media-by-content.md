---
status: superseded by ADR-0017
---

# Own exported media by content

Exact historical viewing and re-export cannot depend on mutable external URLs or the browser's disposable Cache Storage. Image bytes enter a shared IndexedDB Media Store when added to the editor, are keyed and referenced by their content hash, and are resolved for browser display through a stable internal media path rather than a temporary blob URL; identical files therefore deduplicate across drafts and Versions. Versions, new Question Revisions, Layout Plans, and required Media Assets live in object stores in one database and commit in one transaction. The application requests persistent browser storage when creating its first Version and stops export with an actionable storage error if that transaction cannot be committed, rather than producing an artifact absent from append-only Version History.
