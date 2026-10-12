---
status: accepted
---

# Drop the Question Bank Record integrity digest

ADR-0018 originally gave every Question Bank Record a required SHA-256 digest over its RFC 8785 canonical form so that a record mangled by a PDF rewrite would be rejected rather than imported. The record's main producers turned out to be AI assistants following `/extract`, and the digest was the one step they could not perform without code execution: an assistant that skipped or invented it delivered a file Test Parrot refused, with no way for the teacher to fix it. Schema validation, cardinality and reference checks, and per-asset media hashes already reject a malformed record, and the digest never authenticated anyone. The `0.1.0` contract therefore has no `integrity` member at all — it was unreleased, so no producer depends on it — and a corrupted attachment is caught by those structural checks instead.
