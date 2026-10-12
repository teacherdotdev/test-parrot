# Convert questions into a Test Parrot Package

Use these instructions to convert questions from a PDF, image, scan, screenshot, document, or plain text into a JSON file that a user can import into Test Parrot.

## Required result

Always create one complete UTF-8 JSON file using the **Test Parrot Package `0.1.0`** format. Name the downloaded file:

```text
<short-name>.parrot.json
```

A package always holds exactly one Question Bank Record `0.10.0` with every converted Question. What else goes in it depends on the source, so triage it first:

- **The source is a test** — an exam, quiz, worksheet or any paper a student sits, with its questions in a printed order: also add one Exam Record `0.5.0` that lays the Questions out as the test does, in its printed order and under its own section headings (see [Tests](#tests)).
- **The source is only questions** — a question pool, a study list, a bank exported from elsewhere, anything not laid out as one paper: add no Exam. `exams` is an empty array.

When it is unclear whether the source is a test, ask the user; if you cannot ask, add no Exam and say so in the report. Never invent an Exam the source does not show. Everything below about Questions applies either way: the package's bank is an ordinary Question Bank Record.

When finished:

1. Give the user the JSON as a downloadable file. Do not provide only a JSON code block when you can create a file attachment.
2. Tell the user: **Download the JSON file, open [testparrot.com](https://testparrot.com), and drag the file into Test Parrot to import it.**
3. **If you are Gemini,** do not try to create, attach, or present a file. Show the complete JSON in a single `json` code block instead, and follow the Gemini delivery instructions under **Final validation and delivery**.
4. Report any ambiguity, unreadable source content, or unsupported material. If there are no such limitations, explicitly say that the complete source was converted.

Do not generate a PDF. Do not return a summary in place of the JSON file.

## Public format resources

Use these resources as the source of truth:

- [JSON Schema](./formats/question-bank/0.10.0/schema.json)
- [Minimal Multiple Choice example](./formats/question-bank/0.10.0/examples/minimal-multiple-choice.json)
- [True/False example](./formats/question-bank/0.10.0/examples/true-false.json)
- [Matching example](./formats/question-bank/0.10.0/examples/matching.json)
- [Multipart example](./formats/question-bank/0.10.0/examples/multipart.json)
- [Subparts example](./formats/question-bank/0.10.0/examples/subparts.json)
- [Points example](./formats/question-bank/0.10.0/examples/points.json)
- [Short Answer example](./formats/question-bank/0.10.0/examples/short-answer.json)
- [Complete rich-text example](./formats/question-bank/0.10.0/examples/complete-rich-text.json)
- [Provenance and links example](./formats/question-bank/0.10.0/examples/provenance-and-links.json)
- [Pending Images example](./formats/question-bank/0.10.0/examples/pending-images.json)
- [Side-by-side example](./formats/question-bank/0.10.0/examples/side-by-side.json)
- [Test Parrot Package JSON Schema](./formats/package/0.1.0/schema.json) and [Exam Record JSON Schema](./formats/exam/0.5.0/schema.json)
- [Package example: a test, with its bank and its Exam's sections as printed](./formats/package/0.1.0/examples/printed-test.json)
- [Package example: an exam-board paper, with Points, Subparts and the Exam Board style](./formats/package/0.1.0/examples/exam-board-paper.json)
- [Package example: questions only, with a bank and no Exam](./formats/package/0.1.0/examples/bank-only.json)

The Question Bank Record inside the package has this top-level shape:

```json
{
  "format": "test-parrot/question-bank",
  "formatVersion": "0.10.0",
  "generator": {
    "name": "Name of the assistant or conversion tool",
    "version": "Version or model name"
  },
  "requiredFeatures": [],
  "bank": {
    "name": "Question Bank name",
    "questions": []
  },
  "media": []
}
```

Do not add application database IDs, local paths, timestamps, page numbers, layout coordinates, OCR confidence, or conversational notes to the record. The only exception is the `pending` member of a Pending Image (see [Images and Pending Images](#images-and-pending-images)). A test's layout belongs in its Exam Record, and only in the members that format defines.

## The package

The file itself is the package, with the Question Bank Record under `questionBanks`. For questions only, `exams` is `[]`. For a test, it holds one Exam:

```json
{
  "format": "test-parrot/package",
  "formatVersion": "0.1.0",
  "generator": {
    "name": "Name of the assistant or conversion tool",
    "version": "Version or model name"
  },
  "requiredFeatures": [],
  "questionBanks": [
    { "id": "bank", "record": { "format": "test-parrot/question-bank", "formatVersion": "0.10.0", "...": "the complete Question Bank Record" } }
  ],
  "exams": [
    {
      "format": "test-parrot/exam",
      "formatVersion": "0.5.0",
      "name": "The test's title",
      "sections": [
        { "title": "Part I: Vocabulary", "instructions": "Circle the letter of the best answer." },
        { "title": "Part II", "instructions": "" }
      ],
      "positions": [
        { "question": { "bank": "bank", "question": "q1" }, "section": 0, "columns": 2 },
        { "question": { "bank": "bank", "question": "q2" }, "section": 0 },
        { "question": { "bank": "bank", "question": "q3" }, "section": 1 }
      ]
    }
  ]
}
```

## Tests

When triage says the source is a test:

- Name the bank after the subject or unit, and name the Exam after the test's own title as printed.
- Record the test's sections in `sections` (see [Sections](#sections)).
- Give the Exam one position for every converted Question, in printed order, each naming `"bank": "bank"` and that Question's ID, and with `section` set to the index, from 0, of the section the test prints it in. Use each Question exactly once. An unconverted question gets no position. A Multipart question is one Question, so it takes one position, however many source numbers its Parts carried.
- Write every Question's choices and Word Bank answers into the bank in the order the test prints them. That records the test's answer order, so leave out `answerOrder`: answers print in the order the bank records them, and the answer key's letters stay right.
- Record `columns` (`1`, `2` or `4`) on a Multiple Choice position whenever the source layout shows how many columns its answers are printed in: count the answers side by side on one line. Four answers across one line is `4`. Answers printed as a grid of two across — (A) beside (B), (C) beside (D), a 2 × 2 grid — are `2`. Answers printed one under another are `1`. Answers that are pictures, such as four graphs to choose from, are nearly always printed as a grid: look at the page and record it, since a picture answer with no `columns` prints as wide as the whole question. Leave `columns` out only when the layout truly cannot be read, such as answers split across a page break. Never put `columns` on any other Question Type.
- Record `workSpace` on a Short Answer position whenever the source prints room to write its answer below it, so the test arrives with the room it printed: `{ "height": <lines × 32>, "style": "lines", "fill": false }` when the room is ruled, counting the printed lines (three lines is `96`); and `{ "height": <rows × 32>, "style": "blank", "fill": false }` when it is empty space, as many 32-pixel rows as the space is tall at 96 pixels to the inch (about one row per third of an inch, never fewer than one). Leave `workSpace` out when the source prints the answer on the same line, leaves no room, or its room cannot be read, such as an answer split across a page break. Never put `workSpace` on any other Question Type, nor on a Multipart question: its Short Answer Parts take Test Parrot's defaults.
- Record `"paperStyle": "exam-board"` when the source is an exam-board paper: a structured paper such as an IGCSE, GCSE or A-level paper, which prints each answer's marks as `[2]` against the right margin, a question's total as `[Total: 9]`, and parts as `(a)` and `(i)`, usually on A4 with “Turn over” at the foot of its pages. That style prints the `points` you record as the paper does, with each question's and the paper's totals, so the teacher sees the marks they gave. Leave `paperStyle` out for any other test: never write `standard`, `classic` or `condensed`, which are the teacher's choice.
- Record `wordBankLayout` on a Matching position when the source shows where its Word Bank prints: `beside` its items, or `above` them. Leave it out when the layout cannot be read.
- Do not add `headingSize`, `textSize`, `header`, `margins`, `hiddenAnswers`, `wordBankLayoutSet`, point values, or any other member. The teacher sets how the test prints in Test Parrot. A question's points are not the Exam's: they go on the Question itself in the bank, as `points` (see [Points](#points)).

Test Parrot prints the Exam exactly in the order you record: its sections in the order `sections` lists them, and the questions in each in the order of their positions. It never sorts them by Question Type, so the order you write is the order the teacher gets. Reproduce the test as printed, question by question.

### Sections

A section is a heading the test divides its questions under, such as “Part A”, “Section II: Multiple Choice”, “Vocabulary” or “Extra Credit”, with the line of directions printed under it. Write one entry in `sections` for each, in the order the test prints them:

- `title` is the heading exactly as printed, including its numbering and point values: “Part B – Short Answer (10 points)”. Leave out only a range of source question numbers, such as “(Questions 1–10)” or “Questions 11 through 20”, since Test Parrot numbers the questions itself.
- `instructions` is the directions printed under that heading, exactly as printed, such as “Circle the letter of the best answer.” or “Answer in complete sentences.”. Leave out a sentence that only names source question numbers, for the same reason. Write `""` when the heading has no directions.
- A section holds whatever the test prints under it, in printed order, whatever its Question Types. Never split a section by Question Type, and never merge two sections because their questions are of the same type.
- `title` is only ever text the test prints as a heading. Never make one up, and never add words to a heading to tell two sections apart.
- A test often prints several lines of directions under one heading, each followed by its own questions: “Answer the following questions.”, then a few questions, then “Write the capital of each country below.”, then more. Each new line of directions starts a new section. The first takes the heading; each later one has `"title": ""` and its directions as `instructions`, so it prints its directions and no heading, as the test does.
- A heading repeated at the top of a later page, such as “Weather and Climate (continued)”, continues the section it repeats. It starts no section.
- Everything printed between a heading and its first question is that section's `instructions`, in printed order: a line such as “Read pages 40–45 before you begin.” as well as the directions after it.
- Questions printed before the test's first heading go in a section of their own, first, with `"title": ""`.
- When the test prints no section headings at all, write exactly one section, with `"title": ""` and, as its `instructions`, the directions printed above the questions, or `""`. A section whose `title` and `instructions` are both `""` prints no heading.
- The test's own title is the Exam's `name`, not a section. A name or date line, a school or teacher name, and page headers and footers are not sections; leave them out.
- Keep a section even when you could not convert any of its questions: it prints its heading, and the teacher adds the missing questions under it. Name its unconverted questions in the report as usual.
- Directions printed under a section heading belong to the section, never to a Question as well. A Matching set whose only directions are its section's has a blank paragraph as its stem (see [Matching](#matching)); write the same directions in only one place.
- Text you cannot tell apart as a heading or directions, or as part of a question, is a materially ambiguous question boundary: ask the user, or keep it with the question and say so in the report.

## Completeness is mandatory—but do not force uncertain content

Unless the user explicitly asks for a subset, attempt to convert **every question and every supported part of the source**. A sample, first-page conversion, or silently partial conversion is not acceptable.

> **If you cannot reliably determine the type of question, do not force it into a specific form. Just leave it and explicitly warn that you could not convert.**

Completeness means accounting for every source question, not pretending every question was converted successfully. Never classify an ambiguous question as Multiple Choice, True/False, Matching, Short Answer or Multipart merely to make the output appear complete. Leave that question out of the JSON, identify it by source page and visible number or opening words, explain why its type could not be determined, and include it in the final conversion report as unconverted. Ask the user for clarification when possible; after clarification, add the question in its correct form.

### Before conversion

1. Inspect every supplied page, image, table, answer-key section, footnote, continuation, and annotation.
2. For a long source, process it in batches and maintain a page-coverage and question-count checklist. Do not silently stop because of a context or output limit.
3. Inventory all questions in authored order. Reconcile the inventory with visible numbering. A matching section counts one source number per item, but is converted as one Question per word bank (see [Matching](#matching)). Likewise, questions that share one passage, quote, image or table count one source number each, but are converted as one Multipart Question (see [Multipart](#multipart)). A question printed under one number with lettered parts, such as 2(a), 2(b)(i) and 2(b)(ii), counts one source number and is converted as one Multipart Question.
4. Record unexplained duplicate or missing numbers as source ambiguities; do not silently renumber them away.
5. Identify any content that is unreadable or cannot be represented by this format before claiming completion.

### During conversion

1. Classify a question as `multiple-choice`, `true-false`, `matching`, `fill-in-the-blank`, `short-answer` or `multipart` only when the source supports that classification. Version `0.10.0` supports only those six types. If its type is uncertain or it cannot be represented without material loss, leave it out and report it explicitly; never coerce it into the closest supported type.
2. Preserve the exact wording, punctuation, capitalization, symbols, units, and meaningful whitespace. A Question's stem is what the source prints at its number, and nothing more: never add the directions printed above a group of questions to each one, and take out a mark printed beside it, such as `[2]`, which becomes its `points` (see [Points](#points)). Under “Write the capital of each country below.”, the item `18. Peru` has the stem “Peru”.
3. Preserve authored question and choice order.
4. Preserve paragraphs, headings, blockquotes, lists, code, rules, tables, equations, hard breaks, links, images, captions, content printed side by side, figures, tables and captions printed centred, and text formatting when present (see [Page layout: boxes and side-by-side content](#page-layout-boxes-and-side-by-side-content)).
5. Do not rewrite, summarize, correct, simplify, or “improve” source content unless the user explicitly requests editing.
6. Never invent missing text, choices, answers, correctness, Difficulty, Topics, attribution, or license information.
   **Mark an answer only where the source gives one** — an answer key, a circled or highlighted choice, a filled-in blank. Many tests, worksheets and study guides give none. Then every Multiple Choice and True/False choice is `"correct": false` and no Matching item has an `answer`, even when you are sure what the answer is. Test Parrot prints what you mark in the teacher's answer key, so an answer you supply yourself becomes a key the teacher never wrote.
7. Ask the user about materially ambiguous OCR, unreadable symbols, unclear question boundaries, missing choices, uncertain Question Types, and uncertain answer keys instead of guessing.
8. If an essential element cannot be represented, leave that Question unconverted and identify its exact location and limitation rather than silently dropping or coercing it.

### Before delivery

Perform a second pass against the original source and verify all of the following:

- every source page or image was inspected;
- every source question is accounted for as either converted exactly once or explicitly listed as unconverted;
- converted Questions remain in authored order, even when an unconverted question creates a gap in source numbering;
- every converted stem and choice is complete, and no stem repeats directions printed above it;
- every supplied answer and correctness indicator was copied accurately;
- every matching item names the word bank answer the source's key gives it, or none when the key gives none;
- every sentence a student completes by writing on a line inside it is one Fill in the Blank Question with a `blank` where each line is, holding the answer the source's key gives it or none, and no underscores are left in its stem;
- every block of questions that shares one passage, quote, image, table or piece of notation — including the questions after “Use the chart …” or “Refer to the map …” — is one Multipart Question with its Parts in printed order, or is listed as unconverted, and the shared material is in its stem rather than in its first Part;
- correctness was never inferred from general knowledge: with no answer key in the source, no choice is `correct` and no Matching item has an `answer`;
- all supplied Difficulty and Topics values were preserved;
- meaningful formatting, especially subscript and superscript, was preserved semantically;
- every image, caption, table, list, equation, hard break, and safe link was preserved, and every table is a block of its own in a `content` list, never nested inside a paragraph;
- every question printed under one number with lettered parts is one Multipart Question, each lettered part a Part and each `(i)`, `(ii)`, … beneath a part a Subpart of it, in printed order, with no label left in a stem;
- every Part that holds Subparts has its lead-in as its `stem` and its `subparts`, and no `type`, `choices`, `suggestedAnswer` or `points`;
- every mark the source prints for a question, Part or Subpart is that one's `points`, a positive whole number; no `[2]`, `(2 marks)` or `[Total: 9]` is left in a stem, choice or Suggested Answer; no Multipart Question carries `points`; and no total was stored;
- an exam-board paper's Exam has `"paperStyle": "exam-board"`, and no other test has a `paperStyle`;
- all Question, choice, item, word bank, Part, Part choice, Subpart and Subpart choice IDs are unique and sequential;
- every meaningful image, including an image used as an answer choice, matching item or word bank answer, is a Pending Image;
- every picture has its own Pending Image, with pictures printed side by side split rather than merged — one per `panel` of a `side-by-side`;
- every picture, table and caption the source prints centred has `"align": "center"`, and nothing printed at the left has an `align`;
- shared material — a passage, picture, table or anything else that directions such as “Use the information above for problems 3 – 5” refer to — appears once, in the stem of the one Multipart Question whose Parts are those problems, and is never repeated in a Part's stem or in another Question;
- every boxed passage or quote is a `blockquote`, with its “Source: …” line as the ordinary paragraph right after it, and was transcribed as text even when the source stores it as a picture;
- content printed side by side is one `side-by-side` of two or three `panel`s, left to right, directly in a Question's or Part's stem — never in a choice, matching item, word bank answer or Suggested Answer, never inside a blockquote, list, table or another `side-by-side`, and never for answer choices laid out in a grid;
- borders and shaded boxes that only frame or group the questions themselves were ignored;
- every Pending Image names the tag printed on its picture, or its page when the picture has no tag;
- every tag in the [image tag list](#image-tags-in-this-document) is accounted for in the conversion report;
- the Question Bank Record's `media` is an empty array;
- for a test, the Exam has one position per converted Question, in printed order, each naming an existing Question ID in the package's bank and the section the test prints it in, and no Question twice;
- for a test, `sections` lists every section heading the test prints, in printed order, each `title` and `instructions` transcribed exactly — or is one section with an empty `title` when the test prints no headings — and no section was split or merged by Question Type;
- for a test, every `title` is text the test prints as a heading, and each later line of directions under one heading is a section with an empty `title`;
- for a test, every Multiple Choice position whose answers the source prints side by side — a row of four, a 2 × 2 grid, a grid of pictures — has the `columns` that layout shows, every `columns` value sits only on a Multiple Choice position (never on a Multipart question), and every Short Answer position whose source prints room to write below it has the `workSpace` that room shows, on no other position;
- the file is a Test Parrot Package with exactly one Question Bank Record, and it holds an Exam only if the source is a test;
- the final JSON passes the public schema and semantic rules.

If any check fails, fix the record or disclose the precise limitation. Never say the extraction is complete when it is not.

## Question types

Version `0.10.0` supports `multiple-choice`, `true-false`, `matching`, `fill-in-the-blank`, `short-answer`, and `multipart` Questions. Do not use any of them as a fallback for an unknown, mixed, or unsupported Question Type. In particular, do not turn an uncertain question into Short Answer merely because it has no clearly detected choices, do not turn a two-choice question into True/False unless those two choices really are true and false, do not turn a matching section into Multiple Choice questions that each repeat the word bank, and do not turn a passage and its questions into separate questions that each repeat the passage — or that leave it out. Leave it unconverted and warn the user instead.

### Multiple Choice

A Multiple Choice Question:

- has an ID such as `q1`;
- has at least two choices;
- keeps choices in authored order;
- uses choice IDs such as `q1-c1`, `q1-c2`, and so on;
- has zero or one choice whose `correct` value is `true`;
- does not have `suggestedAnswer`.

Zero correct choices is valid and means the source did not identify a correct answer. Do not guess one.

Write no `locked` member on a choice. Test Parrot keeps an answer such as “All of the above” or “Both A and B” in its printed place by itself whenever it shuffles a test's answers.

```json
{
  "id": "q1",
  "type": "multiple-choice",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Which number is prime?" }]
      }
    ]
  },
  "difficulty": "easy",
  "topics": ["Numbers"],
  "choices": [
    {
      "id": "q1-c1",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Four" }]
          }
        ]
      },
      "correct": false
    },
    {
      "id": "q1-c2",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Five" }]
          }
        ]
      },
      "correct": true
    }
  ]
}
```

### True/False

A True/False Question is a statement the student judges true or false. Convert a source question to `true-false` when it is presented under a True/False heading or instruction, or when its only two answers are true and false — including `T`/`F`, `True`/`False`, and the same pair in the source's own language.

A True/False Question:

- has an ID such as `q2`;
- has exactly two choices, the affirmative first and the negative second, whatever order the source printed them in;
- writes those choices out as ordinary content — `True` then `False` — rather than copying the source's `T`/`F` shorthand;
- uses choice IDs such as `q2-c1` and `q2-c2`;
- has zero or one choice whose `correct` value is `true`;
- does not have `suggestedAnswer`.

Mark `correct` on the choice the source's answer key gives: a key of `T` or `True` marks the first choice, and `F` or `False` marks the second. Zero correct choices is valid and means the source did not identify an answer. Do not guess one.

```json
{
  "id": "q2",
  "type": "true-false",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Water boils at 100 degrees Celsius at sea level."
          }
        ]
      }
    ]
  },
  "topics": ["States of matter"],
  "choices": [
    {
      "id": "q2-c1",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "True" }]
          }
        ]
      },
      "correct": true
    },
    {
      "id": "q2-c2",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "False" }]
          }
        ]
      },
      "correct": false
    }
  ]
}
```

Keep the statement itself in the stem. A leading `T  F` pair, a blank line, or a numbered answer column printed beside the statement is answer-sheet furniture, not part of the question: leave it out.

### Matching

A matching section is a list of numbered items on one side and a lettered word bank on the other, which the student matches by writing a letter in the blank beside each item. It typically looks like this in the source:

```text
Matching: Match each event to the correct time period.

____ 1. People made their first tools from stone.      A. Stone Age
____ 2. Bronze tools were first made.                  B. Bronze Age
____ 3. Castles were built across Europe.              C. Iron Age
                                                       D. Middle Ages
```

Convert **one whole set — every item that shares one word bank — as one `matching` Question**, even though each item carries its own number in the source. Do not split a set into one Question per item, and do not merge two sets that have different word banks. Test Parrot numbers the items again when it prints the test, one number per item, and prints the word bank beside them.

A Matching Question:

- has an ID such as `q3`;
- keeps the set's own directions (for example “Match each event to the correct time period.”) in the `stem`; the stem may be a blank paragraph when the source has none beyond the section heading. In a test, directions printed under the section heading are that section's `instructions` instead (see [Sections](#sections)): never write them in both;
- has `prompts`: the items, at least one, in authored order, with IDs such as `q3-p1`, `q3-p2`, and so on;
- has `wordBank`: the lettered answers, at least two, in authored order, with IDs such as `q3-a1`, `q3-a2`, and so on;
- gives each item an `answer` — the ID of the word bank answer the source's answer key matches it with — or no `answer` member at all when the key gives none;
- does not have `choices` or `suggestedAnswer`.

The letters are positions, not content: `A.` is `q3-a1`, `B.` is `q3-a2`, and so on, so leave the letters out of the answer content and out of the item content. Leave the source numbers and the blanks out too — they are furniture. A key of `2. C` means the item numbered 2 names the third word bank answer. Several items may name the same answer when the key says so, and a word bank may hold answers no item names; keep those distractors in authored order. Never infer a match from general knowledge, and never reorder either list.

```json
{
  "id": "q3",
  "type": "matching",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Match each event to the correct time period."
          }
        ]
      }
    ]
  },
  "prompts": [
    {
      "id": "q3-p1",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "People made their first tools from stone."
              }
            ]
          }
        ]
      },
      "answer": "q3-a1"
    },
    {
      "id": "q3-p2",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [
              { "type": "text", "text": "Bronze tools were first made." }
            ]
          }
        ]
      },
      "answer": "q3-a2"
    },
    {
      "id": "q3-p3",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "Castles were built across Europe."
              }
            ]
          }
        ]
      },
      "answer": "q3-a4"
    }
  ],
  "wordBank": [
    {
      "id": "q3-a1",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Stone Age" }]
          }
        ]
      }
    },
    {
      "id": "q3-a2",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Bronze Age" }]
          }
        ]
      }
    },
    {
      "id": "q3-a3",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Iron Age" }]
          }
        ]
      }
    },
    {
      "id": "q3-a4",
      "content": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Middle Ages" }]
          }
        ]
      }
    }
  ]
}
```

If the source prints the word bank above or below the items rather than beside them, or letters the items and numbers the bank, it is still a matching set: the items are the side the student writes on. If you cannot tell which side is which, or which answers belong to which set, leave the section unconverted and say so.

### Fill in the Blank

A Fill in the Blank Question is a sentence a student completes by writing on a line printed inside it, such as `Bees carry ________ from flower to flower.` It:

- has an ID such as `q3`;
- is one sentence, one Question, with its own number — never a set of sentences, even under shared directions;
- has a `blank` node in its stem where each line is, standing among the sentence's text; a sentence with two lines has two `blank` nodes and is still one Question;
- puts the answer the source's key gives in the `blank`'s `content` — text, keeping its formatting, and inline mathematics only. With no key, the `blank` has no `content`: never write an answer yourself;
- keeps a hint printed beside the line, such as a first letter `(p)`, as ordinary text of the stem;
- has no `choices`, `suggestedAnswer`, `prompts`, `wordBank` or `parts`.

```json
{
  "id": "q3",
  "type": "fill-in-the-blank",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Bees carry (p)" },
          { "type": "blank", "content": [{ "type": "text", "text": "pollen" }] },
          { "type": "text", "text": " from flower to flower." }
        ]
      }
    ]
  }
}
```

Never leave the underscores, dots or empty box a source prints as the line in the stem's text: the `blank` is the line. A word bank printed above fill-in-the-blank sentences has no place in the record — leave it out and say so in the report. A sentence whose line has a choice of words printed beside it, such as `(buy / bought)`, keeps those words as stem text. When the line asks for something longer than a word or phrase, such as a sentence or a calculation, it is a Short Answer Question instead.

### Short Answer

A Short Answer Question:

- has an ID such as `q4`;
- has no `choices` member;
- may have a rich-text `suggestedAnswer` only when the source or user supplies one.

```json
{
  "id": "q4",
  "type": "short-answer",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Name the process plants use to make food."
          }
        ]
      }
    ]
  },
  "topics": ["Biology"],
  "suggestedAnswer": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Photosynthesis." }]
      }
    ]
  }
}
```

A visibly blank stem is valid if the source actually contains a blank stem.

### Multipart

A Multipart question is a stem of shared material — a passage, a quote, a speech, a diagram, a map, a chart, a table, or anything else — followed by the questions, its Parts, that a student answers from it. It typically looks like this in the source:

```text
Base your answers to questions 12 and 13 on the passage below and on your
knowledge of social studies.

    The power of the Kingdom of Aldmere was fading by 1450 …

        Source: “A Short History of Aldmere,” 1998 (adapted)

12 Which region was controlled by the Kingdom of Aldmere in 1450?
   (1) Western Hills          (3) Eastern Forests
   (2) Southern Plains        (4) Northern Coast

13 Based on the passage, identify an issue faced by the Kingdom of Aldmere in the 1400s.
   (1) The kingdom became too large to govern.
   (2) Its harbors silted up.
   (3) Rulers were responsive to the needs of the people.
   (4) Trade increased in the kingdom.
```

Convert **the material and every question asked about it as one `multipart` Question**, even though the source numbers each question separately. Each of those questions becomes one **Part** of the Multipart question, in printed order. Do not split the block into one Question per source number, do not repeat the material in several Questions, and never convert a Part as a standalone Question without its material: a student cannot answer it. Test Parrot prints the Multipart question under one number and letters its Parts beneath it (`a.`, `b.`, …).

Recognise a Multipart question by an instruction such as “Base your answers to questions 12 and 13 on …”, “Use the map below to answer questions 4 through 6”, “Read the passage and answer the questions that follow”, “Use the chart to answer the questions below” or “Refer to the map above”, or by any shared material that the following questions refer to. A single question introduced this way (“Base your answer to question 5 on the graph below”) is a Multipart question with one Part.

Two or more numbered blanks that label one picture, diagram or piece of notation — `8.` and `9.` pointing at two parts of one labelled drawing of a flower — are one Multipart question too: the picture or notation is its stem, and each numbered blank is a Short Answer Part, in printed order.

**A question numbered once and asked in lettered parts is one Multipart question too.** Structured papers number a question `2` and print its parts `(a)`, `(b)`, … beneath it, and sometimes number further questions `(i)`, `(ii)`, … beneath a part, so that the paper asks question 2(b)(i). Convert the whole of question 2 as one `multipart` Question, even when its parts share no material: whatever it prints after its number and before `(a)` — a sentence, a table, a diagram — is its stem, or a blank paragraph when it prints nothing there; each lettered part is a Part, in printed order; and each `(i)`, `(ii)`, … beneath a part is one of that Part's Subparts (see [Subparts](#subparts)).

The test is shared material, not shared directions. Questions that all need the same picture, table, passage or notation are one Multipart question. Questions that only share a line of directions, such as “Answer the following questions.” or “Write the capital of each country below.”, are separate Questions in a section with those directions (see [Sections](#sections)). When the directions name shared material (“Use the chart …”), the material goes in the Multipart question's stem and the directions are its section's `instructions`.

A question that names other questions by their source numbers, such as “Which of the cities in questions 5–8 …”, keeps its wording. Test Parrot renumbers the test, so list it in the report as a question whose numbers the teacher must check.

A Multipart Question:

- has an ID such as `q5`;
- keeps the shared material in the `stem`: the passage, quote, image, table or diagram, with any source or attribution line (for example “Source: …”, “— Patrick Henry, 1775”, a caption under a map) written as ordinary content in the stem, where the source prints it;
- leaves out the “Base your answers to questions 12 and 13 …” instruction itself, since it names source numbers that Test Parrot replaces, and its section prints its own directions;
- leaves the source's labels — `12`, `2`, `(a)`, `(i)` — out of every stem, since Test Parrot numbers the Question and letters its Parts itself;
- has `parts`: the questions asked about the material, in printed order, with IDs such as `q5-s1`, `q5-s2`, and so on;
- gives `difficulty` and `topics` to the Multipart Question, never to a Part;
- does not have `choices`, `prompts`, `wordBank`, `suggestedAnswer` or `points` of its own — each Part carries its own answers and points.

Each Part has an `id` and its own `stem`, and either answers or holds Subparts (see [Subparts](#subparts)). A Part that answers has a `type`, which is one of exactly two:

- A `multiple-choice` Part has at least two `choices` in authored order, with IDs such as `q5-s1-c1`, `q5-s1-c2`, and so on, zero or one of them `correct`, and no `suggestedAnswer`.
- A `short-answer` Part has no `choices`, and may have a rich-text `suggestedAnswer` only when the source or user supplies one.

A Part that answers may also have `points` (see [Points](#points)).

Leave the source's question numbers (`12`, `13`) out of each Part's stem, and its choice numbers or letters (`(1)`, `(2)`, `A.`) out of each choice — they are positions, not content. A key of `12: 4` marks the fourth choice of the Part numbered 12. Never infer correctness from general knowledge, and never reorder the Parts: they are lettered in place and often build on one another.

**If any question in the block is not Multiple Choice or Short Answer** — a True/False statement, a matching set, or a question whose type you cannot determine — do not force it into a Part or a Subpart and do not convert the rest of the block without it. Leave the whole block, material and every question, unconverted and list it under **Unconverted Questions** with the reason. Likewise, when you cannot tell which questions a piece of material belongs to, leave that block unconverted and say so. A question numbered `(i)`, `(ii)`, … beneath a Part is not such a question: it is a Subpart. Only a question beneath a Subpart, a level deeper still, cannot be written: leave its block unconverted and say so.

```json
{
  "id": "q5",
  "type": "multipart",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "blockquote",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "The power of the Kingdom of Aldmere was fading by 1450 …"
              }
            ]
          }
        ]
      },
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Source: “A Short History of Aldmere,” 1998 (adapted)"
          }
        ]
      }
    ]
  },
  "topics": ["Kingdom of Aldmere"],
  "parts": [
    {
      "id": "q5-s1",
      "type": "multiple-choice",
      "stem": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "Which region was controlled by the Kingdom of Aldmere in 1450?"
              }
            ]
          }
        ]
      },
      "choices": [
        { "id": "q5-s1-c1", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Western Hills" }] }] }, "correct": false },
        { "id": "q5-s1-c2", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Southern Plains" }] }] }, "correct": false },
        { "id": "q5-s1-c3", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Eastern Forests" }] }] }, "correct": false },
        { "id": "q5-s1-c4", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Northern Coast" }] }] }, "correct": true }
      ]
    },
    {
      "id": "q5-s2",
      "type": "multiple-choice",
      "stem": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "Based on the passage, identify an issue faced by the Kingdom of Aldmere in the 1400s."
              }
            ]
          }
        ]
      },
      "choices": [
        { "id": "q5-s2-c1", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "The kingdom became too large to govern." }] }] }, "correct": false },
        { "id": "q5-s2-c2", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Its harbors silted up." }] }] }, "correct": true },
        { "id": "q5-s2-c3", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Rulers were responsive to the needs of the people." }] }] }, "correct": false },
        { "id": "q5-s2-c4", "content": { "type": "document", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Trade increased in the kingdom." }] }] }, "correct": false }
      ]
    }
  ]
}
```

A Short Answer Part is written the same way, without `choices`:

```json
{
  "id": "q5-s3",
  "type": "short-answer",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Explain one reason the Kingdom of Aldmere's power was fading by 1450."
          }
        ]
      }
    ]
  }
}
```

When the shared material is an image, a map or a chart, put it in the stem as a Pending Image `block-image` (see [Images and Pending Images](#images-and-pending-images)); a table is a `table`. A passage or quote printed inside a border is a `blockquote`, with its “Source: …” line as the ordinary paragraph right after it, as in the example above; material printed side by side, such as two graphs or a picture beside text, is a `side-by-side` (see [Page layout: boxes and side-by-side content](#page-layout-boxes-and-side-by-side-content)). The material belongs to the Multipart question alone: write it once, in its stem, and never copy it into a Part's stem or into any other Question.

#### Subparts

A Part may ask questions of its own, numbered beneath it. It typically looks like this in the source:

```text
6   A class measured how far a toy car rolled from ramps of different heights.

    (a) Name the variable the class changed.                         [1]

    (b) The car rolled 40 cm from a 10 cm ramp and 80 cm from a 20 cm ramp.

        (i)  Describe the pattern in these results.                  [2]

        (ii) Predict how far the car rolls from a 15 cm ramp.        [1]

                                                             [Total: 4]
```

Question 6 is one Multipart Question. Part (a) answers. Part (b) holds **Subparts** (i) and (ii): its stem is the lead-in they share, and the questions numbered beneath it are its `subparts`, in printed order. Test Parrot prints them beneath their Part and numbers them (i), (ii)… itself.

A Part that holds Subparts:

- has an `id` and a `stem`: the lead-in printed between its letter and its first Subpart, or a blank paragraph when it prints none;
- has `subparts`: at least one, in printed order, with IDs such as `q6-s2-s1`, `q6-s2-s2`, and so on;
- has no `type`, `choices`, `suggestedAnswer` or `points`: it answers nothing itself, and its Subparts carry the answers and the points.

A Subpart is written exactly as a Part that answers — an `id`, a `type` of `multiple-choice` or `short-answer`, its own `stem`, the `choices` or optional `suggestedAnswer` its type calls for, and optional `points` — and its choices have IDs such as `q6-s2-s1-c1`. A Subpart never holds Subparts of its own. Leave the `(i)`, `(ii)` labels out of each stem, and never reorder Subparts.

A Part never both answers and holds Subparts. When a lettered part asks for an answer of its own and also has questions numbered beneath it, ask the user, or leave the block unconverted and say so.

```json
{
  "id": "q6",
  "type": "multipart",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "A class measured how far a toy car rolled from ramps of different heights." }]
      }
    ]
  },
  "parts": [
    {
      "id": "q6-s1",
      "type": "short-answer",
      "stem": {
        "type": "document",
        "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Name the variable the class changed." }] }]
      },
      "points": 1
    },
    {
      "id": "q6-s2",
      "stem": {
        "type": "document",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "The car rolled 40 cm from a 10 cm ramp and 80 cm from a 20 cm ramp." }]
          }
        ]
      },
      "subparts": [
        {
          "id": "q6-s2-s1",
          "type": "short-answer",
          "stem": {
            "type": "document",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Describe the pattern in these results." }] }]
          },
          "points": 2
        },
        {
          "id": "q6-s2-s2",
          "type": "short-answer",
          "stem": {
            "type": "document",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Predict how far the car rolls from a 15 cm ramp." }] }]
          },
          "points": 1
        }
      ]
    }
  ]
}
```

The `[Total: 4]` is written nowhere: Test Parrot adds up a Multipart Question's points itself (see [Points](#points)).

## Points

Many tests print what each question is worth beside it: `[2]`, `(2 marks)`, `(3 pts)`, `2 marks`, usually at the right margin or at the end of the answer line. That number — its marks or points — is the question's **points**, an optional positive whole number.

- Write it as `points` on what the student answers: a Multiple Choice, True/False, Fill in the Blank or Short Answer Question, once however many blanks it has; a Matching Question, once for the whole set; a Part that answers; or a Subpart. `[2]` printed beside Part (a) is `"points": 2` on that Part.
- **Never leave a mark in the text.** Take `[2]`, `(2 marks)` and the like out of the stem, choice or Suggested Answer where it is printed, as you take out question numbers.
- **Never write a total.** A Multipart Question and a Part that holds Subparts have no `points`: Test Parrot adds up their Parts' and Subparts' points itself, and adds up the test's total. Drop a total the source prints for a question, such as `[Total: 9]` or `(10 marks in all)`, and a total for the whole paper, such as `Total: 60 marks`. If a printed total does not equal the sum of the points you wrote beneath it, say so in the report.
- A matching set that prints a mark beside each item has `points` equal to their sum; one that prints a single mark for the set has that mark.
- Directions that give every question under them the same worth, such as “Each question is worth 2 marks.”, give each of those questions `"points": 2`, and stay in the section's `instructions` as printed.
- Write only points the source prints. Never guess a mark for a question that has none, and never give the rest of a test's questions a mark because some have one.
- When a mark is not a positive whole number — `[½]`, `(0 marks)`, `[1–2]` — or you cannot tell which question it belongs to, leave `points` out and say so in the report.
- A section heading keeps its point value as printed, such as “Part B – Short Answer (10 points)” (see [Sections](#sections)): the heading is text, not points.
- Points print on the test only under the Exam Board style. When the source is an exam-board paper, give its Exam `"paperStyle": "exam-board"` (see [Tests](#tests)), or the teacher opens a test that shows none of the marks you recorded.

```text
7   Name the gas that plants give off in sunlight.   ........................   [1]
```

```json
{
  "id": "q7",
  "type": "short-answer",
  "stem": {
    "type": "document",
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Name the gas that plants give off in sunlight." }]
      }
    ]
  },
  "points": 1
}
```

## Rich text

Each stem, choice, matching item, word bank answer, Part stem, and Suggested Answer is a semantic document:

```json
{
  "type": "document",
  "content": []
}
```

Supported nodes are:

- `paragraph`, with optional `"align": "center"` when the source centres it, as `table` and `block-image` take too (see [Page layout: boxes and side-by-side content](#page-layout-boxes-and-side-by-side-content))
- `heading` with `level` from 1 through 6
- `blockquote`
- `bullet-list`
- `ordered-list` with optional positive `start`
- `list-item`
- `code-block` with optional `language` and text in `text`
- `rule`
- `table`
- `table-row` with optional `header`
- `table-cell` with optional `header`
- `text`
- `inline-math` and `display-math` with authored math in `source`
- `hard-break`
- `inline-image` and `block-image`
- `side-by-side`, holding two or three `panel` nodes — only directly in a Question's or a Part's stem (see [Page layout: boxes and side-by-side content](#page-layout-boxes-and-side-by-side-content))

Supported marks on `text` nodes are:

- `strong`
- `emphasis`
- `inline-code`
- `strike`
- `subscript`
- `superscript`
- `link` with an absolute HTTP or HTTPS `href` and optional `title`

Split text into separate nodes whenever its marks change. Marks apply only to the text node that carries them.

### Tables

A table is a block of its own, written in a `content` list beside the paragraphs around it — never inside a paragraph or under any member but `content`. Test Parrot reads child nodes only from `content`, and refuses a file that hides them anywhere else. A `table` holds `table-row`s, each row holds `table-cell`s, and each cell holds blocks such as paragraphs. Mark the header row and its cells with `"header": true`. A cell the student fills in holds one empty paragraph. For example, a stem with a line of directions and then a table:

```json
{
  "type": "document",
  "content": [
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "Complete the table." }]
    },
    {
      "type": "table",
      "content": [
        {
          "type": "table-row",
          "header": true,
          "content": [
            { "type": "table-cell", "header": true, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Planet" }] }] },
            { "type": "table-cell", "header": true, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Moons" }] }] }
          ]
        },
        {
          "type": "table-row",
          "content": [
            { "type": "table-cell", "content": [{ "type": "paragraph", "content": [{ "type": "inline-math", "source": "x^{2}" }] }] },
            { "type": "table-cell", "content": [{ "type": "paragraph" }] }
          ]
        }
      ]
    }
  ]
}
```

Write every row and every cell the source prints, empty ones included, so the table keeps its shape. Write notation inside a cell, such as an exponent, as math, exactly as you would outside a table.

A table the student completes, with source question numbers printed in some of its cells, is one Short Answer Question whose stem is the table. Leave the numbers out of the cells, since Test Parrot numbers the Question itself, and say in the report that those source numbers became one Question.

### Subscript and superscript are required formatting

Do not flatten subscript or superscript to baseline text. OCR commonly loses this formatting, so inspect the source visually instead of trusting extracted plain text alone.

For example, visually formatted “H₂O has 10³ molecules” should be represented as:

```json
{
  "type": "paragraph",
  "content": [
    { "type": "text", "text": "H" },
    {
      "type": "text",
      "text": "2",
      "marks": [{ "type": "subscript" }]
    },
    { "type": "text", "text": "O has 10" },
    {
      "type": "text",
      "text": "3",
      "marks": [{ "type": "superscript" }]
    },
    { "type": "text", "text": " molecules" }
  ]
}
```

Use the semantic marks when ordinary characters are visually formatted as subscript or superscript. If the source literally contains Unicode characters such as `₂` or `³`, preserving those authored characters is allowed, but do not use Unicode substitution merely to avoid recording known formatting.

Marks may be combined. Bold superscript text, for example, can use:

```json
{
  "type": "text",
  "text": "2",
  "marks": [{ "type": "strong" }, { "type": "superscript" }]
}
```

Use `inline-math` or `display-math` with the authored math source for mathematical expressions. Do not misuse a superscript mark as a replacement for structured math. For example:

```json
{ "type": "inline-math", "source": "x^2 + y^2" }
```

The same formatting rules apply inside stems, choices, matching items, word bank answers, Multipart Parts, and Suggested Answers.

## Page layout: boxes and side-by-side content

Most of a page's layout is not content: Test Parrot lays the test out itself. Three things a page does with its content are: a box, content side by side, and a centred figure.

**A boxed source is a `blockquote`.** A passage, quote, speech excerpt or document printed inside a border is a `blockquote` holding its paragraphs. Its attribution — “Source: …”, “— Patrick Henry, 1775” — is the ordinary paragraph right after the blockquote, outside it, even when the source prints it inside the box. Transcribe a boxed passage as text even when the source document stores it as a picture; keep a picture only for genuine artwork, such as a map, chart, cartoon, photograph or graph.

**Content printed side by side is a `side-by-side`.** Two graphs next to each other, two tables, a table beside a graph, or a picture beside its text are one `side-by-side` with one `panel` per item, left to right:

```json
{
  "type": "side-by-side",
  "content": [
    {
      "type": "panel",
      "content": [
        { "type": "block-image", "pending": { "image": 3 }, "alt": "Graph of f", "caption": "Graph of f" }
      ]
    },
    {
      "type": "panel",
      "content": [
        { "type": "block-image", "pending": { "image": 4 }, "alt": "Graph of g", "caption": "Graph of g" }
      ]
    }
  ]
}
```

Rules:

- A `side-by-side` holds two or three `panel`s and nothing else, and has no other members. When the source prints four or more items across one line, write them as ordinary blocks one after another, or as two `side-by-side`s, one under the other, and say so in the report.
- A `panel` holds one or more blocks — paragraphs, headings, blockquotes, lists, tables, equations, pictures — in the order they read inside it. A `panel` never holds another `side-by-side`.
- A `side-by-side` is written only directly in a Question's `stem` or a Multipart Part's `stem`, as one of its top-level blocks: never in a choice, a matching item, a word bank answer or a Suggested Answer, and never inside a blockquote, list, table or panel.
- Text above or below the items, such as the question or a caption spanning both, stays outside the `side-by-side`, before or after it in the stem.
- **Answer choices laid out in a grid are not a `side-by-side`.** Write the choices as ordinary `choices`; for a test, the grid is the position's `columns` (see [Tests](#tests)).

**A figure printed centred is centred.** When the source prints a picture, a table, or a figure's caption in the middle of the line, give that `block-image`, `table` or `paragraph` `"align": "center"`. A caption printed on a line of its own, such as “Fig. 1.1” under a figure or “Table 1.1” above or below a table, is an ordinary paragraph where the source prints it, centred when the source centres it; a caption written in a picture's `caption` is centred with its picture:

```json
{
  "type": "document",
  "content": [
    { "type": "paragraph", "content": [{ "type": "text", "text": "Fig. 1.1 shows a leaf seen through a hand lens." }] },
    { "type": "block-image", "pending": { "image": 5 }, "alt": "A leaf seen through a hand lens", "align": "center" },
    { "type": "paragraph", "align": "center", "content": [{ "type": "text", "text": "Fig. 1.1", "marks": [{ "type": "strong" }] }] },
    { "type": "paragraph", "align": "center", "content": [{ "type": "text", "text": "Table 1.1", "marks": [{ "type": "strong" }] }] },
    {
      "type": "table",
      "align": "center",
      "content": [
        {
          "type": "table-row",
          "header": true,
          "content": [
            { "type": "table-cell", "header": true, "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Leaf" }] }] },
            { "type": "table-cell", "header": true, "content": [{ "type": "paragraph", "align": "center", "content": [{ "type": "text", "text": "Length / mm" }] }] }
          ]
        },
        {
          "type": "table-row",
          "content": [
            { "type": "table-cell", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "A" }] }] },
            { "type": "table-cell", "content": [{ "type": "paragraph", "align": "center", "content": [{ "type": "text", "text": "42" }] }] }
          ]
        }
      ]
    }
  ]
}
```

Rules:

- `"align": "center"` is the only alignment. Left is the default: leave `align` out for everything the source prints at the left, and never write `"left"`, `"right"` or `"justify"`.
- Only a `paragraph`, a `block-image` or a `table` takes `align`. A paragraph in a table cell or a `panel` may be centred too, as the numbers in a centred column often are.
- Centre only what the source centres: a figure, its caption, a table, a centred title line. Body text, questions and answers printed at the left stay left.
- A paragraph in a list item, a choice, a matching item or a word bank answer is never centred: those open with their own bullet, number or letter.
- Pictures and tables in a `panel` are already centred across it; `align` there is needed only for a paragraph.

**Boxes around the questions themselves are layout.** A border or shaded box that only frames or groups questions — a box around each question, around a section, or around an answer area — is not content. Ignore it: do not write it as a `blockquote`, a `side-by-side`, a table or a rule.

## Links

Only absolute HTTP and HTTPS links are allowed. Preserve both the visible label and destination:

```json
{
  "type": "text",
  "text": "reference",
  "marks": [
    {
      "type": "link",
      "href": "https://example.org/reference",
      "title": "Optional title"
    }
  ]
}
```

Reject or report `javascript:`, `data:`, `file:`, relative, and custom-scheme links. Do not silently make an unsafe link importable by changing its destination.

## Images and Pending Images

If an image is meaningful Question Content—for example, a graph or diagram the Question asks about, or a picture used as an answer choice—preserve it. Do not replace it with an invented description.

**Do not create Media Assets, and never write base64.** Instead, write a **Pending Image**: an image node that names the picture by its tag. Test Parrot takes the picture from the original file when the teacher imports the JSON.

**The file you were given may be a labeled copy**, and the [image tag list](#image-tags-in-this-document) below says whether it is. In a labeled PDF, Test Parrot has printed a small red tag, such as **IMG 3**, in the top-left corner of every image embedded in the document and every figure it found drawn with lines. In a labeled Word document, the red tag sits in the text just before its picture: it names the picture that follows it. The tags are not part of the source: never copy a tag into Question Content, `alt`, or `caption`, and describe each picture as if its tag were not there.

```json
{
  "type": "block-image",
  "pending": { "image": 3 },
  "alt": "Map of the bus routes in the town of Riverton",
  "caption": "Riverton Bus Routes and Stops, 2020"
}
```

Rules:

- A Pending Image has a `pending` member and **no `asset` member**.
- `pending` holds `image`: the number on the tag printed on that picture. Read the number from the tag; do not count images yourself.
- A picture with no tag, such as a diagram Test Parrot did not recognize or a picture on a scanned page, gets `"pending": { "page": <n> }` instead, where `n` is the 1-based page of the file as a PDF viewer counts it (in a Word document, always `1`). Do not add coordinates or any other location.
- **Not every tag is a picture.** Test Parrot tags generously: it tags every embedded image and every figure it finds drawn with lines, so a tag may cover a table, typed text, an equation, a caption, a structure made of characters, or only part of a larger figure, and some documents store a reading passage, a table, an equation, or a caption as an image. Transcribe those as ordinary content—text, a table, or math—exactly as you would if they were typed, and do not write a Pending Image for their tag. A tagged image that holds only words, such as a boxed reading passage with its source line, is text: transcribe it as a `blockquote` with its source line as the paragraph right after it (see [Page layout: boxes and side-by-side content](#page-layout-boxes-and-side-by-side-content)). A passage that several questions share is written once, in the stem of the Multipart Question those questions become (see [Multipart](#multipart)). Keep a picture only for genuine artwork, such as a map, chart, cartoon, photograph or graph. Write a Pending Image for a tag of words only if you cannot read its words reliably, and say so in the conversion report. When two or three adjacent tags are parts of one figure, write a Pending Image for each, in reading order, in the panels of one `side-by-side`, so they print together as that figure. Leave out any tag that is not Question Content, such as a lone mark or a decoration, and list it in the conversion report as not Question Content.
- Put the Pending Image exactly where the picture belongs: in the `stem` when the picture belongs to the question, or in the choice's `content` when the picture is that answer choice.
- **Write one Pending Image per picture.** Two graphs side by side, such as “Graph of f” and “Graph of g”, are two pictures and need two Pending Images, in reading order, each in its own `panel` of one `side-by-side`. When you cannot tell whether something is one picture or several, write several: an extra Pending Image is easy for the teacher to fill, and a missing one is not.
- **Shared pictures belong to a Multipart Question.** When one picture serves several questions, those questions are the Parts of one Multipart Question, and the picture is written once, in its stem. Directions such as “Use the information above for problems 3 – 5” mean that problems 3, 4, and 5 are the Parts of one Multipart Question whose stem holds the pictures those directions refer to; never copy the pictures into each Part's stem or into separate Questions (see [Multipart](#multipart)). The same tag appears in more than one place only when the source itself uses the same picture as content of two unrelated Questions, and then every occurrence names that tag.
- Put caption text printed beside or below the picture in `caption`, even if the source shows the caption as an image.
- Give every Pending Image useful `alt` text describing what the picture shows. `authoredSize` from `0.05` through `1` is optional: it is the width the picture prints at as a share of the width of what holds it — the question, a panel or an answer — so `0.5` prints it half as wide as the question. Never give a Pending Image a `crop`.
- Use `block-image` for a picture that stands on its own line, including a picture that is an answer choice's whole content. Use `inline-image` only for a small picture inside a line of text.
- Leave the Question Bank Record's `media` array empty: `"media": []`.

**Equations are not images.** Many documents store equations as small pictures. Write every equation as `inline-math` or `display-math` with its source, never as a Pending Image. Likewise, write text that the source shows as a picture, such as a caption or a heading, as text.

If you cannot tell where an essential picture is, identify the affected question and tell the user the conversion is incomplete. Do not omit the image silently.

### Image tags in this document

{{IMAGE_TAGS}}

In the conversion report, account for every tag listed here: which Questions and answers use it as a picture, or that it was transcribed as text, a table, or math, or that it is not Question Content (for example, a logo).

## Question Metadata and provenance

A Question may have:

- `difficulty`: `easy`, `medium`, or `hard`;
- `topics`: an ordered array of strings.

A Multipart Part or Subpart never has either: they belong to its Multipart Question. Points are not Question Metadata: see [Points](#points).

A bank may have:

- `description`;
- `author`;
- `license`, containing a required display `name` and optional absolute HTTP or HTTPS `url`.

Include only information explicitly present in the source or supplied by the user. Declared author and license information are not proof of identity or ownership.

## Final validation and delivery

Validate the package against the [package schema](./formats/package/0.1.0/schema.json), its Question Bank Record against the [Question Bank Record schema](./formats/question-bank/0.10.0/schema.json), and any Exam against the [Exam Record schema](./formats/exam/0.5.0/schema.json). Schema validation alone is not sufficient: also verify Question cardinality, unique IDs, that every matching `answer` names an ID in the same Question's `wordBank`, that every Multipart Part is Multiple Choice with at least two choices, Short Answer with none, or holds at least one Subpart and no `type`, `choices`, `suggestedAnswer` or `points`, that every Subpart is Multiple Choice or Short Answer in the same way, that every `points` is a positive whole number on a Question that is not Multipart, a Part that answers, or a Subpart, that every `side-by-side` has two or three panels and stands directly in a stem, safe links, and that every Pending Image follows the rules above.

Relevant import limits include:

- 75 MiB JSON record;
- 10,000 Questions;
- 2,000 Media Assets;
- 25 MiB per decoded Media Asset;
- 75 MiB total decoded media;
- 25,000 semantic nodes per Question;
- rich-text depth of 50;
- maximum image dimensions of 20,000 by 20,000 pixels.

Deliver exactly one complete `.parrot.json` file. Then tell the user:

> Download the JSON file, open [testparrot.com](https://testparrot.com), and drag the file into Test Parrot to import it.

**If you are Gemini,** show the complete JSON in one `json` code block rather than trying to present a file, and never shorten or elide any part of it. Then tell the user:

> Copy the JSON from the code block (use its copy button), paste it into a plain-text editor, and save it as `<short-bank-name>.question-bank.json`. Then open [testparrot.com](https://testparrot.com) and drag the saved file into Test Parrot to import it.

Also include a concise conversion report containing:

- source pages/images inspected;
- whether triage treated the source as a test (the package has an Exam) or as questions only (no Exam), and for a test which Multiple Choice positions were given `columns`;
- total Questions converted;
- counts by Question Type (a matching set is one Question; also give its item count; a Multipart question is one Question; also give its Part and Subpart counts);
- whether the source prints points, and if so how many Questions, Parts and Subparts carry them, every mark left out because it was not a positive whole number or had no clear question, and every printed total that does not match the points beneath it;
- whether answer correctness was supplied by the source's answer key or left unmarked because it has none;
- every question that names other questions by their source numbers, and every set of source numbers that became one Question (a Multipart question, a table to complete), so the teacher can check the numbering;
- every image tag, and which Questions and answers use it as a picture, or how it was transcribed instead;
- every ambiguity, omission, normalization, or unsupported element—or “None” when there were none;
- an **Unconverted Questions** section listing each source page and question identifier, opening words, and the reason it could not be converted—or “None” when every question was converted.

End by telling the user they can ask you to change anything they see in Test Parrot's preview, and that Test Parrot updates its preview when they drop in the new file.

### Corrections

The user may come back after looking at the import in Test Parrot, with a correction such as “questions 4 to 7 all use the map, so make them one Multipart question”, a picture placed on the wrong question, or an error message Test Parrot showed. Make the change against the source and these instructions, then deliver the **whole corrected file** again, in the same way as the first — never only the changed part, since Test Parrot replaces the file it is previewing. Keep every other Question, ID and position as it was, and say in a line or two what you changed. Test Parrot numbers Questions continuously across the test, so a number the user quotes from its preview may not be the source's number: find the question by its words.

Do not describe the result as complete if the Unconverted Questions section is not “None.” It is acceptable and safer to deliver a valid partial JSON file with an explicit warning than to corrupt meaning by forcing an uncertain question into the wrong type.
