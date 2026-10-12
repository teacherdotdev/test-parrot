# T11: Browse and exactly re-export per-Exam Export History

## What to build

Replace Version History with immutable event history under each Exam. Teachers can inspect exactly what each export produced and reproduce that same format and Content Selection without consulting current Exam or Question Bank state. Historical output remains observational and can never become editable work.

## Acceptance criteria

- [ ] Export History is reachable from its owning Exam and has no global Home or collection feed.
- [ ] Records are listed newest first with captured Exam name, timestamp, format, Content Selection, and Question count; repeated identical events remain separate rows.
- [ ] Selecting a record replaces only the center document with a clean read-only view built from that record's stored Layout Plans and Media Assets.
- [ ] Current Exam and Question Bank edits, current layout-engine behavior, and current export preferences cannot alter historical display or output.
- [ ] Historical view offers only Back to Exam and a fixed-format Re-export PDF or Re-export DOCX action.
- [ ] No format or Content Selection controls, edit controls, Save, Save As, restore, reconciliation, or create-Exam action appears in historical view.
- [ ] Re-export preserves the source record's format, Content Selection, captured Exam name, semantics, media, page assignment, and structural topology; package bytes and generated metadata may differ.
- [ ] Re-export prepares the artifact before atomically appending another immutable Export Record under the same Exam UUID, then starts download.
- [ ] The new record receives a new timestamp, retains the historical captured name, may record internal provenance, and leaves the source record unchanged.
- [ ] Re-export success leaves the teacher in historical view and leaves the mounted Exam Working Copy, selection, scroll position, open bank tabs, saved state, and Undo history unchanged.
- [ ] Back to Exam restores the exact mounted Working Copy and predictable focus.
- [ ] Cmd/Ctrl+P does not trigger historical re-export; re-export remains an explicit record action.
- [ ] Store, browser, media, accessibility, exact stored-plan, repeated-event, and heavyweight parity tests cover history independent of live authoring state.

## Blocked by

- T10 — Record every Working Copy export under its Exam.
