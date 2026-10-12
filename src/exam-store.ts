// The authoring state and the store that owns it.
//
// The authoring state — the Question Bank, the Working Copy, and the dirty
// flag — is mirrored to a backend on every change, so a refresh loses nothing.
// The backend is a narrow injectable interface: the app hands the store the
// normalized IndexedDB generation, while unit tests use an in-memory backend.
//
// The store is also the one authoring boundary. Every semantic action a teacher
// can take on the Question Bank or the Working Copy is a single method here:
// creating canonical Question Content with or without putting it on the exam,
// adding a reference, editing a banked question's content and metadata, moving
// a reference, arranging Sections, and Removing a reference. Callers never assemble an
// action out of smaller ones — that is what makes each of them atomic, one undo
// step, and one mirrored write.

import {
  choicesOf,
  columnsOf,
  duplicateQuestion,
  hasWorkSpace,
  isExamSection,
  isWordBankLayout,
  isWorkSpace,
  moveSection,
  deleteSection,
  insertSection,
  mergeSection,
  moveToNewSection,
  splitSection,
  workSpaceIn,
  placeQuestions,
  rewordSection,
  sameSectionOf,
  sameSections,
  sectionIdOf,
  sectionLayoutOf,
  sectionsOf,
  snapWorkSpaceHeight,
  takesWorkSpace,
  orderedChoices,
  orderedPartChoices,
  orderedQuestions,
  answeringPartsOf,
  presentationIdsOf,
  shuffleSelectedQuestions,
  type Arrangement,
  type ColumnSetting,
  newSectionWordingOf,
  type ExamSection,
  type Subpart,
  type Question,
  type SectionPlacement,
  type SectionTarget,
  type WordBankLayout,
  type WorkSpace,
} from './exam'
import {
  DEFAULT_HEADING_SIZE,
  isHeadingSize,
  isSectionHeadings,
  sameSectionHeadings,
  type HeadingSize,
  type SectionHeadingChange,
  DEFAULT_TEXT_SIZE,
  isTextSize,
  type TextSize,
} from './section-headings'
import { isExamHeader, sameExamHeader, withHeaderLine, type HeaderLine } from './page-header'
import { isPageMargins, sameMargins, withMargin, type MarginSide } from './page-margins'
import { DEFAULT_PAPER_STYLE, isPaperStyle, type PaperStyle } from './paper-style'
import {
  bankQuestionById,
  createWorkingCopy,
  createQuestionBank,
  withChoiceOrder,
  withHiddenAnswers,
  withQuestionBanked,
  withReferenceAdded,
  withReferenceOrder,
  withReferencesRemoved,
  withSectionLayout,
  type ExamWorkingCopy,
  type QuestionBank,
} from './question-bank'
import { selectedExam, type SelectedExam } from './selected-exam'
import { hiddenAnswerIdsOf, varySelectedAnswers, withShownIncorrect } from './hidden-answers'
import { withCanonicalQuestionProjection } from './canonical-question-projection'
import { withoutQuestions } from './question-deletion'
import { upgradeStoredQuestion } from './stored-upgrade'
import {
  EMPTY_EXPORT_HISTORY,
  type ExportHistory,
  type ExportRecord,
} from './export-preparation'
import { wordBankLayoutFor, wordBankLayoutOf, type BankAnswerWidth } from './export-plan'
import { clampSize } from './picture-geometry'

/** Everything authoring owns: canonical content, the selection made from it,
 *  and whether that has reached the saved state yet. */
export type AuthoringState = {
  questionBank: QuestionBank
  workingCopy: ExamWorkingCopy
  dirty: boolean
}

export type SavedState = Omit<AuthoringState, 'dirty'>

/** Browser-local Working Copy durability, separate from whether its Exam has
 * intentionally been saved. */
export type BackupStatus = 'ready' | 'pending' | 'failed'

// The whole persistence surface: read the last value written, write a new one.
// Both are asynchronous so that an IndexedDB implementation fits behind the
// same interface as a localStorage one.
export interface Backend<T> {
  read(): Promise<T | null>
  write(value: T): Promise<void>
}

/** An authoring backend that keeps the explicit saved state in the same
 *  durability boundary as the working Question Bank and Working Copy. */
export interface DurableAuthoringBackend extends Backend<AuthoringState> {
  readSaved(): Promise<SavedState | null>
  /** Creates an Exam's saved baseline and first Working Copy in one transaction. */
  initialize(saved: SavedState, working: AuthoringState): Promise<void>
  commitSaved(value: SavedState): Promise<void>
  readExportHistory(): Promise<ExportHistory>
  commitExportRecord(record: ExportRecord): Promise<void>
}

export type MemoryBackend<T> = Backend<T> & {
  /** The last value written, for assertions. */
  value: T | null
  /** How many writes have landed, for assertions. */
  writes: number
}

// A backend that keeps the value in a variable. Used by tests, so neither
// fake-indexeddb nor a localStorage shim is needed to exercise the store.
export function createMemoryBackend<T>(
  initial: T | null = null,
): MemoryBackend<T> {
  const backend: MemoryBackend<T> = {
    value: initial,
    writes: 0,
    read: async () => backend.value,
    write: async (value: T) => {
      backend.value = structuredClone(value)
      backend.writes += 1
    },
  }
  return backend
}

export function createAuthoringState(): AuthoringState {
  return {
    questionBank: createQuestionBank(),
    workingCopy: createWorkingCopy(),
    dirty: false,
  }
}

function isQuestionBank(value: unknown): value is QuestionBank {
  const bank = value as QuestionBank | null
  return typeof bank === 'object' && bank !== null && Array.isArray(bank.questions)
}

function isChoiceOrder(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(
      (choices) => Array.isArray(choices) && choices.every((choiceId) => typeof choiceId === 'string'),
    )
  )
}

function isColumnSettings(value: unknown): value is Record<string, ColumnSetting> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((columns) => columns === 1 || columns === 2 || columns === 4)
  )
}

function isWordBankLayoutSettings(value: unknown): value is Record<string, WordBankLayout> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(isWordBankLayout)
  )
}

function isWordBankLayoutChoices(value: unknown): value is Record<string, true> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((set) => set === true)
  )
}

function isSectionList(value: unknown): value is ExamWorkingCopy['sections'] {
  return Array.isArray(value) && value.every(isExamSection)
}

function isSectionPlacement(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((section) => typeof section === 'string')
  )
}

function isWorkSpaceSettings(value: unknown): value is Record<string, WorkSpace> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(isWorkSpace)
  )
}

/** An Exam's picture sizes (ADR-0050): by question, then by picture, each a
 *  share of its container. */
function isPictureSizeSettings(value: unknown): value is Record<string, Record<string, number>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every((sizes) =>
    typeof sizes === 'object' && sizes !== null && !Array.isArray(sizes)
    && Object.values(sizes).every((size) => typeof size === 'number' && size > 0 && size <= 1))
}

function isWorkingCopy(value: unknown): value is ExamWorkingCopy {
  const draft = value as ExamWorkingCopy | null
  return (
    typeof draft === 'object' &&
    draft !== null &&
    typeof draft.title === 'string' &&
    Array.isArray(draft.questionIds) &&
    draft.questionIds.every((id) => typeof id === 'string') &&
    (draft.columns === undefined || isColumnSettings(draft.columns)) &&
    (draft.workSpace === undefined || isWorkSpaceSettings(draft.workSpace)) &&
    (draft.wordBankLayout === undefined || isWordBankLayoutSettings(draft.wordBankLayout)) &&
    (draft.wordBankLayoutSet === undefined || isWordBankLayoutChoices(draft.wordBankLayoutSet)) &&
    (draft.pictureSizes === undefined || isPictureSizeSettings(draft.pictureSizes)) &&
    (draft.choiceOrder === undefined || isChoiceOrder(draft.choiceOrder)) &&
    (draft.hiddenAnswers === undefined || isChoiceOrder(draft.hiddenAnswers)) &&
    (draft.sections === undefined || isSectionList(draft.sections)) &&
    (draft.sectionOf === undefined || isSectionPlacement(draft.sectionOf)) &&
    (draft.sectionHeadings === undefined || isSectionHeadings(draft.sectionHeadings)) &&
    (draft.headingSize === undefined || isHeadingSize(draft.headingSize)) &&
    (draft.header === undefined || isExamHeader(draft.header)) &&
    (draft.textSize === undefined || isTextSize(draft.textSize)) &&
    (draft.margins === undefined || isPageMargins(draft.margins)) &&
    (draft.paperStyle === undefined || isPaperStyle(draft.paperStyle))
  )
}

// Stored authoring state is trusted only as far as its shape; anything else is
// treated as absent, so a corrupt entry costs the teacher their draft rather
// than the whole app.
function isAuthoringState(value: unknown): value is AuthoringState {
  const state = value as AuthoringState | null
  return (
    typeof state === 'object' &&
    state !== null &&
    typeof state.dirty === 'boolean' &&
    isQuestionBank(state.questionBank) &&
    isWorkingCopy(state.workingCopy)
  )
}

// The Exam settings a Working Copy may carry, each with the guard it is read
// through.
const WORKING_COPY_SETTINGS: Readonly<Record<string, (value: unknown) => boolean>> = {
  columns: isColumnSettings,
  workSpace: isWorkSpaceSettings,
  wordBankLayout: isWordBankLayoutSettings,
  wordBankLayoutSet: isWordBankLayoutChoices,
  pictureSizes: isPictureSizeSettings,
  choiceOrder: isChoiceOrder,
  // The same shape as an order: ids, keyed by question.
  hiddenAnswers: isChoiceOrder,
  sections: isSectionList,
  sectionOf: isSectionPlacement,
  sectionHeadings: isSectionHeadings,
  headingSize: isHeadingSize,
  header: isExamHeader,
  textSize: isTextSize,
  margins: isPageMargins,
  paperStyle: isPaperStyle,
}

// A draft an earlier build stored, in the current shape. Its questions are
// upgraded (see `stored-upgrade.ts`), and a setting this build cannot read —
// the withdrawn rich-text page header, say — is dropped so its default
// applies. Refusing the draft over one setting would load a blank Exam, and
// the first edit would then write that blank over the teacher's work.
function upgradedStoredState(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const state = value as Record<string, unknown>
  const upgraded: Record<string, unknown> = { ...state }
  const bank = state.questionBank as Record<string, unknown> | null | undefined
  if (typeof bank === 'object' && bank !== null && Array.isArray(bank.questions)) {
    upgraded.questionBank = {
      ...bank,
      questions: bank.questions.map((question: unknown) =>
        typeof question === 'object' && question !== null
          ? upgradeStoredQuestion(question as Question)
          : question,
      ),
    }
  }
  const draft = state.workingCopy
  if (typeof draft === 'object' && draft !== null && !Array.isArray(draft)) {
    // A build before ADR-0044 stored the Paper Style under its old name.
    const { questionStyle: legacyStyle, ...rest } = draft as Record<string, unknown>
    const workingCopy: Record<string, unknown> = { ...rest }
    // A build that never shipped stored Paper Details, since withdrawn
    // (ADR-0045): they are dropped rather than carried along unread.
    delete workingCopy.paperDetails
    if (workingCopy.paperStyle === undefined && legacyStyle !== undefined) workingCopy.paperStyle = legacyStyle
    for (const [setting, readable] of Object.entries(WORKING_COPY_SETTINGS)) {
      if (workingCopy[setting] !== undefined && !readable(workingCopy[setting])) {
        delete workingCopy[setting]
      }
    }
    upgraded.workingCopy = workingCopy
  }
  return upgraded
}

function isSavedState(value: unknown): value is SavedState {
  return isAuthoringState({ ...(value as object), dirty: false })
}

/**
 * The authoring boundary.
 *
 * Reads are snapshots: `getState` and `selectedExam` return objects that are
 * new only when something they describe changed, so a React consumer can hold
 * either as a dependency.
 */
export type ExamStore = {
  /** The current authoring state. A new object on every change. */
  getState(): AuthoringState
  /** The Exam and ordering rendering and export consume — the referenced
   *  Question Bank records, in Working Copy order, and nothing else. */
  selectedExam(): SelectedExam
  subscribe(listener: () => void): () => void
  /** Whether the newest Working Copy has reached browser-local storage. */
  backupStatus(): BackupStatus

  setTitle(title: string): void
  /** Rewords one Question Section's heading on this Exam. `null` sets a part
   *  back to its default; an empty string clears it from the printed page. */
  setSectionHeading(sectionId: string, change: SectionHeadingChange): void
  /** Moves one Section past its neighbour, up (`-1`) or down (`1`). */
  moveSection(sectionId: string, direction: -1 | 1): void
  /** Deletes one Section and Removes the questions it holds. Undoable, like
   *  every other action here, so it asks nothing. */
  deleteSection(sectionId: string): void
  /** Starts a new Section at one question: it and the questions after it in
   *  its Section move into a Section of their own directly below. */
  splitSection(questionId: string): void
  /** Makes these questions one new Section, placed where the first of them
   *  is, splitting its Section around them. */
  moveToNewSection(questionIds: readonly string[]): void
  /** Inserts an empty Section above or below one, and returns its id — or
   *  `null` when there is no such Section to insert beside. */
  insertSection(sectionId: string, placement: SectionPlacement): string | null
  /** Merges one Section with its neighbour above (`-1`) or below (`1`), under
   *  this Section's wording; the emptied neighbour is deleted. */
  mergeSection(sectionId: string, direction: -1 | 1): void
  /** How large every section heading prints on this Exam. */
  setHeadingSize(size: HeadingSize): void
  setTextSize(size: TextSize): void
  /** How every question on this Exam prints. Switching never touches a Work
   *  Space the teacher set. */
  setPaperStyle(style: PaperStyle): void
  /** Rewords one test-page header line; `null` restores its default. */
  setHeaderLine(line: HeaderLine, text: string | null): void
  /** Sets how far in from `sides` of the sheet the Exam's pages print, in
   *  inches. A change `continuing` a scrub of a margin field joins the undo
   *  step its first change made, so one drag is one step. */
  setMargins(sides: readonly MarginSide[], inches: number, options?: { continuing?: boolean }): void
  /** Refreshes the canonical Questions projected from open Question Banks.
   * Workspace browsing is not an Exam command and creates no Undo step. */
  syncCanonicalQuestions(questions: readonly Question[]): void
  /** Accepts a deletion already committed by the cross-resource durability
   * boundary. It is not an Exam command and clears history rather than writing
   * an undoable or discardable removal. */
  acceptForcedDeletion(questionIds: readonly string[]): void

  /** Banks canonical Question Content without putting it on the Working Copy. */
  createInQuestionBank(question: Question): void
  /** Replaces one Question Bank record — its Question Content, its Question
   *  Type, its Difficulty and its Topics — wherever it is referenced. One
   *  popup save is one call, so a content edit and a metadata edit made
   *  together are one authoring action. An unbanked question is banked, so a
   *  save is never lost. */
  updateInQuestionBank(question: Question): void
  setQuestionColumns(questionIds: readonly string[], columns: ColumnSetting): void
  /** Sets where the Word Bank of each Matching question in `questionIds`
   *  prints on this Exam — Auto, Beside or Above — as one authoring action.
   *  Any other Question Type is left alone, and Auto is stored as nothing. */
  setWordBankLayout(questionIds: readonly string[], layout: WordBankLayout): void
  /** Changes the room left for work below Short Answer questions — its
   *  height, whether it is blank or ruled, and whether it runs to the foot of
   *  the page — as one authoring action. Only the fields given change; any
   *  other Question Type in `questionIds` is left alone. Work space is Exam
   *  presentation, so the Question Bank is never touched. */
  setQuestionWorkSpace(questionIds: readonly string[], patch: Partial<WorkSpace>): void
  /** How wide this Exam prints one of a question's pictures, named by its
   *  `pictureKey`, as a share of its container; `null` goes back to the
   *  picture's Default Picture Size (ADR-0050). One undoable change. */
  setPictureSize(questionId: string, picture: string, size: number | null): void
  /** References a newly canonical copy immediately after the original while
   * preserving the original's visible Exam presentation. The caller may supply
   * a copy already committed to the owning Question Bank. */
  duplicateInWorkingCopy(questionId: string, duplicate?: Question): void
  /** References an unused Question Bank record from the Working Copy. With no
   *  target it goes to the end of the last Section, or starts the first
   *  Section of an Exam that has none; with one, it goes there, whatever the
   *  Section already holds. A question already referenced is left where it
   *  is: a reference occurs at most once. */
  addToWorkingCopy(question: string | Question, target?: SectionTarget | null): void
  /** Adds several unused records in the supplied order as one undoable
   *  composition. Used by filtered Add all and multi-row bank drags; a question
   *  the target cannot take is not added. */
  addManyToWorkingCopy(
    questions: readonly (string | Question)[],
    target?: SectionTarget | null,
  ): void
  /** Moves references to a target: beside a question, at the end of a
   *  Section, or into a new Section directly below one. A Section holds
   *  Questions of any type, so every requested question moves. A Section a
   *  move empties stays. */
  moveInWorkingCopy(questionIds: readonly string[], target: SectionTarget): void
  /** Shuffles selected references only among their current positions, within
   *  each Question Section. Every eligible section changes order in this one
   *  authoring action. */
  shuffleSelectedQuestions(questionIds: readonly string[]): void
  /** Shuffles each selected eligible Multiple Choice question's answers in one
   *  authoring action. The order belongs to the Working Copy, not Question
   *  Content, so its canonical authored order remains intact. A question that
   *  hides some incorrect answers draws again which ones (ADR-0038). */
  shuffleSelectedAnswers(questionIds: readonly string[]): void
  /** Has each selected Multiple Choice question show `count` of its incorrect
   *  answers, clamped to what each allows; `Infinity` shows them all. Exam
   *  presentation, like answer order: the Question keeps every answer. */
  setShownIncorrect(questionIds: readonly string[], count: number): void
  /** Removes references from the Working Copy, leaving their Question Bank
   *  records exactly as they were. Remove excludes; it never deletes. */
  removeFromWorkingCopy(questionIds: readonly string[]): void
  /** Whether anything has ever been saved — what tells an untouched draft from
   *  an exam with unsaved changes. */
  hasSavedExam(): boolean
  canUndo(): boolean
  canRedo(): boolean
  undo(): void
  redo(): void
  save(): Promise<void>
  /** Creates a separately saved Exam through the caller's one durable
   * transaction, then leaves this source Exam at its saved composition. */
  saveAs(commit: (snapshot: SaveAsSnapshot) => Promise<void>): Promise<SaveAsSession>
  /** Atomically records the current Working Copy alongside newly prepared
   * immutable Export History. It never changes the explicitly saved Exam. */
  publish(record: ExportRecord): Promise<void>
  exportHistory(): ExportHistory
  discard(): Promise<void>

  /** Resolves once every mirrored write has landed. For tests and shutdown. */
  whenSettled(): Promise<void>
}

// The authoring state carrying a new Working Copy — or the very same state when
// the Working Copy refused the change. Every reference operation is total and
// returns the draft it was given when it declines, and this is what turns that
// into "nothing happened": no undo step, no dirty flag and no write, because
// `apply` stops at an unchanged state.
function withExamWorkingCopy(
  state: AuthoringState,
  workingCopy: ExamWorkingCopy,
): AuthoringState {
  return workingCopy === state.workingCopy ? state : { ...state, workingCopy }
}

/** Freeze every referenced Question's current layout into an Exam arrangement.
 * It is used at save time, where an absent legacy setting must not keep
 * following a later canonical-content edit. */
function withResolvedColumns(state: AuthoringState): ExamWorkingCopy {
  const current = state.workingCopy.columns ?? {}
  let changed = false
  const columns = { ...current }
  for (const questionId of state.workingCopy.questionIds) {
    if (columns[questionId] !== undefined) continue
    const question = bankQuestionById(state.questionBank, questionId)
    if (!question) continue
    columns[questionId] = question.columns
    changed = true
  }
  return changed ? { ...state.workingCopy, columns } : state.workingCopy
}

/** Savedness is a composition comparison. Canonical Question Content is live,
 * so it intentionally does not participate: only the Exam name, membership,
 * question order, answer order, column layout, work space and section
 * headings are explicitly saved. */
function sameExamWorkingCopy(left: ExamWorkingCopy, right: ExamWorkingCopy): boolean {
  const sameEntries = <T>(first: Record<string, T> | undefined, second: Record<string, T> | undefined, equal: (left: T, right: T) => boolean) => {
    const firstEntries = Object.entries(first ?? {})
    const secondEntries = second ?? {}
    return firstEntries.length === Object.keys(secondEntries).length
      && firstEntries.every(([id, value]) => secondEntries[id] !== undefined && equal(value, secondEntries[id]!))
  }
  return left.title === right.title
    && left.questionIds.length === right.questionIds.length
    && left.questionIds.every((id, index) => id === right.questionIds[index])
    && sameEntries(left.columns, right.columns, (first, second) => first === second)
    && sameEntries(left.workSpace, right.workSpace, (first, second) =>
      first.height === second.height && first.style === second.style && first.fill === second.fill,
    )
    && sameEntries(left.wordBankLayout, right.wordBankLayout, (first, second) => first === second)
    && sameEntries(left.wordBankLayoutSet, right.wordBankLayoutSet, (first, second) => first === second)
    && sameEntries(left.pictureSizes, right.pictureSizes, (first, second) =>
      sameEntries(first, second, (one, other) => one === other))
    && sameEntries(left.choiceOrder, right.choiceOrder, (first, second) =>
      first.length === second.length && first.every((id, index) => id === second[index]),
    )
    && sameEntries(left.hiddenAnswers, right.hiddenAnswers, (first, second) =>
      first.length === second.length && first.every((id, index) => id === second[index]),
    )
    && sameSections(left.sections, right.sections)
    && sameSectionOf(left.sectionOf, right.sectionOf)
    && sameSectionHeadings(left.sectionHeadings, right.sectionHeadings)
    && (left.headingSize ?? DEFAULT_HEADING_SIZE) === (right.headingSize ?? DEFAULT_HEADING_SIZE)
    && sameExamHeader(left.header, right.header)
    && (left.textSize ?? DEFAULT_TEXT_SIZE) === (right.textSize ?? DEFAULT_TEXT_SIZE)
    && sameMargins(left.margins, right.margins)
    && (left.paperStyle ?? DEFAULT_PAPER_STYLE) === (right.paperStyle ?? DEFAULT_PAPER_STYLE)
}

/** The Part or Subpart that answers with this id, when it belongs to a Multipart question
 *  this Exam references. Its ids and question ids never collide — all are fresh
 *  UUIDs — so a presentation setting addressed to one can tell which it is by
 *  looking. A Part that holds Subparts answers nothing, so has nothing to set. */
function referencedPartOf(state: AuthoringState, id: string): Subpart | undefined {
  for (const questionId of state.workingCopy.questionIds) {
    const question = bankQuestionById(state.questionBank, questionId)
    const part = question
      ? answeringPartsOf(question).find((candidate) => candidate.id === id)
      : undefined
    if (part) return part
  }
  return undefined
}

/** A duplicate Multipart question looks like its original on the sheet: each of its
 *  Parts and Subparts takes the answer order, columns and work space its
 *  original had here, under the copy's fresh ids. */
function withPartPresentationCopied(
  workingCopy: ExamWorkingCopy,
  original: Question,
  copy: Question,
  arrangement: Arrangement,
): ExamWorkingCopy {
  const originalParts = answeringPartsOf(original)
  const copiedParts = answeringPartsOf(copy)
  if (originalParts.length === 0) return workingCopy
  const columns = { ...(workingCopy.columns ?? {}) }
  const workSpace = { ...(workingCopy.workSpace ?? {}) }
  const choiceOrder = { ...(workingCopy.choiceOrder ?? {}) }
  originalParts.forEach((part, index) => {
    const copied = copiedParts[index]
    if (!copied) return
    const partColumns = workingCopy.columns?.[part.id]
    if (partColumns !== undefined) columns[copied.id] = partColumns
    const space = workingCopy.workSpace?.[part.id]
    if (space !== undefined) workSpace[copied.id] = space
    if (arrangement.choiceOrder[part.id]) {
      choiceOrder[copied.id] = orderedPartChoices(part, arrangement).map(
        (choice) => copied.choices[part.choices.findIndex(({ id }) => id === choice.id)]!.id,
      )
    }
  })
  return {
    ...workingCopy,
    columns,
    choiceOrder,
    ...(Object.keys(workSpace).length > 0 ? { workSpace } : {}),
  }
}

function withDirtyFlag(current: AuthoringState, saved: SavedState | null): AuthoringState {
  const dirty = !saved || !sameExamWorkingCopy(current.workingCopy, saved.workingCopy)
  return current.dirty === dirty ? current : { ...current, dirty }
}

/**
 * Adds canonical references and puts them in their Sections, without crossing
 * the history boundary.
 *
 * With a target, every question lands there, in the order given. Without one —
 * Add and Add all — they go to the end of the last Section, and on an Exam
 * with no Section yet, into one new one, worded by `newSectionWordingOf`. A
 * question already referenced is left where it is: a reference occurs at most
 * once, so adding one twice is not a move.
 */
function withQuestionsAdded(
  current: AuthoringState,
  questionsOrIds: readonly (string | Question)[],
  target: SectionTarget | null,
  bankAnswerWidth?: BankAnswerWidth,
): AuthoringState {
  let bank = current.questionBank
  // An Exam written before Sections were stored has them stored first, as
  // they print, so what is added joins one of them rather than a new Section
  // of its own type beside them.
  const prior = selectedExam(bank, current.workingCopy)
  const hadSections = sectionsOf(prior.exam).length > 0
  let workingCopy = hadSections
    ? withSectionLayout(current.workingCopy, sectionLayoutOf(prior.exam, prior.arrangement))
    : current.workingCopy
  const added: Question[] = []
  for (const item of questionsOrIds) {
    const supplied = typeof item === 'string' ? null : item
    const questionId = typeof item === 'string' ? item : item.id
    const question = supplied ?? bankQuestionById(bank, questionId)
    if (!question) continue
    const referenced = withReferenceAdded(workingCopy, questionId)
    if (referenced === workingCopy) continue
    if (supplied) bank = withQuestionBanked(bank, supplied)
    workingCopy = referenced
    added.push(question)
  }
  if (added.length === 0) return current

  if (!hadSections) {
    // An Exam with nothing on it: whatever arrives, however it was asked for,
    // starts its first Section, in the order given — never sorted by type, and
    // never split into a Section per type — worded for their type when they
    // share one, and untitled when they mix.
    const section: ExamSection = {
      id: crypto.randomUUID(),
      ...newSectionWordingOf(added.map(({ type }) => type), workingCopy.sectionHeadings),
    }
    workingCopy = withSectionLayout(workingCopy, {
      sections: [section],
      sectionOf: Object.fromEntries(added.map(({ id }) => [id, section.id])),
      questionOrder: added.map(({ id }) => id),
    })
  } else {
    // Stored even when the questions already landed where they were put, so a
    // Section made later can never draw an unplaced question into itself. A
    // question on the Exam belongs to its last Section until placed, so that
    // is where Add puts it.
    const { exam, arrangement } = selectedExam(bank, workingCopy)
    const to: SectionTarget = target ?? {
      kind: 'section-end',
      sectionId: sectionsOf(exam).at(-1)!.id,
    }
    const layout =
      placeQuestions(exam, arrangement, added.map(({ id }) => id), to)
      ?? sectionLayoutOf(exam, arrangement)
    workingCopy = withSectionLayout(workingCopy, layout)
  }
  return {
    ...current,
    questionBank: bank,
    workingCopy: withWordBankLayouts(
      bank,
      withInsertedColumns(bank, workingCopy, added),
      added.map(({ id }) => id),
      bankAnswerWidth,
    ),
  }
}

/** Each of `questionIds` that is a Matching question on this Exam takes the
 *  Word Bank layout its Paper Style and the fit rule give it now
 *  (`wordBankLayoutFor`), replacing any it had: how a Matching position gets
 *  its layout when it arrives, and how a change of style places again every
 *  one the teacher did not choose. */
function withWordBankLayouts(
  bank: QuestionBank,
  workingCopy: ExamWorkingCopy,
  questionIds: readonly string[],
  bankAnswerWidth: BankAnswerWidth | undefined,
): ExamWorkingCopy {
  const prior = workingCopy.wordBankLayout ?? {}
  let next: Record<string, WordBankLayout> | null = null
  for (const questionId of questionIds) {
    if (!workingCopy.questionIds.includes(questionId)) continue
    const question = bankQuestionById(bank, questionId)
    if (question?.type !== 'matching') continue
    const layout = wordBankLayoutFor(question, workingCopy, bankAnswerWidth)
    if (prior[questionId] === layout) continue
    next ??= { ...prior }
    next[questionId] = layout
  }
  return next ? { ...workingCopy, wordBankLayout: next } : workingCopy
}

/** An inserted Multiple Choice question starts with the answer columns of the
 *  question printed immediately above it, or immediately below when none is
 *  above, or with one column when it has no neighbour of its type. */
function withInsertedColumns(
  bank: QuestionBank,
  workingCopy: ExamWorkingCopy,
  added: readonly Question[],
): ExamWorkingCopy {
  let next = workingCopy
  const adding = new Set(added.map(({ id }) => id))
  const { exam, arrangement } = selectedExam(bank, workingCopy)
  const printed = orderedQuestions(exam, arrangement).filter(
    ({ type }) => type === 'multiple-choice',
  )
  for (const [index, question] of printed.entries()) {
    if (!adding.has(question.id)) continue
    const above = printed.slice(0, index).reverse()[0]
    const below = printed.slice(index + 1).find(({ id }) => !adding.has(id))
    const neighbor = above ?? below
    const columns = neighbor
      ? next.columns?.[neighbor.id] ?? columnsOf(neighbor)
      : 1
    next = { ...next, columns: { ...(next.columns ?? {}), [question.id]: columns } }
  }
  return next
}

export type SaveAsSnapshot = {
  sourceRestored: AuthoringState
  targetInitial: AuthoringState
}

/** Session-only history that moves with Save As rather than being persisted. */
export type SaveAsSession = {
  initial: AuthoringState
  history: { undo: AuthoringState[]; redo: AuthoringState[] }
}

export function createExamStore(options: {
  backend: Backend<AuthoringState>
  savedBackend?: Backend<SavedState>
  saved?: SavedState | null
  exportHistory?: ExportHistory
  initial?: AuthoringState
  initialHistory?: { undo: AuthoringState[]; redo: AuthoringState[] }
  /** Measures a Word Bank answer, so a Matching question takes the layout
   *  that fits when it arrives or the style changes (`wordBankLayoutFor`).
   *  The editor passes `domMeasure`'s; without it, a bank is placed by its
   *  count. Only ever read inside an action, whose result is stored, so undo,
   *  redo and every Layout Plan read the same layout back. */
  bankAnswerWidth?: BankAnswerWidth
}): ExamStore {
  const { backend, savedBackend, bankAnswerWidth } = options
  const durableBackend = 'commitSaved' in backend
    ? (backend as DurableAuthoringBackend)
    : null
  const initialState = options.initial ?? createAuthoringState()
  // Every Exam has a saved composition. The fallback also gives pre-ticket
  // records (and narrow in-memory test stores) a stable initial baseline.
  let saved: SavedState | null = options.saved ?? {
    questionBank: initialState.questionBank,
    workingCopy: initialState.workingCopy,
  }
  let state: AuthoringState = withDirtyFlag(initialState, saved)
  let exportHistory = options.exportHistory ?? EMPTY_EXPORT_HISTORY
  // The derived Exam, kept beside the state it was derived from. Deriving it
  // once per change rather than once per read is what lets a consumer treat it
  // as a stable dependency; `selectedExam` reuses the halves that did not move.
  let selected: SelectedExam = selectedExam(state.questionBank, state.workingCopy)
  const listeners = new Set<() => void>()
  let pending: Promise<void> = Promise.resolve()
  let backupStatus: BackupStatus = 'ready'
  let backupRevision = 0
  const undoStack: AuthoringState[] = [...(options.initialHistory?.undo ?? [])]
  const redoStack: AuthoringState[] = [...(options.initialHistory?.redo ?? [])]
  const HISTORY_LIMIT = 100

  // Generic backends are chained so their writes cannot overtake one another.
  // The durable IndexedDB backend starts each transaction immediately; the
  // database queues overlapping read/write transactions in creation order.
  // Starting them here matters at navigation time: a second authored question
  // must already be inside IndexedDB's durability boundary when Reload begins,
  // not waiting behind a promise for the first transaction.
  const notify = () => {
    for (const listener of listeners) listener()
  }

  const mirror = () => {
    const snapshot = state
    const revision = ++backupRevision
    backupStatus = 'pending'
    const write = durableBackend
      ? backend.write(snapshot)
      : pending.then(() => backend.write(snapshot))
    pending = Promise.all([pending, write])
      .then(() => {
        if (revision === backupRevision) {
          backupStatus = 'ready'
          notify()
        }
      })
      .catch((error: unknown) => {
        console.error('Could not mirror the authoring state', error)
        if (revision === backupRevision) {
          backupStatus = 'failed'
          notify()
        }
      })
  }

  const settle = (next: AuthoringState) => {
    state = withDirtyFlag(next, saved)
    selected = selectedExam(state.questionBank, state.workingCopy, selected)
    mirror()
    notify()
  }

  // Every write goes through here: it is the single place the authoring state
  // is mirrored and subscribers are told.
  const apply = (
    next: (state: AuthoringState) => AuthoringState,
    _dirty: boolean,
    recordHistory = false,
  ) => {
    const updated = next(state)
    if (updated === state) return
    if (recordHistory) {
      undoStack.push(state)
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
      redoStack.length = 0
    }
    settle(updated)
  }

  // One semantic authoring action: the single place the dirty flag is raised,
  // and the single place a step is pushed onto the undo stack. Every boundary
  // method below is exactly one call to this, which is what makes one teacher
  // action one undo step.
  const change = (next: (state: AuthoringState) => AuthoringState) =>
    apply(next, true, true)

  const restoreHistory = (
    source: AuthoringState[],
    destination: AuthoringState[],
  ) => {
    const historicalAuthoringState = source.pop()
    if (!historicalAuthoringState) return
    destination.push(state)
    settle(historicalAuthoringState)
  }

  const syncHistoryQuestion = (snapshot: AuthoringState, question: Question): AuthoringState => {
    const projected = withCanonicalQuestionProjection(snapshot, null, question).working
    return projected.questionBank === snapshot.questionBank && projected.workingCopy === snapshot.workingCopy
      ? snapshot
      : projected
  }

  const store: ExamStore = {
    getState: () => state,
    selectedExam: () => selected,
    backupStatus: () => backupStatus,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    setTitle: (title) =>
      change((current) =>
        title === current.workingCopy.title
          ? current
          : { ...current, workingCopy: { ...current.workingCopy, title } },
      ),

    setSectionHeading: (sectionId, headingChange) =>
      change((current) => {
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const layout = rewordSection(exam, arrangement, sectionId, headingChange)
        return layout
          ? withExamWorkingCopy(current, withSectionLayout(current.workingCopy, layout))
          : current
      }),

    setHeadingSize: (size) =>
      change((current) => {
        if ((current.workingCopy.headingSize ?? DEFAULT_HEADING_SIZE) === size) return current
        // The default is stored as its absence, like every other default here.
        const workingCopy: ExamWorkingCopy = { ...current.workingCopy, headingSize: size }
        if (size === DEFAULT_HEADING_SIZE) delete workingCopy.headingSize
        return { ...current, workingCopy }
      }),

    setTextSize: (size) =>
      change((current) => {
        if ((current.workingCopy.textSize ?? DEFAULT_TEXT_SIZE) === size) return current
        const workingCopy: ExamWorkingCopy = { ...current.workingCopy, textSize: size }
        if (size === DEFAULT_TEXT_SIZE) delete workingCopy.textSize
        return { ...current, workingCopy }
      }),

    setPaperStyle: (style) =>
      change((current) => {
        if ((current.workingCopy.paperStyle ?? DEFAULT_PAPER_STYLE) === style) return current
        const styled: ExamWorkingCopy = { ...current.workingCopy, paperStyle: style }
        if (style === DEFAULT_PAPER_STYLE) delete styled.paperStyle
        // Switching style never changes what the teacher set (ADR-0044): every
        // Matching question's Word Bank goes where the new style and the fit
        // rule put it, in the same undoable step, except one the teacher
        // chose. The rule is deterministic, so switching back restores them.
        const chosen = styled.wordBankLayoutSet ?? {}
        const workingCopy = withWordBankLayouts(
          current.questionBank,
          styled,
          styled.questionIds.filter((id) => chosen[id] !== true),
          bankAnswerWidth,
        )
        return { ...current, workingCopy }
      }),

    setHeaderLine: (line, text) =>
      change((current) => {
        const header = withHeaderLine(current.workingCopy.header, line, text)
        if (sameExamHeader(header, current.workingCopy.header)) return current
        const workingCopy: ExamWorkingCopy = { ...current.workingCopy, header }
        if (!header) delete workingCopy.header
        return { ...current, workingCopy }
      }),

    setMargins: (sides, inches, options) =>
      apply((current) => {
        const margins = withMargin(current.workingCopy.margins, sides, inches)
        if (sameMargins(margins, current.workingCopy.margins)) return current
        const workingCopy: ExamWorkingCopy = { ...current.workingCopy, margins }
        if (!margins) delete workingCopy.margins
        return { ...current, workingCopy }
      }, true, !options?.continuing),

    syncCanonicalQuestions: (questions) => {
      let working = state
      let nextSaved = saved
      for (const question of questions) {
        if (!working.questionBank.questions.some((candidate) => candidate.id === question.id)) {
          const bank = withQuestionBanked(working.questionBank, question)
          working = bank === working.questionBank ? working : { ...working, questionBank: bank }
          continue
        }
        const projected = withCanonicalQuestionProjection(working, nextSaved, question)
        working = projected.working
        nextSaved = projected.saved
        for (let index = 0; index < undoStack.length; index += 1) {
          undoStack[index] = syncHistoryQuestion(undoStack[index]!, question)
        }
        for (let index = 0; index < redoStack.length; index += 1) {
          redoStack[index] = syncHistoryQuestion(redoStack[index]!, question)
        }
      }
      if (working === state) return
      state = working
      saved = nextSaved
      selected = selectedExam(state.questionBank, state.workingCopy, selected)
      notify()
    },

    acceptForcedDeletion: (questionIds) => {
      const deleted = withoutQuestions(state, saved, new Set(questionIds))
      state = deleted.working
      saved = deleted.saved
      selected = selectedExam(state.questionBank, state.workingCopy, selected)
      undoStack.length = 0
      redoStack.length = 0
      notify()
    },

    createInQuestionBank: (question) =>
      change((current) => ({
        ...current,
        questionBank: withQuestionBanked(current.questionBank, question),
      })),

    updateInQuestionBank: (question) =>
      change((current) => {
        // A Question Content edit must not silently revise this Exam's answer
        // layout. Capture its current effective setting before replacing the
        // canonical record, including for working copies written before the
        // setting moved onto the Working Copy.
        const prior = bankQuestionById(current.questionBank, question.id)
        if (prior && prior.type !== question.type) return current
        const columns = current.workingCopy.columns ?? {}
        const workingCopy = current.workingCopy.questionIds.includes(question.id)
          && columns[question.id] === undefined
          && prior
          ? {
              ...current.workingCopy,
              columns: { ...columns, [question.id]: prior.columns },
            }
          : current.workingCopy
        return {
          ...current,
          questionBank: withQuestionBanked(current.questionBank, question),
          workingCopy,
        }
      }),

    setQuestionColumns: (questionIds, columns) => {
      const targeted = new Set(questionIds)
      change((current) => {
        const currentColumns = current.workingCopy.columns ?? {}
        let changed = false
        const nextColumns = { ...currentColumns }
        for (const questionId of targeted) {
          // A Multiple Choice Part of a Multipart question on this Exam lays its answers
          // out under its own id, as a question does under its.
          const part = referencedPartOf(current, questionId)
          if (part && part.type !== 'multiple-choice') continue
          if (!part && !current.workingCopy.questionIds.includes(questionId)) continue
          const effectiveColumns = nextColumns[questionId]
            ?? part?.columns
            ?? bankQuestionById(current.questionBank, questionId)?.columns
          if (effectiveColumns === columns) continue
          nextColumns[questionId] = columns
          changed = true
        }
        return changed
          ? { ...current, workingCopy: { ...current.workingCopy, columns: nextColumns } }
          : current
      })
    },

    setWordBankLayout: (questionIds, layout) => {
      change((current) => {
        const next = { ...(current.workingCopy.wordBankLayout ?? {}) }
        // The teacher chose it, so a change of style leaves it (ADR-0044).
        const chosen = { ...(current.workingCopy.wordBankLayoutSet ?? {}) }
        let changed = false
        for (const questionId of new Set(questionIds)) {
          if (!current.workingCopy.questionIds.includes(questionId)) continue
          const question = bankQuestionById(current.questionBank, questionId)
          if (question?.type !== 'matching') continue
          // What the position prints now, a layout stored before every
          // position carried one included.
          if (wordBankLayoutOf(current.workingCopy, question) === layout) continue
          next[questionId] = layout
          chosen[questionId] = true
          changed = true
        }
        return changed
          ? {
              ...current,
              workingCopy: { ...current.workingCopy, wordBankLayout: next, wordBankLayoutSet: chosen },
            }
          : current
      })
    },

    setPictureSize: (questionId, picture, size) => {
      change((current) => {
        if (!current.workingCopy.questionIds.includes(questionId)) return current
        const sizes = { ...(current.workingCopy.pictureSizes?.[questionId] ?? {}) }
        if (size === null) {
          if (sizes[picture] === undefined) return current
          delete sizes[picture]
        } else {
          const clamped = clampSize(size)
          if (sizes[picture] === clamped) return current
          sizes[picture] = clamped
        }
        const pictureSizes = { ...(current.workingCopy.pictureSizes ?? {}) }
        if (Object.keys(sizes).length > 0) pictureSizes[questionId] = sizes
        else delete pictureSizes[questionId]
        const workingCopy = { ...current.workingCopy }
        if (Object.keys(pictureSizes).length > 0) workingCopy.pictureSizes = pictureSizes
        else delete workingCopy.pictureSizes
        return { ...current, workingCopy }
      })
    },

    setQuestionWorkSpace: (questionIds, patch) => {
      const targeted = new Set(questionIds)
      change((current) => {
        const currentSpaces = current.workingCopy.workSpace ?? {}
        let changed = false
        const nextSpaces = { ...currentSpaces }
        for (const questionId of targeted) {
          // A Short Answer Part of a Multipart question on this Exam leaves room under
          // its own id, as a Short Answer question does under its.
          const part = referencedPartOf(current, questionId)
          if (part) {
            if (part.type !== 'open') continue
          } else {
            if (!current.workingCopy.questionIds.includes(questionId)) continue
            const question = bankQuestionById(current.questionBank, questionId)
            if (!question || !takesWorkSpace(question.type)) continue
          }
          // What the position prints now: its own setting, or its Paper
          // Style's default when it has none.
          const style = current.workingCopy.paperStyle
          const prior = workSpaceIn(currentSpaces, style, questionId)
          const next: WorkSpace = {
            height: snapWorkSpaceHeight(patch.height ?? prior.height),
            style: patch.style ?? prior.style,
            fill: patch.fill ?? prior.fill,
          }
          // "None" picked for a position that sets nothing is the teacher's
          // own setting even where it prints what the style already prints:
          // stored as a zero-height Work Space, it stays none when the Exam
          // later takes a style that rules lines (ADR-0044). A position the
          // teacher never touched keeps storing nothing.
          const choosesNone = !hasWorkSpace(next) && !isWorkSpace(currentSpaces[questionId])
          if (
            next.height === prior.height
            && next.style === prior.style
            && next.fill === prior.fill
            && !choosesNone
          ) continue
          nextSpaces[questionId] = next
          changed = true
        }
        return changed
          ? { ...current, workingCopy: { ...current.workingCopy, workSpace: nextSpaces } }
          : current
      })
    },

    duplicateInWorkingCopy: (questionId, suppliedCopy) =>
      change((current) => {
        const original = bankQuestionById(current.questionBank, questionId)
        if (!original || !current.workingCopy.questionIds.includes(questionId)) return current
        const copy = suppliedCopy ?? duplicateQuestion(original)
        if (bankQuestionById(current.questionBank, copy.id)) return current
        const selected = selectedExam(current.questionBank, current.workingCopy)
        const visibleOriginal = selected.exam.questions.find(({ id }) => id === questionId)
        const originalChoices = choicesOf(original)
        const copiedChoices = choicesOf(copy)
        const copiedChoiceOrder = orderedChoices(original, selected.arrangement).map((choice) =>
          copiedChoices[originalChoices.findIndex(({ id }) => id === choice.id)]!.id,
        )
        // It hides the answers its original hides, under their new ids.
        const copiedHidden = hiddenAnswerIdsOf(original, selected.arrangement).map((id) =>
          copiedChoices[originalChoices.findIndex((choice) => choice.id === id)]!.id,
        )
        const referenced = withReferenceAdded(current.workingCopy, copy.id, questionId)
        const workingCopy = withPartPresentationCopied(
          // The copy sits in its original's Section, directly after it.
          visibleOriginal
            ? {
                ...referenced,
                sectionOf: {
                  ...(referenced.sectionOf ?? {}),
                  [copy.id]: sectionIdOf(selected.exam, visibleOriginal),
                },
              }
            : referenced,
          original,
          copy,
          selected.arrangement,
        )
        return {
          ...current,
          questionBank: withQuestionBanked(current.questionBank, copy),
          workingCopy: {
            ...workingCopy,
            columns: {
              ...(workingCopy.columns ?? {}),
              [copy.id]: visibleOriginal ? columnsOf(visibleOriginal) : columnsOf(original),
            },
            choiceOrder: {
              ...(workingCopy.choiceOrder ?? {}),
              [copy.id]: copiedChoiceOrder,
            },
            ...(copiedHidden.length > 0
              ? { hiddenAnswers: { ...(workingCopy.hiddenAnswers ?? {}), [copy.id]: copiedHidden } }
              : {}),
            // A duplicate looks like its original on the sheet, work space
            // and Word Bank layout included.
            ...(original.type === 'matching'
              ? {
                  wordBankLayout: {
                    ...(workingCopy.wordBankLayout ?? {}),
                    [copy.id]: wordBankLayoutOf(selected.exam, original),
                  },
                }
              : {}),
            // And so does whether the teacher chose that layout.
            ...(workingCopy.wordBankLayoutSet?.[questionId] === true
              ? { wordBankLayoutSet: { ...workingCopy.wordBankLayoutSet, [copy.id]: true as const } }
              : {}),
            ...(workingCopy.workSpace?.[questionId]
              ? {
                  workSpace: {
                    ...workingCopy.workSpace,
                    [copy.id]: workingCopy.workSpace[questionId]!,
                  },
                }
              : {}),
            // Its pictures are the same pictures, at the sizes this Exam gave
            // them.
            ...(workingCopy.pictureSizes?.[questionId]
              ? {
                  pictureSizes: {
                    ...workingCopy.pictureSizes,
                    [copy.id]: { ...workingCopy.pictureSizes[questionId]! },
                  },
                }
              : {}),
          },
        }
      }),

    addToWorkingCopy: (questionOrId, target = null) =>
      change((current) => withQuestionsAdded(current, [questionOrId], target, bankAnswerWidth)),

    addManyToWorkingCopy: (questions, target = null) =>
      change((current) => withQuestionsAdded(current, questions, target, bankAnswerWidth)),

    moveInWorkingCopy: (questionIds, target) =>
      change((current) => {
        // Where a question may go is the Exam's own rule — a Section holds one
        // type — so the move is resolved against the derived Exam and its
        // result recorded as the Working Copy's Sections and order.
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const layout = placeQuestions(exam, arrangement, questionIds, target)
        return layout
          ? withExamWorkingCopy(current, withSectionLayout(current.workingCopy, layout))
          : current
      }),

    moveSection: (sectionId, direction) =>
      change((current) => {
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const layout = moveSection(exam, arrangement, sectionId, direction)
        return layout
          ? withExamWorkingCopy(current, withSectionLayout(current.workingCopy, layout))
          : current
      }),

    deleteSection: (sectionId) =>
      change((current) => {
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const deleted = deleteSection(exam, arrangement, sectionId)
        if (!deleted) return current
        // Deleting a Section Removes its questions: they leave this Exam and
        // stay in their Question Bank.
        const removed = withReferencesRemoved(
          withSectionLayout(current.workingCopy, deleted.layout),
          deleted.removedQuestionIds,
          deleted.removedQuestionIds.flatMap((id) => {
            const question = bankQuestionById(current.questionBank, id)
            return question ? presentationIdsOf(question).slice(1) : []
          }),
        )
        return withExamWorkingCopy(current, removed)
      }),

    splitSection: (questionId) =>
      change((current) => {
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const layout = splitSection(exam, arrangement, questionId)
        return layout
          ? withExamWorkingCopy(current, withSectionLayout(current.workingCopy, layout))
          : current
      }),

    moveToNewSection: (questionIds) =>
      change((current) => {
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const layout = moveToNewSection(exam, arrangement, questionIds)
        return layout
          ? withExamWorkingCopy(current, withSectionLayout(current.workingCopy, layout))
          : current
      }),

    insertSection: (sectionId, placement) => {
      // The new Section's id is what the sheet focuses its heading by, so it
      // is read back out of the one change that makes it.
      let inserted: string | null = null
      change((current) => {
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const made = insertSection(exam, arrangement, sectionId, placement)
        if (!made) return current
        inserted = made.sectionId
        return withExamWorkingCopy(current, withSectionLayout(current.workingCopy, made.layout))
      })
      return inserted
    },

    mergeSection: (sectionId, direction) =>
      change((current) => {
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const layout = mergeSection(exam, arrangement, sectionId, direction)
        return layout
          ? withExamWorkingCopy(current, withSectionLayout(current.workingCopy, layout))
          : current
      }),

    shuffleSelectedQuestions: (questionIds) =>
      change((current) => {
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const shuffled = shuffleSelectedQuestions(exam, arrangement, questionIds, Math.random)
        if (shuffled === arrangement) return current
        return withExamWorkingCopy(
          current,
          withReferenceOrder(current.workingCopy, shuffled.questionOrder),
        )
      }),

    shuffleSelectedAnswers: (questionIds) =>
      change((current) => {
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const shuffled = varySelectedAnswers(exam, arrangement, questionIds, Math.random)
        if (shuffled === arrangement) return current
        return withExamWorkingCopy(
          current,
          withHiddenAnswers(
            withChoiceOrder(current.workingCopy, shuffled.choiceOrder),
            shuffled.hiddenAnswers ?? {},
          ),
        )
      }),

    setShownIncorrect: (questionIds, count) =>
      change((current) => {
        const { exam, arrangement } = selectedExam(current.questionBank, current.workingCopy)
        const next = withShownIncorrect(exam, arrangement, questionIds, count, Math.random)
        if (next === arrangement) return current
        return withExamWorkingCopy(
          current,
          withHiddenAnswers(current.workingCopy, next.hiddenAnswers ?? {}),
        )
      }),

    removeFromWorkingCopy: (questionIds) =>
      change((current) =>
        withExamWorkingCopy(
          current,
          withReferencesRemoved(
            current.workingCopy,
            questionIds,
            questionIds.flatMap((id) => {
              const question = bankQuestionById(current.questionBank, id)
              return question ? presentationIdsOf(question).slice(1) : []
            }),
          ),
        ),
      ),

    hasSavedExam: () => saved !== null,

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo: () => restoreHistory(undoStack, redoStack),
    redo: () => restoreHistory(redoStack, undoStack),

    saveAs: async (commit) => {
      await pending
      const working = state
      const sourceSaved = saved
      const copiedTitle = `${working.workingCopy.title} Copy`
      const targetInitial: AuthoringState = {
        ...working,
        // A newly explicit saved composition must freeze any inherited answer
        // column settings exactly as Save does.
        workingCopy: { ...withResolvedColumns(working), title: copiedTitle },
        dirty: false,
      }
      // Question Content remains live when restoring an arrangement: Save As
      // must not roll canonical edits back merely because the source's saved
      // composition predates them.
      const sourceRestored: AuthoringState = {
        ...working,
        workingCopy: sourceSaved?.workingCopy ?? createWorkingCopy(working.workingCopy.title),
        dirty: false,
      }
      const history = { undo: [...undoStack], redo: [...redoStack] }
      await commit({ sourceRestored, targetInitial })
      state = withDirtyFlag(sourceRestored, sourceSaved)
      selected = selectedExam(state.questionBank, state.workingCopy, selected)
      undoStack.length = 0
      redoStack.length = 0
      notify()
      return { initial: targetInitial, history }
    },

    save: async () => {
      if (saved && !state.dirty) return
      await pending
      const savingState = state
      const nextSaved: SavedState = {
        questionBank: savingState.questionBank,
        workingCopy: withResolvedColumns(savingState),
      }
      await (durableBackend
        ? durableBackend.commitSaved(nextSaved)
        : savedBackend?.write(nextSaved))
      saved = nextSaved
      // A new authoring action may have happened while durable Save was in
      // flight. It is ordered after the saved transaction and remains dirty;
      // only the exact state that was saved can be marked clean.
      if (state !== savingState) {
        settle(state)
        return
      }
      if (durableBackend) {
        state = withDirtyFlag({ ...state, workingCopy: nextSaved.workingCopy }, saved)
        selected = selectedExam(state.questionBank, state.workingCopy, selected)
        notify()
      } else {
        settle({ ...state, workingCopy: nextSaved.workingCopy })
        await pending
      }
    },

    publish: async (record) => {
      await pending
      if (durableBackend) await durableBackend.commitExportRecord(record)
      exportHistory = { records: [...exportHistory.records, record] }
      notify()
    },

    exportHistory: () => exportHistory,

    discard: async () => {
      // Discard restores this Exam's saved composition, but Question Content is
      // canonical and live. A later typo fix therefore remains visible rather
      // than being rolled back with this Exam's arrangement.
      const savedDraft = saved?.workingCopy ?? createWorkingCopy(state.workingCopy.title)
      const restored: AuthoringState = {
        ...state,
        workingCopy: savedDraft,
      }
      undoStack.length = 0
      redoStack.length = 0
      apply(() => restored, false)
      await pending
    },

    whenSettled: () => pending,
  }

  return store
}

// Restore the authoring state the teacher left behind, or start a clean one.
export async function loadExamStore(
  backend: Backend<AuthoringState>,
  savedBackend?: Backend<SavedState>,
  bankAnswerWidth?: BankAnswerWidth,
): Promise<ExamStore> {
  let stored: AuthoringState | null = null
  let saved: SavedState | null = null
  let exportHistory: ExportHistory = EMPTY_EXPORT_HISTORY
  try {
    stored = upgradedStoredState(await backend.read()) as AuthoringState | null
  } catch (error) {
    console.error('Could not read the authoring state', error)
  }
  try {
    const storedSaved = upgradedStoredState('readSaved' in backend
      ? await (backend as DurableAuthoringBackend).readSaved()
      : (await savedBackend?.read()) ?? null)
    saved = isSavedState(storedSaved) ? storedSaved : null
  } catch (error) {
    console.error('Could not read the saved exam', error)
  }
  try {
    exportHistory = 'readExportHistory' in backend
      ? await (backend as DurableAuthoringBackend).readExportHistory()
      : EMPTY_EXPORT_HISTORY
  } catch (error) {
    console.error('Could not read Export History', error)
  }
  const initial = isAuthoringState(stored)
    ? stored
    : saved
      ? { ...saved, dirty: false }
      : createAuthoringState()
  return createExamStore({
    backend,
    savedBackend,
    saved,
    initial,
    exportHistory,
    bankAnswerWidth,
  })
}
