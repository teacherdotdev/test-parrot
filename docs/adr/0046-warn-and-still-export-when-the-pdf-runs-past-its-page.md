---
status: accepted
---

# Warn, and still export, when the PDF runs past its page

The PDF Export Adapter draws each page from the Layout Plan (ADR-0001), which packed it from heights the browser measured off print's own markup. The adapter sets text by its own font metrics, so a page can come out a little taller in the PDF than it was packed. Until now, any content that ran past the foot of its planned content box stopped the export with "PDF content does not fit its planned page n. Shorten the affected content or change its layout, then try again."

That message left teachers stuck. It named a page but not what on it was too tall, and the page looked fine in the preview, so there was nothing obvious to shorten. A converted exam with a table under a picture in a Part failed on whatever page that question went to, and only deleting the question let the exam export at all.

**A PDF whose content runs past a planned page is still made.** The adapter draws every page exactly as planned, letting what runs over continue into that page's bottom margin; it never clips, shrinks or repaginates. It reports the pages it did this on, counted across the whole file as a PDF viewer counts them, and once the download has started the teacher sees a warning that stays until they dismiss it: "Page 3 of the PDF runs past its bottom margin. Check it before printing." The Export Record is committed as for any other export.

Parity is still guarded where it was: `bun test` holds the adapters to the plan, and a mismatch found there is fixed in the adapter. This changes only what a teacher sees when one slips through to a real exam — a file to check, instead of no file at all. Content the plan itself cannot fit, such as a single Part taller than a whole page, is reported the same way.
