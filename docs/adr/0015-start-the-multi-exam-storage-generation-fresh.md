---
status: accepted
---

# Start the multi-Exam storage generation fresh

The storage generation for multiple Question Banks, multiple Exams, per-Exam Working Copies and workspace state, and per-Exam Export History starts empty. Earlier localStorage, IndexedDB, and Cache Storage generations are ignored rather than migrated or actively deleted. Durable domain and workspace state use IndexedDB; URL query parameters carry only one-time editor launch intent, and localStorage is not an authoring persistence layer.
