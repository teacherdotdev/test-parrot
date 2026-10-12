---
status: accepted
---

# Let an Exam set its page margins, and tighten its type

Teachers asked for tighter line spacing, smaller margins, and Multiple Choice answers set in a little from their question. Every line of question text was 1.45 lines apart, every paragraph opened a full line's gap, and every bulleted item opened that same gap, so a paragraph break could not be told from the next line and a short list sprawled down the page.

## Spacing

The body's spacing is one table in `export-typography.ts`, in multiples of the type's size so every text size keeps its proportions, and every adapter reads it:

- A line is `BODY_LINE_HEIGHT` (1.2; it was 1.45, then 1.3) times the type. Teachers still found 1.3 airy, so body, list and answer text tightened again.
- A heading's lines — a section title, the Answer Key's "Answer Section" and its section titles — are `HEADING_LINE_HEIGHT` (1.2, was 1.3) apart, and the Exam title's `TITLE_LINE_HEIGHT` (1.1, was 1.2): each tightened by the same step as the body, so a heading keeps its place against the text under it. Section Directions are body text, at the body's.
- A paragraph, or a list, opens `PARAGRAPH_GAP_EM` (1em) below the block before it — print's own paragraph spacing, now stated rather than left to the browser. The gap is unchanged; against the tighter lines it now reads as a break.
- A list's items sit `LIST_ITEM_GAP_EM` (0.2em) apart, where each used to open a paragraph gap, and an item's own paragraphs sit together.

Print sets these on `.exam-page`, its question text and its headings, and the measuring host inherits them, so the plan packs what print draws. The PDF draws its line pitch, heading lines and gaps from the same numbers. DOCX gives each body paragraph and each heading a line height of at least the table's — at least, so a line holding a picture or an equation still grows — and the same gaps. Choices and Matching items keep their own tight spacing, as before.

A Multiple Choice question's answers, and a Multiple Choice Part's, are set in `CHOICE_INDENT` (18px) from the stem above them, in all three adapters.

Export Records keep their Layout Plans, and an adapter draws a recorded plan with today's spacing. Tighter lines only leave a reprinted page more room at its foot; the narrower answers could, rarely, wrap a long answer in a four-column grid onto another line.

## Page Margins

Margins are this Exam's presentation, like its heading and text sizes (ADR-0025): set from the Format menu, saved and undone with the Exam. They are in inches, the unit a teacher sets them in, from 0.5 to 1.5 in steps of 0.05; ¾ inch on every side, the sheet's margin until now, is the default, and only a departure from it is stored, so no Exam already made moves.

The control is shaped like a design tool's inspector: one number field sets all four sides, and a toggle opens Top, Right, Bottom and Left. When the sides differ the combined field reads "Mixed", and setting it sets every side. Every field scrubs: pressing on its label or icon, or on the field before it has focus, and dragging sideways moves the value a hundredth of an inch a pixel (a tenth with Shift), shown on the margins' own step; a press that does not move puts the caret in the field to type, and arrow keys step it. A slider was tried first and replaced: it took a row's width for a value a teacher reads as a number. It is a panel the Format menu opens rather than rows in the menu, because a menu closes on any scroll and a sheet that loses a page as its margins shrink scrolls under the pointer mid-drag. The sheet reflows as the value changes, and one drag is one undo step. Its icon is a page between crop marks — a portrait rectangle, Letter's proportions — in the Format menu and the panel.

The Layout Plan's `pageSize` carries each side's margin in pixels and the content width they leave. Packing measures every item at that width and fills the height the top and bottom leave; print lays the sheet out from the plan's own page size; the PDF and DOCX cut each page to it. A plan recorded before this states one `margin` for every side, and reads as that margin on all four, so an Export Record reprints as it did and a new one reprints with its own margins.

The Exam Record carries them as `margins`, every side stated, so they travel in a Test Parrot Package. Adding a member a `0.3.0` consumer would drop is a minor version: Exam Record `0.4.0` adds `margins` to `0.3.0`, alongside the Question Style (ADR-0041), and nothing else. Test Parrot writes `0.4.0` and reads every earlier version with the default margins.

## A title that wraps

A long Exam title used to sit in the first page's fixed title band on one line, and ran off the sheet or over the questions below it. It now wraps, on the test's first page and the Answer Key's, in every output. How many lines it takes is a measurement, so the plan asks the injected `Measure` (`titleLines`), and the page's header grows by a title line for each line past the first (`headerHeightOf`); packing fills only what is left, and the furniture records the count, so print, the PDF and DOCX draw the header the plan packed. A title on one line moves nothing. On the Answer Key the title keeps its own lines and "Answer Section" its own, unbroken, beneath it, so the label is never squeezed beside a wrapped title; a Version's name stays in the header beside the ID. On the sheet the title is typed where it prints, in a field that wraps exactly as the printed title does.
