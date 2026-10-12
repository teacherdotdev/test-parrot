# 04: Carry Question Bank provenance and safe external links

**What to build:** Let a teacher maintain optional Question Bank description, declared author, and license information and carry those attributes through the Question Bank File. Preserve useful web links while enforcing a narrow safe-link policy and clearly disclosing external references during import.

**Blocked by:** 01 “Export a complete media-free Question Bank File”; 02 “Import a media-free Question Bank File as a new bank”; external GitHub issue #45 “Create and manage multiple reusable Question Banks”.

**Status:** ready-for-agent

**Published as:** GitHub issue #59

- [ ] A Question Bank can persist an optional description, author, and license alongside its name.
- [ ] License is an optional object with a display name and optional safe URL.
- [ ] Teachers can explicitly edit these attributes through Question Bank management without a bank-level Save workflow.
- [ ] No author, school, email, device, browser, account, or file-path metadata is inferred or exported automatically.
- [ ] The Question Bank Record includes only provenance the teacher explicitly entered.
- [ ] The PDF preview displays description, declared author, and license when present without implying that Test Parrot verified them.
- [ ] Import confirmation displays the same provenance from the record before commit.
- [ ] Confirmed import stores provenance on the new independent Question Bank so it survives refresh and later re-export.
- [ ] HTTP and HTTPS are the only allowed link schemes in Question Content and license metadata for v0.
- [ ] Executable, embedded-data, local-file, and custom application schemes reject the complete import rather than becoming clickable content.
- [ ] Export never emits a disallowed link scheme into a Question Bank Record.
- [ ] Import confirmation reports whether external links are present.
- [ ] Link labels, destinations, and rich-text marks remain intact through export and import.
- [ ] The record includes no creation or export timestamps.
- [ ] Editing provenance is a substantive Question Bank update under the bank resource's ordinary persistence rules.
- [ ] Unit tests cover every accepted and rejected URL scheme, absent and partial optional provenance, and unchanged provenance through round trip.
- [ ] Browser tests edit provenance, inspect it in the teacher preview and import confirmation, import the file, refresh, and observe the retained values.
