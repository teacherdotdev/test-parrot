# 07: Complete the accessible sharing workflow and protect export parity

**What to build:** Finish Question Bank File sharing as a polished browser workflow and verify that shared low-level PDF changes have not altered existing Exam PDF or DOCX behavior. Cover focus, cancellation, progress, failures, successful navigation, persistence, and the separation between sharing a bank and publishing an Exam.

**Blocked by:** 01 “Export a complete media-free Question Bank File”; 02 “Import a media-free Question Bank File as a new bank”; 03 “Carry Media Assets through Question Bank Files”; 04 “Carry Question Bank provenance and safe external links”; 05 “Enforce format compatibility and hostile-input limits”; 06 “Publish and verify the 0.1.0 Question Bank Record contract”; external GitHub issue #54 “Remove the superseded Version workflow and verify the redesign”.

**Status:** ready-for-agent

**Published as:** GitHub issue #62

- [ ] Export and import dialogs have accessible names, initial focus, trapped Tab order, Escape cancellation, and useful focus restoration.
- [ ] Controls are disabled while record preparation, PDF generation, validation, or persistence is in progress.
- [ ] Progress and recoverable failures are announced without dismissing the teacher's context.
- [ ] Export clearly states that the file contains correct and Suggested Answers and is intended for teachers, without requiring an extra repetitive confirmation.
- [ ] Import confirmation clearly distinguishes verified record integrity from unverified author identity and unverified PDF pages.
- [ ] Cancelling export produces no download; cancelling import creates no resource.
- [ ] PDF creation failure produces no fallback JSON download and no partial PDF.
- [ ] Attachment stripping, invalid files, unsupported versions, unsafe links, corrupt media, resource-limit failures, and IndexedDB failures remain actionable in the finished UI.
- [ ] Successful import opens the new Question Bank collection and announces the imported Question count.
- [ ] The imported bank, provenance, Questions, choices, links, and Media Assets remain correct after refresh.
- [ ] Importing while an Exam is active creates no Exam, does not alter its Working Copy, and does not change its saved or unsaved status.
- [ ] Question Bank export creates no Exam Export Record and does not alter Question Bank recency except for separately committed metadata edits.
- [ ] Repeated import creates independent banks with fresh identities and no duplicate warning or merge path.
- [ ] Browser tests use accessible user controls and assert visible resources, confirmation summaries, downloaded filenames, and durable outcomes rather than React state or CSS details.
- [ ] Browser tests cover empty-bank prevention, unresolved Question edit handling, successful media-free and media-rich round trips, cancellation, focus behavior, preparation failures, persistence failure, duplicate names, and unchanged Exam state.
- [ ] Existing Exam PDF and DOCX unit and browser suites continue to pass without interpreting Question Bank Files as Export Artifacts.
- [ ] Existing Exam Export Document, Layout Plan, PDF, DOCX, and print-reference semantic parity remains unchanged.
- [ ] The heavyweight export comparison is run because shared PDF generation or drawing behavior changed; any resulting Exam PDF or DOCX parity regression is fixed before completion.
- [ ] Build, lint, standard unit tests, browser end-to-end tests, and the documented heavyweight export comparison all pass.
