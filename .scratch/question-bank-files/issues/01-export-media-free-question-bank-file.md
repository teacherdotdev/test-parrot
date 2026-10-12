# 01: Export a complete media-free Question Bank File

**What to build:** Let a teacher export one complete, non-empty, committed Question Bank as a self-contained PDF. Build the authoritative `0.1.0` Question Bank Record first, render a complete teacher-readable preview from that record, and attach the exact record as the PDF's one canonical extraction. This initial vertical slice supports Multiple Choice and Short Answer Questions plus all supported non-image rich-text semantics. It remains wholly separate from Exam export and history.

**Blocked by:** External GitHub issues #45 “Create and manage multiple reusable Question Banks” and #46 “Browse Question Banks as restorable editor tabs”.

**Status:** ready-for-agent

**Published as:** GitHub issue #56

- [ ] An export action targets exactly one active Question Bank and cannot include Questions from another bank.
- [ ] Export is unavailable for an empty Question Bank and explains that at least one Question is required.
- [ ] An open, unconfirmed Question edit must be saved or cancelled before export can proceed.
- [ ] Export uses the bank's canonical stored Question order, regardless of visible search or filters.
- [ ] The Question Bank Record identifies itself as `test-parrot/question-bank` at format version `0.1.0`.
- [ ] The record uses a format-owned semantic rich-text representation rather than local storage records or editor JSON.
- [ ] Multiple Choice Questions contain a separate stem and authored choices with package-local ordinal IDs and correctness; they require at least two choices and allow zero or one correct choice.
- [ ] Short Answer Questions contain a stem and optional rich-text Suggested Answer.
- [ ] Difficulty and Topics are included, while Exam references, answer arrangements, answer-column layout, Working Copies, Export Records, Layout Plans, and local identities are excluded.
- [ ] Supported non-image paragraphs, headings, blockquotes, lists, code, rules, tables, math, authored hard breaks, text, and marks round-trip into the record without semantic flattening.
- [ ] HTTP and HTTPS links can be represented in this initial export; unsupported schemes do not enter a generated record.
- [ ] Record integrity is SHA-256 over RFC 8785 canonical JSON with the digest field omitted during calculation.
- [ ] The PDF contains exactly one attachment named `pdfcx.json`, with MIME type `application/json`, description `pdf-canonical-extraction`, and associated-file relationship `Source`.
- [ ] The attached bytes are the exact UTF-8 serialization used as the source of the preview.
- [ ] The complete preview shows the bank name, Question count, every Question, Question Type, Difficulty, Topics, choices, correct-answer indication, and Suggested Answers.
- [ ] The preview states that it is a teacher Question Bank containing answers, can be imported into Test Parrot, and may lose import data if rewritten or printed.
- [ ] The preview does not show student identity fields, Exam sections, answer-key streams, Exam Version names, or other Exam furniture.
- [ ] Long content paginates for PDF-viewer usability without creating a durable page-parity contract.
- [ ] The download uses a sanitized `<bank-name>.question-bank.pdf` filename with an Untitled Question Bank fallback.
- [ ] Export failure produces no partial download and leaves the Question Bank unchanged.
- [ ] Export creates no Exam Export Record, does not alter Export History, and does not save or change an Exam or Working Copy.
- [ ] Unit tests inspect generated PDFs through an independent reader and assert canonical attachment metadata and record/preview semantic agreement.
- [ ] Browser coverage uses the teacher-facing export control, observes the downloaded filename and complete preview, and verifies that Exam and Export History state are unchanged.
