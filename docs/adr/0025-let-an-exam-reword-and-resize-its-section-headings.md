---
status: accepted
---

# Let an Exam reword and resize its section headings

Every Question Section printed a heading and a line of directions that were hardcoded per Question Type — "never stored, never editable". Teachers asked to change both: their own directions ("Circle the best answer"), a different heading, or none at all, and to make the headings larger or smaller.

The wording belongs to one Exam, not to the Question Type across a teacher's account. A per-type account default was considered and set aside: the request was about the test in front of the teacher, and a per-Exam setting can gain an account default later without changing what an Exam stores. So `Exam.sectionHeadings` holds, for any Section the teacher has reworded, an optional `title` and `instructions`. Only departures from the default are stored — a part set back to its default loses its key, and a Section with nothing left loses its entry — so an untouched Exam stores nothing and an improved default still reaches every Exam that never changed it. An empty string is a part the teacher cleared; it prints nothing. A Section cleared of both prints no heading at all, but stays in the Layout Plan at no height, so the sheet can still offer to bring it back.

Headings are plain text, typed where they print, the same way the Exam title is: the heading is its own field, with the title's underline, laid over a hidden copy of its value so it wraps as the printed text does and keeps the height the plan measured. Rich text was not asked for and would make three adapters render formatting in a heading.

Size is one of three presets — Small, Normal, Large — for the whole Exam, chosen from a new Format menu. Presets rather than a free point size keep print, PDF and DOCX reading one table (`SECTION_HEADING_PX`); Normal is the sheet's existing type, so the default output is unchanged, and the plan states a size only when it is not Normal.

The heading size sets every heading on the Exam, its title included (`TITLE_PX`): a large section heading under a title that stayed the same size read as a mistake. Each title size fits the first page's fixed title band, so the header's height, and packing, do not change.

A **Text size** — the same three presets, from the same Format menu, chosen apart from the heading size — sets the questions, answers and answer-key lines (`BODY_PX`). Print sets it on each page's content, whose line height is relative, and the measuring host carries the same size, so the plan packs what print will draw; the PDF scales its line pitch by the same ratio, and DOCX sets its body style from it. The header line, the footer and the section directions are not content and keep their own type. Fixed spacing around the text does not scale, in any adapter.

The Answer Key's section titles follow the test's headings. A heading cleared from the test is still named by its default in the key, because a run of answers with no label is no use as a teacher's reference.

The Exam Record carries the wording and both sizes, so they travel in a Test Parrot Package. Adding members a `0.1.0` consumer would drop is a minor version: Exam Record `0.2.0` is published beside `0.1.0`, keyed by the record's own Question Type names. Test Parrot writes `0.2.0` and reads both; a `0.1.0` Exam imports with the default headings.
