---
status: superseded by ADR-0015
---

# Start versioned export storage fresh

The IndexedDB generation that introduces Version History, Question Revisions, Layout Plans, and content-addressed Media Assets will start with an empty Question Bank and Exam Draft. Existing localStorage, IndexedDB, and Cache Storage data will be ignored rather than migrated or actively deleted, avoiding a compatibility layer across the replaced authoring, image, and export models.
