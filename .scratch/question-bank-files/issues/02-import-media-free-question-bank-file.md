# 02: Import a media-free Question Bank File as a new bank

**What to build:** Let a teacher select a conforming media-free Question Bank File, inspect a confirmation derived from its authoritative Question Bank Record, optionally change the proposed local bank name, and atomically create and open a new independent Question Bank. The import path validates rather than parses the visible PDF and generates fresh local identities every time.

**Blocked by:** 01 “Export a complete media-free Question Bank File”; external GitHub issues #45 “Create and manage multiple reusable Question Banks” and #49 “Complete Home and searchable resource collections”.

**Status:** ready-for-agent

**Published as:** GitHub issue #57

- [ ] A teacher can choose a PDF for import from a Question Bank resource-management surface.
- [ ] Inspection reads PDF attachments and never uses OCR, page text, visual layout, annotations, or PDF images to reconstruct Questions.
- [ ] Import requires exactly one attachment whose description is `pdf-canonical-extraction` and whose record format is `test-parrot/question-bank`.
- [ ] A PDF with no canonical attachment is reported as preview-only or not exported as a Test Parrot Question Bank File.
- [ ] A PDF with several canonical attachments is rejected as ambiguous.
- [ ] Unrelated noncanonical attachments do not become Question Bank content.
- [ ] Invalid PDF bytes, invalid JSON, unsupported format versions, structural errors, semantic errors, and integrity mismatch produce distinct actionable errors.
- [ ] File inspection makes no durable change and returns either errors or a fully validated import proposal.
- [ ] The confirmation is derived exclusively from the record that will be imported, not from the PDF pages.
- [ ] Confirmation shows the proposed bank name, counts by Question Type, Topics, incomplete Multiple Choice count, declared format version, and record-integrity status.
- [ ] Confirmation clearly says that a new independent Question Bank will be created.
- [ ] The teacher may edit the proposed local bank name before confirming, and duplicate Question Bank names are allowed.
- [ ] Cancelling confirmation leaves all resources unchanged and returns focus to a useful import control.
- [ ] Every confirmed import creates a new Question Bank even when the same file is imported repeatedly.
- [ ] Import creates fresh local Question Bank, Question, and choice identities and rewrites package-local references consistently.
- [ ] Package-local ordinal IDs are never retained as local synchronization identities.
- [ ] Unknown optional fields are ignored and discarded; unsupported Question Types, rich-text nodes, marks, enum values affecting semantics, and required features reject the whole import.
- [ ] Multiple Choice validity requires at least two choices and no more than one correct choice; zero correct choices remain importable and are disclosed as incomplete.
- [ ] Safe media-free rich text, Question Metadata, correctness, and Suggested Answers are preserved exactly in the new bank.
- [ ] The complete Question Bank is committed atomically; no valid subset or placeholder Questions are imported after a failure.
- [ ] A persistence failure leaves no new visible or durable Question Bank.
- [ ] Import creates no Exam, changes no Working Copy, and leaves existing Question Banks untouched.
- [ ] Successful import opens the new Question Bank's full collection and announces the imported Question count.
- [ ] Imported Question Content and the new bank survive refresh.
- [ ] Store-level tests assert fresh identities, complete semantic state, and no Exam mutation rather than helper calls.
- [ ] Real IndexedDB tests abort the transaction and reopen storage to prove that no partial bank remains.
- [ ] Browser tests cover file selection, record-derived confirmation, rename, cancellation, invalid files, successful navigation, duplicate-name import, and unchanged active Exam state.
