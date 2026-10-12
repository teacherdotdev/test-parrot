# Question Bank Record 0.1.0

> **Superseded by [Question Bank Record 0.4.0](question-bank-record-0.4.0.md).** Test Parrot no longer produces `0.1.0` records; it still reads them, and this contract is frozen so that every Question Bank File already shared keeps opening. The one fixture that changes after publication is `invalid/unsupported-version.json`, which names a version no Test Parrot parser implements — each time a newer version ships, it has to name the one after that to keep meaning it.

The **Question Bank Record** is the authoritative, portable representation of one complete Question Bank. It is embedded in a **Question Bank File**, whose PDF pages are only a teacher-readable preview. The record, not the pages, controls import.

## Published contract

- Format: `test-parrot/question-bank`
- Version: `0.1.0`
- Stable schema identifier: `https://testparrot.com/formats/question-bank/0.1.0/schema.json`
- Checked-in schema: [`/formats/question-bank/0.1.0/schema.json`](../public/formats/question-bank/0.1.0/schema.json)
- [Canonical examples](../public/formats/question-bank/0.1.0/examples/)
- [Invalid counterexamples](../public/formats/question-bank/0.1.0/invalid/)

The schema is the machine-readable structural contract; this document supplies semantics that JSON Schema cannot express. Implementations must perform both structural and semantic validation.

## Envelope and compatibility

Every record has these required members:

| Member             | Meaning                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`           | Exactly `test-parrot/question-bank`.                                                                                                                |
| `formatVersion`    | The exact version of this contract, `0.1.0`.                                                                                                        |
| `generator`        | Informational producer name and version. Consumers must not gate conformance on either value.                                                       |
| `requiredFeatures` | Semantic capabilities required to consume the record without loss. An importer must reject an unknown entry. It may ignore unknown optional fields. |
| `bank`             | Name, optional provenance, and non-empty ordered Questions.                                                                                         |
| `media`            | Media Asset declarations used by Question Content; empty when no image is used.                                                                     |

Importers accept only exact versions for which they implement a parser or migration. They must not infer compatibility from a SemVer range or accept every `0.x` version. During major version zero, a **patch** change is a compatible clarification or addition; a **minor** change may be incompatible and requires explicit parser or migration support. Major version one will establish the first stable compatibility commitment.

Unknown optional fields may be ignored and need not survive re-export. Unknown Question Types, semantic nodes, marks, enum values that affect meaning, and required features must reject the entire record rather than be silently discarded.

## Identity and ordering

`bank.questions` is in canonical authored Question order. A Question has a package-local ordinal ID such as `q1`; a Multiple Choice choice has one such as `q1-c1`. These IDs exist only to make references inside one record readable. They are not local application identities, synchronization keys, or IDs to preserve on import. An application creates fresh local IDs for an imported bank, its Questions, and its choices.

Media Asset IDs are different: `sha256:<digest>` is a content address derived from immutable bytes. Implementations may use that hash to reuse identical media locally. It is not the identity of a Question or Question Bank.

The contract contains no IndexedDB store names, local URL paths, editor-specific or ProseMirror-only node names, Exam references, Working Copies, Export Records, Exam Layout Plans, answer-column layout, local timestamps, or PDF object identifiers.

## Question Bank and provenance

`bank.name` is required. `description`, `author`, and `license` are optional, explicitly declared provenance. `license` has a display `name` and optional absolute HTTP or HTTPS `url`. A producer must not infer provenance from an account, school, email, device, browser, file path, or the time of export. Declared provenance is information, not verified identity or proof of license ownership.

## Question Types and metadata

Every Question has `id`, `type`, and a semantic `stem`. Optional Question Metadata consists of `difficulty` (`easy`, `medium`, or `hard`) and ordered `topics` strings.

### Multiple Choice

A `multiple-choice` Question has an authored `choices` list of at least two entries. Choice content is outside the stem tree. Each choice has a package-local `id`, semantic `content`, and boolean `correct`. Zero or one choice may be correct; zero is conforming but represents incomplete authoring. A Multiple Choice Question must not contain `suggestedAnswer`.

### Short Answer

A `short-answer` Question has no choices and may have a rich-text `suggestedAnswer`. A structurally present but visibly blank stem is valid.

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

The canonical examples cover a minimal Multiple Choice bank, Short Answer with Suggested Answer, every supported rich-text node and mark, provenance and external links, and referenced Media Assets. Their formatting and generator values are deliberately not Test Parrot output requirements.

The invalid fixture manifest records the expected application-level rejection category for unsupported versions and required features, unsafe URLs, malformed Questions, dangling references, and invalid Media Assets. Conformance tests validate examples directly with an independent JSON Schema implementation, inspect them through Test Parrot's public import seam, validate Test Parrot-generated records against the published schema, and assert that schema vocabulary, adapters, and examples remain aligned.


## Implementation status

The Question Bank File workflow described by ADR-0018 and GitHub issue #55 is
implemented by the `0.1.0` exporter, importer, public fixtures, and contract
tests. Question Bank Files remain a resource-exchange format: they do not use
Exam Export Documents or Layout Plans and do not create Exam Export Records or
Question Bank export history.
