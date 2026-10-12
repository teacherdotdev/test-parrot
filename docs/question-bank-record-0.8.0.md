# Question Bank Record 0.8.0

> **Superseded by [Question Bank Record 0.9.0](question-bank-record-0.9.0.md).** Test Parrot no longer produces `0.8.0` records; it still reads them, and this contract is frozen so that every Question Bank File already shared keeps opening. A `0.8.0` record says nothing about Locked Answers, so its answers are locked or not by their wording once imported. The one fixture that changes after publication is `invalid/unsupported-version.json`, which names a version no Test Parrot parser implements — each time a newer version ships, it has to name the one after that to keep meaning it.

The **Question Bank Record** is the authoritative, portable representation of one complete Question Bank. It travels inside a [Test Parrot Package](test-parrot-package-0.1.0.md), which travels in a zip beside the picture files the record names. That zip is embedded in a **Question Bank File**, whose PDF pages are only a teacher-readable preview. The record, not the pages, controls import.

## Published contract

- Format: `test-parrot/question-bank`
- Version: `0.8.0`
- Stable schema identifier: `https://testparrot.com/formats/question-bank/0.8.0/schema.json`
- Checked-in schema: [`/formats/question-bank/0.8.0/schema.json`](../public/formats/question-bank/0.8.0/schema.json)
- [Canonical examples](../public/formats/question-bank/0.8.0/examples/)
- [Invalid counterexamples](../public/formats/question-bank/0.8.0/invalid/)
- Superseded but still readable: [Question Bank Record 0.7.0](question-bank-record-0.7.0.md), [Question Bank Record 0.6.0](question-bank-record-0.6.0.md), [Question Bank Record 0.5.0](question-bank-record-0.5.0.md), [Question Bank Record 0.4.0](question-bank-record-0.4.0.md), [Question Bank Record 0.3.0](question-bank-record-0.3.0.md), [Question Bank Record 0.2.0](question-bank-record-0.2.0.md) and [Question Bank Record 0.1.0](question-bank-record-0.1.0.md)

The schema is the machine-readable structural contract; this document supplies semantics that JSON Schema cannot express. Implementations must perform both structural and semantic validation.

## Envelope and compatibility

Every record has these required members:

| Member             | Meaning                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`           | Exactly `test-parrot/question-bank`.                                                                                                                |
| `formatVersion`    | The exact version of this contract, `0.8.0`.                                                                                                        |
| `generator`        | Informational producer name and version. Consumers must not gate conformance on either value.                                                       |
| `requiredFeatures` | Semantic capabilities required to consume the record without loss. An importer must reject an unknown entry. It may ignore unknown optional fields. |
| `bank`             | Name, optional provenance, and non-empty ordered Questions.                                                                                         |
| `media`            | Media Asset declarations used by Question Content, each naming a file in the package's zip; empty when no image carries bytes.                     |

### What 0.8.0 changed

`0.8.0` changes only how a Media Asset's bytes travel. Through `0.7.0` each Media Asset carried its bytes in the record as base64 `bytes`; from `0.8.0` it names its `file` instead, a path in the zip the record's package travels in (see [Media Assets](#media-assets) and [The package zip](#the-package-zip)). A picture of a few megabytes no longer makes the record a string of several million characters, and the record stays readable in a text editor. A record that declares no Media Asset — one with no pictures, or whose pictures are all Pending Images — is otherwise the same in `0.7.0` and `0.8.0`.

An older consumer must reject a `0.8.0` record, since it would find no bytes for any picture, which is why the change is a minor version rather than a patch. A consumer reads a `0.1.0`–`0.7.0` record's base64 `bytes` as before.

`0.7.0` added the **Picture Crop**, an optional `crop` on a block image that carries an `asset` (see [Picture Crops](#picture-crops)), and changed what `authoredSize` means: from `0.7.0` it is the width of what the picture shows as a share of its container, where through `0.6.0` it was a ratio against the width the picture fit its container at. A consumer reads a `0.1.0`–`0.6.0` record's `authoredSize` with the meaning that record's version gave it, so a picture in a Question Bank File already shared prints at the size it always did; a producer that rewrites such a record as `0.8.0` converts each size to a share. Before that, `0.6.0` added the Side-by-Side, `0.5.0` the Pending Image, `0.4.0` `multipart`, `0.3.0` `matching` and `0.2.0` `true-false`.

A producer writes `0.8.0`. A consumer implements `0.1.0`, `0.2.0`, `0.3.0`, `0.4.0`, `0.5.0`, `0.6.0`, `0.7.0` and `0.8.0` — a Question Bank File that has already been shared must keep opening — and reports to the teacher the version the file declared, not the version it migrated to.

Importers accept only exact versions for which they implement a parser or migration. They must not infer compatibility from a SemVer range or accept every `0.x` version. During major version zero, a **patch** change is a compatible clarification or addition; a **minor** change may be incompatible and requires explicit parser or migration support. Major version one will establish the first stable compatibility commitment.

Unknown optional fields may be ignored and need not survive re-export. Unknown Question Types, semantic nodes, marks, enum values that affect meaning, and required features must reject the entire record rather than be silently discarded. Child nodes belong only in a node's `content`, and marks only in its `marks`: a node written under any other member, such as a table nested in a paragraph's `table` member, is misplaced Question Content, not an optional field, and rejects the record.

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
- images: `inline-image` and `block-image`, each carrying a Media Asset or a Pending Image;
- layout: `side-by-side` and its `panel`s, in a stem only (see [Side-by-Side](#side-by-side)).

Text marks are `strong`, `emphasis`, `inline-code`, `strike`, `subscript`, `superscript`, and `link`. A link requires an absolute HTTP or HTTPS `href` and may have `title`. Other schemes, including `javascript:`, `data:`, `file:`, and custom application schemes, are unsafe and invalidate the record.

`inline-math` and `display-math` carry authored math in `source`. A `code-block` carries text and an optional language. `header` identifies table header rows or cells. `hard-break` represents an authored break and must not be inferred from renderer wrapping.

### Side-by-Side

A **Side-by-Side** lays two or three **Panels** across one line of a stem, left to right: two graphs a question compares, two tables, a table beside a graph, a picture beside the text about it.

```json
{
  "type": "side-by-side",
  "content": [
    { "type": "panel", "content": [{ "type": "block-image", "asset": "sha256:…", "alt": "Graph A" }] },
    { "type": "panel", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "…" }] }] }
  ]
}
```

- A `side-by-side` holds two or three `panel` nodes, in reading order, and nothing else. It has no other members: how wide each Panel is, and how its content is aligned, is presentation a consumer decides, not part of the record.
- A `panel` holds one or more blocks — any block a stem may hold except a `side-by-side`: `paragraph`, `heading`, `blockquote`, the lists, `code-block`, `display-math`, `rule`, `table`, and `block-image`, which may be a Pending Image. A `panel` appears nowhere but directly inside a `side-by-side`.
- A `side-by-side` appears only as a top-level block of a Question's `stem` or of a Multipart Part's `stem`. It is not conforming in a choice, a Matching item, a Word Bank answer, or a Suggested Answer, and not inside a `blockquote`, a list item, a table cell, or a `panel` — a Side-by-Side never holds another.

The schema enforces all three rules: a Question's and a Part's `stem` are a `stemDocument`, whose top-level blocks may be Side-by-Sides, while every other document and every node's `content` admit neither node. A Side-by-Side is exchanged as its content, so a picture inside a Panel is an ordinary image node: its Media Asset is declared in `media` and a Pending Image in a Panel is resolved like any other.

## Marks

Marks decorate a `text` node through its ordered `marks` array. A mark's meaning applies to that text only. Consumers must preserve every supported mark and reject unsupported marks instead of flattening them. A `link` mark preserves its label in the text node and destination in `href`.

## Images, Media Assets and Pending Images

An image node carries exactly one of `asset` or `pending`. It may carry `alt`, `caption`, and `authoredSize` either way. `authoredSize` is the **Authored Image Size**: the width of what the picture shows as a share of its container — the Question Content lane, a Panel, or an answer's cell — from `0.05` through `1` inclusive, preserving the picture's proportions. An image without one fits its container at its own width, or the container's when that is narrower. A `block-image` with an `asset` may also carry a `crop`.

### Picture Crops

A **Picture Crop** is the part of a block image's Media Asset the picture shows. The Media Asset itself stays whole, so a consumer can always widen the crop again.

```json
{
  "type": "block-image",
  "asset": "sha256:…",
  "alt": "Triangle ABC",
  "authoredSize": 0.4,
  "crop": { "left": 0.25, "top": 0.1, "right": 0.75, "bottom": 0.6 }
}
```

- `crop` has exactly the four members `left`, `top`, `right` and `bottom`, each a number from `0` through `1`: fractions of the width and height of the upright picture — after any EXIF orientation a camera photo carries — measured from its top-left corner.
- `left` must be less than `right` and `top` less than `bottom`. The schema cannot compare two numbers, so this rule is semantic; a crop that breaks it invalidates its Question.
- Only a `block-image` that carries an `asset` may have a `crop`. A crop on an `inline-image` or on a Pending Image invalidates its Question: a Pending Image is cropped only once it has a Media Asset.
- A crop that keeps the whole picture, `{ "left": 0, "top": 0, "right": 1, "bottom": 1 }`, is conforming, but a producer omits it.
- `authoredSize` is the width of the kept part, not of the whole Media Asset. Every rendering shows only the kept part.

### Media Assets

An image node with `asset: "sha256:<64 lowercase hex digits>"` identifies its bytes. Each referenced asset appears exactly once in `media` with:

- the same `id` content address;
- `mimeType`: `image/png`, `image/jpeg`, or `image/webp`;
- positive pixel `width` and `height` (each no more than 20,000) of the upright picture, after any EXIF orientation a camera photo carries;
- `file`: the path, inside the package's zip, of the file holding the asset's canonical source bytes. It is `media/`, the `id` with its colon written as a hyphen, and the extension the MIME type takes — `.png`, `.jpg` or `.webp` — so an asset `sha256:3eb6…8672` of type `image/png` names `media/sha256-3eb6…8672.png`.

```json
{
  "id": "sha256:3eb6d464a6c5947d4bd697a140ce49868dab5c038eb708985432c2fa4c108672",
  "mimeType": "image/png",
  "width": 40,
  "height": 20,
  "file": "media/sha256-3eb6d464a6c5947d4bd697a140ce49868dab5c038eb708985432c2fa4c108672.png"
}
```

A `0.8.0` Media Asset must not carry `bytes`; one that does invalidates the record. Every image reference must resolve, every declaration must be referenced, IDs must be unique, every named file must be in the zip, and the file's MIME type, dimensions, and SHA-256 digest must match their declarations. A named file missing from the zip rejects the whole record rather than leaving a picture blank. A file under the zip's `media/` that no Media Asset in its package names rejects the package, as a Media Asset nothing references rejects its record; any other file in the zip is ignored.

A record read outside a zip — a bare JSON file, or one an AI assistant wrote — has no files, so it may declare no Media Asset: its pictures, if any, are Pending Images. A consumer rejects such a record if it declares one. Other locally supported image forms must be normalized to PNG before record creation; SVG is not exchanged.

### Pending Images

A **Pending Image** is an image whose bytes the record does not carry yet. It exists so that a producer that cannot encode image bytes — an AI assistant converting a teacher's test, for example — can still say exactly where each picture belongs. Its `pending` member is an object with exactly one member:

- `image`: a positive integer naming an **Image Tag**, the numbered label such as “IMG 3” that Test Parrot prints on each picture in a labeled copy of the teacher's **Source Document**; or
- `page`: a positive integer naming the 1-based page of the Source Document the picture is on, counted the way a PDF viewer counts pages (always `1` for a Word document, which has no fixed pages), for a picture that has no tag.

```json
{
  "type": "block-image",
  "pending": { "image": 3 },
  "alt": "Map of the bus routes in Riverton",
  "caption": "Riverton Bus Routes, 2020"
}
```

A Pending Image with both `asset` and `pending`, an empty `pending`, one naming both `image` and `page`, a zero, negative or fractional number, or any other member in `pending` invalidates the record. A record may hold Pending Images and an empty `media` array; every declared Media Asset must still be referenced. The same tag may appear in several places — a picture shared by several Questions is repeated in each — and names the same picture every time. A Pending Image may sit anywhere an image may, a Multipart question's shared material and its Parts included.

A Pending Image is conforming but incomplete, as an unmatched Matching item is. A consumer keeps it as it is until it is resolved with a Media Asset, and re-exports it unchanged. Image Tags are numbered by the Source Document, not by the record: a tag means nothing without the Source Document it was printed on, and a consumer that has none must leave the Pending Image unresolved rather than guess.

## The package zip

A `0.8.0` record travels in a [Test Parrot Package](test-parrot-package-0.1.0.md), and the package travels in a zip:

- `parrot.json` at the zip's root is the package, UTF-8 JSON;
- `media/` holds each file a Media Asset in the package names, stored as the asset's canonical source bytes.

Nothing about the zip is in the record: a Media Asset's `file` says only where its bytes are found. The same zip is embedded in a Question Bank File and in an Exam PDF that includes the answer key, and can be downloaded on its own as `*.parrot.zip`.

## Question Bank File carrier

A conforming Question Bank File is an ordinary, unencrypted PDF. It carries exactly one authoritative attachment, the package zip, with all of this metadata:

| PDF attachment property                          | Exact value                |
| ------------------------------------------------ | -------------------------- |
| file name                                        | `parrot.zip`               |
| MIME type                                        | `application/zip`          |
| description (`/Desc`)                            | `pdf-canonical-extraction` |
| associated-file relationship (`/AFRelationship`) | `Source`                   |

The package in it holds exactly one Question Bank Record and no Exam Records. A consumer finds the attachment by its description. A Question Bank File written before `0.8.0` carries a bare `0.1.0`–`0.7.0` record as `pdfcx.json`, `application/json`, under the same description, and still imports.

Image bytes intentionally have up to two physical representations in a Question Bank File: canonical source bytes in the zip and renderer-oriented image data in the PDF preview. This supports exact, editable offline import while allowing ordinary PDF viewing. PDF image XObjects are unstable under rewriting and are never referenced by the public record; repeated preview occurrences should reuse one PDF image object where possible.

The PDF preview is a teacher aid containing answers. It is generated from the record but is not authoritative, and pagination has no durable parity promise. Rewriting or printing the PDF can strip the attachment and leave a preview-only document. Where the record has a Pending Image, the preview draws a bordered “picture needed” box naming its tag or page instead of a picture.

Importers must never reconstruct Questions from PDF page text, images, annotations, OCR, or layout. Question Content comes only from the record. The one thing a Source Document may supply is the bytes of a Pending Image, and only from the Source Document that Pending Image names — never from a Question Bank File’s own preview.

## Examples and counterexamples

The canonical examples cover a cropped block image, a minimal Multiple Choice bank, a True/False bank, a Matching bank with a distractor and an unmatched item, a Multipart question bank with Multiple Choice and Short Answer Parts and a Multipart question with no Parts yet, Short Answer with Suggested Answer, every supported rich-text node and mark, provenance and external links, referenced Media Assets, Pending Images: a tag in a stem, tags as Multiple Choice answers, a tag shared by two Questions, a page, and a Multipart question whose shared material and one of whose Parts are Pending Images; and Side-by-Sides: two graphs in a stem, a table beside a table, and a Multipart question whose shared material is a blockquote passage, its source line, and a picture beside text, with a Part whose stem holds three Panels. Each fixture directory is laid out as a package zip is: a record's `file` paths resolve against the directory it sits in, whose `media/` holds the files. Their formatting and generator values are deliberately not Test Parrot output requirements.

The invalid fixture manifest records the expected application-level rejection category for unsupported versions and required features, unsafe URLs, malformed Questions, dangling references, invalid Media Assets — a file whose bytes do not match its digest, a file missing from the zip, and a Media Asset still carrying base64 `bytes` — and malformed Pending Images: one with a Media Asset too, an empty one, one naming both a tag and a page, zero or negative numbers, and an unknown member; and misplaced or malformed Side-by-Sides: one Panel, four Panels, a Side-by-Side inside a Panel, one in a Multiple Choice answer, and one inside a blockquote; and malformed Picture Crops: an inverted one, one outside 0–1, one on a Pending Image, and one on an inline image. Conformance tests validate examples directly with an independent JSON Schema implementation, inspect them through Test Parrot's public import seam, validate Test Parrot-generated records against the published schema, and assert that schema vocabulary, adapters, and examples remain aligned.


## Implementation status

The Question Bank File workflow described by ADR-0018 and GitHub issue #55 is
implemented by the `0.8.0` exporter, importer, public fixtures, and contract
tests, with `0.7.0`, `0.6.0`, `0.5.0`, `0.4.0`, `0.3.0`, `0.2.0` and `0.1.0` retained as consumer versions.
Pending Images and Resolve Images are described by ADR-0027 and GitHub issue #88, Picture Crops and the Authored Image Size as a share of its container by ADR-0032, and Media Assets carried as files in the package zip by ADR-0036. Question Bank Files remain a resource-exchange format: they do not use
Exam Export Documents or Layout Plans and do not create Exam Export Records or
Question Bank export history.
