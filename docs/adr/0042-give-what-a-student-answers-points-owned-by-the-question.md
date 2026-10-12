---
status: accepted
---

# Give what a student answers Points, owned by the Question

Teachers assembling papers from past exams need each question's worth on the paper and in the mark scheme, a total that follows as they add and remove questions, and the ability to change a worth. Test Parrot had no notion of worth at all; every Question File importer dropped the points its source carried.

**Points** are an optional whole number on whatever a student answers: a Multiple Choice, True/False or Short Answer Question, a whole Matching set, or a Part or Subpart that answers (ADR-0043). A Multipart question's Points, and an Exam's total, are always the sum of their parts and are never stored, so they cannot disagree with them. Something with no Points is unpointed rather than worth nothing: it adds nothing to a total, and a total over nothing with Points is no total at all. An Exam whose Questions only partly have Points is not blocked from export.

- **Points belong to the Question, not the Exam position.** A past paper's points come with the question and the mark scheme is written against them, so the same Question is worth the same on every Exam. Per-position Points, like Work Space, were considered and left out until someone needs one Question worth different amounts on two Exams; a position override can be added later without changing what a Question stores. Points are set in the question editor beside Difficulty and Topics, or in a Part's or Subpart's header; under a Paper Style that prints them, the printed `[n]` on the exam sheet is also where they are changed. Either way it edits the Question, which saves immediately like any other bank edit.
- **A Matching set takes its Points as a whole.** Its Items share one Word Bank and are never Questions of their own (ADR-0021), and the papers it serves give such a task one total.
- **Where Points show belongs to the Paper Style** (ADR-0044): Points are always kept and always counted, and a style decides whether `[2]`, a question total or a paper total appears. Like Question Metadata, they never show on the exam sheet or the test otherwise: no chip beside a question and no running total in the document bar, so a sheet under a style that prints none reads as that style's paper. The Answer Key prints each entry's or Part line's Points and the paper total whenever there are Points, under every style.

## Records

Question Bank Record `0.9.0` adds `points` to a question and to a Part or Subpart that answers. Adding a member an earlier consumer would drop is a minor version; Test Parrot writes `0.9.0` and reads every earlier version as unpointed. The conversion instructions (`public/extract.md`) teach an assistant to turn a bracketed `[n]` into `points` and never to leave it in a stem. The Question File importers keep the points their formats carry as Points wherever a whole number of points belongs to a whole question: QTI item points, Moodle `defaultgrade`, Respondus `Points:` lines, Brightspace's points column. A fractional or zero point value is dropped, as before, since Points are positive whole numbers.
