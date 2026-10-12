---
status: accepted
---

# Give True/False its own Question Type

Source documents hold True/False questions, and they had nowhere to go: True/False was not a Question Type, so a True/False question could only arrive as a two-choice Multiple Choice question, and then printed under Multiple Choice's heading and directions, which did not match it.

`'true-false'` is therefore a third Question Type, between Multiple Choice and Short Answer in Section order. It reuses the answer-choice machinery rather than a new correctness field: a True/False question stores the same `multipleChoice` node with exactly two choices, `True` and `False`, so correctness, stable choice identity, duplication, and the portable record all work as they already did. What the type changes is what a teacher can do with the pair and what the paper shows.

The pair is fixed. The editor draws it without a `contentDOM`, so there is nowhere to put a cursor and no "Add answer" button: a teacher marks which of the two is correct and cannot retype, split, or extend them. Shuffling answers skips the type entirely — True before False is a convention a student reads, not an authored order, and reversing it varies nothing.

The pair is not printed. A True/False question prints its statement with an answer blank, under directions that ask for a T or an F; the Answer Key records `T` or `F` rather than a choice letter. Printing `A. True  B. False` beneath every statement would be furniture, and it is not how the source documents teachers are converting are written.

The exchange format follows in the only way its own compatibility rule allows. A `0.1.0` consumer must reject an unknown Question Type outright, so adding one is a minor version: the Question Bank Record is now `0.2.0`, published beside `0.1.0` rather than in place of it. Test Parrot writes `0.2.0` and reads both, migrating a `0.1.0` record forward at its parser — the version added nothing a `0.1.0` record already says, so migration rewrites no content — while still reporting to the teacher the version their file declared.
