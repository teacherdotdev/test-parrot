# Exam Record 0.5.0

The **Exam Record** is the portable composition of one Exam: its name, its test-page header lines, its Question Sections in print order and how each one's heading reads, how large its headings and text print, how its questions print, how far in from each edge its pages print, and, for each position, the Question it uses, the Section it is in, and that position's answer columns, answer order, Hidden Answers, Work Space and Exam Picture Sizes. It never carries Question Content. It references Questions in Question Bank Records that travel beside it in the same [Test Parrot Package](test-parrot-package-0.1.0.md), and it is importable only inside one. See ADR-0022, ADR-0029, ADR-0038, ADR-0039, ADR-0041, ADR-0044, ADR-0045 and ADR-0050.

## Published contract

- Format: `test-parrot/exam`
- Version: `0.5.0`, versioned separately from the Question Bank Record and the Test Parrot Package
- Stable schema identifier: `https://testparrot.com/formats/exam/0.5.0/schema.json`
- Checked-in schema: [`/formats/exam/0.5.0/schema.json`](../public/formats/exam/0.5.0/schema.json)
- [Canonical examples](../public/formats/exam/0.5.0/examples/)
- Superseded but still readable: [Exam Record 0.4.0](exam-record-0.4.0.md), [Exam Record 0.3.0](exam-record-0.3.0.md), and Exam Records `0.2.0` and `0.1.0`
- Invalid counterexamples live with the package, since an Exam Record is validated there: [`/formats/package/0.1.0/invalid/`](../public/formats/package/0.1.0/invalid/)

The schema is the structural contract; this document supplies the rules JSON Schema cannot express. Implementations must perform both.

## Envelope

| Member          | Meaning                                                  |
| --------------- | -------------------------------------------------------- |
| `format`        | Exactly `test-parrot/exam`.                              |
| `formatVersion` | Exactly `0.5.0`. Importers accept exact versions only.   |
| `name`          | The Exam's name. An empty name imports as “Untitled Exam”. |
| `sections`      | The Exam's Question Sections, in the order they print. May be empty. See below. |
| `headingSize`   | Optional. `small`, `normal` or `large`: how large every heading prints — the Exam's title, and each section heading and its directions. Absent means `normal`. |
| `textSize`      | Optional. `small`, `normal` or `large`: how large the Exam's questions, answers and answer-key lines print. The page header line keeps its size. Absent means `normal`. |
| `paperStyle` | Optional. `standard`, `classic`, `condensed` or `exam-board`: how the Exam's paper prints. Absent means `standard`. See below. |
| `header`        | Optional. The Exam's own test-page header lines. See below. |
| `margins`       | Optional. How far in from each edge of the sheet the Exam's pages print. See below. |
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
| `hiddenAnswers` | no     | The **Hidden Answers**: incorrect choice ids of a **Multiple Choice** Question that this position leaves off, each at most once. Allowed on no other Question Type. See below. |
| `wordBankLayout` | no    | `beside` or `above`: where a **Matching** Question's Word Bank prints — beside its Items, or above them in columns. Beside stays beside however wide its answers, which wrap in the widest column the Items allow. Allowed on no other Question Type. Test Parrot writes it on every Matching position; see Defaults for a record without it. |
| `wordBankLayoutSet` | no | `true` when the teacher chose this **Matching** position's `wordBankLayout`, rather than it being placed by the `paperStyle` and the fit rule. Read only beside a `wordBankLayout`; absent means `false`. Allowed on no other Question Type. See Paper Style. |
| `workSpace`   | no       | `{ "height", "style", "fill" }`, room left below a **Short Answer** Question for a student's working. Allowed on no other Question Type. `height` is in CSS pixels at 96 dpi and is snapped to whole ruled lines of 32 px on import — each 32 px is one row, which the `paperStyle` lays out on the page (closer together under `condensed`); `style` is `blank` or `lines`; `fill` stretches the space to the foot of its page, with `height` the least room it takes. A `height` of 0 with `fill` false is no room, set on purpose; it wins over the room a `paperStyle` would rule there. |

| `pictureSizes` | no     | **Exam Picture Sizes**: `[{ "picture", "size" }]`, how wide this position prints some of its Question's block pictures. Allowed on any Question Type. See below. |

Semantic rules:

- Every `question` reference must resolve to a Question in a Question Bank Record in the same package.
- Every `section` must be an index into `sections`. Any Question may be in any Section.
- An Exam uses each Question at most once.
- Exam Records carry no point values.

## Hidden Answers

A Multiple Choice position may show fewer of its Question's incorrect answers than the Question has (ADR-0038). The Question in its Question Bank Record keeps every answer; `hiddenAnswers` says which this position leaves off. It is Exam presentation, like `answerOrder`.

- Every id must be one of the Question's choice ids, and none may be its correct answer; a record that breaks either rule is rejected.
- A consumer shows a Locked Answer (Question Bank Record `0.9.0`) whatever `hiddenAnswers` says, shows at least one incorrect answer, and hides nothing while the Question has no correct answer or has a Locked Answer that names others by letter, such as “Both A and B”. A producer never writes a position that breaks these rules; a consumer reading one shows the answers the rules require and hides the rest it names.
- The answers shown keep `answerOrder`, with the hidden ones taken out, and are lettered by their place among the answers shown. A Locked Answer last stays last.
- Producers record only answers actually hidden. An absent `hiddenAnswers` shows every answer.

## Picture Sizes

A position may print some of its Question's block pictures at a width of its own (ADR-0050). Each is an **Exam Picture Size**: Exam presentation like `workSpace`, which wins over the picture's Default Picture Size — the `authoredSize` its Question Bank Record gives it, or its own width when it has none — on this Exam alone, in its test and Answer Key. The Question in its Question Bank Record is unchanged.

- `picture` counts, from 1, the Question's `block-image` nodes in this order: its `stem`; then each of its `choices`, `prompts` and `wordBank` answers in turn; then its `suggestedAnswer`; then each Part in turn, itself in that order — its `stem`, its `choices` and `suggestedAnswer`, then each of its Subparts the same way. Each document is read depth first in document order, so a picture in a Panel of a Side-by-Side is counted where the Panel stands. Pending Images are counted too. Inline images are never counted and cannot be sized.
- `size` is the width of what the picture shows as a share of its container — the Question Content lane, a Panel or an answer-choice cell — from 0.05 to 1. It keeps the picture's proportions.
- Each `picture` must be one of the Question's block pictures and may appear at most once; a record that breaks either rule, or gives a `size` outside 0.05 to 1, is rejected.
- A size on a Pending Image is accepted and has nothing to apply to until the picture is resolved; Test Parrot drops it on import.
- Producers record only pictures the Exam actually sized. An absent `pictureSizes` prints every picture at its Default Picture Size.

## Order

Sections print in the order `sections` lists them, and question numbering runs continuously across them. Producers write positions in print order: every position of the first Section, then every position of the second, and so on. On import, positions are stably regrouped by `section`, keeping only their order within each Section. A record whose positions interleave Sections is conforming; it is not rejected and no warning is given.

## Paper Style

`paperStyle` is one preset for the whole Exam (ADR-0041, ADR-0044); there is no per-position or per-type style. It changes only how the test prints. The Answer Key is the same under every style, its answers in capitals.

| Value       | Before a Multiple Choice number | Before a True/False number | Answer letters | Word Bank | Short Answer with no `workSpace` | Question spacing |
| ----------- | ------------------------------- | -------------------------- | -------------- | --------- | -------------------------------- | ---------------- |
| `standard`  | nothing; the letter is circled  | T and F, to circle         | `A.`           | beside its Items where it fits, above them otherwise | no room | the sheet's own |
| `classic`   | an answer blank                 | an answer blank            | `a.`           | above its Items | three ruled lines (96 px) | the sheet's own |
| `condensed` | nothing; the letter is circled  | T and F, to circle         | `A.`           | beside its Items where it fits, above them otherwise | three ruled lines (96 px), ruled closer | closer together |
| `exam-board` | nothing; the letter is circled | T and F, to circle         | `A`            | beside its Items where it fits, above them otherwise | three dotted lines (96 px) | the sheet's own |

- Every Matching Item prints its own answer blank under every style.
- A Multiple Choice Part keeps capital letters under every style, so they never read as the Part letters beside them.
- Under `condensed`, a Multiple Choice Question's or Part's answers are laid out in four, or else two, columns where every answer fits one line of a column; never in fewer columns than its `columns`.
- The room a style rules applies to a Short Answer position, and to every Short Answer Part of a Multipart position, that has no `workSpace`. A `workSpace` always wins, including a zero-height one.
- A `workSpace`'s rows keep their count under every style; `condensed` only sets them closer together on the page. A Matching position's `wordBankLayout` is where its Word Bank prints under every style.
- Under `exam-board` (ADR-0045) the test prints on A4 rather than US Letter, numbers its questions `1` rather than `1.`, letters Parts `(a)` and Subparts `(i)`, rules every lined Work Space with dotted lines, prints an answer's Points as `[n]` against the right margin after it and a Multipart Question's total as `[Total: n]` after it, and prints "The total mark for this paper is n." beneath the title when any Question has Points. Its test pages carry the `header` lines as under every style, with the page number centred above them, and "Turn over" at the foot of every test page another follows. It prints no page of its own. Its Answer Key is on A4 and is otherwise the same as under every style.
- Changing an Exam's style never changes what the teacher set (ADR-0044). A `workSpace` is kept as it is. A Matching position whose `wordBankLayoutSet` is `true` keeps its `wordBankLayout`; every other Matching position is placed again by the new style, as in Defaults, so switching back gives the same layouts.

## Header

Every test page opens with one line for the student beside the paper's ID, which prints against the right margin (ADR-0026). By default the first page's line is Name, Class and Date blanks and every later page's is a Name blank. `header` holds optional `first` and `later` strings that replace them:

- The line is plain text, printed exactly as written, spaces included; underscores are the blanks.
- An absent member reads as the default; an empty string prints nothing but the ID.
- The paper's ID is never part of the line.
- Producers record only departures from the default. Answer Key pages carry no line.

## Margins

Every page is US Letter, or A4 under `exam-board`. By default it prints three quarters of an inch in from every edge. `margins` sets the Exam's own Page Margins (ADR-0039):

- It has `top`, `right`, `bottom` and `left`, all required, each a number of inches from `0.5` to `1.5`.
- Test Parrot sets margins in steps of `0.05` inch, but any number in range is conforming and is kept as given.
- Every page of the test and of the Answer Key prints with the same margins; the header line, title and page number sit inside them.
- Absent means `0.75` on every side. Producers write `margins` only when some side departs from that.

## Defaults

- A Multiple Choice position without `columns` takes the answer columns of the Multiple Choice position before it, or one column if it is the first — the same rule that applies when a teacher adds a Question to an Exam.
- A position without `answerOrder` prints its answers in their authored order.
- A position without `hiddenAnswers` prints every answer.
- A position without `pictureSizes` prints every picture at its Default Picture Size.
- A Short Answer position without `workSpace` leaves the room its `paperStyle` rules, which under `standard` is none.
- A Matching position without `wordBankLayout` is given one on import, once, as a Question added to an Exam is: above its Items under `classic`; otherwise beside them when its widest answer fits a column beside them on one line, and above them when it does not or when its Word Bank has more than twice as many answers as there are Items, and more than five. Test Parrot then stores and writes that layout; it is not worked out again.
- A **Multipart** position (Question Bank Record `0.4.0`) carries only `question` and `section`. Answer order, answer columns and Work Space are set per Part in Test Parrot, and this version has no member for a Part's, so none of the three, nor `hiddenAnswers`, is allowed on a Multipart position and every Part imports with its defaults: answers in authored order, the default answer columns, and a Short Answer Part's default Work Space.

## Producers

Record `columns` only when the source layout makes them clear, and a Short Answer position's `workSpace` only when the source prints room to write below it — ruled lines counted, blank space in 32 px rows. Record `paperStyle` only when it is not `standard`, and `workSpace` wherever the teacher set it, a zero-height one included under any style: the room a style rules is not written out as a `workSpace`. Record `wordBankLayout` when the source shows where a Word Bank prints; leave it out to let the importer choose. Record `wordBankLayoutSet` only for a layout the teacher chose.

## Changes from 0.4.0

One member is new, and optional: `pictureSizes`, on any position — the Exam Picture Sizes it gives its Question's block pictures, each naming its picture by its place among them (ADR-0050). Nothing else changed, so a `0.4.0` record is a `0.5.0` record that prints every picture at its Default Picture Size. Test Parrot writes `0.5.0` and still imports `0.4.0`, `0.3.0`, `0.2.0` and `0.1.0`; a `pictureSizes` in an older record is an unknown optional member and is ignored.

## Changes in 0.4.0, from 0.3.0

Five members are new, all optional:

- `hiddenAnswers`, on a Multiple Choice position: an Exam may show fewer of a Question's incorrect answers than it has, never its correct answer or a Locked Answer (ADR-0038).
- `wordBankLayout`, on a Matching position: where its Word Bank prints, beside or above its Items (ADR-0041).
- `wordBankLayoutSet`, on a Matching position: whether the teacher chose that layout, so a change of style leaves it (ADR-0044).
- `margins`: an Exam's Page Margins, one per side, in inches (ADR-0039).
- `paperStyle`: how every question on the Exam prints (ADR-0041, ADR-0044, ADR-0045). A Short Answer position's default Work Space now follows it. A zero-height `workSpace` was always conforming; it now means "no room" even where the style would rule lines.

Nothing else changed, so a `0.3.0` record is a `0.4.0` record that hides nothing, has every Word Bank placed on import, keeps the default margins and prints in the `standard` style. Test Parrot wrote `0.4.0` and imported `0.3.0`, `0.2.0` and `0.1.0`, each that way; a `hiddenAnswers`, `wordBankLayout`, `wordBankLayoutSet`, `margins` or `paperStyle` in an older record is an unknown optional member and is ignored.

## Changes in 0.3.0, from 0.2.0

`sections` and each position's `section` are new and required: an Exam's Sections are stored and arranged by the teacher rather than derived from Question Type, so a Section may hold Questions of any type, an Exam may arrange its Sections in any order, and it may keep empty ones (ADR-0029). `sectionHeadings` is withdrawn; each Section carries its own `title` and `instructions`, in full. Test Parrot writes `0.3.0` and still imports `0.2.0` and `0.1.0`, deriving their Sections the old way: one per Question Type that has Questions, in the fixed order Multiple Choice, True/False, Matching, Short Answer, Multipart, each worded by that record's `sectionHeadings`.
