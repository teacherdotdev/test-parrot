---
status: accepted
---

# Let a page break between a stem's blocks

Packing moves a question to the next page whole whenever a page would hold it, and breaks one that no page holds between its parts (ADR-0024, ADR-0043). A question's own stem could already break between its blocks, and a Multipart question's stem as a last resort. A Part's stem, a Part's lead-in and a Subpart's stem never could. Structured papers put a great deal in one Part — text, a tall figure, a table, then room to answer — and such a Part, taller than a page, fitted nowhere: it overflowed on whatever page it went to, and the PDF ran past its margin there (ADR-0046).

**A page may now break between the top-level blocks of any stem**: a question's stem, a Part's stem or lead-in, and a Subpart's stem. It never breaks inside a block — a paragraph, a picture, a table, a Side-by-Side or a Blockquote prints whole — and never between a picture and its caption.

- **A caption is structural.** A paragraph directly after a picture — a block picture, a paragraph of only pictures, or a Side-by-Side with a picture in it — goes with that picture. Reading the paragraph's wording ("Fig.", "Figure", "Table") was considered and left out: wording varies by paper and language, and the place a caption stands is the same in all of them. A long paragraph after a picture is kept with it too; it can still break before the picture.
- **Labels stay with their first block.** A question's number, a Part's letter and a Subpart's label print on the first piece, with the first block of their stem; a continued piece prints none, as a continued Part already did. A lead-in's last block stays with its Subpart (i) where a page holds both. A Part's room and its Points go with its last piece, and a choice grid moves whole, as a question's do.
- **Only what no page holds breaks.** This follows the existing policy rather than adding one: a question that fits a page moves whole; one that does not breaks between its Parts and Subparts, and each Part, lead-in with its Subpart (i), or Subpart that fits a page still moves whole. Only one taller than a page by itself breaks between its stem's blocks, filling the room left on the page it starts on. Breaking any Part at a page's foot to save paper was rejected: a student turning the page mid-Part is a cost paid only when nothing else fits.

Every adapter draws the pieces the Layout Plan made: a continued piece prints the stem blocks it carries and nothing above them, and the fingerprints compare those pieces page by page, so print, PDF and DOCX break in the same places.
