# Share Question Banks as self-contained PDFs

<!-- Intended GitHub label: ready-for-agent -->

## Problem Statement

Teachers need a simple way to send complete Question Banks to one another and bring shared Questions into Test Parrot. The current Exam PDF and DOCX Export Artifacts are intended to publish an Exam, not exchange reusable canonical Questions. A visually readable PDF alone is insufficient because recovering rich Question Content, answer correctness, Question Metadata, and Media Assets from rendered pages would require fragile text extraction or OCR.

The sharing format must remain useful as Test Parrot adds Question Types and rich-text capabilities. It must be independent of browser storage and editor implementation details, self-contained when shared offline, safe to validate before it changes local data, and explicit about compatibility while the unreleased format evolves through major version zero.

## Solution

Add a separate Question Bank import/export workflow built around a **Question Bank File**: one ordinary, self-contained PDF representing one complete, non-empty Question Bank. Its pages provide a complete teacher-readable preview, including answers and Question Metadata, but are not an Exam, an Export Artifact, or a print-parity target.

The PDF carries exactly one authoritative **Question Bank Record** as an attached UTF-8 `pdfcx.json` file. The attachment uses MIME type `application/json`, `/Desc` `pdf-canonical-extraction`, and `AFRelationship` `Source`. The record begins at format version `0.1.0`, follows a published JSON Schema and prose contract, and uses a format-owned semantic rich-text vocabulary rather than Test Parrot's IndexedDB or ProseMirror representations.

Export constructs and validates the record first, renders the complete PDF preview from that record, then attaches the exact serialized record used as the rendering source. Import reads and validates the attachment rather than parsing PDF pages. After a record-derived confirmation, import atomically creates a new independent Question Bank and required Media Assets with fresh local identities. It never merges with an existing bank, creates an Exam, or changes a Working Copy.

## User Stories

1. As a teacher, I want to export one complete Question Bank as a PDF, so that I can share reusable Questions through familiar file-sharing tools.
2. As a teacher, I want the Question Bank File to open in an ordinary PDF viewer, so that I can inspect it without Test Parrot.
3. As a teacher, I want the PDF preview to show every Question completely, so that I can evaluate the shared material before importing it.
4. As a teacher, I want the preview to show authored Question order, so that it agrees with the shared Question Bank.
5. As a teacher, I want the preview to show every Multiple Choice answer in authored order, so that I can review the canonical choices.
6. As a teacher, I want correct Multiple Choice answers identified in the preview, so that the file serves as a teacher-facing catalog.
7. As a teacher, I want Suggested Answers shown for Short Answer Questions, so that I can review the intended answer material.
8. As a teacher, I want Difficulty and Topics shown with each Question, so that I can understand how the bank is organized.
9. As a teacher, I want images, formatting, links, math, lists, tables, whitespace, and authored breaks visible in the preview, so that inspection does not flatten Question Content.
10. As a teacher, I want Question Bank description, declared author, and license shown when present, so that useful provenance travels with the material.
11. As a teacher, I want the preview labeled as a teacher Question Bank containing answers, so that I do not mistake it for a student Exam.
12. As a teacher, I want the preview to explain that it can be imported into Test Parrot, so that recipients understand why the PDF is special.
13. As a teacher, I want the preview to warn that rewriting or printing the PDF may remove its import data, so that I share the original file unchanged.
14. As a teacher, I want Question Bank export separate from Exam PDF and DOCX export, so that sharing reusable Questions does not publish or expose unrelated Exam state.
15. As a teacher, I want the file to contain only the selected Question Bank, so that Questions from other banks and Exams are not disclosed.
16. As a teacher, I want Question Bank export to exclude Exam membership and presentation state, so that shuffled order, answer columns, Working Copies, and Export History do not leak into the bank.
17. As a teacher, I want export blocked for an empty Question Bank, so that I do not accidentally share a meaningless file.
18. As a teacher, I want an unfinished Question edit resolved before export, so that visible editing state cannot silently disagree with the committed bank.
19. As a teacher, I want Question Bank export not to alter or save an Exam, so that sharing and Exam authoring remain independent intentions.
20. As a teacher, I want Question Bank export not to create an Export Record or Question Bank export history, so that a sharing download does not become publication history.
21. As a teacher, I want optional provenance to be explicitly entered rather than inferred from an account, device, or browser, so that sharing does not reveal personal information unexpectedly.
22. As a teacher, I want unchanged optional provenance retained with an imported bank and included in later exports, so that declared authorship and licensing remain visible.
23. As a teacher, I want a recognizable sanitized filename such as `algebra-review.question-bank.pdf`, so that recipients can identify the file's purpose.
24. As a teacher, I want every required Media Asset embedded in the file, so that shared Questions work offline and do not depend on mutable URLs.
25. As a teacher, I want repeated uses of one image to share one canonical Media Asset in the record, so that the record does not duplicate the same bytes per occurrence.
26. As a teacher, I want missing Media Assets to stop export with an actionable error, so that a Question Bank File never silently omits content.
27. As a teacher, I want export failure to leave my Question Bank unchanged and produce no partial download, so that a broken artifact cannot be mistaken for a valid one.
28. As a recipient, I want to choose a Question Bank PDF for import, so that I can receive a colleague's reusable Questions.
29. As a recipient, I want Test Parrot to read its embedded structured record instead of using OCR, so that imported Questions preserve their exact meaning and formatting.
30. As a recipient, I want import to require the canonical attachment marker, so that an ordinary PDF is never guessed to be a Question Bank File.
31. As a recipient, I want a clear error when a PDF's import attachment was stripped, so that I know to request the original file rather than expect page parsing.
32. As a recipient, I want ambiguous files with several canonical records rejected, so that Test Parrot never guesses which bank to import.
33. As a recipient, I want corrupt, malformed, or unsupported records rejected before local data changes, so that imported content cannot partially damage my collection.
34. As a recipient, I want the record's integrity verified, so that accidental corruption can be detected before import.
35. As a recipient, I want integrity messaging not to imply verified authorship, so that a valid digest is not mistaken for identity or trust.
36. As a recipient, I want a confirmation summary rendered from the record that will actually be imported, so that misleading or independently edited PDF pages do not control my decision.
37. As a recipient, I want confirmation to show the bank name and counts by Question Type, so that I understand the import's scope.
38. As a recipient, I want confirmation to show Topics, Media Asset count and size, external-link presence, author, and license, so that I can evaluate content and risk before committing.
39. As a recipient, I want to edit the proposed local Question Bank name before import, so that I can organize the new bank immediately.
40. As a recipient, I want duplicate Question Bank names allowed, so that naming does not block import.
41. As a recipient, I want every import to create a new independent Question Bank, so that importing never overwrites or merges my existing Questions.
42. As a recipient, I want importing the same file twice to create two independent banks without duplicate-detection machinery, so that the behavior stays simple and predictable.
43. As a recipient, I want imported Questions and choices to receive fresh local identities, so that portable identifiers do not create accidental synchronization.
44. As a recipient, I want imported Media Assets deduplicated by their content hashes, so that independent banks need not store identical immutable bytes repeatedly.
45. As a recipient, I want import to create no Exam and change no Working Copy, so that receiving content does not alter active composition.
46. As a recipient, I want the new Question Bank and all required Media Assets committed atomically, so that failure cannot leave a partial bank or orphaned visible content.
47. As a recipient, I want successful import to open the new Question Bank and report its Question count, so that I can immediately inspect or use it.
48. As a recipient, I want an import failure to preserve the current screen and all existing resources, so that retrying is safe.
49. As a recipient, I want unsupported Question Types, rich-text nodes, marks, and required features rejected, so that Test Parrot never silently drops Question Content.
50. As a recipient, I want harmless unknown optional fields ignored, so that additive metadata from another producer does not unnecessarily block import.
51. As a recipient, I want ignored unknown fields discarded on later export, so that Test Parrot does not relay opaque data it cannot explain.
52. As a recipient, I want unsafe URL schemes rejected, so that imported Question Content cannot introduce executable or local-file links.
53. As a recipient, I want unreferenced bundled Media Assets rejected, so that a Question Bank File cannot double as a hidden arbitrary-file carrier.
54. As a recipient, I want every image reference resolved and every Media Asset hash verified, so that visible Questions cannot point to missing or substituted bytes.
55. As a recipient, I want image MIME type and intrinsic dimensions verified from decoded bytes, so that declarations cannot bypass media safety checks.
56. As a recipient, I want oversized PDFs, records, banks, Questions, and Media Assets rejected with clear errors, so that a malicious or accidental file cannot exhaust my browser.
57. As a third-party developer, I want a public versioned JSON Schema and prose semantics, so that I can produce or consume conforming Question Bank Records.
58. As a third-party developer, I want conformance based on the record rather than a Test Parrot generator name, so that interoperable implementations are possible.
59. As a third-party developer, I want a format-owned semantic rich-text model, so that I do not have to reproduce Test Parrot's editor or storage implementation.
60. As a third-party developer, I want explicit package-local Question and choice identifiers, so that references are readable without implying durable cross-installation identity.
61. As a third-party developer, I want Media Assets addressed by SHA-256, so that content references and integrity checks have stable semantics.
62. As a third-party developer, I want exact supported-version behavior, so that an importer never guesses whether a newer `0.x` record is compatible.
63. As a third-party developer, I want optional additions distinguishable from required features, so that importers can ignore harmless data but reject semantic loss.
64. As a future Test Parrot maintainer, I want older supported records handled through explicit parsers or migrations, so that compatibility policy is visible and testable.
65. As a future Test Parrot maintainer, I want the preview rendered from the validated Question Bank Record, so that page generation and machine export cannot evolve into two definitions of the bank.
66. As a future Test Parrot maintainer, I want import and export adapters around the public model, so that internal storage and editor schemas can evolve without silently changing the exchange format.

## Implementation Decisions

- Implement the accepted architecture in ADR-0018. A Question Bank File is an ordinary, unencrypted PDF and does not claim PDF/A conformance.
- Keep Question Bank File import/export separate from Exam Export Artifacts, Export Records, Export History, the Export Document, and the Exam Layout Plan.
- Add resource-level actions for exporting the active Question Bank and importing a Question Bank File. Import is available from Question Bank resource-management surfaces; export always names one complete bank.
- An open, unconfirmed Question edit must be saved or cancelled before Question Bank export can begin. Export reads only committed canonical bank state.
- Introduce one cohesive Question Bank exchange boundary with two application-level operations: prepare a Question Bank File from one committed bank plus its Media Assets, and inspect a PDF into a validated import proposal. UI code must not independently construct records, interpret attachments, remap identities, or assemble persistence transactions.
- The export operation first adapts local domain state to a format-owned Question Bank Record, validates it, computes integrity, creates a preview model from it, renders the PDF, and attaches the exact serialized record. No second path may independently derive visible Question content from local state.
- The import operation accepts PDF bytes and returns either actionable validation errors or a record-derived proposal containing display summary and fully validated content ready for identity remapping. It must not write durable state while inspecting a file.
- The Question Bank Record top-level envelope contains `format`, `formatVersion`, `generator`, `requiredFeatures`, `integrity`, `bank`, and `media`. The format identifier is `test-parrot/question-bank`; initial format version is `0.1.0`.
- Publish a versioned JSON Schema with a stable public identifier and concise prose semantics and examples. The schema, not TypeScript types, IndexedDB records, ProseMirror JSON, or generated PDF bytes, is the public contract.
- Maintain an explicit compatibility table. Import accepts only exact format versions with an implemented parser or migration. It rejects unsupported versions before confirmation and reports both the file version and versions supported by the application.
- During major version zero, patch releases are compatible clarifications or additions, while minor releases may be incompatible. The first stable compatibility commitment will use major version one.
- Ignore unknown optional fields while parsing and discard them when creating local state. Reject unknown Question Types, document nodes, marks, enum values that affect semantics, and entries in `requiredFeatures` that the importer does not support. Do not add a general namespaced extension system in v0.
- Use a format-owned semantic rich-text tree. Support the semantic equivalents of the editor's exported paragraphs, headings, blockquotes, bullet and ordered lists, list items, code blocks, horizontal rules, tables and header cells, inline and block images, inline and display math, authored hard breaks, text, and supported marks. Marks cover strong, emphasis, inline code, strike-through, subscript, superscript, and safe links.
- Keep Multiple Choice structure outside the stem tree. A Multiple Choice Question contains a stem, an authored list of choices, and correctness on each choice. It requires at least two choices and permits zero or one correct choice; zero correctness is valid but is identified as incomplete in import confirmation.
- A Short Answer Question contains a stem and an optional rich-text Suggested Answer. A structurally present but visibly blank stem is permitted when the editor permits incomplete authoring.
- Include only canonical Question Content and Question Metadata: Question Type, stem, authored choices and correctness or Suggested Answer, Difficulty, Topics, and referenced Media Assets.
- Exclude Exam references, Exam names, Working Copies, shuffled question or answer arrangements, answer-column layout, Export Records, Layout Plans, export styling, local timestamps, and local storage identities.
- Preserve the Question Bank's canonical stored Question order, regardless of active search, filtering, or sorting UI. Use that same order in the record and PDF preview.
- Give each Question and choice deterministic package-local ordinal identifiers such as sequential Question and choice IDs. These identifiers exist only to express references inside one record and are never treated as synchronization identities.
- Import generates fresh local identities for the Question Bank, Questions, and choices and rewrites all internal references before commit. It always creates a new independent Question Bank, even when the same file or content has already been imported.
- Permit duplicate local Question Bank names. Confirmation allows only the proposed local bank name to be edited; it does not edit source Question Content or provenance.
- Add optional persisted Question Bank attributes for description, author, and license. License is an optional object with a display name and safe URL. Never infer these values from browser, account, device, school, file path, or email information.
- Do not include creation or export timestamps in v0.
- Preserve only allowlisted hyperlink schemes in Question Content and license metadata. Initially allow HTTP and HTTPS links; reject executable, embedded-data, local-file, and custom application schemes. Confirmation reports that external links are present.
- Represent an image in rich text by a SHA-256 Media Asset reference plus optional alt text, optional caption, and optional Authored Image Size from 0.05 through 1.
- Permit PNG, JPEG, and WebP Media Assets in v0. Preserve their source bytes in the Question Bank Record. Normalize any other locally accepted image to PNG before record construction; exclude SVG. The PDF preview may decode or transcode these canonical bytes for rendering without changing the attached record.
- Store every referenced Media Asset exactly once in the record as SHA-256, MIME type, intrinsic width and height, and base64 bytes. Every declared asset must be referenced, every reference must resolve, and duplicate declarations for one hash are invalid.
- Accept the intentional PDF size trade-off: each unique image may have one canonical representation inside the record and one renderer-oriented image representation in the PDF, while repeated preview occurrences reuse the PDF image object. Do not reference PDF image XObjects from the public record.
- Serialize the complete Question Bank Record as UTF-8 JSON in one attachment named `pdfcx.json`, with MIME type `application/json`, `/Desc` exactly `pdf-canonical-extraction`, and `AFRelationship` `Source`.
- Export produces exactly one canonical attachment. Import requires exactly one attachment with the canonical description and expected record format; it rejects zero or multiple canonical candidates rather than falling back to file name, page text, or OCR. Noncanonical attachments do not become Question Bank content.
- Compute record integrity with SHA-256 over the RFC 8785 canonicalized complete record with `integrity.digest` omitted. Integrity is corruption detection only and is not used for duplicate import detection, authorship, signatures, or proof that independently modified PDF pages agree with the record.
- The PDF preview is complete and teacher-facing. It shows bank name, optional provenance, Question count, every Question in canonical bank order, Question Type, Difficulty, Topics, all Question Content, correct answers, and Suggested Answers.
- The first page states that the file is a teacher Question Bank containing answers, can be imported into Test Parrot, and may lose import data if rewritten or printed. Keep format version and an abbreviated digest in technical document information or a subordinate footer.
- Do not reuse Exam furniture such as student identity fields, Exam sections, friendly Version names, student-test/answer-key streams, or Exam export controls. Question Bank pagination is for PDF-viewer usability and carries no durable page-parity promise; a long Question may split when necessary.
- Generate a sanitized `<bank-name>.question-bank.pdf` filename, using lowercase readable words, replacing unsafe characters, collapsing whitespace, and falling back to `untitled-question-bank.question-bank.pdf`.
- Do not create Question Bank export history, an Export Record, or a persistent duplicate digest. Export does not alter the bank or any Exam.
- Import accepts conforming records from any generator. Generator name and version are informational and do not gate conformance.
- Apply layered import limits before expensive allocation or persistence wherever possible: 100 MB PDF bytes, 75 MB decoded canonical JSON attachment, 10,000 Questions, 2,000 Media Assets, 25 MB per decoded Media Asset, 75 MB total decoded media, rich-text nesting depth 50, 25,000 document nodes per Question, and image dimensions no greater than 20,000 by 20,000 pixels.
- Perform structural schema validation followed by semantic validation. Semantic checks cover unique package-local IDs, all references, supported features and vocabulary, Question Type rules, safe URL schemes, base64 validity, SHA-256 matches, decoded MIME type and dimensions, resource limits, and the absence of unreferenced Media Assets.
- Reject the complete import on any validation failure. Do not import valid subsets, synthesize placeholders, or preserve unsupported content invisibly.
- Build import confirmation solely from the validated Question Bank Record. Show proposed editable bank name, Question counts by type, Topics, incomplete Multiple Choice count, Media Asset count and decoded size, external-link presence, declared author and license, format version, and record-integrity status. Say that import creates a new independent Question Bank.
- After confirmation, generate fresh local identities and atomically commit the complete bank, Questions, and Media Assets in one IndexedDB transaction. Existing content-addressed Media Assets may be reused when their verified hashes match. Any transaction failure leaves no new visible or durable resource.
- Successful import opens the new Question Bank's full collection and announces the imported Question count. It creates no Exam, changes no Working Copy, and does not add Questions to an active Exam.
- A successful imported bank counts as meaningful local authoring state for the existing persistent-storage request policy.
- Keep all import errors actionable and distinct: invalid PDF, missing canonical attachment, ambiguous canonical attachments, invalid JSON, unsupported format version or required feature, integrity mismatch, invalid Question Content, unsafe link, invalid or missing media, limit exceeded, and persistence failure.
- If a valid record has been placed in PDF pages that appear misleading, import still uses the record. The application may say “Record integrity verified” but must never say the PDF pages or declared author are verified.
- If a PDF processor strips the attachment, the remaining document is preview-only. Do not parse its text, images, annotations, or visual layout to reconstruct Questions.

## Testing Decisions

- Prefer one cohesive application-level Question Bank exchange seam. Its export operation is tested from committed Question Bank plus Media Assets to an inspectable Question Bank File; its import operation is tested from PDF bytes to a validated import proposal. This is the highest pure boundary that can prove record construction, attachment behavior, compatibility, validation, and preview derivation without testing private serializer helpers.
- Test externally observable contracts rather than implementation details. Assert decoded records, attachment metadata, visible preview content, validation outcomes, atomic durable resources, user-facing messages, and downloaded filenames. Do not assert private helper calls, React state, PDF object numbers, stream compression, exact PDF bytes, exact text coordinates, or renderer-selected wrapping.
- At the pure exchange boundary, test a representative complete bank containing every supported Question Type, semantic rich-text node and mark, metadata field, correctness state, Suggested Answer, hyperlink, Authored Image Size, and Media Asset format.
- Verify that the record, extracted attachment, and preview model contain the same complete bank in canonical order. Deliberately degrade each projection in tests to ensure parity checks detect omitted or changed semantic content.
- Validate the public `0.1.0` JSON Schema against canonical examples and malformed counterexamples. Test third-party generator values, ignored optional fields, rejected unknown required features, rejected semantic vocabulary, and exact supported-version behavior.
- Test adapters between local domain/editor state and the public record in both directions. Assert domain terms and semantics rather than storage shape: `short-answer` rather than internal legacy names, choices separated from stems, fresh local identities, and exclusion of Exam-specific state.
- Test RFC 8785 canonicalization and SHA-256 integrity with fixed external conformance vectors. Assert that insignificant JSON whitespace and object-key ordering do not alter canonical digest calculation, while semantic changes and Media Asset byte changes do.
- Test integrity verification separately from trust. A record with a mismatched digest fails; a self-consistent record from an unfamiliar generator succeeds; no result claims author or PDF-page verification.
- Test PDF packaging by reading generated bytes through an independent PDF reader. Assert exactly one `pdf-canonical-extraction` attachment, file name `pdfcx.json`, JSON MIME type, `Source` relationship where exposed, and exact attachment bytes. Avoid reading back through the writer's own in-memory objects.
- Test PDF import with no canonical attachment, one valid canonical attachment, multiple canonical attachments, malformed PDFs, malformed JSON, stripped attachments, and unrelated noncanonical attachments. No case may fall back to OCR or visible-page extraction.
- Test complete teacher preview semantics: bank identity and provenance, contains-answers/import warnings, every Question, Question Types, metadata, choices, correctness, Suggested Answers, links, math, tables, images, captions, and canonical order. Do not impose Exam page-parity or exact geometry assertions.
- Extend the existing PDF adapter and export-fixture coverage as prior art for fonts, links, rich-text blocks, tables, math, image decoding, unsupported characters, and overflow behavior, while keeping the Question Bank preview model separate from the Exam Layout Plan.
- Test Media Asset rules with PNG, JPEG, and WebP, normalized unsupported local images, duplicate references, hash mismatch, MIME mismatch, dimensions mismatch, missing assets, duplicate declarations, unreferenced assets, invalid base64, and unsupported SVG.
- Test every accepted resource limit at the boundary and immediately over it. Assert an actionable limit-specific validation error and no import proposal or durable write.
- At the authoring/persistence boundary, test that confirmed import generates fresh bank, Question, and choice identities; rewrites references; permits duplicate names; reuses identical content-addressed Media Assets; retains provenance; and commits all records atomically.
- Use the real IndexedDB adapter for transaction-abort tests. Reopen the database after injected failures and assert that neither a partial Question Bank nor newly orphaned Media Assets exist. Extend existing IndexedDB authoring and publication transaction tests as prior art.
- Test that importing the same Question Bank File twice creates two independent banks with distinct local identities and shared content-addressed Media Asset storage. Do not add duplicate-warning or replacement assertions.
- Test that import creates no Exam, does not dirty or alter an active Working Copy, and does not change existing Question Banks.
- At the browser seam, use accessible controls to export an active non-empty Question Bank, inspect the browser download name, select a PDF for import, review record-derived confirmation, optionally rename the bank, confirm, and observe the new bank open with all Questions.
- Browser tests should assert teacher-visible outcomes and browser contracts following the repository's browser assertion guidance. Prefer roles, labels, visible summaries, downloaded files, and reopened durable resources over CSS classes or geometry.
- Browser coverage includes empty-bank export prevention, contains-answers notice, unresolved edit handling, export media failure, no partial download, import summary, cancellation, invalid-file errors, unsupported-version errors, transaction failure, successful open-after-import, refresh persistence, duplicate-name import, and unchanged active Exam.
- Test keyboard focus and modal behavior using the existing export dialog as accessibility prior art: initial focus, trapped Tab order, Escape cancellation, disabled controls during preparation or commit, recoverable error focus, and focus restoration after cancellation.
- Test that Question Bank export creates no Exam Export Record and does not alter bank update timestamps or Working Copy save state.
- Test sanitized filenames for ordinary names, punctuation, Unicode, whitespace, empty names, and platform-unsafe characters.
- Run the standard unit suite, browser end-to-end suite, build, and lint. Also run the heavyweight export comparison because implementation will modify PDF generation or shared low-level PDF drawing; existing Exam PDF and DOCX parity must remain unchanged.

## Out of Scope

- Importing or exporting Exams.
- Attaching Question Bank Records to existing Exam PDF or DOCX Export Artifacts.
- A DOCX Question Bank carrier.
- A standalone JSON, ZIP, SQLite, Parquet, or proprietary Question Bank package.
- Importing a selected subset of a Question Bank or only Questions used by an Exam.
- Creating an Exam or changing a Working Copy during import.
- Merge, replace, update, synchronization, conflict resolution, or duplicate detection for previously imported banks.
- Preserving source bank, Question, or choice identities as local or cross-installation synchronization identities.
- Question Bank export history or Export Records for sharing events.
- OCR, PDF text extraction, image extraction, visual-layout parsing, or reconstruction when the canonical attachment is absent.
- Treating PDF image XObjects as canonical Media Assets or referencing PDF object numbers from the public record.
- Detecting handwritten annotations or comparing independently edited PDF pages with the Question Bank Record.
- Cryptographic author signatures, trusted identity, certificate handling, or proof of license ownership.
- Encrypted or password-protected Question Bank Files.
- PDF/A conformance.
- SVG or arbitrary file attachments as Media Assets.
- Remote Media Asset URLs or authenticated downloads.
- A general v0 extension namespace or independent versioning of every Question Type and rich-text feature.
- Partial import, placeholder Questions, or silent loss of unsupported content.
- Byte-identical PDF output, exact print layout, Exam export page parity, or a promise that the preview is optimized for paper.
- Migrating pre-release schemas for which no explicit parser or migration has been retained.

## Further Notes

- This specification implements the accepted decision in ADR-0018 and uses the glossary definitions of Question Bank File and Question Bank Record.
- The feature depends on the in-progress multiple-Question-Bank resource model and atomic Media Asset persistence. It should integrate with those accepted boundaries rather than extending the temporary one-bank storage model visible in the current branch.
- The PDF contains up to two physical representations of each unique image for deliberate reasons: canonical source bytes in the record and renderer-oriented image data for the preview. PDF image objects are unstable under rewriting and may not preserve original PNG, WebP, transparency, color-profile, or metadata bytes.
- `pdf-canonical-extraction` identifies the one canonical record under the pdfcx convention. The Test Parrot format identifier and version determine whether that record is a Question Bank Record the application understands.
- The record digest is required for corruption detection but is not retained for duplicate-import behavior. Every confirmed import creates a new bank.
- The public format is pre-release. Any incompatible v0 evolution requires a new explicit format version and deliberate importer support rather than permissive version-range matching.
- Published to GitHub as #55, with implementation slices #56 through #62.
