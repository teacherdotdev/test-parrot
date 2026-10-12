# 03: Carry Media Assets through Question Bank Files

**What to build:** Extend the complete export/import path so image-bearing Questions remain self-contained and editable after sharing. Preserve canonical PNG, JPEG, and WebP bytes in the Question Bank Record, render those images in the PDF preview, verify them before import, and atomically reuse or persist content-addressed Media Assets with the new bank.

**Blocked by:** 01 “Export a complete media-free Question Bank File”; 02 “Import a media-free Question Bank File as a new bank”; external GitHub issue #53 “Complete local durability and Media Asset lifecycle”.

**Status:** ready-for-agent

**Published as:** GitHub issue #58

- [ ] Semantic inline and block image nodes reference Media Assets by `sha256:<digest>` rather than local URLs or PDF object identifiers.
- [ ] Image nodes retain optional alt text, optional caption, and optional Authored Image Size constrained from 0.05 through 1.
- [ ] The record stores each referenced Media Asset exactly once with SHA-256, MIME type, intrinsic width and height, and base64 source bytes.
- [ ] PNG, JPEG, and WebP are the supported v0 exchange formats.
- [ ] A locally supported image outside the portable set is normalized to PNG before record construction; SVG is not exchanged.
- [ ] The PDF preview renders every referenced image from the canonical record and reuses one renderer-oriented PDF image object for repeated occurrences when possible.
- [ ] The canonical source bytes remain in the attachment even though the PDF also contains renderer-oriented image data.
- [ ] The public record never references PDF object numbers or image XObjects.
- [ ] Missing required local media blocks export with an actionable Question-specific error and no download.
- [ ] Import verifies base64 validity, SHA-256, decoded MIME type, intrinsic dimensions, and supported format before confirmation.
- [ ] Every image reference must resolve and every declared Media Asset must be referenced; missing, duplicate, or unreferenced declarations reject the complete import.
- [ ] Media count and decoded total size appear in the import confirmation.
- [ ] Confirmed import atomically commits the Question Bank, Questions, and required Media Assets.
- [ ] Existing verified Media Assets with matching hashes are reused rather than duplicated.
- [ ] Importing the same file twice creates independent banks and Questions while sharing content-addressed Media Asset storage.
- [ ] A failed bank-plus-media transaction leaves neither a partial bank nor newly orphaned Media Assets after storage is reopened.
- [ ] Imported image-bearing Questions render correctly after navigation and refresh.
- [ ] Tests cover PNG, JPEG, WebP, normalized local input, inline and block images, captions, Authored Image Size, repeated references, hash mismatch, MIME mismatch, dimension mismatch, invalid base64, missing assets, duplicate declarations, unreferenced assets, and rejected SVG.
- [ ] Browser coverage exports and imports a realistic media-rich bank and verifies the resulting visible Questions rather than internal image geometry.
