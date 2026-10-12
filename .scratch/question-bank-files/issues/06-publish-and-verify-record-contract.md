# 06: Publish and verify the 0.1.0 Question Bank Record contract

**What to build:** Make the Question Bank Record an implementable public contract rather than an internal TypeScript shape. Publish its versioned JSON Schema, prose semantics, canonical examples, invalid counterexamples, and conformance fixtures, then verify that Test Parrot's importer and exporter obey that contract independently of local editor and storage representations.

**Blocked by:** 03 “Carry Media Assets through Question Bank Files”; 04 “Carry Question Bank provenance and safe external links”; 05 “Enforce format compatibility and hostile-input limits”.

**Status:** ready-for-agent

**Published as:** GitHub issue #61

- [ ] A checked-in JSON Schema defines `test-parrot/question-bank` format version `0.1.0` and has a stable public schema identifier.
- [ ] Prose documentation defines the envelope, version policy, required-feature behavior, Question Types, semantic rich-text vocabulary, marks, links, image references, Media Assets, provenance, and integrity calculation.
- [ ] Documentation states that patch changes in major version zero are compatible clarifications or additions, while minor changes may be incompatible and require explicit parser or migration support.
- [ ] Documentation distinguishes package-local IDs, local application identities, and content-addressed Media Asset hashes.
- [ ] Documentation states that the Question Bank Record is authoritative, PDF pages are a teacher preview, and integrity does not prove authorship or page agreement.
- [ ] Documentation explains the intentional duplicate physical representation of image data in the record and PDF preview.
- [ ] Canonical examples include a minimal Multiple Choice bank, a Short Answer bank, a complete rich-text bank, a provenance-and-links bank, and a media-rich bank.
- [ ] Invalid counterexamples cover unsupported versions and required features, unsafe URLs, malformed Questions, bad references, bad integrity, and invalid Media Assets.
- [ ] RFC 8785 canonicalization and SHA-256 behavior are verified with fixed external conformance vectors.
- [ ] Schema examples validate with an implementation independent of application TypeScript types.
- [ ] Test Parrot's generated records validate against the public schema.
- [ ] Third-party-shaped conforming fixtures import even when their generator name and JSON formatting differ from Test Parrot output.
- [ ] Public examples imported into Test Parrot produce the documented Questions, provenance, links, and Media Assets.
- [ ] A record exported from those imported banks remains semantically conformant but does not need to preserve ignored unknown fields or original JSON bytes.
- [ ] The contract contains no IndexedDB store names, local URL paths, ProseMirror-only nodes, Exam Layout Plans, or other implementation details.
- [ ] The format documentation identifies the exact pdfcx attachment name, MIME type, description, and associated-file relationship.
- [ ] Automated conformance tests fail when supported schema vocabulary, application adapters, or canonical examples drift apart.
