---
status: superseded by ADR-0005
---

# Create immutable Versions only during export

Authoring happens in a mutable Exam Draft, never in a Version. Export will eventually create immutable, view-only Versions from temporary Export Previews, persist their format-neutral Layout Plans in an Export Event, and permit only unchanged PDF or DOCX re-export; editing, deletion, and using a historical Version as a revision source are excluded. Implementation is deferred until the export-stage work, so the question-bank build may continue using the current export pipeline through a compatibility boundary.
