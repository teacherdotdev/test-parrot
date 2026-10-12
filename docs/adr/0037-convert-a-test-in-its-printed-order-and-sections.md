---
status: accepted
---

# Convert a test in its printed order and sections

A teacher who imported a test through an assistant got it back sorted by Question Type: every Multiple Choice question first, then True/False, and so on, under Test Parrot's default headings. Their test had its own parts, “Part A”, “Part B – Short Answer (10 points)”, some mixing kinds of question, and they had to rebuild them by hand.

ADR-0022 accepted the regrouping because an Exam Record could not represent a test that puts Short Answer first. ADR-0029 removed that limit: Exam Record `0.3.0` stores Sections, in any order and of any mix of types, each with its own heading and directions. The conversion instructions still asked for `0.1.0`, so nothing an assistant wrote could carry the test's own structure.

The instructions now ask for Exam Record `0.3.0`, with one Section for each heading the test prints, in printed order, and each position in the Section the test prints it in. A Section's heading and directions are transcribed exactly, point values included, except for ranges of source question numbers, which Test Parrot replaces with its own numbering. A Section is never split or merged by Question Type. A test with no headings is one Section whose heading is empty, so it prints none. Questions before the first heading get a Section of their own. A Section is kept even when none of its questions could be converted, so the teacher can see where they belong. Directions printed under a heading belong to the Section, and a Matching set whose only directions are those has a blank stem, so they never print twice.

The assistant still records nothing about how the test prints: no heading or text size and no Page Header. Those are the teacher's choices in Test Parrot, and reading them reliably from a scan is a guess.

This supersedes the part of ADR-0022 that regroups an assistant's Exam by Question Type. Test Parrot still reads `0.1.0` records the old way.
