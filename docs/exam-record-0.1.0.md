# Exam Record 0.1.0

The **Exam Record** is the portable composition of one Exam: its name and, for each position, the Question it uses, with that position's answer columns, answer order and Work Space. It never carries Question Content. It references Questions in Question Bank Records that travel beside it in the same [Test Parrot Package](test-parrot-package-0.1.0.md), and it is importable only inside one. See ADR-0022.

## Published contract

- Format: `test-parrot/exam`
- Version: `0.1.0`, versioned separately from the Question Bank Record and the Test Parrot Package
- Stable schema identifier: `https://testparrot.com/formats/exam/0.1.0/schema.json`
- Checked-in schema: [`/formats/exam/0.1.0/schema.json`](../public/formats/exam/0.1.0/schema.json)
- [Canonical examples](../public/formats/exam/0.1.0/examples/)
- Invalid counterexamples live with the package, since an Exam Record is validated there: [`/formats/package/0.1.0/invalid/`](../public/formats/package/0.1.0/invalid/)

The schema is the structural contract; this document supplies the rules JSON Schema cannot express. Implementations must perform both.

## Envelope

| Member          | Meaning                                                  |
| --------------- | -------------------------------------------------------- |
| `format`        | Exactly `test-parrot/exam`.                              |
| `formatVersion` | Exactly `0.1.0`. Importers accept exact versions only.   |
| `name`          | The Exam's name. An empty name imports as “Untitled Exam”. |
| `positions`     | The Exam's positions, in order. May be empty.            |

Unknown optional members are ignored and are not preserved on import.

## Positions

Each position has these members:

| Member        | Required | Meaning |
| ------------- | -------- | ------- |
| `question`    | yes      | `{ "bank": <package-local bank id>, "question": <that record's Question id> }`. |
| `columns`     | no       | `1`, `2` or `4`: how many columns a **Multiple Choice** Question's answers lay out in. Allowed on no other Question Type. |
| `answerOrder` | no       | A permutation of the Question's answer ids: its choice ids on **Multiple Choice**, or its Word Bank ids on **Matching**. It must list every answer exactly once. Allowed on no other Question Type; True/False answers are always True, then False. |
| `workSpace`   | no       | `{ "height", "style", "fill" }`, room left below a **Short Answer** Question for a student's working. Allowed on no other Question Type. `height` is in CSS pixels at 96 dpi and is snapped to whole ruled lines of 32 px on import; `style` is `blank` or `lines`; `fill` stretches the space to the foot of its page, with `height` the least room it takes. |

Semantic rules:

- Every `question` reference must resolve to a Question in a Question Bank Record in the same package.
- An Exam uses each Question at most once.
- Exam Records carry no point values.

## Sections and order

Test Parrot always prints Question Sections in its own order: Multiple Choice, True/False, Matching, Short Answer, Multipart. An Exam Record carries no Section order. On import, positions are stably regrouped into that order, keeping only their order within each Section. A record whose positions interleave Sections is conforming; it is not rejected and no warning is given.

## Defaults

- A Multiple Choice position without `columns` takes the answer columns of the Multiple Choice position before it, or one column if it is the first — the same rule that applies when a teacher adds a Question to an Exam.
- A position without `answerOrder` prints its answers in their authored order.
- A Short Answer position without `workSpace` leaves no room.
- A **Multipart** position (Question Bank Record `0.4.0`) carries only `question`. Answer order, answer columns and Work Space are set per Part in Test Parrot, and this version has no member for a Part's, so none of the three is allowed on a Multipart position and every Part imports with its defaults: answers in authored order, the default answer columns, and a Short Answer Part's default Work Space.

## Producers

Record `columns` only when the source layout makes them clear, and never guess `workSpace`.
