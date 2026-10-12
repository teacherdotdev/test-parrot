---
status: accepted
---

# Split a long matching set between its Items, repeating its Word Bank

ADR 0021 made each matching set one atomic page item, because a Word Bank on a different page from its Items is no use to a student. That held while every set fit on a page. A set taller than a full content box had nothing smaller to break into, so the plan placed it alone and let it overflow. Print clipped everything past the foot of the sheet without saying so, and a teacher's long set lost its last Items.

A set too long for a page now breaks between its Items, never inside one. The directions stay glued to the first Item, and every piece carries the whole Word Bank in the same shape (beside the Items or above them), so each page of Items has its answers in front of the student. This supersedes the "one atomic page item" clause of ADR 0021 and keeps its reason. A set that fits on a page still moves whole, exactly as before.

Repeating the bank costs paper, and a bank taller than a page by itself still overflows. Splitting the bank as well was rejected because a student would have to turn pages to match one Item. Refusing to export was rejected because the teacher's set is valid and prints fine once broken up.
