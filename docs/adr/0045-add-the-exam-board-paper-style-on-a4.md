---
status: accepted
---

# Add the Exam Board Paper Style, on A4

Teachers preparing students for international exam boards' papers want their own tests to look like them: `1 (a) (i)` labels, dotted lines to write on, each answer's points in brackets at the right margin, each question's total beneath it, the paper's total, and A4 paper.

**Exam Board** is a fourth Paper Style (ADR-0044). Its rules:

| | Exam Board |
| --- | --- |
| Paper | A4, with the Exam's margins |
| Labels | `1`, `(a)`, `(i)`; Multiple Choice answers `A`–`D` |
| Ruled Work Space | dotted, the lines running to the right margin; three where the teacher set none |
| Points | `[n]` at the right margin after each answer with Points, on the last of its ruled lines where it has them; `[Total: n]` after each Multipart question with Points |
| Paper total | "The total mark for this paper is n." beneath the title on page 1, when anything has Points |
| Running furniture | the Page Header lines (ADR-0026) as every style prints them, with the page number centred on a row of its own above them; "Turn over" at the foot of every test page the test continues past |

Point placements are independent rules any style may take — after each answer, a question's total, a Section's total, the paper's total beneath the title — each with its wording as a small template, so a style for another paper can take only the ones it uses. Standard, Classic and Condensed take none, and print exactly as before. The paper's total is counted from the Points (ADR-0042), never typed: it opens the test's content as a line of its own, measured and packed like any other, and is never part of the Answer Key, which prints its own total beside its heading.

**Test Parrot does not generate whole pages.** Every page a style prints holds the Exam's own questions. Page 1 under Exam Board is a test page like any other style's: the title, and the first-page header line — Name, Class and Date blanks by default, reworded as the teacher likes — and later pages carry the later line. A Cover Page — the title, a subject line, a duration, a paper code, candidate boxes and an instructions list on a page of its own, filled from **Paper Details** stored on the Exam and edited from the Format menu — was built and withdrawn before it shipped: the teacher decided Test Parrot should not make pages the teacher did not write, and with no cover there is nothing for Paper Details to fill, so they went too. A page the teacher inserts and writes themselves, which a cover could later be, was considered and deferred.

The page number prints at the top on a row of its own rather than on the header line, so it never stands over the first page's blanks; the row adds to the header of each test page and packing fills only what is left.

**Paper size is a Paper Style rule.** The Layout Plan carried US Letter as its one page size; it now carries the size its style names, US Letter for every style but Exam Board. A4 paginates, prints and exports through the same Layout Plan, so export parity covers it as it covers Letter.
