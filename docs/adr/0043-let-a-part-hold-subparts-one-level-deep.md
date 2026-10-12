---
status: accepted
---

# Let a Part hold Subparts, one level deep

Structured exam papers number their questions 2(a)(i): a Part that opens with shared material and then asks several numbered questions of its own. A Multipart question (ADR-0024) had only one level of Parts, so such a Part had to be flattened, losing its lead-in, or split into Questions, losing its place.

A Part may now hold **Subparts**, numbered (i), (ii)… in authored order. A Subpart is a Multiple Choice or Short Answer question like a Part, but never holds Subparts of its own, so 2(a)(i) is as deep as a Multipart question goes. **A Part either answers or holds Subparts, never both**: a Part with Subparts has a stem only, their shared lead-in, and no answers, Suggested Answer or Points of its own. Subparts are never shuffled, for the reason Parts are not; a Multiple Choice Subpart's answers Vary as a Part's do. Question Metadata stays on the Multipart question; the Answer Key records one line per Subpart where a Part has them.

- **Fixed depth, not recursion.** A Part holding Parts to any depth, lettered a → i → A → 1, was considered. Every paper asked about stops at the third level, and a fixed depth keeps the editor, the record, the Layout Plan and both Export Adapters to one more known level rather than a recursive one. A deeper level can be added later as another named level without changing what a Subpart is.
- **Answering or holding, not both.** A Part that answered and also held Subparts would need its own answer printed between its stem and its first Subpart, a place no paper uses; the papers write a Part with Subparts as lead-in only.
- **Editing.** A Part's menu offers **Add Subparts**, which turns the Part into a lead-in and its current answers, Suggested Answer and Points into Subpart (i), so nothing typed is lost. Removing the last Subpart turns the Part back into an answering Part with that Subpart's answers.
- **Labels belong to the Paper Style** (ADR-0044): `a.` and `i.` under the existing styles, `(a)` and `(i)` under Exam Board.

Question Bank Record `0.9.0` gives a Part an optional `subparts` array, each shaped like an answering Part, and refuses a Part carrying both `subparts` and answers.
