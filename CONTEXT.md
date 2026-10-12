# Test Parrot

Test Parrot authors reusable questions, saves Exams, and records what teachers export while preserving the intended structure and layout across output formats.

## Language

**Question**:
A canonical record owned by exactly one Question Bank and referenced live by any number of Exams. One Question identity may occur at most once in an Exam; Duplicate creates a new Question in the original Question Bank.
_Avoid_: Exam question, question copy

**Question Content**:
The rich-text material authored for one question, including its stem and, when present, its answer choices or Suggested Answer.
_Avoid_: Question text, editor content

**Question Metadata**:
Difficulty and Topics used to organize and find Questions while composing an Exam. Question Metadata appears as tags beside each entry in an exported Answer Key, but does not appear on the student test.
_Avoid_: Question identity, export identity

**Question Bank**:
An independently reusable, named collection of canonical Questions whose confirmed changes save immediately. It may carry an optional description, author, and license; a new bank is named “Untitled Question Bank” by default. An Exam may reference Questions from any number of banks, and a bank may contribute Questions to any number of Exams.
_Avoid_: Question library

**Question Bank Pop-over**:
A compact, read-only, always-on-top window of Question Banks, kept beside another document so a teacher can select Questions and drag or Copy them across. It opens from a bank, holds that bank as one of its own tabs with their own filters, and belongs to no Exam; nothing in it edits, adds to an Exam, or deletes. How each Question is laid out for copying — its answer columns, Word Bank placement, answer lines — is set there for that window only and forgotten when it closes.
_Avoid_: Popup, mini mode, floating bank

**Copy**:
To put Questions' student-facing Question Content on the clipboard, or drag it, ready for another document: stems, answer choices, the T and F to circle, Items and Word Bank or Parts, lettered and laid out as a test prints them and unnumbered, with pictures embedded and mathematics as pictures or, for Microsoft Word, as MathML. It never carries correctness, a Suggested Answer, Question Metadata or Work Space, and it changes nothing; Duplicate is what creates a new Question.
_Avoid_: Duplicate (for putting a Question on the clipboard), export

**Question Bank File**:
A self-contained PDF for sharing one complete Question Bank, carrying a Test Parrot Package of that one bank and no Exams. It opens with front matter: the bank's details, a warning that it is a digital file containing answers whose import data is lost if it is printed, scanned or saved again as a PDF, and an outline of its Question Types, each with its count and its Topics, every one linked to its place in the preview. The preview follows that outline, placing each Question once, under its Question Type and its first Topic, and it is derived from the package the file carries, which is the authoritative source for importing the bank.
_Avoid_: Exam export, printable question bank, backup

**Question Bank Record**:
The versioned, format-owned machine-readable representation of one Question Bank and every Media Asset it needs. It travels inside a Test Parrot Package, or alone as a JSON file that import treats as a package of that one bank, and is the authoritative source for import in every case. Import either creates a new independent Question Bank from it or adds its Questions to an existing bank as new Questions, never preserving local identities or inferring Question Content from PDF pages.
_Avoid_: PDF metadata, extracted questions

**Exam Record**:
The versioned, format-owned machine-readable composition of one Exam: its name and, for each position, the Question it references in a Question Bank Record travelling in the same Test Parrot Package, with that position's answer columns, answer order, Hidden Answers, Word Bank layout and Work Space, and the Question Section it is in, and the Exam's heading and text sizes, Paper Style and Page Margins. It carries the Exam's Sections in print order, each with its Section Heading and Section Directions, so a test an assistant converts keeps its own parts in its own order. It never references a Question outside its package.
_Avoid_: Exam layout, test JSON

**Test Parrot Package**:
A versioned bundle of one or more Question Bank Records and any number of Exam Records that reference Questions in them, versioned separately from both. It travels as a zip file holding the package and, as a file of its own, each picture it needs: attached to every Question Bank File, attached to every exported Exam PDF whose Content Selection includes the answer key, or alone. A package that carries no pictures of its own, such as one an assistant writes, may travel as a bare JSON file. An Exam PDF's package holds one bank, named after the Exam, containing exactly that Exam's Questions, whichever banks they came from. Importing a package lets the teacher choose which banks and Exams to bring in.
_Avoid_: Import package, bundle, transfer file

**Question File**:
A file of questions written for another tool — a Blackboard Test Generator text or its uploads and pools, a QTI, Moodle, Aiken or GIFT export, a Respondus or Brightspace file, a spreadsheet — or pasted text or a Word document written in one of those formats. Test Parrot reads it with rules alone, no AI, into a Question Bank Record: the same file always gives the same Questions, and each question it cannot bring in is named with its line. A kind of question Test Parrot has no Question Type for is converted and reported, never silently dropped. A Question File is never a Source Document: its pictures come from the file itself when it carries them, and are added by hand when it does not.
_Avoid_: Foreign format, LMS export, legacy import

**Source Document**:
The teacher's original PDF or Word document (.docx), or a photo of their test, that an assistant converts into a Test Parrot Package. It is never authoritative for Question Content; Test Parrot uses it only to supply pictures for Pending Images, and keeps it only while its import is in progress. A photo is kept as a one-page PDF: nothing in it is tagged, so its pictures arrive as Pending Images naming page 1 and are cropped from it. A Word document has no fixed pages: its pictures are the image files it keeps, and a picture it does not keep as one, such as a chart or a shape drawn in Word, is resolved by upload. A test the teacher has only as pasted text or an older document format still converts, but has no Source Document; its pictures are resolved by upload.
_Avoid_: Original PDF, Question Bank File

**Image Tag**:
The numbered label, such as “IMG 3”, that Test Parrot prints on each picture in a labeled copy of a Source Document — inside the picture's corner in a PDF, just before it in a Word document — so an assistant can name a picture exactly. A tag names an embedded image, not necessarily a picture: a passage stored as an image is tagged too. In a PDF it can also name a figure drawn with lines, such as a graph a browser saved from an SVG, a chemical structure with its atom labels, a whole reaction row, or a ruled table; its picture is that region of the page, rendered. Drawn figures are tagged generously, so a tag may hold something the assistant transcribes instead.
_Avoid_: Image number, image ID, label

**Pending Image**:
An image in imported Question Content that names an Image Tag, or only a page, of its Source Document instead of carrying Media Asset bytes. It stays in the Question Bank until the teacher resolves it with a Media Asset, and an Exam that uses it cannot be exported until then.
_Avoid_: Placeholder image, dummy image

**Resolve Images**:
The step where a teacher confirms or replaces the Media Asset for each Pending Image, choosing from the Source Document's images, a crop of one of its pages, or an uploaded file. In an import it happens in the preview itself: every tagged picture is already in place, marked as detected, and clicking any picture offers the others. It can be reopened later while any remain by supplying the Source Document again.
_Avoid_: Image doctor, image review

**Import History**:
Every import this browser has started, newest first: each test still waiting for the file its assistant makes, with its Source Document, and each finished import with what it brought in and the Pending Images it still has. Every import is its own entry — starting one never replaces or resumes another — and a waiting import that is not finished within seven days expires, its Source Document removed. It is kept outside Account Backups, like the Source Documents it holds.
_Avoid_: Import log, upload history

**Account Backup**:
One file holding everything Test Parrot keeps in a browser: every Exam, Question Bank, Working Copy, Export History, Media Asset and preference. Restoring one replaces the browser's whole account rather than merging into it; it is refused when it comes from a storage generation this version cannot read.
_Avoid_: Export, Question Bank File, archive

**Difficulty**:
An optional classification of a question as easy, medium, or hard.

**Topic**:
An optional, free-form label describing subject matter assessed by a question. A question may have more than one Topic.
_Avoid_: Concept

**Points**:
What answering something correctly is worth, as a whole number: an optional part of a Question that is the same on every Exam using it. Points belong to what a student answers — a Multiple Choice, True/False, Fill in the Blank or Short Answer Question, a whole Matching set, or a Part or Subpart that answers — so a Multipart question's Points, and an Exam's total, are always the sum of their parts and never set apart from them. Something with no Points is unpointed, not worth nothing: it adds nothing to a total. Like Question Metadata, Points never show on the exam sheet or the student test unless the Exam's Paper Style prints them; the Answer Key always records them.
_Avoid_: Marks (except where a Paper Style prints its own wording), score, weight

**Default Picture Size**:
How wide a block image starts on any Exam: the width of what it shows, as a share of its printable container, such as the Question Content lane, a Panel or an answer-choice cell. It is part of the Question, but never set in the question editor, which shows each picture at this size and cannot resize it: a picture taken from a Source Document arrives at about the width it had on its page, a Picture Crop keeps what it shows at the size it printed at before, and a picture with none fits its container at its own width, or the container's when that is narrower. Copy, the Pop-over and the Question Bank show pictures at this size.
_Avoid_: Authored Image Size, image ratio, image height

**Exam Picture Size**:
How wide one Exam prints one of its Questions' block pictures, set by dragging the picture's corners on the exam sheet. It is Exam presentation, like Work Space, never Question Content: it wins over the Default Picture Size on that Exam alone — in its test and Answer Key, in every format and Version — and the Question never changes. It belongs to the picture as its source and Picture Crop name it, so re-cropping a picture makes it a new one at its default size. It is a share of its container like the default, never exceeds it and always keeps the picture's proportions, so a picture is resized from its corners alone. Duplicate copies it; Reset size lets it go.
_Avoid_: Image override, picture scale

**Picture Crop**:
The part of a block image's Media Asset that Question Content shows, measured on the upright picture. The whole Media Asset is kept, so a crop can always be widened again: in the editor a double click shows the cropped-away parts as a ghost around what is kept. Every output shows only the kept part.
_Avoid_: Cropped image, trimmed picture

**Centred**:
Said of a paragraph, block picture or table in Question Content that is set in the middle of its column, as a figure, its caption and a table often are; everything else is left, and nothing is right-aligned or justified. A Panel centres its pictures and tables by itself, and a list item's or an answer's blocks are never centred.
_Avoid_: Center-aligned, alignment

**Blockquote**:
Rich text set apart from the stem around it, printed inside a black border — the home of a quoted source passage, even one the source document stored as a picture. Its source attribution is an ordinary paragraph after it, not part of it.
_Avoid_: Box, callout, frame, stimulus

**Side-by-Side**:
Rich text in a stem that lays two or three equal Panels across one line, left to right, without borders, and is never split across a page. It holds no Side-by-Side and sits in no Blockquote or table.
_Avoid_: Columns (those are answer columns), row, grid, layout table

**Panel**:
One area of a Side-by-Side, holding any rich text a stem can except another Side-by-Side; its pictures and tables are centred across it and all Panels are centred against the tallest.
_Avoid_: Cell, column

**Exam**:
A mutable composition with a stable identity and a name, made from live references to Question Bank records. A new Exam is named “Untitled Exam” by default; Save updates it, while Save As moves the current Working Copy into a separate Exam and restores the source Exam to its last saved state. An untouched, empty Untitled Exam is disposable rather than durable. Deleting an Exam deletes its Export History too, but never its Questions.
_Avoid_: Exam project, exam family, Version, Draft

**Working Copy**:
The locally backed-up editing state currently open for an Exam. It may differ from the Exam's explicitly saved state and is the state that Save, Save As, and Export act upon.
_Avoid_: Exam Draft, Draft, autosaved Exam, local save

**Export Record**:
An immutable record attached to an Exam, deleted only with that Exam, and created each time its Working Copy or a previous Export Record is exported. It retains only the exact Content Selection, format, any Versions, question state, and Layout Plans produced by that event; repeated and historical re-exports produce separate Export Records, and export does not save the Exam. A historical re-export reproduces some or all of the record's Versions exactly and never creates new ones.
_Avoid_: Version, saved Exam, deduplicated export

**Export Artifact**:
A PDF or DOCX produced by an export and described by its Export Record.
_Avoid_: Version, Exam

**Version**:
One shuffled arrangement of an Exam's Questions and answers, produced by an export and kept in its Export Record. A Version of a question that has Hidden Answers hides as many as the Working Copy does, drawn for itself. Each Version has a two-word name, such as “Curly Fox”, that implies no order and is never reused within its Exam's Export History, and that name prints on its student test and answer key. Versions in one export differ from one another and from the Working Copy's own arrangement; an export that shuffles nothing prints the Working Copy's arrangement, unnamed, and produces no Version. Producing Versions never changes the Exam.
_Avoid_: Form, Variant, Version History, saved Exam

**Export History**:
The chronological collection of an Exam's Export Records, kept for as long as the Exam is. Export History preserves what the teacher produced without making the Exam immutable.
_Avoid_: Version History, audit log

**Remove**:
To exclude Question Content from an Exam while leaving it in its Question Bank.

**Delete**:
To permanently remove Question Content from its Question Bank, every Exam that references it, and their Working Copies. Deletion requires showing the affected Exams and explicit confirmation; existing Export Records remain unchanged. Deleting an Exam permanently removes it and its Export History after a confirmation naming the Exam and how many Export Records go with it.

**Question Type**:
What a Question asks for, settled when it is created and never changed afterwards: Multiple Choice, True/False, Matching, Fill in the Blank, Short Answer, or Multipart. It decides how the Question is answered and laid out, the wording a new Question Section of only Questions of this type begins with, and what its Answer Key entry records.
_Avoid_: Question format, question kind

**True/False**:
A Question Type whose answer is one of exactly two fixed choices, True and False, which the teacher picks between rather than writes. The pair is not printed as lettered answers: a T and an F print beside its number for a student to circle — or, under a Paper Style that asks for one, an answer line to write on — and the Answer Key records T or F rather than a choice letter. It does not Vary: True before False is a convention a student reads, not an authored order.
_Avoid_: Binary question, T/F question, two-choice multiple choice

**Matching**:
A Question Type that is one whole set: its stem is the set's directions, its Items are what a student matches, and its Word Bank is what they are matched against. One Matching Question takes one test number per Item — the numbers print on the Items, and the stem prints unnumbered — because the Items share one Word Bank. A Question Bank keeps a set whole: an Item is never a Question of its own.
_Avoid_: Matching question (for one Item), match list, pair

**Item**:
One numbered thing to match in a Matching set, in authored order. It is matched by naming one Word Bank answer, by identity rather than by letter, so a shuffled Word Bank moves its letter and not its match; an Item that names nothing is unmatched, which is incomplete rather than invalid. Its Answer Key entry records the letter of the answer it names.
_Avoid_: Prompt (in teacher-facing text), stem (for an Item), left side

**Word Bank**:
The lettered answers a Matching set's Items are matched against, in authored order. A letter is a position — Vary may shuffle a Word Bank, as it shuffles Multiple Choice answers — and no answer is correct on its own: several Items may name the same answer, and an answer no Item names is a distractor. Where a Word Bank prints is Exam presentation, like a Multiple Choice question's answer columns, and always one of two: beside its Items or above them in columns. Where the teacher has set none, the Exam's Paper Style supplies it — above under Classic, and otherwise beside its Items when its widest answer fits a column beside them — and a placement the teacher set always wins, so changing Paper Style never moves one.
_Avoid_: Choices (for a Matching set), answer list, right side

**Locked Answer**:
A Multiple Choice answer that keeps its authored letter however answers are shuffled, by Vary or in a Version, while the others shuffle among the letters left: “All of the above” means nothing anywhere else. It is Question Content, since it is about what the answer means. An answer worded like “All of the above”, “None of these” or “Both A and B” is locked by its wording, until the teacher unlocks it; any other the teacher may lock. A teacher's own decision outlasts any rewording, and only theirs is kept: an undecided answer follows what it says now. True/False answers and a Word Bank are never locked. A lock governs shuffling, not authoring: the teacher still moves a Locked Answer by hand, and a new answer is added above the Locked Answers that end the list.
_Avoid_: Pinned answer, fixed answer, anchored choice

**Hidden Answer**:
An incorrect Multiple Choice answer an Exam leaves off one of its positions, so the position shows from one up to all of its Question's incorrect answers. It is Exam presentation like answer order, never Question Content: the Question keeps every answer. The correct answer and every Locked Answer always show; nothing is hidden while no answer is marked correct, or beside a Locked Answer that names others by letter. The answers shown close up and are lettered as they print, on the test and in the Answer Key alike.
_Avoid_: Removed answer, deleted distractor, answer subset

**Fill in the Blank**:
A Question Type whose stem is a sentence written with one or more Blanks in it, for a student to write in. Each sentence is its own Question and takes one test number however many Blanks it holds, and its Answer Key entry records each Blank's answer in the order they appear. It has no Word Bank: one would be an accommodation, not part of what the question asks. A Fill in the Blank question with no Blank is incomplete rather than invalid.
_Avoid_: Cloze, completion, missing word

**Blank**:
A place in a Fill in the Blank question's stem where a student writes, holding the answer the teacher wrote for it as rich text, as they want the Answer Key to show it — a word, or alternatives the teacher allows. It prints the same length wherever it is, whatever its answer, so its length is never a clue; any hint, like a first letter, is ordinary stem text the teacher types.
_Avoid_: Gap, fill (and never “blank” for an answer line beside a number or in the Page Header)

**Short Answer**:
A Question Type whose response is intentionally brief and does not present answer choices.
_Avoid_: Open, Open ended, Open Response, Short Response

**Suggested Answer**:
Optional rich-text material authored for a Short Answer question to represent its answer in the Answer Key.
_Avoid_: Correct answer, sample response, rubric

**Multipart**:
A Question Type whose Question is a stem followed by its Parts. The stem is ordinary rich text, usually the shared material the Parts are asked about — a passage, quote, image, table or anything else. One Multipart question takes one test number, and its Parts are lettered beneath it. A Question Bank keeps it whole: a Part is never a Question of its own, and an Exam adds, moves and Removes a Multipart question as one Question.
_Avoid_: Stimulus, passage, document-based question, question group, source

**Part**:
One lettered question within a Multipart question, in authored order: a Multiple Choice Part with its own stem and answers, a Short Answer Part with its own stem and optional Suggested Answer, or a stem alone followed by its Subparts. Unlike a Question's type, a Part's type may be switched while it is edited; only the answers of the type it ends as are saved. Parts are never shuffled, since they are lettered in place and often build on one another, but a Multiple Choice Part's answers Vary as a Multiple Choice question's do. A Multipart question with no Parts is incomplete rather than invalid. Question Metadata belongs to the Multipart question, not its Parts; its Answer Key entry records one line per Part, or per Subpart where a Part has them.
_Avoid_: Sub-question, item (Item is Matching's), sub-part

**Subpart**:
One question numbered (i), (ii)… within a Part, in authored order: a Multiple Choice or Short Answer question like a Part, but never holding Subparts of its own. A Part that has Subparts answers nothing itself — its stem is their shared lead-in — so 2(a)(i) is as deep as a Multipart question goes. Like Parts, Subparts are never shuffled.
_Avoid_: Sub-question, sub-sub-part, nested part

**Work Space**:
Room an Exam leaves below a Short Answer question or Short Answer Part for a student's working: blank or ruled, as tall as the teacher drags it, or filling the rest of its page. It is Exam presentation set on the exam sheet like answer columns, never Question Content, so the same Question may take different room on another Exam; Duplicate copies it. Where the teacher has set none, the Exam's Paper Style supplies it — ruled lines under Classic and Condensed, none under Standard — and a Work Space the teacher set, None included, always wins. It is kept as a number of rows; the Paper Style decides how far apart they lie on the page, closer under Condensed, and the first row is a little shorter, so the first rule sits close under its question.
_Avoid_: White space, answer box, response area

**Page Header**:
The line an Exam prints at the top of each test page, beside the paper's ID. By default the first page asks for a Name, Class and Date on lines to write on, and later pages for a Name; an Exam may reword the first page's line and the later pages' line, as plain text in which underscores are the lines to write on, or clear either. The ID is the one value the header fills in for each paper and is never part of the line. The Exam's title prints on its own line under the first page's header, and Answer Key pages carry the ID alone. Every Paper Style prints it.
_Avoid_: Letterhead, banner, identity line

**Page Margins**:
How far in from each edge of the sheet an Exam's pages print, in inches: three quarters of an inch on every side unless the Exam sets its own, one value for all four sides or each side apart. It is Exam presentation, set from the Format menu like the heading and text sizes; every page of the test and the Answer Key prints with it, and the Exam's questions are packed into the room it leaves.
_Avoid_: Padding, page border, gutter

**Paper Style**:
How an Exam's paper is drawn, apart from what it asks and how its Questions are arranged: its paper size, fonts, how Questions, Parts and Subparts are labelled, how ruled Work Space looks, where Points and their totals print, and its running header and footer. An Exam names one Paper Style — Standard, Classic, Condensed or Exam Board — chosen from the Format menu and never set per question; it decides what prints before a question's number, how answers and a Word Bank are lettered and laid out, how far apart questions stand, and what Work Space or Word Bank layout a question has when the teacher has set none. Standard is the sheet as it always printed, and switching between them never changes the Exam or its Questions, so switching back restores the same paper. A Paper Style is a description Test Parrot draws, never code of its own, and no Paper Style carries an exam board's name, marks or wording. A Paper Style never adds a page of its own: every page it prints holds the Exam's own questions.
_Avoid_: Question Style, template, theme, format, layout preset

**Question Section**:
An ordered group of Questions within an Exam, of any Question Type, fixed in the Exam and its exported output. An Exam's Sections print in whatever order the teacher arranges them, and every Question in an Exam belongs to exactly one Section. A Section has its own Section Heading and Section Directions, and an emptied Section stays, and prints its heading and directions, until the teacher deletes it or merges it with a neighbour — so the sheet and the paper always put every Question on the same page; deleting a Section Removes its Questions, while merging moves them into the neighbour, under its wording. Every heading on an Exam, its title included, prints at one of three sizes, and its questions and answers at one of three text sizes chosen apart from the headings. The Answer Key groups its entries by Section and uses the test's headings.
_Avoid_: Question category, type section

**Section Heading**:
The title a Question Section prints above its Questions. A new Section made from Questions begins with the heading of their type when they are all one Question Type, and untitled — with no heading or directions — when they mix types; one inserted empty begins as "New section". After that it is the teacher's own text for that Section alone, which they may reword, or clear so it prints nothing.
_Avoid_: Section title, header

**Section Directions**:
The line of instructions a Question Section prints under its Section Heading, telling a student how to answer. Like the heading, it begins as that of the type of the Questions the Section is made from when they share one, and empty otherwise or when the Section is inserted empty, and is then the teacher's to reword or clear.
_Avoid_: Subheading, instructions, section subtitle

**Vary**:
A family of Exam actions that shuffle question order or answer order — a Multiple Choice question's or Part's answers, or a Matching set's Word Bank — in the Working Copy, before saving or exporting. Locked Answers keep their letters. Vary also chooses how many of a Multiple Choice question's incorrect answers show, and shuffling a question with Hidden Answers draws again which ones. Shuffling that happens during export produces Versions instead and leaves the Exam untouched; it is not Vary.
_Avoid_: Randomization, version generation

**Export Preview**:
A read-only, output-faithful rendering of the Working Copy with selection, correctness, and other editor annotations hidden. It is not a separate draft or editing workspace.
_Avoid_: Export workspace, draft version

**Media Asset**:
Immutable image bytes identified by their content rather than by a mutable location. Export Records retain Media Asset references so recorded output does not depend on an external or disposable image URL.
_Avoid_: Image URL, cached image

**Export Document**:
The format-neutral semantic content and presentation intent for one Exam export and Content Selection.
_Avoid_: Central representation, export model

**Layout Plan**:
The format-neutral resolution of an Export Document into pages, grids, headers, footers, and explicit break decisions.
_Avoid_: Rendered document

**Content Selection**:
Which documents an export covers — the student test, the answer key, or both.
_Avoid_: Print content, mode

**Export Adapter**:
A translator from a Layout Plan into a particular output format, such as print HTML/PDF or DOCX.
_Avoid_: Renderer

**Reference PDF**:
The PDF captured from the print Export Adapter and treated as the layout oracle for export acceptance.
_Avoid_: Golden PDF

**Comparison Engine**:
External software used during testing to render a DOCX into a PDF whose structure and geometry can be compared with the Reference PDF.
_Avoid_: DOCX renderer

**Export Fingerprint**:
The normalized semantic content, page assignment, and structural topology used to compare an Export Document, its Layout Plan, and each Export Adapter's output. It excludes output format, package bytes, generated identifiers, coordinates, fonts, raster appearance, and renderer-chosen line wrapping.
_Avoid_: Version identity, snapshot, golden
