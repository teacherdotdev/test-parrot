---
status: accepted
---

# Let a teacher delete an Exam, and its Export History with it

ADR-0012 made Exams and Export Records undeletable, so that what a teacher printed could always be looked up and printed again. In practice that left every abandoned attempt, test run and one-off quiz on Home and in Exams for good, with no way to tidy them away. Export History protects a teacher's record of their own work; it was never meant to stop them throwing that work out.

**A teacher can delete an Exam.** Delete is in each Exam card's menu, on Home and in Exams, and in the editor's File menu. A confirmation names the Exam and how many exports go with it — "Delete “Biology Unit 3”? This also deletes its 4 exports. Files you’ve already downloaded aren’t affected. This can’t be undone." — and there is no undo. Deleting the Exam that is open leaves the editor for Home.

**Its Export History goes with it.** An Export Record belongs to its Exam (ADR-0014) and is reachable only through it (ADR-0016), so a record without its Exam would be one nobody could find. Records stay immutable: the only way one is ever deleted is with its Exam. Deleting a Question or a Question Bank still leaves every Export Record unchanged.

**Nothing else the Exam only referenced is touched.** Its Questions stay in their Question Banks. A Media Asset is collected only when nothing still references it — no bank Question, no other Exam's saved state or Working Copy, no remaining Export Record — by the same sweep that runs after a Question or bank is deleted (ADR-0017). Everything kept for the Exam by its id goes too: its Working Copy, the Exam to reopen in the editor, and its Question Bank tabs (ADR-0013).

This amends ADR-0012's "Exams and Export Records are undeletable" and ADR-0014's "undeletable Export Record"; the silent clean-up of an untouched Untitled Exam is unchanged.
