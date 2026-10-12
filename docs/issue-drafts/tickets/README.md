# Ticket breakdown: multi-Exam and Question Bank redesign

These are local drafts for review. They have not been published to GitHub or labelled. When published, each ticket should receive `ready-for-agent`, and symbolic blockers should be replaced with GitHub issue references/native dependency edges.

| ID | Ticket | Blocked by |
| --- | --- | --- |
| T01 | Create and reopen multiple Exams from Home | None |
| T02 | Save, discard, and recover each Exam Working Copy | T01 |
| T03 | Move current work into a new Exam with Save As | T02 |
| T04 | Create and manage multiple reusable Question Banks | T01 |
| T05 | Browse Question Banks as restorable editor tabs | T04 |
| T06 | Compose one Exam from Questions across open banks | T02, T05 |
| T07 | Propagate canonical Question edits across live Exams | T06 |
| T08 | Complete Home and searchable resource collections | T03, T04, T07 |
| T09 | Permanently delete Questions and Question Banks safely | T07, T08 |
| T10 | Record every Working Copy export under its Exam | T02, T06 |
| T11 | Browse and exactly re-export per-Exam Export History | T10 |
| T12 | Complete local durability and Media Asset lifecycle | T09, T11 |
| T13 | Remove the superseded Version workflow and verify the redesign | T03, T08, T09, T11, T12 |

## Why this shape

T01 is the foundational tracer bullet: it replaces the single-document startup with a fresh multi-Exam generation and proves one complete Home → Editor → refresh path. T04 can then proceed in parallel with the saved/working-state work in T02–T03. T06 joins those tracks at the first complete multi-bank composition workflow. Export Records can proceed after Working Copies and composition exist, while shared-edit usage and resource-management UI proceed in parallel. T13 is the contraction step: once every replacement path exists, it removes compatibility surfaces that cannot be deleted safely earlier.
