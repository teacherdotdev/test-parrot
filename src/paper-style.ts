// What an Exam's Paper Style says about how its paper prints.
//
// A Paper Style is one test-wide preset, chosen from the Format menu like
// the heading and text sizes (ADR-0025), and never set per question or per
// Question Type (ADR-0041). It decides what prints before a question's number,
// how answers are lettered and laid out, how a matching set's Word Bank sits,
// what room a Short Answer position leaves when the teacher has set none, and
// how far apart questions stand — and, since the Exam Board style (ADR-0045),
// the sheet's size, how questions, Parts, Subparts and answers are labelled,
// how ruled lines look, where Points print and what the head and foot of each
// page carry. The Export Document reads these rules once,
// so print, PDF, DOCX, the Export Preview and the exam sheet all draw the same
// thing; nothing here is read by an adapter.
//
// `'standard'` is the sheet as it printed before Paper Styles existed, so an
// Exam that never chose one prints exactly as it always did.

import type { WorkSpace } from './exam'

export type PaperStyle = 'standard' | 'classic' | 'condensed' | 'exam-board'

export const PAPER_STYLES: readonly PaperStyle[] = [
  'standard',
  'classic',
  'condensed',
  'exam-board',
]

export const DEFAULT_PAPER_STYLE: PaperStyle = 'standard'

/** Whether a stored value is a Paper Style this build can print. The single
 *  guard, so storage and import agree on what a readable record is. */
export function isPaperStyle(value: unknown): value is PaperStyle {
  return PAPER_STYLES.includes(value as PaperStyle)
}

/** How each Paper Style is named, and said in a line, in the Format menu. */
export const PAPER_STYLE_LABELS: Record<PaperStyle, { label: string; description: string }> = {
  standard: {
    label: 'Standard',
    description: 'Circle the letter or T/F; no blanks before numbers.',
  },
  classic: {
    label: 'Classic',
    description: 'A blank before each objective number; ruled lines for written answers.',
  },
  condensed: {
    label: 'Condensed',
    description: 'Saves paper: tighter spacing, answers across where they fit, closer-ruled lines.',
  },
  'exam-board': {
    label: 'Exam Board',
    description: 'A4: 1 (a) (i) labels, dotted lines, points in brackets at the right.',
  },
}

/** The answer blank a student writes a letter, or T or F, on, printed before a
 *  question's number. The same seven underscores an Export Record made before
 *  Sections were stored printed there (ADR-0029), so such a record reprints
 *  through the same path. */
export const ANSWER_BLANK = '_______'

/** How a style letters answers on the test. The Answer Key keeps its capitals
 *  whatever the test prints: it is the teacher's reference, as a common test
 *  generator's own key reads "ANS: A" beside a test lettered "a.". */
export type Lettering = 'upper' | 'lower'

/** Where a Matching position's Word Bank goes when it takes a layout — when
 *  the question arrives on the Exam, or the Exam takes this style: beside its
 *  Items wherever it fits and above them otherwise (`'fit'`), or above them
 *  (`'above'`). A teacher may then move any one, and a change of style sets
 *  again only those the teacher did not move (`wordBankLayoutFor`, ADR-0044). */
export type BankPlacement = 'fit' | 'above'

/** The sheet a style prints on: US Letter, or A4 (ADR-0045). */
export type PaperSize = 'letter' | 'a4'

/** How a ruled Work Space's lines are drawn: a solid rule, or a row of dots. */
export type Ruling = 'solid' | 'dotted'

/** How something is labelled where it prints, as a small template: `{n}` is
 *  its number or letter. `'{n}.'` prints `1.`, `a.`, `A.`; `'({n})'` prints
 *  `(a)`. A template is data, so a style for another paper needs no code. */
export type LabelTemplate = string

/** The labels a style prints, by level. Each is a template (`LabelTemplate`). */
export type PaperLabels = {
  /** A question's number, and a matching set's Item numbers. */
  question: LabelTemplate
  /** A Part's letter. */
  part: LabelTemplate
  /** A Subpart's numeral. */
  subpart: LabelTemplate
  /** A Multiple Choice answer's letter, and a Word Bank answer's. */
  answer: LabelTemplate
}

/** Every label the sheet always printed: a number or letter and a full stop. */
export const PERIOD_LABELS: PaperLabels = {
  question: '{n}.',
  part: '{n}.',
  subpart: '{n}.',
  answer: '{n}.',
}

/** A label written through its template. */
export function labelled(template: LabelTemplate, value: string | number): string {
  return template.split('{n}').join(String(value))
}

/** Where a style prints Points on the test (ADR-0045). Each placement is its
 *  own rule, with its wording a template in which `{n}` is the Points; one a
 *  style leaves out is not printed, and nothing unpointed prints any. */
export type PointPlacements = {
  /** After each answer with Points, against the right margin: a Multiple Choice,
   *  True/False or Matching question's after its answers, a Short Answer
   *  question's, Part's or Subpart's after its Work Space. */
  pointsAfterAnswer?: string
  /** After each Multipart question with Points, against the right margin: the sum
   *  of its Parts' and Subparts' Points. */
  questionTotal?: string
  /** After a Section's last question, against the right margin: the sum of
   *  its questions' Points. */
  sectionTotal?: string
  /** Beneath the title on the test's first page: the paper's total. */
  paperTotalUnderTitle?: string
}

/** What a style prints at the head and foot of each test page, past the
 *  Page Header line every style prints. */
export type RunningFurniture = {
  /** Where the page number prints: centred at the foot, as the sheet always
   *  printed it, or centred at the top. */
  pageNumber: 'foot' | 'top'
  /** What prints at the foot, right, of every test page another test page
   *  follows; absent prints nothing there. */
  continues?: string
}
export type PaperStyleRules = {
  /** What prints before a True/False question's number. */
  trueFalseMarks: readonly string[]
  /** What prints before a Multiple Choice question's number. */
  multipleChoiceMarks: readonly string[]
  /** How a Multiple Choice question's answers, and a Word Bank, are lettered.
   *  A Multiple Choice Part keeps its capitals, so its answers never read as
   *  the Part letters `a.`, `b.` beside them. */
  lettering: Lettering
  /** Whether a Multiple Choice question's or Part's answers widen past the
   *  columns the teacher set, to as many as hold each answer on one line.
   *  Never narrower than the teacher's own setting. */
  answersAcross: boolean
  bankPlacement: BankPlacement
  /** The room a Short Answer question or Part leaves when the teacher has set
   *  none on this Exam. An explicit Work Space — "None" included — always
   *  wins; `null` leaves no room, as every Exam did before. */
  defaultWorkSpace: WorkSpace | null
  /** The space below each question, in CSS pixels: `.exam-question`'s bottom
   *  margin in styles.css, which `export-typography.test.ts` holds to it. */
  questionGap: number
  /** How far apart a Work Space's rows lie on the page, in CSS pixels. Every
   *  Work Space keeps its count of rows under every style; a smaller pitch
   *  only sets them closer, and never rewrites a stored height. */
  workSpacePitch: number
  /** The sheet, US Letter or A4. Every page of the test and its Answer Key. */
  pageSize: PaperSize
  /** How questions, Parts, Subparts and answers are labelled on the test. The
   *  Answer Key keeps its own labels whatever the style. */
  labels: PaperLabels
  /** How a ruled Work Space is drawn. */
  ruling: Ruling
  /** Where Points print on the test. */
  points: PointPlacements
  running: RunningFurniture
}

/** The letters a True/False question's student circles, in the order they print. */
export const TRUE_FALSE_MARKS: readonly string[] = ['T', 'F']

/** The question gap every style but Condensed keeps: the sheet's own. */
export const STANDARD_QUESTION_GAP = 26

/** The Work Space pitch every style but Condensed keeps: `WORK_SPACE_LINE_PITCH`,
 *  a third of an inch. */
const STANDARD_WORK_SPACE_PITCH = 32

/** What every style printed before the Exam Board style: US Letter, `1.`
 *  `a.` `i.` `A.`, solid rules, no Points on the test, and the page number at
 *  the foot. */
const SHEET_RULES = {
  pageSize: 'letter',
  labels: PERIOD_LABELS,
  ruling: 'solid',
  points: {},
  running: { pageNumber: 'foot' },
} as const satisfies Pick<PaperStyleRules, 'pageSize' | 'labels' | 'ruling' | 'points' | 'running'>

export const PAPER_STYLE_RULES: Record<PaperStyle, PaperStyleRules> = {
  // The sheet as ADR-0029 left it: T and F to circle, a letter circled on its
  // answer, no blanks, and no room a teacher did not ask for.
  standard: {
    trueFalseMarks: TRUE_FALSE_MARKS,
    multipleChoiceMarks: [],
    lettering: 'upper',
    answersAcross: false,
    bankPlacement: 'fit',
    defaultWorkSpace: null,
    questionGap: STANDARD_QUESTION_GAP,
    workSpacePitch: STANDARD_WORK_SPACE_PITCH,
    ...SHEET_RULES,
  },
  // Modeled on what common test generators print by default: an answer blank
  // before every objective question's number, True/False written on that
  // blank rather than offered as choices, matching choices lettered a–z above
  // the numbered Items, and answer lines below open-ended questions.
  classic: {
    trueFalseMarks: [ANSWER_BLANK],
    multipleChoiceMarks: [ANSWER_BLANK],
    lettering: 'lower',
    answersAcross: false,
    bankPlacement: 'above',
    defaultWorkSpace: { height: 96, style: 'lines', fill: false },
    questionGap: STANDARD_QUESTION_GAP,
    workSpacePitch: STANDARD_WORK_SPACE_PITCH,
    ...SHEET_RULES,
  },
  // Paper first: nothing added before a number, questions closer together,
  // answers laid across the line wherever they fit, and room to write kept
  // but ruled closer — three lines where none were set, a quarter-inch apart,
  // the college-ruled spacing.
  condensed: {
    trueFalseMarks: TRUE_FALSE_MARKS,
    multipleChoiceMarks: [],
    lettering: 'upper',
    answersAcross: true,
    bankPlacement: 'fit',
    defaultWorkSpace: { height: 96, style: 'lines', fill: false },
    questionGap: 12,
    workSpacePitch: 24,
    ...SHEET_RULES,
  },
  // Set out the way international exam boards' papers commonly are (ADR-0045),
  // with none of any board's own wording (ADR-0044): A4; `1`, `(a)`, `(i)`;
  // dotted lines to write on; each answer's Points in brackets at the right
  // margin and each Multipart question's total beneath it; the paper's total
  // beneath the title; and the page number at the top and "Turn over" at the
  // foot. It prints no page of its own: the test opens on its first
  // question, under the Page Header every style prints.
  'exam-board': {
    trueFalseMarks: TRUE_FALSE_MARKS,
    multipleChoiceMarks: [],
    lettering: 'upper',
    answersAcross: false,
    bankPlacement: 'fit',
    defaultWorkSpace: { height: 96, style: 'lines', fill: false },
    questionGap: STANDARD_QUESTION_GAP,
    workSpacePitch: STANDARD_WORK_SPACE_PITCH,
    pageSize: 'a4',
    labels: { question: '{n}', part: '({n})', subpart: '({n})', answer: '{n}' },
    ruling: 'dotted',
    points: {
      pointsAfterAnswer: '[{n}]',
      questionTotal: '[Total: {n}]',
      paperTotalUnderTitle: 'The total mark for this paper is {n}.',
    },
    running: { pageNumber: 'top', continues: 'Turn over' },
  },
}

/** The rules an Exam prints by; absent means Standard. So does a name this
 *  build no longer knows, such as one a recorded Layout Plan kept from before
 *  a style was renamed: its page keeps what the plan resolved, and only the
 *  question gap falls back to the sheet's own. */
export function paperStyleRules(style: PaperStyle | undefined): PaperStyleRules {
  return PAPER_STYLE_RULES[isPaperStyle(style) ? style : DEFAULT_PAPER_STYLE]
}
