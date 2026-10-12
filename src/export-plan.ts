// Export planning: one Export Document, one Layout Plan.
//
// This is the single module that decides what an exam arrangement *says* and how it
// *falls onto pages*. Both Export Adapters — the React/HTML print path and the
// DOCX writer — consume the Layout Plan it returns. Neither walks an `Exam`
// itself, so a content or pagination rule is implemented and fixed once.
//
// The interface callers and tests use is `planExport`: an exam, one arrangement,
// the requested content selection and a `Measure` in; a complete `LayoutPlan`
// out. The two stages behind it are internal:
//
//   1. Semantic derivation into an `ExportDocument` — sections, continuous
//      question numbering, this arrangement's choice order and the letters it
//      earns, choice-grid topology, the answer key.
//   2. Layout resolution into a `LayoutPlan` — page assignment, page furniture,
//      footer numbering, and the explicit break decisions a serializer needs.
//
// Measurement is injected rather than taken from the DOM, so the whole pipeline
// is testable without a browser: nothing here reads a layout property itself,
// it asks `Measure` for one. Export Adapters never measure and never repaginate.
//
// Packing is atomic by default: a question that fits stays whole, and one that
// does not fit moves to the next page whole. Only a question that alone exceeds
// a full content box is ever split, and then only at the boundaries between its
// top-level stem blocks — never through a choice grid or a matching set, and
// never leaving a bare question number at the foot of a page.

import {
  columnsOf,
  orderedChoices,
  orderedPartChoices,
  partsOf,
  promptsOf,
  questionsInSection,
  sectionsOf,
  takesWorkSpace,
  topicsOf,
  laidWorkSpaceHeight,
  rowsIn,
  isWordBankLayout,
  choicesOf,
  WORK_SPACE_LINE_PITCH,
  workSpaceOf,
  workSpaceRowsOf,
  type Difficulty,
  type Exam,
  type Question,
  type QuestionType,
  type Arrangement,
  type PartType,
  type Subpart,
  type WorkSpaceRows,
  type WordBankLayout,
  type WorkSpace,
  type WorkSpaceStyle,
} from './exam'
import { stemNodesOf, type ProseMirrorJSON } from './question-doc'
import { blankAnswerBlocks } from './blank'
import { withPictureSizes } from './picture-geometry'
import { pointsOfQuestion, sumOfPoints } from './points'
import { answerVisibilityOf, shownChoices, type AnswerVisibility } from './hidden-answers'
import { headerLineOf, type ExamHeader, type HeaderLine } from './page-header'
import { DEFAULT_MARGIN, marginPx, marginsOf, sameMargins, type MarginSide, type PageMargins } from './page-margins'

// The default section wording lives with the rest of what an Exam may say
// about its sections; re-exported for the adapters and tests that print it.
export { SECTION_INSTRUCTIONS, SECTION_TITLE } from './section-headings'
import {
  DEFAULT_HEADING_SIZE,
  DEFAULT_TEXT_SIZE,
  type HeadingSize,
  type TextSize,
} from './section-headings'
import { TITLE_LINE_HEIGHT, TITLE_PX } from './export-typography'
import {
  ANSWER_BLANK,
  DEFAULT_PAPER_STYLE,
  PERIOD_LABELS,
  labelled,
  paperStyleRules,
  type LabelTemplate,
  type PaperSize,
  type PaperStyle,
  type PaperStyleRules,
} from './paper-style'

// How many columns a choice grid is drawn in — the same set a question's
// `columns` setting comes from, named here because the plan is what the
// renderers read.
export type ColumnCount = 1 | 2 | 4

/** What an item is laid out under besides its own content: the Exam's text
 *  size, the width its page's margins leave, and its Paper Style, which
 *  decides the space left below a question. Absent members are the defaults —
 *  normal text on today's sheet, in the Standard style. */
export type ItemLayout = {
  textSize?: TextSize
  contentWidth?: number
  paperStyle?: PaperStyle
}

// Everything the render needs to know about how big things come out. The app
// supplies a DOM-backed implementation; tests supply stubs.
export type Measure = {
  /** Height in px of one page item, laid out at the content box's width, at
   *  the Exam's text size and with the space its Paper Style leaves below
   *  a question. Each member of `layout` is passed only when it is not the
   *  default. */
  itemHeight(item: PageItem, layout?: ItemLayout): number
  /** The width in px a choice-grid cell needs to hold this answer on one line,
   *  its letter and the cell's padding included. Optional: a measure without
   *  it never lets a Paper Style widen answers past their set columns. */
  choiceWidth?(choice: PlannedChoice, textSize?: TextSize): number
  /** How many lines the Exam title wraps onto at this heading size, set
   *  across `width`. Optional: a measure without it plans every title on one
   *  line, as the sheet always did. */
  titleLines?(title: string, size: HeadingSize | undefined, width: number): number
  /** The width in px a Word Bank answer needs on one line, its letter
   *  included: how wide a bank beside its Items is drawn, and — read once,
   *  when a Matching position takes its layout (`wordBankLayoutFor`) — whether
   *  it goes there at all. Optional: a measure without it draws every bank
   *  beside its Items at `MATCHING_BANK_WIDTH`. */
  bankAnswerWidth?(answer: PlannedBankAnswer, textSize?: TextSize): number
}

// A stub that reports nothing: every item is zero-height, so an exam packs onto
// one page. Tests that are not about geometry inject this; the app injects
// `domMeasure`.
export const unmeasured: Measure = {
  itemHeight: () => 0,
}

// A choice as it prints: its letter is its position in this arrangement's ordering,
// so it is what the student writes on their paper and what the answer key
// records.
export type PlannedChoice = {
  id: string
  letter: string
  correct: boolean
  /** A Locked Answer, which kept its letter however answers were shuffled.
   *  Only the Working Copy's sheet shows it; nothing prints it. */
  locked?: true
  node: ProseMirrorJSON
  /** How its letter prints on the test, when the Paper Style labels answers
   *  otherwise than `A.` — `A` under Exam Board. Absent prints `letter` and a
   *  full stop (`printedLabel`). Only a grid's cells carry it. */
  printed?: string
}

/** How a label prints: as the plan resolved it for its Paper Style, or — on
 *  every style that labels with a full stop, and every plan recorded before a
 *  style could say otherwise — the number or letter and a full stop. Every
 *  adapter labels questions, Parts, Subparts and answers through this. */
export function printedLabel(label: string | number, printed: string | undefined): string {
  return printed ?? `${label}.`
}

/** A label resolved through a style's template, or nothing where the
 *  template is the sheet's own `{n}.`, so a plan under any style that
 *  labels so is exactly what it always was. */
function printedBy(template: LabelTemplate, value: string | number): { printed: string } | Record<string, never> {
  return template === PERIOD_LABELS.question ? {} : { printed: labelled(template, value) }
}

// The choice grid, row by row. `cells[row][column]` is `null` where the last
// column runs out of choices. Filled column-major: reading a column top to
// bottom gives consecutive letters. A cell's letter is the one the test prints
// — lower case under a Paper Style that letters "a." — while the question's
// own `choices` keep the capitals its Answer Key records.
export type ChoiceGrid = {
  columns: ColumnCount
  rows: number
  cells: (PlannedChoice | null)[][]
}

// One item of a matching set as it prints: its own number on the test, the
// letter of the Word Bank answer it matches under this arrangement's bank
// order — `null` when the teacher has not matched it — and the node to render.
export type PlannedPrompt = {
  id: string
  number: number
  letter: string | null
  node: ProseMirrorJSON
  /** How its number prints, when the style numbers otherwise than `1.`. */
  printed?: string
}

// A Word Bank answer as it prints: its letter is its position in this
// arrangement's ordering, which is what a student writes in a prompt's blank.
// It prints as the Paper Style letters it; the prompt's own `letter`, which
// the answer key records, keeps its capital.
export type PlannedBankAnswer = {
  id: string
  letter: string
  node: ProseMirrorJSON
  /** How its letter prints, when the style letters otherwise than `A.`. */
  printed?: string
}

// A long Word Bank laid out in columns above the items, column-major like a
// choice grid: reading a column top to bottom gives consecutive letters.
// `cells[row][column]` is `null` where the last column runs out of answers.
export type BankGrid = {
  columns: number
  rows: number
  cells: (PlannedBankAnswer | null)[][]
}

// A matching set as it prints. A bank on a different page from its prompts is
// no use to a student, so a set too long for one page breaks only between its
// prompts, and every piece prints the whole bank. A short bank prints beside the numbered prompts, in a column of its own to
// their right; a long one prints above them in `bankGrid`, as the source tests
// lay it out once it no longer fits down the side.
export type MatchingSet = {
  prompts: PlannedPrompt[]
  /** The Word Bank in this arrangement's order, lettered. */
  bank: PlannedBankAnswer[]
  /** The bank in columns, when it prints above the prompts; `null` when it
   *  prints beside them. */
  bankGrid: BankGrid | null
  /** How wide the column beside the prompts is, its inset included, when the
   *  bank prints there and needs more than `MATCHING_BANK_WIDTH`. Absent on
   *  every other set, and on plans recorded before a bank could widen. */
  bankWidth?: number
}

/** The longest Word Bank that is placed beside its items when nothing can
 *  measure it. A measured bank is placed by whether it fits
 *  (`wordBankLayoutFor`). */
export const MATCHING_BESIDE_LIMIT = 5

/** The least room a matching set's prompts keep beside a Word Bank, their
 *  number column aside, in CSS pixels: enough for a short sentence a line.
 *  Condensed lets the prompts narrow further, so more banks go beside them. */
export const MATCHING_PROMPTS_MIN_WIDTH = 240
export const CONDENSED_MATCHING_PROMPTS_MIN_WIDTH = 180

/** How far the Word Bank beside the prompts is set in from them: the
 *  `.matching-bank` padding in styles.css. */
export const MATCHING_BANK_INSET = 24
export const MATCHING_BANK_COLUMNS = 2

// The room a Short Answer piece leaves below itself, resolved onto a page.
// `height` is final: for a space that fills the rest of its page, packing has
// already grown it to reach the foot of that page, so an adapter draws exactly
// this much and never measures. `lines` is how many ruled lines fit in it —
// none for a blank space — counted here so every adapter rules the same number.
export type PlannedWorkSpace = {
  /** The height it takes on the page, laid out in its rows. */
  height: number
  style: WorkSpaceStyle
  lines: number
  fill: boolean
  /** How far apart its rows lie, and how tall its first one is, in CSS
   *  pixels: the Paper Style's pitch, the first row shortened so the first
   *  rule sits close under the question. A plan recorded before either was
   *  stated reads as 32 and 32 (`rowsOfPlanned`), as it printed. */
  pitch?: number
  firstRow?: number
  /** Set when its lines are dotted rather than solid, as the Paper Style
   *  rules them (ADR-0045). Absent is a solid rule. */
  ruling?: 'dotted'
}

/** Whether Points printed after an answer that ends in this Work Space stand
 *  on its last ruled line, at its right end — `……………… [3]` — the last rule
 *  stopping short of them, rather than on a line of their own. Only a ruled
 *  space that takes room has a last rule to set them on. Every adapter, and
 *  so the measure, draws by this. */
export function pointsOnLastRule(space: PlannedWorkSpace | null | undefined): boolean {
  return !!space && space.style === 'lines' && space.lines > 0 && space.height > 0
}

/** The rows a planned work space is drawn in. Every adapter draws by this. */
export function rowsOfPlanned(space: PlannedWorkSpace): WorkSpaceRows {
  return { pitch: space.pitch ?? WORK_SPACE_LINE_PITCH, first: space.firstRow ?? WORK_SPACE_LINE_PITCH }
}

/** Room a filled work space leaves at the foot of its page, so fractional
 *  measurement can never round it onto another sheet. */
const WORK_SPACE_FILL_SLACK = 1

/** A stored work space as the page lays it out in `rows`: as many rows as it
 *  stores, at the style's pitch. */
function plannedWorkSpace(space: WorkSpace, rows: WorkSpaceRows, rules: PaperStyleRules): PlannedWorkSpace {
  const height = laidWorkSpaceHeight(space.height, rows)
  return {
    height,
    style: space.style,
    lines: space.style === 'lines' ? rowsIn(height, rows) : 0,
    fill: space.fill,
    pitch: rows.pitch,
    firstRow: rows.first,
    ...(rules.ruling === 'dotted' ? { ruling: 'dotted' as const } : {}),
  }
}

// One Subpart of a Part as it prints: numbered `i`, `ii`, … in authored order
// beneath its Part's lead-in, with its own stem and — for a Multiple Choice
// Subpart — its answers in this arrangement's order and the grid they lay out
// in, or — for a Short Answer one — the room it leaves for work. A Subpart
// prints the way a Part of its kind does, one level further in.
export type PlannedSubpart = {
  id: string
  /** Its position under its Part — `i`, `ii`, … — as every Paper Style labels
   *  it today. The label is data, like a Part's letter, so a style that prints
   *  `(i)` changes the plan rather than an adapter. */
  label: string
  type: PartType
  stem: ProseMirrorJSON[]
  /** The answers in this arrangement's order, lettered `A`, `B`, …; empty for
   *  a Short Answer one. */
  choices: PlannedChoice[]
  grid: ChoiceGrid | null
  /** The room a Short Answer one leaves for work, resolved as a question's is
   *  — zero-height when it leaves none, so the sheet can offer a handle to
   *  drag some open. `null` for a Multiple Choice one. */
  workSpace: PlannedWorkSpace | null
  /** A Short Answer one's Suggested Answer, for the Answer Key only. */
  suggestedAnswer?: ProseMirrorJSON[]
  /** What answering it is worth, when it has points (ADR-0042). Planned as
   *  data whether or not the Paper Style prints it: the Answer Key does, and
   *  where the test does is the style's to decide. A Part that holds
   *  Subparts never has any of its own. */
  points?: number
  /** How its label prints, when the Paper Style labels it otherwise than
   *  `i.` — `(i)` under Exam Board; a Part's letter, `(a)`. */
  printed?: string
  /** Its Points as the Paper Style prints them after its answer, against the
   *  right margin — `[2]` under Exam Board. Absent on an unpointed one and
   *  under every style that prints no Points on the test, and on every piece
   *  of one broken across pages but the last. */
  pointsAfter?: string
  /** Set on a piece of one whose stem broke across pages (ADR-0048): its
   *  label printed on an earlier page, so this piece prints none — only the
   *  stem blocks it carries, and its answers or room when it is the last. */
  continued?: true
}

// One Part of a Multipart question as it prints: lettered `a`, `b`, … in authored order
// beneath the Multipart question's one number, with its own stem and — for a Multiple
// Choice Part — its answers in this arrangement's order and the grid they lay
// out in, or — for a Short Answer Part — the room it leaves for work. A Part
// prints the way a question of its kind does, one level in. A Part that holds
// Subparts prints its stem as their lead-in and answers nothing itself: no
// answers, no grid, no work space — its Subparts carry them.
export type PlannedPart = Omit<PlannedSubpart, 'label' | 'type'> & {
  /** Its position under the Multipart question: `a`, `b`, …. */
  letter: string
  type: PartType | 'subparts'
  /** The Subparts this piece prints beneath the Part's lead-in, in authored
   *  order; empty for a Part that answers itself. */
  subparts: PlannedSubpart[]
  /** Set on a piece of a Part whose letter printed on an earlier page: it
   *  prints no letter, only the stem blocks it carries — the rest of its stem
   *  or lead-in, none when it only goes on with its Subparts — then its
   *  answers or room, or its Subparts, in their place. */
  continued?: true
}

/** A Part or Subpart that answers, as it is planned, with the name it goes by:
 *  a Part's letter, `a`, or a Subpart's place under its Part, `a (i)`. */
export type NamedAnswering = {
  name: string
  part: Omit<PlannedSubpart, 'label'>
  /** Whether it is a Subpart rather than a Part. */
  subpart: boolean
}

/** Every Part and Subpart that answers among these planned Parts, in the order
 *  they print, by the name the Answer Key and the sheet's menus give each. */
export function answeringPartsIn(parts: readonly PlannedPart[]): NamedAnswering[] {
  return parts.flatMap(({ letter, subparts, type, continued, ...part }): NamedAnswering[] => {
    void continued
    return type === 'subparts'
      ? subparts.map(({ label, ...subpart }) => ({ name: `${letter} (${label})`, part: subpart, subpart: true }))
      : [{ name: letter, part: { ...part, type }, subpart: false }]
  })
}

/** The Work Space that ends this Part on the page: its own, or its last
 *  Subpart's when it holds Subparts. */
export function closingWorkSpaceOf(part: PlannedPart): PlannedWorkSpace | null {
  return part.subparts.length > 0 ? part.subparts.at(-1)!.workSpace : part.workSpace
}

/** The Part with the Work Space that ends it grown by `grow`. */
function withClosingWorkSpace(
  part: PlannedPart,
  grow: (space: PlannedWorkSpace) => PlannedWorkSpace,
): PlannedPart {
  const last = part.subparts.at(-1)
  if (last) {
    if (!last.workSpace) return part
    return { ...part, subparts: [...part.subparts.slice(0, -1), { ...last, workSpace: grow(last.workSpace) }] }
  }
  return part.workSpace ? { ...part, workSpace: grow(part.workSpace) } : part
}

export type PlannedQuestion = {
  id: string
  type: QuestionType
  /** Position on the printed test, counted continuously across sections. A
   *  matching set's number is its first prompt's: its prompts take the run of
   *  numbers from there, one each, and the set's stem prints unnumbered. */
  number: number
  /** What prints in the number column, before the number, as the Exam's
   *  Paper Style decides: the T and F a student circles on a True/False
   *  question, or an answer blank to write on — `ANSWER_BLANK` — and nothing
   *  on a Standard Multiple Choice question, whose letter is circled on its
   *  answer. */
  marks: readonly string[]
  /** The question document's top-level blocks, without the choice list. */
  stem: ProseMirrorJSON[]
  /** The answers in this arrangement's order, lettered. Empty for short answer
   *  and for a matching set, whose Word Bank is in `matching`. A True/False
   *  question carries its pair here — lettered `T` and `F`, which is what the
   *  Answer Key reports — even though the test prints only its `marks`. A
   *  Multiple Choice question carries only the answers it shows: its Hidden
   *  Answers are left out, and the rest lettered as they print. */
  choices: PlannedChoice[]
  /** How many of a Multiple Choice question's incorrect answers show, when
   *  this Exam hides some. Only the Working Copy's sheet says so. */
  answerVisibility?: AnswerVisibility
  /** How those answers lay out, or `null` when the test does not print them —
   *  a short answer question has none, and a True/False question's pair is
   *  stated by the section's directions instead. */
  grid: ChoiceGrid | null
  /** The prompts and Word Bank of a matching set; `null` for every other
   *  Question Type. */
  matching: MatchingSet | null
  /** The room this Exam leaves below a Short Answer question for a student's
   *  work, as the teacher set it or its Paper Style supplies it, laid out
   *  in the style's rows; `null` for every other Question Type. A Short Answer
   *  question with no room still carries one, zero-height, so the sheet can
   *  offer a handle to drag some open. */
  workSpace: PlannedWorkSpace | null
  /** Optional organizational metadata, retained so the Answer Key can help a
   *  teacher identify and review the Questions without exposing it to students. */
  difficulty?: Difficulty
  topics?: string[]
  /** Where a Matching question's Word Bank prints on this Exam, as its
   *  position stores it. Absent on a plan recorded before every Matching
   *  position stored one, and on every other Question Type. */
  wordBankLayout?: WordBankLayout
  /** A Short Answer question's Suggested Answer, as top-level blocks. Never
   *  printed on the test; the Answer Key prints it under the question's line. */
  suggestedAnswer?: ProseMirrorJSON[]
  /** A Multipart question's Parts, lettered, in authored order; `null` for every other
   *  Question Type. A Multipart question's `stem` is the shared material its Parts are asked about. */
  parts: PlannedPart[] | null
  /** What the whole question is worth, when anything in it has Points: its
   *  own Points, or a Multipart question's Parts' and Subparts' sum
   *  (ADR-0042). Not to be confused with `marks`, which is what prints in
   *  the number column. No current Paper Style prints it on the test; the
   *  Answer Key counts its total from it. Absent on a plan recorded before
   *  Points existed, which therefore reprints as it always did. */
  totalPoints?: number
  /** How its number prints, when the Paper Style numbers otherwise than
   *  `1.` — a bold `1` under Exam Board. */
  printedNumber?: string
  /** Its Points as the Paper Style prints them after its answer — `[2]` —
   *  as a Part's are (ADR-0045): on the last line of a ruled Work Space
   *  (`pointsOnLastRule`), otherwise on a line of their own against the right
   *  margin. Absent on a Multipart question, whose Parts carry their own, on
   *  an unpointed question, and under every style that prints none. */
  pointsAfter?: string
  /** The totals its Paper Style prints after the whole question, against the
   *  right margin, in order (ADR-0045): a Multipart question's — `[Total: 9]`
   *  — and, after a Section's last question, that Section's. Absent when the
   *  style prints none, or nothing in it has points. Only the question's last
   *  piece prints them. */
  closingPoints?: string[]
}

/** How a question's number prints in its number column. */
export function printedNumberOf(question: Pick<PlannedQuestion, 'number' | 'printedNumber'>): string {
  return printedLabel(question.number, question.printedNumber)
}

/** How many numbers a question takes on the test: one, or one per prompt for
 *  a matching set. What continuous numbering advances by. */
export function numbersTakenBy(question: PlannedQuestion): number {
  return question.matching ? question.matching.prompts.length : 1
}

/** The question's number as a teacher would say it — `22`, or `22–25` for a
 *  matching set whose prompts run over several. */
export function numberLabelOf(question: PlannedQuestion): string {
  const span = numbersTakenBy(question)
  return span > 1
    ? `${question.number}–${question.number + span - 1}`
    : String(question.number)
}

export type SectionHeadingItem = {
  kind: 'section-heading'
  /** Which of the Exam's Sections this heads. */
  sectionId: string
  title: string
  instructions: string
  /** A heading is never left at the foot of a page without its first question.
   *  Packing enforces it; adapters carry it into their own keep-with-next. */
  keepWithNext: true
  /** The Exam's heading size, present only when it is not `'normal'` — so an
   *  Exam that never chose one plans exactly as it always did. */
  size?: HeadingSize
  /** A Section with no questions yet. It prints like any other; the sheet
   *  also offers it as a place to put some. */
  empty?: true
}

// A question, or as much of one as this page has room for.
//
// The common case is one item carrying the whole question: `stem` is the
// question's own stem, `numbered` is true, and `grid` is the question's own
// grid. A question too tall for any page comes out as consecutive pieces of the
// same `question` instead — the first carrying the number line, the last
// carrying the grid, and each carrying a run of top-level stem blocks. Views
// draw the item, never the question behind it, so a split needs no special case
// on screen or on paper.
export type QuestionItem = {
  kind: 'question'
  /** The whole question, for identity, numbering, selection and the answer key. */
  question: PlannedQuestion
  /** The top-level stem blocks this piece prints, in order. */
  stem: ProseMirrorJSON[]
  /** Whether this piece is the question's first: the one that prints the
   *  number line and answer blank (see `printsNumberLine`) and carries its
   *  editing handles. Never alone: it always carries stem, grid or set with it. */
  numbered: boolean
  /** The choice grid, on the single piece that prints it. Never split. */
  grid: ChoiceGrid | null
  /** The matching set: this piece's run of prompts, with the whole Word Bank
   *  on every piece of a set split across pages. */
  matching: MatchingSet | null
  /** A Short Answer question's work space, on its last piece — so the room
   *  for an answer always follows the whole question. `null` on every other
   *  piece and for every other Question Type. */
  workSpace: PlannedWorkSpace | null
  /** The Parts of a Multipart question this piece prints; `null` for every other
   *  Question Type. A Multipart question breaks only between its Parts or a
   *  Part's Subparts, or — when the stem and its first Part cannot share a
   *  page — between its stem's blocks. */
  parts: PlannedPart[] | null
  /** The question's own Points after its answer (`PlannedQuestion.pointsAfter`),
   *  on the piece that ends it; absent on every other piece. */
  pointsAfter?: string
  /** The question's closing totals (`PlannedQuestion.closingPoints`), on the
   *  piece that ends it; absent on every other piece. */
  closingPoints?: string[]
}

/** Whether this piece prints the question's number line: the first piece of
 *  any question but a matching set, whose numbers print on its prompts. */
export function printsNumberLine(item: QuestionItem): boolean {
  return item.numbered && item.question.matching === null
}

/** Whether this piece's first Part prints on the question's number line —
 *  `1 (a) Fig. 1.1 shows…` — because the Multipart question has no stem of
 *  its own: the first piece, with nothing above its Parts. Every adapter
 *  draws, and reads back, the number and the Part's letter as one line. */
export function partsOpenNumberLine(item: QuestionItem): boolean {
  const first = item.parts?.[0]
  return printsNumberLine(item) && item.stem.length === 0 && first !== undefined && !first.continued
}

/** Whether a Part's first Subpart prints on the Part's own letter line —
 *  `(b) (i) Name…` — because the Part has no lead-in. */
export function subpartsOpenLabelLine(part: PlannedPart): boolean {
  return !part.continued && part.stem.length === 0 && part.subparts.length > 0
}

// The answer key's own content items. The repeated title lives in the page's
// furniture (see `PageHeader`'s `'answer-key'` variant) rather than packing
// as an item — it is drawn the same way the test's own title is, on every
// key page, since the key carries only one header variant. What does pack is
// the "Answer Section" heading, one grouping heading per section that holds a
// question, and one line per question.
export type AnswerKeyHeadingItem = {
  kind: 'answer-key-heading'
  /** The paper's total Points, printed beside the heading, when any of its
   *  questions have points (ADR-0042). Under every Paper Style. */
  totalPoints?: number
}

export type AnswerKeySectionItem = {
  kind: 'answer-key-section'
  sectionId: string
  title: string
}

// One line of the key: a question's number, its organizational metadata and,
// for multiple choice, the correct letter under this arrangement's ordering.
// `letter` is `null` for a free-response question — the key still gives it a
// blank so the numbering lines up with the test — and a Short Answer question
// with a Suggested Answer prints that answer on the lines below its blank.
export type AnswerKeyEntryItem = {
  kind: 'answer-key-entry'
  number: number
  letter: string | null
  difficulty?: Difficulty
  topics?: string[]
  suggestedAnswer?: ProseMirrorJSON[]
  /** A Multipart question's one line per Part — or per Subpart, where a Part
   *  holds them — under its one number. */
  parts?: AnswerKeyPartLine[]
  /** What the question is worth, printed `[n]` after its answer, when it has
   *  Points. A Multipart question's Points print on its Part lines instead, and
   *  a Matching set's — one for the whole set — on its first Item's line. */
  points?: number
}

/** What the Answer Key records for one Part or Subpart: the correct letter for
 *  a Multiple Choice one (`null` when none is marked), or the Suggested Answer
 *  for a Short Answer one. */
export type AnswerKeyPartLine = {
  /** What the line is labelled: a Part's letter, `a`, or a Subpart's place
   *  under its Part, `a (i)`. */
  letter: string
  /** Set on a Subpart's line, whose longer label takes a wider column. */
  subpart?: true
  answer: string | null
  suggestedAnswer?: ProseMirrorJSON[]
  /** What the Part or Subpart is worth, printed `[n]`, when it has points. */
  points?: number
}

/** Points as the Answer Key prints them after an answer, in every adapter. */
export function answerKeyPointsText(points: number): string {
  return `[${points}]`
}

/** The paper's total as the Answer Key prints it beside its heading. */
export function answerKeyTotalText(points: number): string {
  return `Total: ${points} ${points === 1 ? 'point' : 'points'}`
}

// The paper's total, as a Paper Style that prints it there (ADR-0045) words
// it: one line opening the test, beneath the title on its first page, when
// anything on the paper has Points. Never part of the Answer Key, which
// prints its own total beside its heading.
export type PaperTotalItem = {
  kind: 'paper-total'
  text: string
}

// One thing that occupies vertical space on a page, in print order.
export type PageItem =
  | PaperTotalItem
  | SectionHeadingItem
  | QuestionItem
  | AnswerKeyHeadingItem
  | AnswerKeySectionItem
  | AnswerKeyEntryItem

// Which furniture a page carries. The first page takes the Name/Class/Date
// line and the title; later pages take a Name blank alone; the answer key —
// begun fresh after the last test page, footer restarted at 1 — takes the
// arrangement ID alone plus the repeated title, and carries no Name line at all.
export type PageHeader = 'first' | 'later' | 'answer-key' | 'answer-key-later'

export function isAnswerKeyHeader(header: PageHeader): boolean {
  return header === 'answer-key' || header === 'answer-key-later'
}

// Which document stream a page belongs to. The answer key begins fresh after
// the last test page with its own restarted footer, so a plan can carry both.
export type PageStream = 'test' | 'answer-key'

// One planned sheet. Everything an Export Adapter needs to reproduce it without
// measuring or repaginating: which furniture it carries, what number its footer
// prints, the ordered items on it, and whether an explicit page break precedes
// it in a serialized stream.
export type PlannedPage = {
  /** Printed in the footer, 1-based within its stream. */
  number: number
  header: PageHeader
  stream: PageStream
  /** What this page's header and footer say. Furniture is a planning decision,
   *  so the two adapters print the same identity fields and the same footer
   *  number rather than each deciding what a header variant means. */
  furniture: PageFurniture
  /** True for every page but the first of a serialized document: a DOCX or any
   *  other linear format must break here rather than rediscover pagination. */
  breakBefore: boolean
  items: PageItem[]
}

/** The blanks a page's header offers the student, in printed order. */
export type IdentityField = 'Name' | 'Class' | 'Date'

export type PageFurniture = {
  identityFields: readonly IdentityField[]
  /** What this test page's header line prints beside the ID: the Exam's own
   *  words, or the default blanks written as text. Absent on answer-key pages,
   *  and on plans recorded before a header could be reworded, which print
   *  `identityFields` as they always did. Empty means the ID alone. */
  identityLine?: string
  /** The exam title, on the pages that repeat it; `null` on the rest. */
  title: string | null
  /** The heading size the title prints at, when the Exam chose one other than
   *  normal. The heading size sets every heading, the title included. */
  titleSize?: HeadingSize
  /** How many lines a long title wraps onto, when it is more than one. Its
   *  header grows by a title line for each (`headerHeightOf`), and packing
   *  filled only what that leaves. */
  titleLines?: number
  /** Which Version's paper this is — printed on every page, both streams, and
   *  empty for the Working Copy's own arrangement. Plans recorded before
   *  Versions existed carry the `ID: A` they printed. */
  arrangementLabel: string
  /** What the footer prints. The same number as the page, named separately
   *  because a footer is furniture rather than an item that packs. */
  pageNumber: number
  /** Where the page number prints, when not centred at the foot: centred at
   *  the top, on a row of its own above the header line, under a Paper Style
   *  that puts it there. Absent on every page of every other style. */
  pageNumberAt?: 'top'
  /** What the foot prints against the right margin — "Turn over" on a test
   *  page another test page follows, under a style that prints it. Absent
   *  prints nothing there. */
  footRight?: string
}

/** What a page's foot prints, in order: its page number, where it prints
 *  there, then "Turn over". */
export function runningFootOf(furniture: PageFurniture): string[] {
  return [
    ...(furniture.pageNumberAt === undefined ? [String(furniture.pageNumber)] : []),
    furniture.footRight ?? '',
  ].filter(Boolean)
}

const IDENTITY_FIELDS: Record<PageHeader, readonly IdentityField[]> = {
  first: ['Name', 'Class', 'Date'],
  later: ['Name'],
  // The key is the teacher's copy: it carries the arrangement it belongs to and
  // nothing for a student to fill in.
  'answer-key': [],
  'answer-key-later': [],
}

// Which variants repeat the exam title. The key repeats it on its first page
// the way the test does, and drops it on continuation pages.
const REPEATS_TITLE: Record<PageHeader, boolean> = {
  first: true,
  later: false,
  'answer-key': true,
  'answer-key-later': false,
}

// Which of an Exam's header lines a test page prints. The key has none.
const HEADER_LINE: Record<PageHeader, HeaderLine | null> = {
  first: 'first',
  later: 'later',
  'answer-key': null,
  'answer-key-later': null,
}

/** What a test page's running furniture needs beyond its header variant:
 *  its Paper Style's rules, and whether another test page follows it. */
type RunningContext = {
  rules: PaperStyleRules
  continues: boolean
}

function furnitureOf(
  page: { header: PageHeader; number: number },
  title: string,
  version: string | undefined,
  header: ExamHeader | undefined,
  titleSize: HeadingSize | undefined,
  titleLines: number,
  running?: RunningContext,
): PageFurniture {
  const line = HEADER_LINE[page.header]
  const identityLine = line ? headerLineOf(header, line) : undefined
  const top = running?.rules.running.pageNumber === 'top'
  const continues = running?.continues ? running.rules.running.continues : undefined
  return {
    identityFields: IDENTITY_FIELDS[page.header],
    ...(identityLine !== undefined ? { identityLine } : {}),
    title: REPEATS_TITLE[page.header] ? title : null,
    ...(REPEATS_TITLE[page.header] && titleSize ? { titleSize } : {}),
    ...(REPEATS_TITLE[page.header] && titleLines > 1 ? { titleLines } : {}),
    arrangementLabel: version ?? '',
    pageNumber: page.number,
    ...(top ? { pageNumberAt: 'top' as const } : {}),
    ...(continues ? { footRight: continues } : {}),
  }
}

// ---------------------------------------------------------------------------
// Page geometry
//
// US Letter at 96dpi: an 816×1056px sheet, by default with ¾" (72px) margins
// on every side, leaving a 672×912px box. An Exam may set its own Page Margins
// (ADR-0039), and its plan's `pageSize` then carries them and the box they
// leave. The header and footer come out of that box's height, so how much
// packing may fill depends on which header the page carries — the first page's
// Name/Class/Date line plus the title is taller than a later page's Name line
// alone.
//
// These are the numbers the screen uses as well: `exam-page.tsx` publishes a
// plan's page size as CSS custom properties so the rendered page is laid out at
// exactly the size packed against, and the print `@page` is the same sheet. A
// mismatch here is what makes content creep onto an extra sheet on paper.
export const PAGE_WIDTH = 816
export const PAGE_HEIGHT = 1056

/** A4 at 96dpi, 210×297mm, in the whole CSS pixels the plan packs in:
 *  793.7×1122.5px, rounded. Every adapter cuts the sheet itself to A4 exactly
 *  — 595.28×841.89pt in the PDF, 11906×16838 twips in DOCX, `A4` in print's
 *  `@page` — so the plan's half-pixel never reaches paper. The Exam Board
 *  Paper Style prints on it (ADR-0045). */
export const A4_WIDTH = 794
export const A4_HEIGHT = 1123
/** The margin of an Exam that never set its own, on every side. */
export const PAGE_MARGIN = marginPx(DEFAULT_MARGIN)

/** The width a page item is laid out at on today's sheet. An Exam with its own
 *  margins is laid out at its plan's `pageSize.contentWidth` instead. */
export const PAGE_CONTENT_WIDTH = PAGE_WIDTH - 2 * PAGE_MARGIN

/** Today's sheet: the page of every Exam that never set its margins. Declared
 *  here, ahead of what reads it, though `pageSizeOf` is with the Layout Plan. */
export const US_LETTER: PageSize = pageSizeOf(undefined)

// Exhaustive over `PageHeader` on purpose: a new variant cannot be added
// without deciding how tall its furniture is. The answer key's header carries
// The first answer-key page repeats the title; continuation pages carry only
// the ID and therefore use the shorter header height.
export const HEADER_HEIGHT: Record<PageHeader, number> = {
  first: 84,
  later: 42,
  'answer-key': 84,
  'answer-key-later': 42,
}

export const FOOTER_HEIGHT = 36

/** The row a page number printed at the top takes, above the header line, so
 *  it never stands over the line's blanks: a line of body type and the gap
 *  below it. Only a Paper Style that prints the number there (ADR-0045) adds
 *  it, to each of its test pages. */
export const RUNNING_HEAD_HEIGHT = 22

/** How much taller a Paper Style's test pages' headers are than their
 *  variant's band: a row for the page number, where the style prints it at
 *  the top. */
export function runningHeadHeight(style: PaperStyle | undefined): number {
  return paperStyleRules(style).running.pageNumber === 'top' ? RUNNING_HEAD_HEIGHT : 0
}

/** How much taller than its one-line band a header grows for a title that
 *  wraps onto `lines` lines at `size`: one title line for each line past the
 *  first, rounded up to a whole pixel. The band itself, `HEADER_HEIGHT`, holds
 *  a one-line title, so a title that fits on one line moves nothing. */
export function titleGrowth(lines: number, size: HeadingSize | undefined): number {
  return lines > 1 ? Math.ceil((lines - 1) * TITLE_PX[size ?? 'normal'] * TITLE_LINE_HEIGHT) : 0
}

/** How tall a page's header is: its variant's, grown for a title that wraps
 *  and for a page number printed above it. Print, the PDF and the sheet all
 *  size the header by this. */
export function headerHeightOf(
  header: PageHeader,
  furniture: Pick<PageFurniture, 'titleLines' | 'titleSize' | 'pageNumberAt'>,
): number {
  return HEADER_HEIGHT[header]
    + titleGrowth(furniture.titleLines ?? 1, furniture.titleSize)
    + (furniture.pageNumberAt === 'top' ? RUNNING_HEAD_HEIGHT : 0)
}

/** How much vertical space packing may fill on a page carrying `header`, on a
 *  sheet with `pageSize`'s margins, less what a wrapping title grows its
 *  header by on the pages that print the title, and less `headExtra` — the
 *  row a page number printed at the top takes (`runningHeadHeight`). */
export function pageContentHeight(
  header: PageHeader,
  pageSize: PageSize = US_LETTER,
  titleExtra = 0,
  headExtra = 0,
): number {
  const box = pageSize.height - pageSize.margins.top - pageSize.margins.bottom
  return box - HEADER_HEIGHT[header] - (REPEATS_TITLE[header] ? titleExtra : 0) - headExtra - FOOTER_HEIGHT
}

/** The most room a teacher can drag a work space to: a whole later page less
 *  an inch for the question itself, so a question and its space still fit on
 *  one sheet. Filling the rest of a page is the way to ask for more. Deeper
 *  margins leave a shorter page, and so a shorter most. */
export function maxWorkSpaceHeight(pageSize: PageSize = US_LETTER, headExtra = 0): number {
  return pageContentHeight('later', pageSize, 0, headExtra) - 96
}

export const MAX_WORK_SPACE_HEIGHT = maxWorkSpaceHeight()

// A question's body does not span the page's full content width: it renders
// inside `.question-body`, the second column of `.exam-question`'s grid in
// styles.css (`grid-template-columns: 34px 1fr; gap: 6px;`) — the number
// column sits to its left. These numbers are copied from that rule because
// CSS can't be read from here at build time; if that rule's column width or
// gap ever changes, this must change with it.
//
// On a Standard Exam the column holds the number alone, as wide as a
// three-digit number. A True/False question also prints the T and F a student
// circles, so its column is wider — `.question-number--marks` in styles.css. A
// Paper Style that prints an answer blank before the number widens it
// again: `.question-number--blank`.
const QUESTION_NUMBER_COLUMN_WIDTH = 34
const MARKS_QUESTION_NUMBER_COLUMN_WIDTH = 64
const BLANK_QUESTION_NUMBER_COLUMN_WIDTH = 92
const QUESTION_NUMBER_COLUMN_GAP = 6

/** The answer blank a Multiple Choice or True/False question printed before
 *  its number until Sections were stored (ADR-0029). An Export Record made
 *  before then carries it and reprints exactly as it was; a Paper Style
 *  that prints a blank there prints this same one (ADR-0041). */
export const LEGACY_ANSWER_BLANK = ANSWER_BLANK

/** What a question's number column holds, which decides how wide it is: the
 *  number alone, the T and F to circle, or an answer blank. */
export type NumberColumn = 'plain' | 'marks' | 'blank'

const NUMBER_COLUMN_WIDTH: Record<NumberColumn, number> = {
  plain: QUESTION_NUMBER_COLUMN_WIDTH,
  marks: MARKS_QUESTION_NUMBER_COLUMN_WIDTH,
  blank: BLANK_QUESTION_NUMBER_COLUMN_WIDTH,
}

export function numberColumnOf(
  question: Pick<PlannedQuestion, 'type'> & { marks?: readonly string[] },
): NumberColumn {
  if (hasAnswerBlank(question)) return 'blank'
  // A True/False question always had the marks' column, whatever a plan
  // recorded before marks were stored says it printed there.
  if ((question.marks?.length ?? 0) > 0 || hasMarks(question.type)) return 'marks'
  return 'plain'
}

/** Whether a planned question prints an answer blank before its number, to
 *  write a letter or a word on rather than circle one: under a Paper Style
 *  that asks for one, or on an Export Record kept from before Sections were
 *  stored. */
export function hasAnswerBlank(question: { marks?: readonly string[] }): boolean {
  return question.marks?.includes(ANSWER_BLANK) ?? false
}

/** Where a question's body starts, in pixels from the content edge: past the
 *  number column and its gap. Every adapter indents a question by this. */
export function questionIndentOf(
  question: Pick<PlannedQuestion, 'type'> & { marks?: readonly string[] },
): number {
  return NUMBER_COLUMN_WIDTH[numberColumnOf(question)] + QUESTION_NUMBER_COLUMN_GAP
}

/** Whether a question's number column carries something before its number
 *  whatever the Paper Style: only True/False, whose answer is one of two
 *  fixed letters, circled or written on a blank. */
export function hasMarks(type: QuestionType): boolean {
  return type === 'true-false'
}

/** The letters a True/False question's student circles, in the order they print. */
export { TRUE_FALSE_MARKS } from './paper-style'

// A matching set's prompts keep their own column: a blank for the letter a
// student writes, then the number (`.matching-prompt` in styles.css,
// `grid-template-columns: 92px 1fr; gap: 6px;`). A long Word Bank prints above
// the prompts, set in by the same step.
const MATCHING_NUMBER_COLUMN_WIDTH = 92

/** Where a matching prompt's body starts, and how far a long Word Bank is set in. */
export const MATCHING_INDENT = MATCHING_NUMBER_COLUMN_WIDTH + QUESTION_NUMBER_COLUMN_GAP

/** The width a long Word Bank's grid is laid out in, on a page `contentWidth` wide. */
export function matchingAreaWidth(contentWidth: number): number {
  return contentWidth - MATCHING_INDENT
}

/** Where a Part's body starts within its Multipart question's body: past its own letter
 *  column, which holds the letter alone. A Part prints no answer blank, of
 *  either kind — a Multiple Choice Part's answer is circled, not written in a
 *  margin — so every Part is set in by the same short step. */
export const PART_INDENT = QUESTION_NUMBER_COLUMN_WIDTH + QUESTION_NUMBER_COLUMN_GAP

/** How far a Multiple Choice question's answers — and a Multiple Choice
 *  Part's — are set in from the stem above them, so the answers read as one
 *  group under the question rather than as more of its text. `.choice-grid`'s
 *  left margin in styles.css is this number. */
export const CHOICE_INDENT = 18

/** The width a Multiple Choice question's choice grid is laid out in, on a
 *  page `contentWidth` wide: past the question's number column — which its
 *  Paper Style may widen with an answer blank — set in from the stem.
 *  Without a question, the plain number column of a Standard Exam. */
export function choiceAreaWidth(
  contentWidth: number,
  question: Pick<PlannedQuestion, 'type'> & { marks?: readonly string[] } = { type: 'multiple-choice' },
): number {
  return contentWidth - questionIndentOf(question) - CHOICE_INDENT
}

/** The width a Multiple Choice Part's choice grid is laid out in: the page
 *  less its Multipart question's number column, its own letter column, and
 *  the answers' indent. */
export function partChoiceAreaWidth(
  contentWidth: number,
  question: Pick<PlannedQuestion, 'type'> & { marks?: readonly string[] } = { type: 'multipart' },
): number {
  return contentWidth - questionIndentOf(question) - PART_INDENT - CHOICE_INDENT
}

/** The width a Multiple Choice Subpart's choice grid is laid out in: its Part's
 *  less the Subpart's own label column, which is a Part's letter column one
 *  level further in. */
export function subpartChoiceAreaWidth(
  contentWidth: number,
  question: Pick<PlannedQuestion, 'type'> & { marks?: readonly string[] } = { type: 'multipart' },
): number {
  return partChoiceAreaWidth(contentWidth, question) - PART_INDENT
}

/** Each, on today's sheet. */
export const PART_CHOICE_AREA_WIDTH = partChoiceAreaWidth(PAGE_CONTENT_WIDTH)
export const SUBPART_CHOICE_AREA_WIDTH = subpartChoiceAreaWidth(PAGE_CONTENT_WIDTH)
export const CHOICE_AREA_WIDTH = choiceAreaWidth(PAGE_CONTENT_WIDTH)

// A matching set spans the whole content width — its prompts carry their own
// number column — and gives its Word Bank this much of it, on the right. The
// print stylesheet's `.matching-bank` width is this number; the DOCX adapter
// reads it from here.
export const MATCHING_BANK_WIDTH = 240

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** What a student circles for a True/False question, by the position of the
 *  answer in the authored pair. A longer pair cannot happen — the editor fixes
 *  it at two — so anything past it falls back to a choice letter rather than
 *  printing nothing. */
const TRUE_FALSE_LETTERS = ['T', 'F']

/** The letter a Part prints under its Multipart question — 'a', 'b', … — told apart
 *  from a choice's capital letter at a glance. */
function partLetterAt(index: number): string {
  return letterAt(index).toLowerCase()
}

const ROMAN: readonly [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
]

/** The label a Subpart prints under its Part — 'i', 'ii', 'iii', 'iv', … — a
 *  lowercase roman numeral, told apart from its Part's letter at a glance. */
export function subpartLabelAt(index: number): string {
  let label = ''
  let remaining = index + 1
  for (const [value, numeral] of ROMAN) {
    while (remaining >= value) {
      label += numeral
      remaining -= value
    }
  }
  return label
}

/** The letter of the choice at `index` — 'A', 'B', … then 'AA', 'AB', …. */
function letterAt(index: number): string {
  let letter = ''
  let remaining = index
  do {
    letter = LETTERS[remaining % 26]! + letter
    remaining = Math.floor(remaining / 26) - 1
  } while (remaining >= 0)
  return letter
}

// Column-major: `rows = ceil(n / columns)`, and the items fill down the first
// column before starting the second.
export function layOutColumns<T>(
  items: T[],
  columns: number,
): { rows: number; cells: (T | null)[][] } {
  const rows = Math.ceil(items.length / columns)
  const cells = Array.from({ length: rows }, (_unused, row) =>
    Array.from(
      { length: columns },
      (_empty, column) => items[column * rows + row] ?? null,
    ),
  )
  return { rows, cells }
}

function layOutGrid(
  choices: PlannedChoice[],
  columns: ColumnCount,
): ChoiceGrid | null {
  if (choices.length === 0) return null
  return { columns, ...layOutColumns(choices, columns) }
}

/** The answers as the test prints them: lower-cased under a Paper Style
 *  that letters "a.", and otherwise the very same choices. Copies, so the
 *  question's own choices keep the capitals its Answer Key records. */
function printedChoices(choices: PlannedChoice[], rules: PaperStyleRules): PlannedChoice[] {
  const lettered = rules.lettering === 'lower'
    ? choices.map((choice) => ({ ...choice, letter: choice.letter.toLowerCase() }))
    : choices
  return labelledChoices(lettered, rules)
}

/** Answers as the style labels them on the test — `A` rather than `A.` under
 *  Exam Board — copied; the very same answers under every style that labels
 *  with a full stop. */
function labelledChoices(choices: PlannedChoice[], rules: PaperStyleRules): PlannedChoice[] {
  if (rules.labels.answer === PERIOD_LABELS.answer) return choices
  return choices.map((choice) => ({ ...choice, ...printedBy(rules.labels.answer, choice.letter) }))
}

/** What an answer with Points prints after itself under this style, if anything. */
function pointsAfterOf(rules: PaperStyleRules, points: number | undefined): { pointsAfter: string } | Record<string, never> {
  const template = rules.points.pointsAfterAnswer
  return template && points !== undefined ? { pointsAfter: labelled(template, points) } : {}
}

// A matching set under this arrangement: the Word Bank in the arrangement's
// order, lettered by position, and each prompt numbered from `number` on and
// given the letter its answer now carries. A prompt that names no answer, or
// one the bank no longer holds, is unmatched and gets no letter.
//
// The Paper Style decides how the bank is lettered on the test. Where it
// sits is the position's own stored layout, beside or above, decided when the
// question arrived on the Exam or its style last changed (`wordBankLayoutFor`)
// and never again at layout time. A prompt's letter, the key's, is a capital
// whatever the bank prints.
function deriveMatching(
  question: Question,
  arrangement: Arrangement,
  number: number,
  rules: PaperStyleRules,
  layout: WordBankLayout,
): MatchingSet {
  const ordered = orderedChoices(question, arrangement)
  const letters = new Map(ordered.map((answer, index) => [answer.id, letterAt(index)]))
  const bank: PlannedBankAnswer[] = ordered.map((answer, index) => {
    const letter = rules.lettering === 'lower' ? letterAt(index).toLowerCase() : letterAt(index)
    return { id: answer.id, letter, node: answer.node, ...printedBy(rules.labels.answer, letter) }
  })
  const above = layout === 'above'
  return {
    prompts: promptsOf(question).map((prompt, index) => ({
      id: prompt.id,
      number: number + index,
      letter: letters.get(prompt.answerId) ?? null,
      node: prompt.node,
      ...printedBy(rules.labels.question, number + index),
    })),
    bank,
    bankGrid: above && bank.length > 0
      ? { columns: MATCHING_BANK_COLUMNS, ...layOutColumns(bank, MATCHING_BANK_COLUMNS) }
      : null,
  }
}

/** A question's Suggested Answer as top-level blocks, copied; none when it has
 *  no answer or the answer holds only blank paragraphs. */
function suggestedAnswerOf(question: Question): ProseMirrorJSON[] {
  const content = question.suggestedAnswer?.content
  if (!Array.isArray(content)) return []
  const blocks = content as ProseMirrorJSON[]
  const blank = (node: ProseMirrorJSON) =>
    node.type === 'paragraph' && !(Array.isArray(node.content) && node.content.length > 0)
  return blocks.every(blank) ? [] : structuredClone(blocks)
}

function blankBlocks(blocks: readonly ProseMirrorJSON[]): boolean {
  return blocks.every(
    (node) =>
      node.type === 'paragraph' && !(Array.isArray(node.content) && node.content.length > 0),
  )
}

// A Part that answers, or a Subpart, under this arrangement: a Multiple Choice
// one's answers in the order recorded under its own id, and a Short Answer
// one's work space as this Exam sets it for that id.
function deriveAnswering(
  exam: Exam,
  part: Subpart,
  arrangement: Arrangement,
): Omit<PlannedSubpart, 'label'> {
  const rules = paperStyleRules(exam.paperStyle)
  const choices: PlannedChoice[] = orderedPartChoices(part, arrangement).map(
    (choice, choiceIndex) => ({
      id: choice.id,
      letter: letterAt(choiceIndex),
      correct: choice.correct,
      ...(choice.locked ? { locked: true as const } : {}),
      node: choice.node,
    }),
  )
  const multipleChoice = part.type === 'multiple-choice'
  const suggested = part.suggestedAnswer?.content
  const suggestedBlocks = Array.isArray(suggested) ? (suggested as ProseMirrorJSON[]) : []
  return {
    id: part.id,
    type: part.type,
    stem: part.stem,
    choices,
    grid: multipleChoice ? layOutGrid(labelledChoices(choices, rules), part.columns) : null,
    workSpace: multipleChoice
      ? null
      : plannedWorkSpace(workSpaceOf(exam, part.id), workSpaceRowsOf(exam.paperStyle), rules),
    ...(!multipleChoice && suggestedBlocks.length > 0 && !blankBlocks(suggestedBlocks)
      ? { suggestedAnswer: structuredClone(suggestedBlocks) }
      : {}),
    ...(part.points !== undefined ? { points: part.points } : {}),
    ...pointsAfterOf(rules, part.points),
  }
}

// A Multipart question's Parts under this arrangement, each lettered by position, and
// each Part's Subparts numbered by theirs beneath it.
function deriveParts(
  exam: Exam,
  question: Question,
  arrangement: Arrangement,
): PlannedPart[] {
  const { labels } = paperStyleRules(exam.paperStyle)
  return partsOf(question).map((part, index): PlannedPart => {
    const letter = partLetterAt(index)
    const printed = printedBy(labels.part, letter)
    if (part.type !== 'subparts') {
      return {
        ...deriveAnswering(exam, { ...part, type: part.type }, arrangement),
        letter,
        ...printed,
        subparts: [],
      }
    }
    return {
      id: part.id,
      letter,
      ...printed,
      type: 'subparts',
      // A lead-in of only empty paragraphs is none: Subpart (i) then opens
      // on the Part's own line (`subpartsOpenLabelLine`).
      stem: blankBlocks(part.stem) ? [] : part.stem,
      choices: [],
      grid: null,
      workSpace: null,
      subparts: part.subparts.map((subpart, subpartIndex) => ({
        ...deriveAnswering(exam, subpart, arrangement),
        label: subpartLabelAt(subpartIndex),
        ...printedBy(labels.subpart, subpartLabelAt(subpartIndex)),
      })),
    }
  })
}

function deriveQuestion(
  exam: Exam,
  question: Question,
  arrangement: Arrangement,
  number: number,
): PlannedQuestion {
  const rules = paperStyleRules(exam.paperStyle)
  const trueFalse = question.type === 'true-false'
  const matching = question.type === 'matching'
  const multipart = question.type === 'multipart'
  // A Multiple Choice question prints only the answers it shows (ADR-0038).
  const ordered = matching || multipart
    ? []
    : question.type === 'multiple-choice'
      ? shownChoices(question, arrangement)
      : orderedChoices(question, arrangement)
  const answerVisibility = question.type === 'multiple-choice'
    ? answerVisibilityOf(question, arrangement)
    : undefined
  const totalPoints = pointsOfQuestion(question)
  const choices: PlannedChoice[] = ordered.map((choice, index) => ({
    id: choice.id,
    // A True/False answer is written the way the student circles it, so the
    // Answer Key reads T or F rather than A or B.
    letter: trueFalse ? TRUE_FALSE_LETTERS[index] ?? letterAt(index) : letterAt(index),
    correct: choice.correct,
    ...(choice.locked ? { locked: true as const } : {}),
    node: choice.node,
  }))
  return {
    id: question.id,
    type: question.type,
    number,
    marks: trueFalse
      ? rules.trueFalseMarks
      : question.type === 'multiple-choice' ? rules.multipleChoiceMarks : [],
    // A Multipart question whose stem is only empty paragraphs has none: its
    // Part (a) opens on its number's line (`partsOpenNumberLine`).
    stem: multipart && blankBlocks(stemNodesOf(question.doc)) ? [] : stemNodesOf(question.doc),
    choices,
    // A True/False question never prints its pair as lettered answers: its
    // marks are the T and F a student circles beside its number, or the blank
    // they write one on.
    grid: trueFalse || matching || multipart
      ? null
      : layOutGrid(printedChoices(choices, rules), columnsOf(question)),
    matching: matching
      ? deriveMatching(question, arrangement, number, rules, wordBankLayoutOf(exam, question))
      : null,
    ...(matching ? { wordBankLayout: wordBankLayoutOf(exam, question) } : {}),
    workSpace: takesWorkSpace(question.type)
      ? plannedWorkSpace(workSpaceOf(exam, question.id), workSpaceRowsOf(exam.paperStyle), rules)
      : null,
    ...(question.difficulty ? { difficulty: question.difficulty } : {}),
    ...(topicsOf(question).length > 0 ? { topics: [...topicsOf(question)] } : {}),
    ...(answerVisibility ? { answerVisibility } : {}),
    ...(question.type === 'open' && suggestedAnswerOf(question).length > 0
      ? { suggestedAnswer: suggestedAnswerOf(question) }
      : {}),
    // A Fill in the Blank question's answers are its Blanks', which the key
    // prints on one line where a Suggested Answer goes (ADR-0049).
    ...(question.type === 'fill-in-the-blank' && blankAnswerBlocks(question.doc).length > 0
      ? { suggestedAnswer: blankAnswerBlocks(question.doc) }
      : {}),
    parts: multipart ? deriveParts(exam, question, arrangement) : null,
    ...(totalPoints !== undefined ? { totalPoints } : {}),
    // A matching set's numbers print on its Items.
    ...(matching ? {} : printedNumberBy(rules, number)),
    ...(multipart ? {} : pointsAfterOf(rules, totalPoints)),
    ...closingPointsOf(rules, multipart, totalPoints),
  }
}

function printedNumberBy(rules: PaperStyleRules, number: number): { printedNumber: string } | Record<string, never> {
  const printed = printedBy(rules.labels.question, number)
  return 'printed' in printed ? { printedNumber: printed.printed } : {}
}

/** The total a question prints after itself under this style: a Multipart
 *  question's. Any other question's Points print after its answer instead
 *  (`pointsAfter`). */
function closingPointsOf(
  rules: PaperStyleRules,
  multipart: boolean,
  totalPoints: number | undefined,
): { closingPoints: string[] } | Record<string, never> {
  const template = multipart ? rules.points.questionTotal : undefined
  return template && totalPoints !== undefined ? { closingPoints: [labelled(template, totalPoints)] } : {}
}

// The Exam's Sections in their own order. A Section with no questions still
// prints its heading and directions, on the sheet and on paper alike, so
// every question lands on the same page in both — a Section that showed on the
// sheet but vanished from the export would move questions between pages.
function deriveItems(exam: Exam, arrangement: Arrangement): PageItem[] {
  const rules = paperStyleRules(exam.paperStyle)
  const items: PageItem[] = []
  let number = 1
  for (const section of sectionsOf(exam)) {
    const questions = questionsInSection(exam, arrangement, section.id)
    // A part the teacher cleared is an empty string: it prints nothing, and a
    // heading cleared of both still holds its place in the plan — at no height
    // — so the sheet can offer to bring it back.
    items.push({
      kind: 'section-heading',
      sectionId: section.id,
      title: section.title,
      instructions: section.instructions,
      keepWithNext: true,
      ...(questions.length === 0 ? { empty: true as const } : {}),
      ...(exam.headingSize && exam.headingSize !== DEFAULT_HEADING_SIZE
        ? { size: exam.headingSize }
        : {}),
    })
    const planned = questions.map((question) => {
      // The Exam's own picture sizes print in place of the Question's (ADR-0050).
      const sized = { ...question, doc: withPictureSizes(question.doc, exam.pictureSizes?.[question.id]) }
      const derived = deriveQuestion(exam, sized, arrangement, number)
      number += numbersTakenBy(derived)
      return derived
    })
    // A Section's total prints after its last question, under a style that
    // prints one, when anything in the Section has points.
    const sectionTotal = rules.points.sectionTotal
    const sectionPoints = sumOfPoints(planned.map((question) => question.totalPoints))
    const last = planned.at(-1)
    if (sectionTotal && sectionPoints !== undefined && last) {
      planned[planned.length - 1] = {
        ...last,
        closingPoints: [...(last.closingPoints ?? []), labelled(sectionTotal, sectionPoints)],
      }
    }
    items.push(...planned.map(wholeQuestion))
  }
  return items
}

/** The question, whole, as one page item — packing's starting point. */
function wholeQuestion(question: PlannedQuestion): QuestionItem {
  return {
    kind: 'question',
    question,
    stem: question.stem,
    numbered: true,
    grid: question.grid,
    matching: question.matching,
    workSpace: question.workSpace,
    parts: question.parts,
    ...(question.pointsAfter ? { pointsAfter: question.pointsAfter } : {}),
    ...(question.closingPoints ? { closingPoints: question.closingPoints } : {}),
  }
}

// The indivisible segments a question may be broken between: its number line
// glued to the first run of its stem (`stemRuns`), so a split can never strand
// a bare number at the foot of a page; then one segment per remaining run;
// then the choice grid whole, since a grid is never split. A question with no stem at
// all is a single segment, so it moves rather than coming apart. A matching set
// and a Multipart question have segments of their own (see `matchingSegmentsOf` and
// `multipartSegmentsOf`).
type Segment = {
  stem: ProseMirrorJSON[]
  numbered: boolean
  grid: ChoiceGrid | null
  matching: MatchingSet | null
  workSpace: PlannedWorkSpace | null
  /** A Multipart question's Parts carried by this segment: a Part that answers
   *  whole, and a Part that holds Subparts one Subpart at a time. */
  parts: PlannedPart[]
  /** Set on the question's last segment: the piece that carries it prints the
   *  question's closing Points. */
  closes?: true
}

// A work space is glued to the last segment rather than being one of its own:
// room for an answer at the top of a page, with its question at the foot of
// the one before, is room nobody would think to use.
function segmentsOf(question: PlannedQuestion, measure: Measure, fullPage: number): Segment[] {
  const segments = segmentsWithin(question, measure, fullPage)
  const last = segments.at(-1)
  if (last) segments[segments.length - 1] = { ...last, closes: true }
  return segments
}

function segmentsWithin(question: PlannedQuestion, measure: Measure, fullPage: number): Segment[] {
  const workSpace = question.workSpace
  if (question.matching) return matchingSegmentsOf(question, question.matching, workSpace)
  if (question.parts) return multipartSegmentsOf(question, question.parts, measure, fullPage)
  const [first, ...rest] = stemRuns(question.stem)
  if (first === undefined) {
    return [
      {
        stem: question.stem,
        numbered: true,
        grid: question.grid,
        matching: null,
        workSpace,
        parts: [],
      },
    ]
  }
  const segments: Segment[] = [
    { stem: first, numbered: true, grid: null, matching: null, workSpace: null, parts: [] },
  ]
  for (const run of rest) {
    segments.push({
      stem: run, numbered: false, grid: null, matching: null, workSpace: null, parts: [],
    })
  }
  if (question.grid) {
    segments.push({
      stem: [], numbered: false, grid: question.grid, matching: null, workSpace: null, parts: [],
    })
  }
  segments[segments.length - 1]!.workSpace = workSpace
  return segments
}

/** Whether a top-level block is a picture: a block picture, a paragraph of
 *  nothing but pictures, or a Side-by-Side with a picture in a Panel. */
function isPicture(block: ProseMirrorJSON): boolean {
  const content = Array.isArray(block.content) ? (block.content as ProseMirrorJSON[]) : []
  switch (block.type) {
    case 'image-block':
    case 'image':
      return true
    case 'paragraph':
      return content.some((node) => node.type === 'image')
        && content.every((node) => node.type === 'image' || (node.type === 'text' && !String(node.text ?? '').trim()))
    case 'sideBySide':
      return content.some((panel) =>
        (Array.isArray(panel.content) ? (panel.content as ProseMirrorJSON[]) : []).some(isPicture))
    default:
      return false
  }
}

/**
 * A stem's top-level blocks in the runs a page may break between (ADR-0048):
 * one block each — a paragraph, a picture, a table, a Side-by-Side, a
 * Blockquote, never anything inside one — except that a paragraph directly
 * after a picture is its caption and goes with it, so a page never ends
 * between a figure and the line that names it.
 */
export function stemRuns(stem: readonly ProseMirrorJSON[]): ProseMirrorJSON[][] {
  const runs: ProseMirrorJSON[][] = []
  stem.forEach((block, index) => {
    const previous = stem[index - 1]
    const caption = previous !== undefined && isPicture(previous) && block.type === 'paragraph' && !isPicture(block)
    if (caption) runs.at(-1)!.push(block)
    else runs.push([block])
  })
  return runs
}

/** A Part or Subpart that answers, as the pieces its stem breaks into
 *  between runs: the first printing its label, the rest `continued`; then
 *  its choice grid whole as a piece of its own, since a grid is never split.
 *  Its room and its Points go with its last piece, as a question's do. Itself
 *  alone when there is nothing to break it between. */
function answeringPieces<T extends PlannedSubpart | PlannedPart>(answering: T): T[] {
  const runs = stemRuns(answering.stem)
  if (runs.length + (answering.grid ? 1 : 0) < 2) return [answering]
  const { pointsAfter, ...rest } = answering
  const bare = { ...rest, grid: null, workSpace: null } as unknown as T
  const end = {
    grid: answering.grid,
    workSpace: answering.workSpace,
    ...(pointsAfter !== undefined ? { pointsAfter } : {}),
  }
  const pieces: T[] = runs.map((run, index) => ({ ...bare, stem: run, ...(index > 0 ? { continued: true as const } : {}) }))
  if (answering.grid) pieces.push({ ...bare, stem: [], continued: true })
  pieces[pieces.length - 1] = { ...pieces[pieces.length - 1]!, ...end }
  return pieces
}

// A Multipart question breaks between its Parts and between a Part's Subparts:
// its number and its stem glued to Part a — and, when Part a holds Subparts,
// to its lead-in and Subpart (i) — then one segment per Part or Subpart after
// it, so a student never turns a page to find the first question about what
// they have just read, nor a lead-in apart from its first Subpart.
// A Part, a lead-in with its Subpart (i), or a Subpart that is taller than a
// whole page on its own breaks between the runs of its stem as a question's
// stem does (ADR-0048); one a page would hold moves whole.
// Only when the stem and Part a's first piece together are taller than a
// whole page does the stem itself come apart between its runs — there is
// then no page that could hold them together — and when the stem cannot,
// Part a breaks so that its first run can stay with the number.
function multipartSegmentsOf(
  question: PlannedQuestion,
  parts: readonly PlannedPart[],
  measure: Measure,
  fullPage: number,
): Segment[] {
  const partSegment = (part: PlannedPart): Segment => ({
    stem: [], numbered: false, grid: null, matching: null, workSpace: null, parts: [part],
  })
  const fits = (segment: Segment) => measure.itemHeight(pieceOf(question, [segment])) <= fullPage
  // A Part that holds Subparts is its letter and lead-in glued to Subpart
  // (i), then each later Subpart as a continuation of the same Part.
  const unitsOf = (part: PlannedPart): PlannedPart[] => {
    const [first, ...later] = part.subparts
    if (!first) return [part]
    return [
      { ...part, subparts: [first] },
      ...later.map((subpart): PlannedPart => ({ ...part, stem: [], subparts: [subpart], continued: true })),
    ]
  }
  // A unit too tall for a page, broken between its runs: an answering Part's
  // own; or a lead-in's, its last run glued to its Subpart's first piece, and
  // the Subpart's own when it too is taller than a page.
  const brokenUnit = (unit: PlannedPart): PlannedPart[] => {
    const [subpart] = unit.subparts
    if (!subpart) return answeringPieces(unit)
    const holder: PlannedPart = { ...unit, stem: [], continued: true }
    const subpieces = fits(partSegment({ ...holder, subparts: [subpart] })) ? [subpart] : answeringPieces(subpart)
    const later = subpieces.slice(1).map((piece): PlannedPart => ({ ...holder, subparts: [piece] }))
    if (unit.continued) return [{ ...holder, subparts: [subpieces[0]!] }, ...later]
    const runs = stemRuns(unit.stem)
    if (runs.length === 0) return [{ ...unit, subparts: [subpieces[0]!] }, ...later]
    const leadIn = runs.map((run, index): PlannedPart => ({
      ...unit,
      stem: run,
      subparts: [],
      ...(index > 0 ? { continued: true as const } : {}),
    }))
    // The lead-in's last run goes with the Subpart's first piece where a page
    // holds both; otherwise the Subpart, which a page holds, moves whole.
    const glued = { ...leadIn.at(-1)!, subparts: [subpieces[0]!] }
    if (fits(partSegment(glued))) return [...leadIn.slice(0, -1), glued, ...later]
    return [...leadIn, { ...holder, subparts: [subpieces[0]!] }, ...later]
  }
  const units = parts.flatMap(unitsOf)
  const pieces = units.flatMap((unit) => (fits(partSegment(unit)) ? [unit] : brokenUnit(unit)))
  const leadOf = (first: PlannedPart | undefined): Segment => ({
    stem: question.stem,
    numbered: true,
    grid: null,
    matching: null,
    workSpace: null,
    parts: first ? [first] : [],
  })
  const lead = leadOf(pieces[0])
  if (fits(lead)) return [lead, ...pieces.slice(1).map(partSegment)]
  const runs = stemRuns(question.stem)
  if (runs.length >= 2) {
    const [first, ...rest] = runs
    return [
      { stem: first!, numbered: true, grid: null, matching: null, workSpace: null, parts: [] },
      ...rest.map((run): Segment => ({
        stem: run, numbered: false, grid: null, matching: null, workSpace: null, parts: [],
      })),
      ...pieces.map(partSegment),
    ]
  }
  // A stem that cannot break keeps the number with Part a's first run.
  const [firstUnit] = units
  if (firstUnit && pieces[0] === firstUnit) {
    const finer = brokenUnit(firstUnit)
    return [leadOf(finer[0]), ...[...finer.slice(1), ...pieces.slice(1)].map(partSegment)]
  }
  return [lead, ...pieces.slice(1).map(partSegment)]
}

/** A piece of a Part or Subpart and the piece continuing it on the same
 *  page, joined back into one: the stem runs of both, and the answers, room
 *  and Points the later one ends with. */
function joinedAnswering<T extends PlannedSubpart | PlannedPart>(earlier: T, later: T): T {
  const pointsAfter = later.pointsAfter ?? earlier.pointsAfter
  const rest = { ...earlier }
  delete rest.pointsAfter
  return {
    ...rest,
    stem: [...earlier.stem, ...later.stem],
    grid: later.grid ?? earlier.grid,
    workSpace: later.workSpace ?? earlier.workSpace,
    ...(pointsAfter !== undefined ? { pointsAfter } : {}),
  }
}

/** Consecutive pieces of the same Subpart, joined back into one. */
function joinedSubparts(pieces: readonly PlannedSubpart[]): PlannedSubpart[] {
  const joined: PlannedSubpart[] = []
  for (const piece of pieces) {
    const last = joined.at(-1)
    if (last && last.id === piece.id && piece.continued) joined[joined.length - 1] = joinedAnswering(last, piece)
    else joined.push(piece)
  }
  return joined
}

/** Consecutive pieces of the same Part, joined back into one: a Part broken
 *  between its runs, or one that holds Subparts, travels one piece to a
 *  segment, but the pieces a page holds print together. */
function joinedParts(pieces: readonly PlannedPart[]): PlannedPart[] {
  const joined: PlannedPart[] = []
  for (const piece of pieces) {
    const last = joined.at(-1)
    if (last && last.id === piece.id && piece.continued) {
      joined[joined.length - 1] = {
        ...joinedAnswering(last, piece),
        subparts: joinedSubparts([...last.subparts, ...piece.subparts]),
      }
    } else joined.push(piece)
  }
  return joined
}

/** Whether a Part or Subpart short of a Multipart question's last fills the rest of its
 *  page. The ones after it cannot then share that page, so the Multipart question
 *  cannot move whole and has to be broken up after it. */
function fillsBeforeItsEnd(question: PlannedQuestion): boolean {
  const spaces = (question.parts ?? []).flatMap((part) =>
    part.subparts.length > 0 ? part.subparts.map((subpart) => subpart.workSpace) : [part.workSpace],
  )
  return spaces.slice(0, -1).some((space) => space?.fill === true)
}

// A matching set breaks only between its items: the directions glued to the
// first, then one part per item after it. Each part carries the whole Word
// Bank, so a set too long for one page continues on the next with its bank
// printed again beside (or above) the items that page holds — items on a page
// with no answers to match them against would be no matching set at all.
function matchingSegmentsOf(
  question: PlannedQuestion,
  set: MatchingSet,
  workSpace: PlannedWorkSpace | null,
): Segment[] {
  const withPrompts = (prompts: PlannedPrompt[]): MatchingSet => ({ ...set, prompts })
  if (set.prompts.length === 0) {
    return [{
      stem: question.stem, numbered: true, grid: question.grid, matching: set, workSpace, parts: [],
    }]
  }
  const segments = set.prompts.map((prompt, index): Segment => ({
    stem: index === 0 ? question.stem : [],
    numbered: index === 0,
    grid: index === 0 ? question.grid : null,
    matching: withPrompts([prompt]),
    workSpace: null,
    parts: [],
  }))
  segments[segments.length - 1]!.workSpace = workSpace
  return segments
}

/** Consecutive segments, gathered back into the one item that prints them. */
function pieceOf(
  question: PlannedQuestion,
  segments: readonly Segment[],
): QuestionItem {
  const sets = segments.flatMap((segment) => (segment.matching ? [segment.matching] : []))
  return {
    kind: 'question',
    question,
    stem: segments.flatMap((segment) => segment.stem),
    numbered: segments.some((segment) => segment.numbered),
    grid: segments.find((segment) => segment.grid !== null)?.grid ?? null,
    // A matching set's segments each hold some of its items and all of its bank.
    matching:
      sets.length === 0 ? null : { ...sets[0]!, prompts: sets.flatMap((set) => set.prompts) },
    workSpace: segments.find((segment) => segment.workSpace !== null)?.workSpace ?? null,
    parts: question.parts ? joinedParts(segments.flatMap((segment) => segment.parts)) : null,
    ...(question.pointsAfter && segments.some((segment) => segment.closes)
      ? { pointsAfter: question.pointsAfter }
      : {}),
    ...(question.closingPoints && segments.some((segment) => segment.closes)
      ? { closingPoints: question.closingPoints }
      : {}),
  }
}

/** The work space that fills the rest of the page this piece lands on, if
 *  any: a Short Answer question's own, or — for a Multipart question — its last Part's
 *  or Subpart's, since a piece of a Multipart question ends at any that fills. */
function fillingSpaceOf(item: QuestionItem): PlannedWorkSpace | null {
  if (item.workSpace?.fill) return item.workSpace
  const last = item.parts?.at(-1)
  const space = last ? closingWorkSpaceOf(last) : null
  return space?.fill ? space : null
}

/** The piece with its filling work space grown to `height`. */
function withFillHeight(item: QuestionItem, height: number): QuestionItem {
  const grow = (space: PlannedWorkSpace): PlannedWorkSpace => ({
    ...space,
    height,
    lines: space.style === 'lines' ? rowsIn(height, rowsOfPlanned(space)) : 0,
  })
  if (item.workSpace?.fill) return { ...item, workSpace: grow(item.workSpace) }
  const parts = item.parts ?? []
  const last = parts.at(-1)
  if (!last) return item
  return { ...item, parts: [...parts.slice(0, -1), withClosingWorkSpace(last, grow)] }
}

// Packing: fill a page until the next item does not fit, then start another.
//
// A question is atomic by default — it moves to the next page whole whenever it
// would fit there. Only a question that exceeds a full content box on its own is
// broken up, and then at the part boundaries above, as late as each page allows.
//
// `initialHeader` and `continuedHeader` are what makes this the same function
// for both the test (`'first'` then `'later'`) and the answer key (`'answer-key'`
// on every page it takes — the key carries only one header variant). Page
// numbers always start at 1 within one call, which is what gives the key its
// own restarted footer: it is simply a second, independent call.
// What packing produces: which items landed on which sheet, under which header
// variant. Furniture needs the document's title and arrangement, which packing has
// no business knowing, so `resolveLayout` is what turns these into
// `PlannedPage`s.
type PackedPage = Pick<PlannedPage, 'number' | 'header' | 'stream' | 'items'>

function paginate(
  items: PageItem[],
  measure: Measure,
  pageSize: PageSize,
  stream: PageStream,
  initialHeader: PageHeader,
  continuedHeader: PageHeader,
  titleExtra = 0,
  headExtra = 0,
): PackedPage[] {
  const pages: PackedPage[] = []
  const contentHeight = (header: PageHeader) => pageContentHeight(header, pageSize, titleExtra, headExtra)
  let header: PageHeader = initialHeader
  let box = contentHeight(header)
  let current: PageItem[] = []
  let used = 0
  // Set once a work space has taken the rest of this page: nothing else may
  // follow it here, whatever height the next item happens to measure at.
  let full = false

  const flush = () => {
    pages.push({ number: pages.length + 1, header, stream, items: current })
    current = []
    used = 0
    full = false
    header = continuedHeader
    box = contentHeight(header)
  }

  // A work space that fills its page is measured at its least height, which is
  // what decided that it fits here; placing it is what grows it to the foot of
  // the page. The growth is recorded on the item itself, so adapters draw the
  // grown height rather than rediscovering it.
  const place = (item: PageItem, height: number) => {
    let placed = item
    let placedHeight = height
    const space = item.kind === 'question' ? fillingSpaceOf(item) : null
    if (item.kind === 'question' && space) {
      const extra = Math.max(0, Math.floor(box - used - height - WORK_SPACE_FILL_SLACK))
      placed = withFillHeight(item, space.height + extra)
      placedHeight = height + extra
      full = true
    }
    current.push(placed)
    used += placedHeight
  }

  // Breaks one question across as many pages as it needs, each page taking as
  // many consecutive parts as still fit. A part taller than a whole page is
  // placed alone and overflows rather than looping forever — there is nothing
  // smaller to break it into. A section heading is kept with its first
  // question whatever that question does: when the first piece does not fit
  // under a heading that shares its page with earlier content, the heading
  // moves to the next page along with the piece rather than staying behind.
  // A heading alone on its page has nothing to move away from: the piece goes
  // on ahead of it only when a fresh page would actually hold it, and an
  // oversized piece overflows under the heading instead.
  const fullPage = contentHeight(continuedHeader)
  // A Part or Subpart that fills its page ends the piece it is in: nothing may
  // follow it on that page.
  const endsPiece = (segment: Segment) => {
    const last = segment.parts.at(-1)
    return last ? closingWorkSpaceOf(last)?.fill === true : false
  }
  const split = (question: PlannedQuestion) => {
    const segments = segmentsOf(question, measure, fullPage)
    let start = 0
    while (start < segments.length) {
      if (full) flush()
      let end = start + 1
      let piece = pieceOf(question, segments.slice(start, end))
      let height = measure.itemHeight(piece)
      if (height > box - used && current.length > 0) {
        const last = current.at(-1)
        if (last?.kind !== 'section-heading') {
          flush()
          continue
        }
        if (current.length > 1) {
          current.pop()
          flush()
          place(last, measure.itemHeight(last))
        } else if (height <= fullPage) {
          flush()
          continue
        }
      }
      while (end < segments.length && !endsPiece(segments[end - 1]!)) {
        const grown = pieceOf(question, segments.slice(start, end + 1))
        const grownHeight = measure.itemHeight(grown)
        if (grownHeight > box - used) break
        piece = grown
        height = grownHeight
        end += 1
      }
      place(piece, height)
      start = end
    }
  }

  for (const [index, item] of items.entries()) {
    if (full) flush()
    const height = measure.itemHeight(item)
    // A section heading must share a page with at least the first indivisible
    // piece of its first question — the whole question, when it is one piece.
    // Reserve that space before committing the heading; otherwise a heading
    // can fit in the last few lines of a page after every question in its
    // section has moved forward.
    if (item.kind === 'section-heading') {
      const firstQuestion = items[index + 1]
      if (firstQuestion?.kind === 'question') {
        const [firstSegment] = segmentsOf(firstQuestion.question, measure, fullPage)
        const firstPieceHeight = firstSegment
          ? measure.itemHeight(pieceOf(firstQuestion.question, [firstSegment]))
          : 0
        if (current.length > 0 && height + firstPieceHeight > box - used) {
          flush()
        }
      }
    }
    // A Multipart question with a Part that fills its page before the last Part cannot
    // be placed whole: the Parts after the filling one go on the next page.
    if (item.kind === 'question' && fillsBeforeItsEnd(item.question)) {
      split(item.question)
      continue
    }
    if (height <= box - used) {
      place(item, height)
      continue
    }
    if (item.kind !== 'question') {
      if (current.length > 0) flush()
      place(item, height)
      continue
    }
    // It does not fit here. Move it forward whole if a page of its own would
    // hold it; otherwise it is genuinely oversized, and splitting starts in
    // whatever room is left rather than wasting the rest of this page.
    const followsSectionHeading = current.at(-1)?.kind === 'section-heading'
    if (
      current.length > 0
      && !followsSectionHeading
      && height <= fullPage
    ) {
      flush()
      place(item, height)
      continue
    }
    split(item.question)
  }
  flush()
  return pages
}

/** The Answer Key's line for a Part or Subpart that answers. */
function answerKeyPartLine(
  letter: string,
  part: Pick<PlannedSubpart, 'type' | 'choices' | 'suggestedAnswer' | 'points'>,
): AnswerKeyPartLine {
  return {
    letter,
    answer:
      part.type === 'multiple-choice'
        ? part.choices.find((choice) => choice.correct)?.letter ?? null
        : null,
    ...(part.suggestedAnswer ? { suggestedAnswer: part.suggestedAnswer } : {}),
    ...(part.points !== undefined ? { points: part.points } : {}),
  }
}

// Derive the key from the exact rendered questions that students see, so its
// numbering and arrangement-relative choice letters cannot drift from the test. A
// question that later splits across pages still contributes exactly one answer
// line — or, for a matching set, exactly one line per prompt, since each prompt
// is a number on the test — because the key is derived before layout and the
// id set guards repeats.
function deriveAnswerKey(testItems: readonly PageItem[]): PageItem[] {
  // The key groups its lines by the test's Sections, under the test's own
  // titles, as the Exam words them. A heading cleared from the test still
  // names its group here: the key is a teacher's reference, and a run of
  // answers with no label is not one. A Section with no questions has no
  // group.
  // The paper's total is counted from the very questions the key lists, so
  // it is the sum of the Points printed beneath it.
  const totalPoints = totalPointsIn(testItems)
  const items: PageItem[] = [
    { kind: 'answer-key-heading', ...(totalPoints !== undefined ? { totalPoints } : {}) },
  ]
  const seen = new Set<string>()
  let heading: SectionHeadingItem | null = null
  let grouped: string | null = null
  // A Section whose heading the teacher cleared is named by its place.
  let unnamed = 0

  for (const item of testItems) {
    if (item.kind === 'section-heading') heading = item
    if (item.kind !== 'question' || seen.has(item.question.id)) continue
    seen.add(item.question.id)
    if (heading && heading.sectionId !== grouped) {
      grouped = heading.sectionId
      items.push({
        kind: 'answer-key-section',
        sectionId: heading.sectionId,
        title: heading.title || `Section ${++unnamed}`,
      })
    }
    const metadata = {
      ...(item.question.difficulty ? { difficulty: item.question.difficulty } : {}),
      ...(item.question.topics?.length ? { topics: [...item.question.topics] } : {}),
    }
    if (item.question.parts) {
      items.push({
        kind: 'answer-key-entry',
        number: item.question.number,
        letter: null,
        ...metadata,
        // A Part that holds Subparts answers nothing itself: its line is one
        // per Subpart, each labelled with its place under the Part.
        parts: answeringPartsIn(item.question.parts).map(({ name, part, subpart }) => ({
          ...answerKeyPartLine(name, part),
          ...(subpart ? { subpart: true as const } : {}),
        })),
      })
      continue
    }
    const points = item.question.totalPoints !== undefined ? { points: item.question.totalPoints } : {}
    if (item.question.matching) {
      // A Matching set takes its Points as a whole, so its Points print once, on
      // its first Item's line.
      item.question.matching.prompts.forEach((prompt, index) => {
        items.push({
          kind: 'answer-key-entry',
          number: prompt.number,
          letter: prompt.letter,
          ...metadata,
          ...(index === 0 ? points : {}),
        })
      })
      continue
    }
    items.push({
      kind: 'answer-key-entry',
      number: item.question.number,
      letter: item.question.choices.find((choice) => choice.correct)?.letter ?? null,
      ...metadata,
      ...points,
      ...(item.question.suggestedAnswer
        ? { suggestedAnswer: item.question.suggestedAnswer }
        : {}),
    })
  }
  return items
}

// ---------------------------------------------------------------------------
// Stage 1: the Export Document
//
// Format-neutral content and presentation intent for one exam arrangement: what the
// paper says, in what order, under which numbers and letters — and nothing at
// all about pages. Both streams are always derived; the selection decides which
// of them the Layout Plan goes on to lay out.

/** Which of an exam arrangement's documents an export covers. */
export type ExportContentSelection = {
  test: boolean
  answerKey: boolean
}

/** The selection DOCX export uses: the student's paper, without the key. */
export const STUDENT_TEST: ExportContentSelection = { test: true, answerKey: false }

/** Which paper a plan is. `version` is the shuffled Version's name, present
 *  only when the export shuffled; it is what the page's label prints. */
export type PlannedArrangement = { id: string; letter: string; version?: string }

export type ExportDocument = {
  title: string
  arrangement: PlannedArrangement
  selection: ExportContentSelection
  /** The student test's content items, in order, before page assignment. */
  test: PageItem[]
  /** The answer key's content items, in order, before page assignment. */
  answerKey: PageItem[]
  /** The Exam's own header lines, where it has reworded them. */
  header?: ExamHeader
  /** The Exam's heading size, where not normal: the title's size. */
  headingSize?: HeadingSize
  /** The Exam's text size, where not normal. */
  textSize?: TextSize
  /** The Exam's Page Margins in inches, where not the default. */
  margins?: PageMargins
  /** The Exam's Paper Style, where not Standard. Its rules are already in
   *  the items; layout reads it for what packing alone decides — how far apart
   *  questions stand, and whether answers fit across the line — and for the
   *  sheet and the running furniture its pages carry. */
  paperStyle?: PaperStyle
}

/** Semantic derivation, on its own. Exposed so tests and fingerprints can read
 *  the semantic stage: it is page-free, and takes no `Measure` at all. */
export function buildExportDocument(
  exam: Exam,
  arrangement: Arrangement,
  selection: ExportContentSelection,
  version?: string,
): ExportDocument {
  const questions = deriveItems(exam, arrangement)
  const total = paperTotalOf(paperStyleRules(exam.paperStyle), questions)
  const test = total ? [total, ...questions] : questions
  return {
    title: exam.title,
    arrangement: {
      id: arrangement.id,
      letter: arrangement.letter,
      ...(version !== undefined ? { version } : {}),
    },
    selection,
    test,
    answerKey: deriveAnswerKey(test),
    ...(exam.header ? { header: exam.header } : {}),
    ...(exam.headingSize && exam.headingSize !== DEFAULT_HEADING_SIZE
      ? { headingSize: exam.headingSize }
      : {}),
    ...(exam.textSize && exam.textSize !== DEFAULT_TEXT_SIZE ? { textSize: exam.textSize } : {}),
    ...(exam.margins && !sameMargins(exam.margins, undefined) ? { margins: { ...exam.margins } } : {}),
    ...(exam.paperStyle && exam.paperStyle !== DEFAULT_PAPER_STYLE
      ? { paperStyle: exam.paperStyle }
      : {}),
  }
}

/** The paper's total Points, counted once per question from the very questions
 *  the test prints; `undefined` when none has points. */
function totalPointsIn(items: readonly PageItem[]): number | undefined {
  return sumOfPoints(
    [...new Map(
      items.flatMap((item) => (item.kind === 'question' ? [[item.question.id, item.question.totalPoints] as const] : [])),
    ).values()],
  )
}

/** The paper's total a style prints beneath the title, opening the test;
 *  `undefined` under a style that prints none there, or when nothing on the
 *  paper has Points. */
function paperTotalOf(rules: PaperStyleRules, questions: readonly PageItem[]): PaperTotalItem | undefined {
  const template = rules.points.paperTotalUnderTitle
  const total = totalPointsIn(questions)
  return template && total !== undefined ? { kind: 'paper-total', text: labelled(template, total) } : undefined
}

// ---------------------------------------------------------------------------
// Stage 2: the Layout Plan
//
// The Export Document resolved onto real sheets. Self-contained on purpose: an
// adapter that has a plan needs neither the exam, the arrangement, nor a `Measure`.

export type PageSize = {
  /** CSS pixels at 96dpi — US Letter, or A4 under a Paper Style that prints
   *  on it — the geometry every output is cut to. */
  width: number
  height: number
  /** Set on an A4 sheet, so an adapter cuts it to A4 exactly rather than to
   *  the whole pixels it was packed in. Absent is US Letter, as every plan
   *  recorded before a style could choose. */
  paper?: 'a4'
  /** How far in from each edge the page prints: the Exam's Page Margins. */
  margins: Record<MarginSide, number>
  /** The width left between the left and right margins — what every item on
   *  the page is laid out at. */
  contentWidth: number
}

/** The sheet a Paper Style names — US Letter unless it says A4 — with an
 *  Exam's Page Margins, in the pixels the plan packs in. */
export function pageSizeOf(margins: PageMargins | undefined, paper: PaperSize = 'letter'): PageSize {
  const inches = marginsOf(margins)
  const px = {
    top: marginPx(inches.top),
    right: marginPx(inches.right),
    bottom: marginPx(inches.bottom),
    left: marginPx(inches.left),
  }
  const a4 = paper === 'a4'
  const width = a4 ? A4_WIDTH : PAGE_WIDTH
  return {
    width,
    height: a4 ? A4_HEIGHT : PAGE_HEIGHT,
    ...(a4 ? { paper: 'a4' as const } : {}),
    margins: px,
    contentWidth: Math.round((width - px.left - px.right) * 100) / 100,
  }
}

/**
 * A Layout Plan as an Export Record stored it, read by this version. A record
 * is never rewritten (ADR-0014), so one made before Sections were stored
 * (ADR-0029) still says whether each question printed an answer blank, and
 * names its Sections by Question Type: here the blank becomes the mark it
 * printed as, and the type the Section's id, so it reprints as it did.
 */
export function readStoredLayoutPlan(plan: LayoutPlan): LayoutPlan {
  // A plan recorded before an Exam could set its margins (ADR-0039) states one
  // margin for every side.
  const legacySize = plan.pageSize as PageSize & { margin?: number }
  const legacyMargin = legacySize.margin ?? PAGE_MARGIN
  const pageSize: PageSize = legacySize.margins
    ? plan.pageSize
    : {
        width: legacySize.width,
        height: legacySize.height,
        margins: { top: legacyMargin, right: legacyMargin, bottom: legacyMargin, left: legacyMargin },
        contentWidth: legacySize.contentWidth,
      }
  const upgraded = (item: PageItem): PageItem => {
    const legacy = item as PageItem & { section?: string }
    if ((item.kind === 'section-heading' || item.kind === 'answer-key-section')
      && typeof item.sectionId !== 'string') {
      return { ...item, sectionId: String(legacy.section ?? '') }
    }
    if (item.kind === 'question' && !Array.isArray(item.question.marks)) {
      const { answerBlank, ...question } = item.question as PlannedQuestion & { answerBlank?: boolean }
      return { ...item, question: { ...question, marks: answerBlank ? [LEGACY_ANSWER_BLANK] : [] } }
    }
    return item
  }
  // A plan recorded before ADR-0044 names its Paper Style by the old name.
  const { questionStyle: legacyStyle, ...current } = plan as LayoutPlan & { questionStyle?: PaperStyle }
  return {
    ...current,
    ...(current.paperStyle === undefined && legacyStyle !== undefined ? { paperStyle: legacyStyle } : {}),
    pageSize,
    pages: plan.pages.map((page) => ({ ...page, items: page.items.map(upgraded) })),
  }
}

export type LayoutPlan = {
  title: string
  arrangement: PlannedArrangement
  selection: ExportContentSelection
  pageSize: PageSize
  /** How large the pages' content prints, when not normal. Every adapter sets
   *  its body type from this; it is what the items were measured at. */
  textSize?: TextSize
  /** The Paper Style the pages were laid out in, when not Standard. What
   *  it prints is in the items; adapters read this only for the space each
   *  question leaves below itself, which is what packing measured. */
  paperStyle?: PaperStyle
  pages: PlannedPage[]
}

export type PlanRequest = {
  exam: Exam
  arrangement: Arrangement
  selection: ExportContentSelection
  measure: Measure
  /** The shuffled Version this paper is, named on every page; absent for the
   *  Working Copy's own arrangement, which prints no label. */
  version?: string
}

/** The column counts a Paper Style may widen answers to, widest first. */
const ACROSS_COLUMNS: readonly ColumnCount[] = [4, 2]

/** Whether an answer is text alone — paragraphs of text, marks and math —
 *  which is all that can be said to fit on one line. A picture or a table
 *  keeps the columns the teacher set. */
function holdsTextOnly(choice: PlannedChoice): boolean {
  const blocks = Array.isArray(choice.node.content) ? (choice.node.content as ProseMirrorJSON[]) : []
  const inlineOnly = (node: ProseMirrorJSON): boolean =>
    node.type !== 'image' && node.type !== 'image-block'
    && (!Array.isArray(node.content) || (node.content as ProseMirrorJSON[]).every(inlineOnly))
  return blocks.every((block) => block.type === 'paragraph' && inlineOnly(block))
}

/** A grid widened to the most columns, past its own, at which every answer
 *  holds one line in a cell of a lane `areaWidth` wide — or the grid as it was
 *  when no wider count fits, the measure cannot say, or an answer holds more
 *  than text. Never narrower than the teacher's own setting. */
function acrossGrid(
  grid: ChoiceGrid | null,
  areaWidth: number,
  measure: Measure,
  textSize: TextSize | undefined,
): ChoiceGrid | null {
  if (!grid || !measure.choiceWidth) return grid
  const choices = grid.cells.flat().filter((cell): cell is PlannedChoice => cell !== null)
  if (!choices.every(holdsTextOnly)) return grid
  // Read back in letter order: the grid is filled column-major.
  const ordered = [...choices].sort((left, right) =>
    left.letter.length - right.letter.length || left.letter.localeCompare(right.letter))
  const widest = Math.max(...ordered.map((choice) => measure.choiceWidth!(choice, textSize)))
  const columns = ACROSS_COLUMNS.find(
    (count) => count > grid.columns && widest <= areaWidth / count,
  )
  return columns ? layOutGrid(ordered, columns) : grid
}

// A Paper Style that lays answers across the line (Condensed) decides how
// far once the items are known and before they pack, since how many columns an
// answer fits in is a measurement: each Multiple Choice question's and Part's
// grid widens as far as every answer still holds one line. The answer key is
// untouched, since it never prints a grid. The lane is what the grid is drawn
// in: the page's width between its margins, less the question's own number
// column (and a Part's letter column) and the answers' indent.
function fitAnswersAcross(
  items: readonly PageItem[],
  measure: Measure,
  textSize: TextSize | undefined,
  contentWidth: number,
): PageItem[] {
  return items.map((item) => {
    if (item.kind !== 'question') return item
    const { question } = item
    const lane = choiceAreaWidth(contentWidth, question)
    const grid = acrossGrid(question.grid, lane, measure, textSize)
    const parts = question.parts?.map((part) => {
      const partGrid = acrossGrid(part.grid, partChoiceAreaWidth(contentWidth, question), measure, textSize)
      const subparts = part.subparts.map((subpart) => {
        const subpartGrid = acrossGrid(subpart.grid, subpartChoiceAreaWidth(contentWidth, question), measure, textSize)
        return subpartGrid === subpart.grid ? subpart : { ...subpart, grid: subpartGrid }
      })
      return partGrid === part.grid && subparts.every((subpart, index) => subpart === part.subparts[index])
        ? part
        : { ...part, grid: partGrid, subparts }
    }) ?? null
    if (grid === question.grid && parts?.every((part, index) => part === question.parts![index]) !== false) {
      return item
    }
    return wholeQuestion({ ...question, grid, parts })
  })
}

// How wide a Word Bank set beside its Items is drawn, with real measurement.
// Where it sits is decided before layout and stored (`wordBankLayoutFor`), so
// this never moves one: a bank beside its Items is given the column its widest
// answer needs, `MATCHING_BANK_WIDTH` at least and never more than leaves the
// prompts their least width, its answers wrapping in it when even that is too
// narrow, rather than overflowing the page. A bank above its Items is left
// alone, and so is every bank when the measure cannot tell widths.
function fitWordBanks(
  items: readonly PageItem[],
  measure: Measure,
  textSize: TextSize | undefined,
  contentWidth: number,
  promptsMinWidth: number,
): PageItem[] {
  const widthOf = measure.bankAnswerWidth
  if (!widthOf) return [...items]
  const widest = contentWidth - MATCHING_INDENT - promptsMinWidth
  return items.map((item) => {
    if (item.kind !== 'question' || !item.question.matching) return item
    const { question } = item
    const set = question.matching!
    if (set.bankGrid || set.bank.length === 0) return item
    const width = Math.min(
      Math.max(bankNeeds(set.bank, widthOf, textSize), MATCHING_BANK_WIDTH),
      Math.max(widest, MATCHING_BANK_WIDTH),
    )
    if (width <= MATCHING_BANK_WIDTH) return item
    return wholeQuestion({ ...question, matching: { ...set, bankWidth: width } })
  })
}

/** How a Word Bank answer's one-line width is measured: `Measure.bankAnswerWidth`. */
export type BankAnswerWidth = NonNullable<Measure['bankAnswerWidth']>

/** What an Exam's choice of Word Bank layout reads beside the question. */
export type WordBankSettings = Pick<Exam, 'paperStyle' | 'textSize' | 'margins'>

/** The width a column beside the Items needs to hold every answer of a Word
 *  Bank on one line, its inset included. */
function bankNeeds(
  bank: readonly PlannedBankAnswer[],
  widthOf: BankAnswerWidth,
  textSize: TextSize | undefined,
): number {
  return MATCHING_BANK_INSET + Math.max(...bank.map((answer) => Math.ceil(widthOf(answer, textSize))))
}

/** The least room a style leaves a matching set's prompts beside its bank. */
function promptsMinWidthOf(style: PaperStyle | undefined): number {
  return style === 'condensed' ? CONDENSED_MATCHING_PROMPTS_MIN_WIDTH : MATCHING_PROMPTS_MIN_WIDTH
}

/**
 * The Word Bank layout a Matching question takes when it arrives on an Exam —
 * added, dragged, imported without one — or when the Exam's Paper Style
 * changes and the teacher has not chosen it (ADR-0044): the style's own
 * placement, and where the style leaves it to fit, beside its Items when its
 * widest answer, measured on one line at the Exam's text size, fits a column that still leaves the Items their least width on a
 * page as wide as the Exam's margins leave, and above them otherwise. A bank
 * with more than twice as many answers as there are Items, and more than
 * `MATCHING_BESIDE_LIMIT`, goes above: beside, the set would stand as tall as
 * its bank. Without `widthOf` — where nothing can measure, and for a position
 * stored before every one carried a layout — a bank goes beside up to
 * `MATCHING_BESIDE_LIMIT` answers and above past it.
 *
 * The result is stored on the position and read as it is from then on, so a
 * Layout Plan never measures where a bank goes.
 */
export function wordBankLayoutFor(
  question: Question,
  settings: WordBankSettings,
  widthOf?: BankAnswerWidth,
): WordBankLayout {
  const rules = paperStyleRules(settings.paperStyle)
  if (rules.bankPlacement === 'above') return 'above'
  const answers = choicesOf(question)
  if (answers.length === 0) return 'beside'
  if (answers.length > Math.max(MATCHING_BESIDE_LIMIT, 2 * promptsOf(question).length)) return 'above'
  if (!widthOf) return answers.length > MATCHING_BESIDE_LIMIT ? 'above' : 'beside'
  const bank: PlannedBankAnswer[] = answers.map((answer, index) => ({
    id: answer.id,
    letter: rules.lettering === 'lower' ? letterAt(index).toLowerCase() : letterAt(index),
    node: answer.node,
  }))
  const widest = pageSizeOf(settings.margins, rules.pageSize).contentWidth
    - MATCHING_INDENT
    - promptsMinWidthOf(settings.paperStyle)
  return bankNeeds(bank, widthOf, settings.textSize) <= widest ? 'beside' : 'above'
}

/** A Matching question's Word Bank layout on this Exam: the one its position
 *  stores, or — for a position stored before every one carried a layout —
 *  the one `wordBankLayoutFor` gives it unmeasured, the same on every read. */
export function wordBankLayoutOf(
  exam: WordBankSettings & Pick<Exam, 'wordBankLayout'>,
  question: Question,
): WordBankLayout {
  const stored = exam.wordBankLayout?.[question.id]
  return isWordBankLayout(stored) ? stored : wordBankLayoutFor(question, exam)
}

/** Layout resolution, on its own: an Export Document onto sheets. Keeping the
 *  two `paginate` calls independent is what restarts the answer key's footer. */
function resolveLayout(
  document: ExportDocument,
  measure: Measure,
): LayoutPlan {
  const { textSize, paperStyle } = document
  const rules = paperStyleRules(paperStyle)
  const pageSize = pageSizeOf(document.margins, rules.pageSize)
  // Every item is measured at the Exam's text size, at the width its margins
  // leave and in its Paper Style; an Exam with none of them asks exactly as
  // it always did.
  const layout: ItemLayout = {
    ...(textSize ? { textSize } : {}),
    ...(pageSize.contentWidth !== PAGE_CONTENT_WIDTH ? { contentWidth: pageSize.contentWidth } : {}),
    ...(paperStyle ? { paperStyle } : {}),
  }
  const sized: Measure = Object.keys(layout).length > 0
    ? { itemHeight: (item) => measure.itemHeight(item, layout) }
    : measure
  // A long title wraps rather than running off the sheet, and the header that
  // prints it grows by a line for each line it wraps onto; every page that
  // prints the title packs into what is left.
  const titleLines = Math.max(
    1,
    Math.round(measure.titleLines?.(document.title, document.headingSize, pageSize.contentWidth) ?? 1),
  )
  const titleExtra = titleGrowth(titleLines, document.headingSize)
  const pages: PackedPage[] = []
  if (document.selection.test) {
    const across = rules.answersAcross
      ? fitAnswersAcross(document.test, measure, textSize, pageSize.contentWidth)
      : document.test
    const test = fitWordBanks(
      across,
      measure,
      textSize,
      pageSize.contentWidth,
      promptsMinWidthOf(paperStyle),
    )
    // The test's pages carry its Paper Style's running head; the Answer
    // Key's keep the sheet's own.
    pages.push(
      ...paginate(test, sized, pageSize, 'test', 'first', 'later', titleExtra, runningHeadHeight(paperStyle)),
    )
  }
  if (document.selection.answerKey) {
    pages.push(
      ...paginate(
        document.answerKey,
        sized,
        pageSize,
        'answer-key',
        'answer-key',
        'answer-key-later',
        titleExtra,
      ),
    )
  }
  return {
    title: document.title,
    arrangement: document.arrangement,
    selection: document.selection,
    pageSize,
    ...(textSize ? { textSize } : {}),
    ...(paperStyle ? { paperStyle } : {}),
    // Every page but the first of the serialized document is preceded by an
    // explicit break. A linear format must reproduce the plan's pagination
    // rather than rediscover one of its own.
    pages: pages.map((page, index) => ({
      ...page,
      furniture: furnitureOf(
        page,
        document.title,
        document.arrangement.version,
        document.header,
        document.headingSize,
        titleLines,
        // The test's running furniture is its Paper Style's; the Answer Key
        // keeps the sheet's own under every style.
        page.stream === 'test'
          ? {
              rules,
              continues: pages[index + 1]?.stream === 'test',
            }
          : undefined,
      ),
      breakBefore: index > 0,
    })),
  }
}

/**
 * The whole planning interface, in one pure call: an exam, the arrangement to
 * export, which of its documents to include, and how to measure. Nothing here
 * reads the DOM, a clock, or a random source.
 */
export function planExport({
  exam,
  arrangement,
  selection,
  measure,
  version,
}: PlanRequest): LayoutPlan {
  return resolveLayout(buildExportDocument(exam, arrangement, selection, version), measure)
}
