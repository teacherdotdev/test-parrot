---
status: accepted
---

# Let an Exam reword its page header

Every test page printed a fixed header line: Name, Class and Date blanks on the first page, a Name blank on later pages, and the paper's ID against the right margin. Teachers asked to make it say what they want — Student and Period in place of Name and Class, say.

The header is one line of plain text per kind of page, typed where it prints, the way the Exam title and the section headings are: the line is its own field, so one click puts the caret where it lands, and Enter or a click elsewhere finishes. A rich-text header, edited in a cut-down question editor with tables, images and a toolbar, was built and withdrawn: it looked unlike the rest of the sheet and was far more machinery than the request needed.

- The first page and later pages each have their own line (`Exam.header.first` and `.later`), because the first page identifies the paper and later pages only need to reunite a dropped stack.
- Underscores are the blanks. The default is written as text too, so the field on screen and every output are the same characters; the default's blanks are sized to fit beside the ID at the sheet's type. Only departures from the default are stored, as for section wording (ADR-0025).
- The paper's ID is not part of the line and cannot be edited: it is the one value that differs between papers, and it keeps its place against the right margin.
- The line never wraps. It prints on one line at the header's fixed height, so packing is unchanged; text too long for the room the ID leaves is cut short.

The plan resolves each test page's line into its furniture (`identityLine`), and print, PDF and DOCX print that text. Export Records keep their Layout Plans, and a plan recorded before this has no `identityLine`, so the adapters still print its `identityFields` as ruled blanks, as they did. The lines travel in the Exam Record, `0.2.0`, as `header`.
