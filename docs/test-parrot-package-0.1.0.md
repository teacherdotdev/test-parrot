# Test Parrot Package 0.1.0

A **Test Parrot Package** carries one or more Question Bank Records and any number of [Exam Records](exam-record-0.1.0.md) that reference Questions in them. It travels in a [package zip](#the-package-zip) beside the pictures its records name: embedded in every Question Bank File and in every exported Exam PDF whose Content Selection includes the answer key, or downloaded on its own as `*.parrot.zip`. Importing it lets the teacher choose which banks and Exams to bring in. See ADR-0022 and ADR-0036.

## Published contract

- Format: `test-parrot/package`
- Version: `0.1.0`, versioned separately from the records it carries
- Stable schema identifier: `https://testparrot.com/formats/package/0.1.0/schema.json`
- Checked-in schema: [`/formats/package/0.1.0/schema.json`](../public/formats/package/0.1.0/schema.json)
- [Canonical examples](../public/formats/package/0.1.0/examples/)
- [Invalid counterexamples](../public/formats/package/0.1.0/invalid/), with the application error code each is rejected with in `manifest.json`

## Envelope

| Member             | Meaning |
| ------------------ | ------- |
| `format`           | Exactly `test-parrot/package`. |
| `formatVersion`    | Exactly `0.1.0`. |
| `generator`        | `{ name, version }` of the software that wrote the package. Informational. |
| `requiredFeatures` | Features a reader must understand. Test Parrot 0.1.0 defines none, so a non-empty list is rejected. |
| `questionBanks`    | At least one `{ "id", "record" }`. `id` is a package-local bank id, unique within the package. `record` is a complete [Question Bank Record](question-bank-record-0.10.0.md) of any version Test Parrot reads, validated by that version's own schema and rules. |
| `exams`            | Zero or more complete Exam Records, each validated by its own version's schema and rules. |

A bare Question Bank Record file remains importable and reads as a package with one bank and no Exams. An Exam Record on its own is not importable.

The package format did not change when pictures moved out of the record: it validates each record against that record's own version, so a package may carry `0.1.0`–`0.7.0` records with base64 Media Assets beside `0.8.0` records that name files in the zip.

## Validation

The whole file is accepted or rejected; nothing is imported from a file that fails any rule. A package is rejected when:

- any format or version, of the package or of anything in it, is unsupported;
- bank ids are duplicated;
- any bank breaks a Question Bank Record rule or limit;
- an Exam references a bank or Question that is not in the package;
- an Exam uses one Question twice;
- a position option does not fit its Question's type;
- an answer order is not an exact permutation of the Question's answers.

A bank may hold Questions no Exam uses. An Exam may draw on several banks in its package but never on a bank outside it.

Every Question Bank Record limit applies to each bank. The Question count and total decoded media limits also apply across the whole package, and a package holds at most 100 banks and 100 Exams.

## The package zip

Test Parrot writes every package as a zip:

- `parrot.json` at the zip's root is the package, UTF-8 JSON;
- `media/` holds each picture a Media Asset of a [Question Bank Record](question-bank-record-0.10.0.md), from `0.8.0`, names in its `file`, named by its SHA-256 digest and MIME type, such as `media/sha256-<64 hex digits>.png`, `.jpg` or `.webp`.

Nothing about the zip is in the package: a Media Asset's `file` says only where its bytes are found. The importer reads a zip file directly, or takes one out of a PDF, then reads it one way. A zip with no `parrot.json`, a `0.8.0` Media Asset whose file is not in the zip, and a file under `media/` that no Media Asset names each reject the whole zip. Any other file in the zip is ignored.

A bare JSON package or record, without a zip, is still accepted — an AI assistant cannot write a zip, and never carries picture bytes, so its pictures arrive as Pending Images. It has no files, so a `0.8.0` or later record in it may declare no Media Asset; a `0.1.0`–`0.7.0` record keeps its base64 ones.

## Importing

The teacher allows or denies each bank and Exam. Denying a bank denies every Exam that uses it; allowing an Exam allows every bank it uses. Each allowed bank goes into a new Question Bank, named from its record unless the teacher renames it, or is added to an existing Question Bank. Adding always appends fresh Questions, never deduplicates, and keeps the existing bank's name, description, author and license. Every Question and answer gets a fresh local identity, and Media Assets are stored by content hash.

## PDF carriers

A Question Bank File and an Exam PDF exported with its answer key each carry the package zip as one attachment with this metadata:

| PDF attachment property                          | Exact value                |
| ------------------------------------------------ | -------------------------- |
| file name                                        | `parrot.zip`               |
| MIME type                                        | `application/zip`          |
| description (`/Desc`)                            | `pdf-canonical-extraction` |
| associated-file relationship (`/AFRelationship`) | `Source`                   |

The importer finds the attachment by its description, so one importer reads both. A PDF written before the zip carries its record or package as `pdfcx.json`, `application/json`, under the same description, and still imports.

A Question Bank File's package holds exactly one bank and no Exams. An Exam PDF's package holds one Exam Record for exactly what that PDF printed and one bank, named “‹Exam name› Question Bank”, containing exactly that Exam's Questions in Exam order, whichever banks they came from. The owning banks' names and descriptions stay home; an author or license travels only when every contributing bank declares the same one. Student-only PDFs and DOCX exports carry nothing.
