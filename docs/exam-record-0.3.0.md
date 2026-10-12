# Exam Record 0.3.0

> **Superseded by [Exam Record 0.4.0](exam-record-0.4.0.md).** Test Parrot no longer writes `0.3.0` records; it still reads them, as Exams that hide no answers, keep the default Page Margins and print in the Standard Paper Style.

The **Exam Record** is the portable composition of one Exam: its name, its test-page header lines, its Question Sections in print order and how each one's heading reads, how large its headings and text print, and, for each position, the Question it uses, the Section it is in, and that position's answer columns, answer order and Work Space. It never carries Question Content. It references Questions in Question Bank Records that travel beside it in the same [Test Parrot Package](test-parrot-package-0.1.0.md), and it is importable only inside one. See ADR-0022 and ADR-0029.

## Published contract

- Format: `test-parrot/exam`
- Version: `0.3.0`, versioned separately from the Question Bank Record and the Test Parrot Package
- Stable schema identifier: `https://testparrot.com/formats/exam/0.3.0/schema.json`
- Checked-in schema: [`/formats/exam/0.3.0/schema.json`](../public/formats/exam/0.3.0/schema.json)
- [Canonical examples](../public/formats/exam/0.3.0/examples/)
- Invalid counterexamples live with the package, since an Exam Record is validated there: [`/formats/package/0.1.0/invalid/`](../public/formats/package/0.1.0/invalid/)

The schema is the structural contract; this document supplies the rules JSON Schema cannot express. Implementations must perform both.

## Envelope

| Member          | Meaning                                                  |
| --------------- | -------------------------------------------------------- |
| `format`        | Exactly `test-parrot/exam`.                              |
| `formatVersion` | Exactly `0.3.0`. Importers accept exact versions only.   |
| `name`          | The Exam's name. An empty name imports as “Untitled Exam”. |
| `sections`      | The Exam's Question Sections, in the order they print. May be empty. See below. |
| `headingSize`   | Optional. `small`, `normal` or `large`: how large every heading prints — the Exam's title, and each section heading and its directions. Absent means `normal`. |
| `textSize`      | Optional. `small`, `normal` or `large`: how large the Exam's questions, answers and answer-key lines print. The page header line keeps its size. Absent means `normal`. |
| `header`        | Optional. The Exam's own test-page header lines. See below. |
| `positions`     | The Exam's positions, in print order. May be empty.      |

Unknown optional members are ignored and are not preserved on import.

## Sections

A Question Section is an ordered group of Questions of any Question Type under a heading and a line of directions (ADR-0029). A Section has no type. Each entry of `sections` has:

| Member         | Required | Meaning |
| -------------- | -------- | ------- |
| `title`        | yes      | The Section's heading, as the teacher wrote it. At most 500 characters. |
| `instructions` | yes      | The Section's directions, as the teacher wrote them. At most 2000 characters. |

- A Section may hold Questions of several types, in any order.
- A Section no position belongs to is conforming. It is kept on import, so a teacher can put Questions in it. It prints its heading and directions on the test with nothing under them, and has no group in the Answer Key.
- Both members are always written out in full; there is no default wording to fall back on. Test Parrot begins a new Section's wording from the defaults of the type of the first Question put in it, but that is editing behaviour, not part of the record.
- An empty string is a part the teacher cleared: it prints nothing. A Section whose `title` and `instructions` are both empty prints no heading at all.
- Importers keep the members as given.
- The Answer Key groups its entries by Section under each Section's `title`; a Section whose `title` is empty is named by its place there ("Section 2").

## Positions

Each position has these members:

| Member        | Required | Meaning |
| ------------- | -------- | ------- |
| `question`    | yes      | `{ "bank": <package-local bank id>, "question": <that record's Question id> }`. |
| `section`     | yes      | The index, from 0, into `sections` of the Section the position is in. |
| `columns`     | no       | `1`, `2` or `4`: how many columns a **Multiple Choice** Question's answers lay out in. Allowed on no other Question Type. |
| `answerOrder` | no       | A permutation of the Question's answer ids: its choice ids on **Multiple Choice**, or its Word Bank ids on **Matching**. It must list every answer exactly once. Allowed on no other Question Type; True/False answers are always True, then False. |
| `workSpace`   | no       | `{ "height", "style", "fill" }`, room left below a **Short Answer** Question for a student's working. Allowed on no other Question Type. `height` is in CSS pixels at 96 dpi and is snapped to whole ruled lines of 32 px on import; `style` is `blank` or `lines`; `fill` stretches the space to the foot of its page, with `height` the least room it takes. |

Semantic rules:

- Every `question` reference must resolve to a Question in a Question Bank Record in the same package.
- Every `section` must be an index into `sections`. Any Question may be in any Section.
- An Exam uses each Question at most once.
- Exam Records carry no point values.

## Order

Sections print in the order `sections` lists them, and question numbering runs continuously across them. Producers write positions in print order: every position of the first Section, then every position of the second, and so on. On import, positions are stably regrouped by `section`, keeping only their order within each Section. A record whose positions interleave Sections is conforming; it is not rejected and no warning is given.

## Header

Every test page opens with one line for the student beside the paper's ID, which prints against the right margin (ADR-0026). By default the first page's line is Name, Class and Date blanks and every later page's is a Name blank. `header` holds optional `first` and `later` strings that replace them:

- The line is plain text, printed exactly as written, spaces included; underscores are the blanks.
- An absent member reads as the default; an empty string prints nothing but the ID.
- The paper's ID is never part of the line.
- Producers record only departures from the default. Answer Key pages carry no line.

## Defaults

- A Multiple Choice position without `columns` takes the answer columns of the Multiple Choice position before it, or one column if it is the first — the same rule that applies when a teacher adds a Question to an Exam.
- A position without `answerOrder` prints its answers in their authored order.
- A Short Answer position without `workSpace` leaves no room.
- A **Multipart** position (Question Bank Record `0.4.0`) carries only `question` and `section`. Answer order, answer columns and Work Space are set per Part in Test Parrot, and this version has no member for a Part's, so none of the three is allowed on a Multipart position and every Part imports with its defaults: answers in authored order, the default answer columns, and a Short Answer Part's default Work Space.

## Producers

Record `columns` only when the source layout makes them clear, and a Short Answer position's `workSpace` only when the source prints room to write below it — ruled lines counted, blank space in 32 px rows.

## Changes from 0.2.0

`sections` and each position's `section` are new and required: an Exam's Sections are stored and arranged by the teacher rather than derived from Question Type, so a Section may hold Questions of any type, an Exam may arrange its Sections in any order, and it may keep empty ones (ADR-0029). `sectionHeadings` is withdrawn; each Section carries its own `title` and `instructions`, in full. Test Parrot writes `0.3.0` and still imports `0.2.0` and `0.1.0`, deriving their Sections the old way: one per Question Type that has Questions, in the fixed order Multiple Choice, True/False, Matching, Short Answer, Multipart, each worded by that record's `sectionHeadings`.
