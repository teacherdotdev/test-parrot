---
status: accepted
---

# Size pictures on the Exam, not in the Question

ADR-0032 made a picture's size part of the Question: the teacher dragged its handles in the question editor, and every Exam printed it at that size. But a picture's size only matters once it is laid out on a page. The same diagram wants half a column on a crowded quiz and the whole width on a one-question worksheet, and a teacher decides that looking at the sheet, not the question editor.

**An Exam sizes its own pictures.** An Exam Picture Size is Exam presentation like Work Space: the Exam stores it, keyed by question and then by picture, as `pictureSizes`. The picture is named by its source and Picture Crop (`pictureKey`), so a re-crop makes a new picture at its default. The size is a share of the picture's container, as ADR-0032's was, and the Layout Plan puts it in place of the Question's own before planning. Every format, the Answer Key and every Version print it, and Export Records keep it in their plans. Exam Record 0.5.0 carries it per position, and 0.4.0 still reads.

**The question editor no longer resizes.** It keeps the Picture Crop and the caption, which are what a picture shows, and draws each picture at its Default Picture Size. That default is the `size` a Question already stores. Importers still set it, so a picture from a Source Document starts at about the width it had on its page. Nothing that exists moves. Copy, the Pop-over, the Question Bank and Question Bank Records keep using it. Moving every existing size onto each Exam that used it was rejected: there was nothing to gain from rewriting stored Exams.

**The sheet is edited the way a design tool is.** Pointing at a picture, or at a Work Space with height, outlines just that thing. A click selects it, and its question with it, and shows its handles: a picture's four corners, or a Work Space's one handle at the middle of its bottom edge. Dragging a handle resizes live, the pages reflow on release, and that is one undo step. Dragging the body still moves the question. A question or Part with no Work Space has nothing to select; its menu's Add work space gives it some, at the default height, to be sized from there. The bar no longer appears whenever a question is hovered. A picture keeps its proportions, so it has corner handles and no side handles. The question editor's crop handles keep their sides, since a crop does change the proportions.

This supersedes ADR-0032's "the editor draws its own picture" resizing and its premise that size is Question Content. Its crop and size-as-a-share rules stand.
