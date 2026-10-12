---
status: accepted
---

# Make each Fill in the Blank sentence its own Question, with no Word Bank

Teachers write vocabulary quizzes as numbered sentences, each with a word left out for the student to write in. These had nowhere to go: an importer turned one into a Short Answer question with literal underscores in its stem and its answers flattened into a Suggested Answer.

`'fill-in-the-blank'` is therefore its own Question Type, after Matching in type order. Its stem is rich text holding one or more Blanks; each Blank holds its answer as rich text, and the Answer Key records the answers in the order the Blanks appear. The teacher makes a Blank by selecting words in a sentence they have already written, so the words become the answer. A Blank prints at one length on every paper, whatever its answer, so the length is never a clue; a first-letter hint is stem text the teacher types, not a setting.

**One sentence is one Question, never a set.** Matching was made one Question per set (ADR-0021) because its Word Bank defines it: take the answers away and the Items cannot be answered at all. A Fill in the Blank sentence can be answered without any list of words. A word bank for one, built from its answers and padded with extra words, is an accommodation: it makes a question easier for some students without changing what it asks. Modelling the sentences as a set around a shared bank was rejected for that reason, and so was a bank derived from a Section's Questions, which would make a Section own content for the first time. Neither is built: Fill in the Blank has no Word Bank, and accommodations are a later decision of their own.

**Several Blanks share one test number.** A sentence with two words to fill in is still one question to a student. Its Points belong to the whole Question, as a Matching set's do (ADR-0042); Points for each Blank can come later without breaking anything.

The Question Bank Record gains the type in a new minor version, as ADR-0020 and ADR-0021 did. Question Files that carry blank questions — GIFT missing-word, Moodle short-answer and cloze, QTI text entry, Blackboard fill-in-the-blank, Anki cloze — now import as Fill in the Blank with real Blanks, accepted answers written as `a / b`; a choice of words inside a sentence becomes a Blank holding the correct one and is reported as converted. A missing-word question with wrong choices stays Multiple Choice.
