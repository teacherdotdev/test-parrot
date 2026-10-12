# Question Bank Record 0.4.0

> **Superseded by [Question Bank Record 0.5.0](question-bank-record-0.5.0.md).** Test Parrot no longer produces `0.4.0` records; it still reads them, and this contract is frozen so that every Question Bank File already shared keeps opening. The one fixture that changes after publication is `invalid/unsupported-version.json`, which names a version no Test Parrot parser implements — each time a newer version ships, it has to name the one after that to keep meaning it.

The **Question Bank Record** is the authoritative, portable representation of one complete Question Bank. It is embedded in a **Question Bank File**, whose PDF pages are only a teacher-readable preview. The record, not the pages, controls import.

## Published contract

- Format: `test-parrot/question-bank`
- Version: `0.4.0`
- Stable schema identifier: `https://testparrot.com/formats/question-bank/0.4.0/schema.json`
- Checked-in schema: [`/formats/question-bank/0.4.0/schema.json`](../public/formats/question-bank/0.4.0/schema.json)
- [Canonical examples](../public/formats/question-bank/0.4.0/examples/)
- [Invalid counterexamples](../public/formats/question-bank/0.4.0/invalid/)
- Superseded but still readable: [Question Bank Record 0.3.0](question-bank-record-0.3.0.md), [Question Bank Record 0.2.0](question-bank-record-0.2.0.md) and [Question Bank Record 0.1.0](question-bank-record-0.1.0.md)

The schema is the machine-readable structural contract; this document supplies semantics that JSON Schema cannot express. Implementations must perform both structural and semantic validation.

## Envelope and compatibility

Every record has these required members:

| Member             | Meaning                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`           | Exactly `test-parrot/question-bank`.                                                                                                                |
| `formatVersion`    | The exact version of this contract, `0.4.0`.                                                                                                        |
| `generator`        | Informational producer name and version. Consumers must not gate conformance on either value.                                                       |
| `requiredFeatures` | Semantic capabilities required to consume the record without loss. An importer must reject an unknown entry. It may ignore unknown optional fields. |
| `bank`             | Name, optional provenance, and non-empty ordered Questions.                                                                                         |
| `media`            | Media Asset declarations used by Question Content; empty when no image is used.                                                                     |

### What 0.4.0 changed

`0.4.0` adds the `multipart` Question Type and nothing else, as `0.3.0` added only `matching` and `0.2.0` only `true-false`. Every `0.3.0` record — and so every `0.2.0` and `0.1.0` record — is therefore also a conforming `0.4.0` record once its `formatVersion` is restated, and migration rewrites no content. The reverse does not hold: a `0.4.0` record containing a Multipart Question must be rejected by an older consumer, which is why the addition is a minor version rather than a patch.

A producer writes `0.4.0`. A consumer implements `0.1.0`, `0.2.0`, `0.3.0` and `0.4.0` — a Question Bank File that has already been shared must keep opening — and reports to the teacher the version the file declared, not the version it migrated to.

Importers accept only exact versions for which they implement a parser or migration. They must not infer compatibility from a SemVer range or accept every `0.x` version. During major version zero, a **patch** change is a compatible clarification or addition; a **minor** change may be incompatible and requires explicit parser or migration support. Major version one will establish the first stable compatibility commitment.

Unknown optional fields may be ignored and need not survive re-export. Unknown Question Types, semantic nodes, marks, enum values that affect meaning, and required features must reject the entire record rather than be silently discarded.

## Identity and ordering

`bank.questions` is in canonical authored Question order. A Question has a package-local ordinal ID such as `q1`; a Multiple Choice choice has one such as `q1-c1`, a Matching item one such as `q1-p1`, a Word Bank answer one such as `q1-a1`, a Multipart Part one such as `q1-s1` and a Part's own Multiple Choice choice one such as `q1-s1-c1`. These IDs exist only to make references inside one record readable — a Matching item names its answer by one. They are not local application identities, synchronization keys, or IDs to preserve on import. An application creates fresh local IDs for an imported bank, its Questions, its Parts, and its choices. The `s` prefix keeps a Part apart from a Matching item's `p`, and a Part choice carries its Part's ID so two Parts' choices never collide.

Media Asset IDs are different: `sha256:<digest>` is a content address derived from immutable bytes. Implementations may use that hash to reuse identical media locally. It is not the identity of a Question or Question Bank.

The contract contains no IndexedDB store names, local URL paths, editor-specific or ProseMirror-only node names, Exam references, Working Copies, Export Records, Exam Layout Plans, answer-column layout, local timestamps, or PDF object identifiers.

## Question Bank and provenance

`bank.name` is required. `description`, `author`, and `license` are optional, explicitly declared provenance. `license` has a display `name` and optional absolute HTTP or HTTPS `url`. A producer must not infer provenance from an account, school, email, device, browser, file path, or the time of export. Declared provenance is information, not verified identity or proof of license ownership.

## Question Types and metadata

Every Question has `id`, `type`, and a semantic `stem`. Optional Question Metadata consists of `difficulty` (`easy`, `medium`, or `hard`) and ordered `topics` strings.

### Multiple Choice

A `multiple-choice` Question has an authored `choices` list of at least two entries. Choice content is outside the stem tree. Each choice has a package-local `id`, semantic `content`, and boolean `correct`. Zero or one choice may be correct; zero is conforming but represents incomplete authoring. A Multiple Choice Question must not contain `suggestedAnswer`.

### True/False

A `true-false` Question has an authored `choices` list of exactly two entries, in the order a student reads them: the first is the affirmative answer and the second the negative. The pair is written out as ordinary choice content — `True` and `False` in English — so a consumer needs no table of what the type means and a bank may state the pair in its own language. Choices carry the same package-local `id`, semantic `content`, and boolean `correct` as Multiple Choice, and the same correctness rule: zero or one may be correct, and zero is conforming but represents incomplete authoring. A True/False Question must not contain `suggestedAnswer`.

The pair is the Question Type rather than authored variation. A consumer must not add to it, reorder it, or offer it for editing, and a producer must not shuffle it: a test that prints True before False on one copy and after it on another varies nothing a student answers.

### Matching

A `matching` Question is one matching set: its `stem` is the set's own directions, such as “Match each event to the correct time period.”, and may be visibly blank; its `prompts` are the items a student matches, at least one, in the order they are numbered; and its `wordBank` is the lettered list they are matched against, at least two answers, in authored order. Each item and each answer has a package-local `id` and semantic `content`.

An item is matched by naming an answer: its optional `answer` is the `id` of one of the same Question's Word Bank answers. Several items may name the same answer, an answer no item names is a distractor, and an item with no `answer` is unmatched — conforming, but representing incomplete authoring. An `answer` that is not an `id` in the Question's own Word Bank invalidates the record.

Neither list carries correctness or letters. An answer's letter is its position in the Word Bank as printed, so a producer that varies a test may shuffle the Word Bank — every item still names the same answer under its new letter — but must not reorder the items, which are numbered in place. On a test each item takes a question number of its own; the Question is one record because its items share one Word Bank. A Matching Question must not contain `choices` or `suggestedAnswer`, and no other Question Type may contain `prompts` or `wordBank`.

### Short Answer

A `short-answer` Question has no choices and may have a rich-text `suggestedAnswer`. A structurally present but visibly blank stem is valid.

### Multipart

A `multipart` Question is a stem with its Parts: its `stem` is usually the shared material a student answers from, such as a passage, a quote, an image, or a table, and its `parts` are the questions asked about it, in the order they are lettered. The stem is ordinary rich text: a source or attribution line is written as part of it, not as a field of its own. `parts` is required and may be empty; a Multipart question with no Parts is conforming but represents incomplete authoring, as a Multiple Choice Question with no correct choice does.

Each Part has a package-local `id`, a `type`, and its own semantic `stem`. A Part's `type` is `multiple-choice` or `short-answer`, and no other value is conforming — there are no True/False, Matching or Multipart Parts:

- A `multiple-choice` Part has an authored `choices` list of at least two entries, each with a package-local `id`, semantic `content`, and boolean `correct`, under the same correctness rule as a Multiple Choice Question: zero or one may be correct, and zero is conforming but represents incomplete authoring. It must not contain `suggestedAnswer`.
- A `short-answer` Part has no `choices` and may have a rich-text `suggestedAnswer`.

Question Metadata — `difficulty` and `topics` — belongs to the Multipart Question, not to its Parts: a Part is never a Question of its own. On a test a Multipart Question takes one question number and its Parts print lettered beneath it. A producer must not reorder the Parts, which are lettered in place and often build on one another; a producer that varies a test may shuffle a Multiple Choice Part's choices as it would a Multiple Choice Question's. A Multipart Question must not contain `choices`, `prompts`, `wordBank`, or `suggestedAnswer` of its own — each Part carries its own — and no other Question Type may contain `parts`.

Answer columns and Work Space are Exam presentation, as they are for a whole Question, and are not part of the record.

## Semantic rich text

A document is `{ "type": "document", "content": [...] }`. It is a format-owned semantic tree, not editor JSON.

Supported nodes are:

- blocks and structure: `paragraph`, `heading` (levels 1–6), `blockquote`, `bullet-list`, `ordered-list` (optional positive `start`), `list-item`, `code-block` (optional `language`), `rule`, `table`, `table-row`, and `table-cell`;
- inline/content nodes: `text`, `inline-math`, `display-math`, and `hard-break`;
- images: `inline-image` and `block-image`.

Text marks are `strong`, `emphasis`, `inline-code`, `strike`, `subscript`, `superscript`, and `link`. A link requires an absolute HTTP or HTTPS `href` and may have `title`. Other schemes, including `javascript:`, `data:`, `file:`, and custom application schemes, are unsafe and invalidate the record.

`inline-math` and `display-math` carry authored math in `source`. A `code-block` carries text and an optional language. `header` identifies table header rows or cells. `hard-break` represents an authored break and must not be inferred from renderer wrapping.

## Marks

Marks decorate a `text` node through its ordered `marks` array. A mark's meaning applies to that text only. Consumers must preserve every supported mark and reject unsupported marks instead of flattening them. A `link` mark preserves its label in the text node and destination in `href`.

## Images and Media Assets

An image node identifies its bytes with `asset: "sha256:<64 lowercase hex digits>"`. It may carry `alt`, `caption`, and `authoredSize`; authored size is a relative width from `0.05` through `1` inclusive and preserves intrinsic aspect ratio.

Each referenced asset appears exactly once in `media` with:

- the same `id` content address;
- `mimeType`: `image/png`, `image/jpeg`, or `image/webp`;
- positive intrinsic pixel `width` and `height` (each no more than 20,000);
- canonical source `bytes` encoded as strict base64.

Every image reference must resolve, every declaration must be referenced, IDs must be unique, and the decoded MIME type, dimensions, and SHA-256 digest must match their declarations. Other locally supported image forms must be normalized to PNG before record creation; SVG is not exchanged.

Image bytes intentionally have up to two physical representations in a Question Bank File: canonical source bytes inside the JSON attachment and renderer-oriented image data in the PDF preview. This supports exact, editable offline import while allowing ordinary PDF viewing. PDF image XObjects are unstable under rewriting and are never referenced by the public record; repeated preview occurrences should reuse one PDF image object where possible.

## Question Bank File carrier

A conforming Question Bank File is an ordinary, unencrypted PDF. It carries exactly one authoritative UTF-8 JSON attachment with all of this metadata:

| PDF attachment property                          | Exact value                |
| ------------------------------------------------ | -------------------------- |
| file name                                        | `pdfcx.json`               |
| MIME type                                        | `application/json`         |
| description (`/Desc`)                            | `pdf-canonical-extraction` |
| associated-file relationship (`/AFRelationship`) | `Source`                   |

The PDF preview is a teacher aid containing answers. It is generated from the record but is not authoritative, and pagination has no durable parity promise. Rewriting or printing the PDF can strip the attachment and leave a preview-only document. Importers must never reconstruct Questions from PDF page text, images, annotations, OCR, or layout.

## Examples and counterexamples

The canonical examples cover a minimal Multiple Choice bank, a True/False bank, a Matching bank with a distractor and an unmatched item, a Multipart question bank with Multiple Choice and Short Answer Parts and a Multipart question with no Parts yet, Short Answer with Suggested Answer, every supported rich-text node and mark, provenance and external links, and referenced Media Assets. Their formatting and generator values are deliberately not Test Parrot output requirements.

The invalid fixture manifest records the expected application-level rejection category for unsupported versions and required features, unsafe URLs, malformed Questions, dangling references, and invalid Media Assets. Conformance tests validate examples directly with an independent JSON Schema implementation, inspect them through Test Parrot's public import seam, validate Test Parrot-generated records against the published schema, and assert that schema vocabulary, adapters, and examples remain aligned.


## Implementation status

The Question Bank File workflow described by ADR-0018 and GitHub issue #55 is
implemented by the `0.4.0` exporter, importer, public fixtures, and contract
tests, with `0.3.0`, `0.2.0` and `0.1.0` retained as consumer versions. Question Bank Files remain a resource-exchange format: they do not use
Exam Export Documents or Layout Plans and do not create Exam Export Records or
Question Bank export history.
