# 05: Enforce format compatibility and hostile-input limits

**What to build:** Harden Question Bank File inspection so compatibility is explicit and untrusted PDFs cannot cause semantic loss or unreasonable browser work. Apply exact version support, required-feature negotiation, layered resource limits, schema validation, and semantic validation before presenting or persisting an import proposal.

**Blocked by:** 02 “Import a media-free Question Bank File as a new bank”; 03 “Carry Media Assets through Question Bank Files”; 04 “Carry Question Bank provenance and safe external links”.

**Status:** ready-for-agent

**Published as:** GitHub issue #60

- [ ] The importer maintains an explicit table of exact format versions for which it has a parser or migration.
- [ ] Numeric version ranges and “accept every 0.x” guesses are not used for compatibility.
- [ ] Unsupported versions fail before confirmation and identify both the file's version and versions supported by the application.
- [ ] Unknown optional fields are ignored and discarded.
- [ ] Unknown required features, Question Types, rich-text nodes, marks, and semantic enum values reject the whole record.
- [ ] Structural JSON Schema validation completes before semantic validation.
- [ ] Semantic validation covers unique package-local IDs, complete references, Question Type cardinality, supported vocabulary, safe URLs, integrity, Media Asset declarations, and decoded media properties.
- [ ] The maximum accepted PDF size is 100 MB.
- [ ] The maximum decoded canonical JSON attachment size is 75 MB.
- [ ] A record contains at most 10,000 Questions and 2,000 Media Assets.
- [ ] One decoded Media Asset is at most 25 MB and total decoded media is at most 75 MB.
- [ ] One Question contains at most 25,000 semantic document nodes and rich-text nesting depth is at most 50.
- [ ] Image dimensions do not exceed 20,000 by 20,000 pixels.
- [ ] Limits are checked before expensive allocation or durable writes wherever the file representation permits.
- [ ] Each limit has a distinct actionable error rather than a generic import failure.
- [ ] Any limit or validation failure yields no import proposal and makes no durable change.
- [ ] Malformed base64 and decompression or allocation hazards fail safely without leaving the application unresponsive.
- [ ] A conforming record from a generator other than Test Parrot is accepted; generator identity remains informational.
- [ ] Tests exercise every boundary exactly at its limit and immediately over it.
- [ ] Tests include malicious combinations such as deep nesting, excessive nodes, oversized declared and decoded media, duplicate IDs, dangling references, and unsupported required features.
- [ ] Browser coverage proves that representative invalid and unsupported files produce specific errors and leave current resources unchanged.
