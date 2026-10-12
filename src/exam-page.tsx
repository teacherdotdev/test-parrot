// The exam page: what the teacher looks at, and what the printer prints.
//
// This is the print Export Adapter: everything on it comes from the Layout Plan
// `export-plan.ts` returns, so this file only decides what a planned page looks
// like — never what is on it, in what order, or under which number. Nothing
// here is typeable: a double-click opens the question dialog instead, and every
// editing control lives in chrome that print hides.
//
// A page is a real sheet: fixed at the geometry `export-plan.ts` packed
// against, published to CSS as custom properties so the two cannot drift, with
// the furniture — the identity line, the title, the page number — drawn from
// the plan's own `PageFurniture` rather than being content that packs. The DOCX
// adapter prints the same furniture from the same field.
//
// The one asynchronous thing on this page is measurement, and it is the reason
// `pages` is state rather than a value computed during render: see
// `usePaginatedExam`.

import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import {
  AnswerKeyEntry,
  AnswerKeyHeading,
  AnswerKeySection,
  PaperTotalContent,
  PageFooterContent,
  PageHeaderContent,
  PageItemMeasureView,
  QuestionContent,
  SectionHeadingContent,
  WorkSpaceView,
  type IdentityLineEditor,
  type RenderPrintedPoints,
} from './page-item-view'
import { headerLineOf, type HeaderLine } from './page-header'
import { pageContentStyle } from './export-typography'
import { pageGeometry } from './page-geometry'
import {
  US_LETTER,
  maxWorkSpaceHeight,
  runningHeadHeight,
  numberLabelOf,
  planExport,
  rowsOfPlanned,
  unmeasured,
  type ExportContentSelection,
  type LayoutPlan,
  type PageHeader,
  type PlannedPage,
  type PageItem,
  type QuestionItem,
  type SectionHeadingItem,
  type PlannedQuestion,
  type PlannedWorkSpace,
  answeringPartsIn,
  wordBankLayoutOf,
} from './export-plan'
import {
  DEFAULT_COLUMNS,
  columnsOf,
  hasWorkSpace,
  laidWorkSpaceHeight,
  rowsIn,
  storedWorkSpaceHeight,
  takesWorkSpace,
  WORK_SPACE_LINE_PITCH,
  moveToNewSection,
  questionsInSection,
  sectionsOf,
  splitSection,
  workSpaceOf,
  type ColumnSetting,
  type WordBankLayout,
  type SectionPlacement,
  type Exam,
  type Arrangement,
  type WorkSpace,
} from './exam'
import type { Selection } from './use-selection'
import { selectAllPaneProps, useSelectAll } from './use-select-all'
import { distinctIds } from './select-all'
import { useQuestionClipboard } from './use-question-clipboard'
import { SheetPiecesContext, SheetQuestionContext, spacePieceOf, type SheetPiece, type SheetPieces } from './sheet-pieces-context'
import { answerVisibilityNote } from './hidden-answers'
import { pointsLabel, parsePointsInput } from './points'
import { shownIncorrectChoices, shownIncorrectMenuOf, type ShownIncorrectMenu } from './question-menu'
import type { SectionHeadingChange } from './section-headings'
import { sectionHeadingStyles } from './export-typography'
import type { WorkspaceDrag } from './use-workspace-drag'
import { dropStateOf, type QuestionDropState } from './workspace-drag'
import {
  dragged,
  NO_WORK_SPACE_PREVIEWS,
  released,
  settled,
  shownHeight,
  type SheetState,
} from './work-space-preview'
import {
  AlignJustify,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Ban,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  CircleMinus,
  Columns2,
  Copy,
  Ellipsis,
  EyeOff,
  EllipsisVertical,
  FoldVertical,
  ImageIcon,
  ListRestart,
  Pencil,
  PencilLine,
  Heading,
  Rows2,
  Shuffle,
  SquareDashed,
  X,
} from 'lucide-react'
import { ColumnLayoutIcon } from './column-layout-icon'
import { InsertSectionAboveIcon } from './format-icons'
import {
  NEW_SECTION_BAND,
  SECTION_RULE_OFFSET,
  bandEdges,
  sameBand,
  sheetBands,
  type SectionBand,
} from './section-bands'
import {
  ContextMenu,
  type MenuItem,
  type MenuPoint,
  type MenuSide,
} from './context-menu'
import { domMeasure, imageSourcesOfDocuments } from './dom-measure'

/** Every question id across every page, in on-page (number) order. */
function orderedQuestionIds(pages: readonly PlannedPage[]): string[] {
  return pages.flatMap((page) =>
    page.items.flatMap((item) => (item.kind === 'question' ? [item.question.id] : [])),
  )
}

/** Every question's column setting, keyed by id — what its context menu
 * highlights, read through `columnsOf` so a record stored before the setting
 * was a plain count highlights the default rather than nothing. */
function columnSettingsOf(exam: Exam): Record<string, ColumnSetting> {
  const byId: Record<string, ColumnSetting> = {}
  for (const question of exam.questions) byId[question.id] = columnsOf(question)
  return byId
}

// The answer-column settings, spelled out because a bare number in a menu
// would not explain itself.
const COLUMN_MENU_OPTIONS: readonly { label: string; value: ColumnSetting }[] = [
  { label: '1 column', value: 1 },
  { label: '2 columns', value: 2 },
  { label: '4 columns', value: 4 },
]

/** How much room a work space opens with when a teacher picks blank or lined
 *  space for a question that has none yet: four ruled lines, enough to be seen
 *  and grabbed, and dragged from there. */
const DEFAULT_WORK_SPACE_HEIGHT = 4 * WORK_SPACE_LINE_PITCH

export type SetWorkSpace = (questionIds: readonly string[], patch: Partial<WorkSpace>) => void

/** Sets the Points of a question — `partId` `null` — or of one of a Multipart
 *  question's Parts or Subparts; `null` points clears them. A bank edit. */
export type SetPoints = (questionId: string, partId: string | null, points: number | null) => void

/** The Answer columns submenu, for a Multiple Choice question or Part. */
function columnsMenu(
  label: string,
  columns: ColumnSetting,
  onSelect: (columns: ColumnSetting) => void,
): MenuItem {
  return {
    kind: 'submenu',
    label,
    // The parent row shows the current layout before its submenu asks the
    // teacher to choose another one.
    icon: <ColumnLayoutIcon columns={columns} withDataAttribute={false} />,
    items: COLUMN_MENU_OPTIONS.map((option) => ({
      kind: 'radio',
      label: option.label,
      checked: option.value === columns,
      icon: <ColumnLayoutIcon columns={option.value} />,
      onSelect: () => onSelect(option.value),
    })),
  }
}

// Where a Matching question's Word Bank prints on this Exam, offered as Multiple
// Choice answer columns are: always one of the two, which the question took
// from the Paper Style when it arrived. Choosing one here is the teacher's,
// and a change of style then leaves it (ADR-0044).
const WORD_BANK_MENU_OPTIONS: readonly { label: string; value: WordBankLayout; icon: ReactNode }[] = [
  { label: 'Beside items', value: 'beside', icon: <Columns2 /> },
  { label: 'Above items', value: 'above', icon: <Rows2 /> },
]

function wordBankMenu(layout: WordBankLayout, onSelect: (layout: WordBankLayout) => void): MenuItem {
  const current = WORD_BANK_MENU_OPTIONS.find((option) => option.value === layout)!
  return {
    kind: 'submenu',
    label: 'Word Bank',
    icon: current.icon,
    items: WORD_BANK_MENU_OPTIONS.map((option) => ({
      kind: 'radio',
      label: option.label,
      checked: option.value === layout,
      icon: option.icon,
      onSelect: () => onSelect(option.value),
    })),
  }
}

/** The Incorrect answers shown submenu, for a Multiple Choice question:
 *  every count it may show, or disabled with the reason none can hide any. */
function shownIncorrectMenu(
  state: ShownIncorrectMenu,
  onSelect: (count: number) => void,
): MenuItem {
  if (state.disabled) {
    return {
      kind: 'submenu',
      label: 'Incorrect answers shown',
      icon: <EyeOff />,
      disabled: true,
      description: state.hint,
      items: [],
    }
  }
  const { range, shown } = state
  return {
    kind: 'submenu',
    label: 'Incorrect answers shown',
    icon: <EyeOff />,
    value: shown === range.max ? 'All' : `${shown} of ${range.max}`,
    items: shownIncorrectChoices(range).map(({ count, label }) => ({
      kind: 'radio',
      label,
      checked: count === shown,
      // All of them is all of each question's, however many it has; a
      // smaller count is clamped to what each one allows.
      onSelect: () => onSelect(count === range.max ? Infinity : count),
    })),
  }
}

/** The Work space submenu and its Fill toggle, for a Short Answer question or
 *  Part: `ids` are what the setting applies to. */
function workSpaceMenu(
  label: string,
  fillLabel: string,
  workSpace: WorkSpace,
  ids: readonly string[],
  onSetWorkSpace: SetWorkSpace,
): MenuItem[] {
  const present = hasWorkSpace(workSpace)
  // Picking a style for a question with no room gives it some, so the
  // choice is visible at once rather than waiting on a drag.
  const withStyle = (style: WorkSpace['style']) =>
    onSetWorkSpace(ids, present
      ? { style }
      : { style, height: DEFAULT_WORK_SPACE_HEIGHT })
  // With none, the one thing to do is add some: it arrives in the style the
  // question already names, at the default height, and is then sized by
  // selecting it on the sheet and dragging its handle (ADR-0050).
  if (!present) {
    return [{
      kind: 'action',
      label: label.replace(/Work space$/, 'Add work space'),
      icon: <PencilLine />,
      onSelect: () => withStyle(workSpace.style),
    }]
  }
  return [
    {
      kind: 'submenu',
      label,
      icon: <PencilLine />,
      items: [
        {
          kind: 'radio',
          label: 'None',
          checked: !present,
          icon: <Ban />,
          onSelect: () => onSetWorkSpace(ids, { height: 0, fill: false }),
        },
        {
          kind: 'radio',
          label: 'Blank space',
          checked: present && workSpace.style === 'blank',
          icon: <SquareDashed />,
          onSelect: () => withStyle('blank'),
        },
        {
          kind: 'radio',
          label: 'Lined space',
          checked: present && workSpace.style === 'lines',
          icon: <AlignJustify />,
          onSelect: () => withStyle('lines'),
        },
      ],
    },
    {
      kind: 'checkbox',
      label: fillLabel,
      checked: workSpace.fill,
      icon: <ArrowDownToLine />,
      onSelect: () => onSetWorkSpace(ids, { fill: !workSpace.fill }),
    },
  ]
}

/** What a question's menu can do to the Exam's Sections, and whether each
 *  would change anything for the questions it acts on. */
type QuestionSectionActions = {
  canSplit: (questionId: string) => boolean
  onSplit: (questionId: string) => void
  canMoveToNewSection: (questionIds: readonly string[]) => boolean
  onMoveToNewSection: (questionIds: readonly string[]) => void
}

/** The Parts and Subparts a right-click on `partId` speaks for: a Part that
 *  answers, or a Subpart, alone; a Part's lead-in, its Subparts. `null` — the
 *  whole question — when it landed on no Part. */
function pointedPartIdsOf(question: PlannedQuestion, partId: string | null): ReadonlySet<string> | null {
  if (!partId) return null
  for (const part of question.parts ?? []) {
    if (part.id === partId) {
      return new Set(part.type === 'subparts' ? part.subparts.map(({ id }) => id) : [part.id])
    }
    if (part.subparts.some(({ id }) => id === partId)) return new Set([partId])
  }
  return null
}

// One list, however it was opened. The grip beside a question and a right-click
// on the question itself raise exactly the same actions, which is what makes
// the grip discoverable rather than a second, lesser control — except on a
// Multipart question, where a right-click on one Part offers that Part's own
// rows alone, rather than every Part's.
function questionMenuItems({
  question,
  columns,
  onEdit,
  onDuplicate,
  onShuffleSelected,
  onShuffleSelectedAnswers,
  shownIncorrect,
  onSetShownIncorrect,
  onRemove,
  onSetColumns,
  wordBankLayout,
  onSetWordBankLayout,
  workSpace,
  workSpaceOfPart,
  onSetWorkSpace,
  selectedQuestionIds,
  sectionActions,
  pointedPartIds = null,
  onResetPictureSize,
}: {
  question: PlannedQuestion
  /** Present when the menu was raised on a picture this Exam has resized. */
  onResetPictureSize?: () => void
  /** The Parts or Subparts a right-click landed on, whose rows alone the menu
   *  offers; `null` for the whole question — its grip, or its shared stem. */
  pointedPartIds?: ReadonlySet<string> | null
  /** Present in the editor: what this menu can do to the Exam's Sections. */
  sectionActions?: QuestionSectionActions
  /** The Incorrect answers shown entry: how many incorrect answers this
   *  question, or another it acts on, may show and shows, or why none can
   *  hide any; null when it is not Multiple Choice. */
  shownIncorrect: ShownIncorrectMenu | null
  onSetShownIncorrect?: (questionIds: readonly string[], count: number) => void
  columns: ColumnSetting
  workSpace: WorkSpace
  /** A Part's work space on this Exam, as its menu reports it. */
  workSpaceOfPart: (partId: string) => WorkSpace
  onSetWorkSpace: SetWorkSpace
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onShuffleSelected: (questionIds: readonly string[]) => void
  onShuffleSelectedAnswers: (questionIds: readonly string[]) => void
  onRemove: (questionIds: readonly string[]) => void
  onSetColumns: (questionIds: readonly string[], columns: ColumnSetting) => void
  /** Where this question's Word Bank prints, when it is a Matching question. */
  wordBankLayout: WordBankLayout
  onSetWordBankLayout?: (questionIds: readonly string[], layout: WordBankLayout) => void
  selectedQuestionIds: readonly string[]
}): MenuItem[] {
  // Every action that can sensibly apply to more than one question applies to
  // the whole selection when the question raising the menu is part of it, and
  // to that question alone otherwise.
  const actedOnIds = selectedQuestionIds.includes(question.id)
    ? selectedQuestionIds
    : [question.id]
  const items: MenuItem[] = [
    {
      kind: 'action',
      label: 'Edit question',
      icon: <Pencil />,
      onSelect: () => onEdit(question.id),
    },
    {
      kind: 'action',
      label: 'Duplicate',
      icon: <Copy />,
      onSelect: () => onDuplicate(question.id),
    },
  ]
  if (onResetPictureSize) {
    items.push({
      kind: 'action',
      label: 'Reset picture size',
      icon: <ImageIcon />,
      onSelect: onResetPictureSize,
    })
  }
  // One question opens a new Section directly below it, taking the rest of
  // its Section with it — or, as the last of its Section, an empty one below
  // that; a selection of several becomes a Section of its own. The row is
  // there but disabled when it would change nothing — a selection that
  // already is a Section.
  if (sectionActions) {
    items.push(
      { kind: 'separator' },
      actedOnIds.length > 1
        ? {
            kind: 'action',
            label: 'Move to new section',
            icon: <BetweenHorizontalStart />,
            disabled: !sectionActions.canMoveToNewSection(actedOnIds),
            onSelect: () => sectionActions.onMoveToNewSection(actedOnIds),
          }
        : {
            kind: 'action',
            label: 'Insert new section below',
            icon: <BetweenHorizontalEnd />,
            disabled: !sectionActions.canSplit(question.id),
            onSelect: () => sectionActions.onSplit(question.id),
          },
    )
  }
  // How a question's answers print, grouped: answer columns and how many
  // incorrect answers show for Multiple Choice, where the Word Bank stands for
  // Matching, and each Multiple Choice Part's columns — for that Part alone,
  // since Parts of different Multipart questions have nothing to line up with
  // one another. A question with no answers to lay out has no group, rather
  // than one present and inert. Like every other row, these follow the type
  // of the question raising the menu; the store leaves any other type in the
  // selection alone.
  const answerFormat: MenuItem[] = []
  if (question.type === 'multiple-choice') {
    answerFormat.push(columnsMenu('Answer columns', columns, (next) => onSetColumns(actedOnIds, next)))
  }
  if (shownIncorrect && onSetShownIncorrect) {
    answerFormat.push(shownIncorrectMenu(shownIncorrect, (count) => onSetShownIncorrect(actedOnIds, count)))
  }
  if (question.type === 'matching' && onSetWordBankLayout) {
    answerFormat.push(wordBankMenu(wordBankLayout, (next) => onSetWordBankLayout(actedOnIds, next)))
  }
  // A Part that holds Subparts answers nothing itself: each of its Subparts
  // is laid out, and leaves room, under its own id and name.
  const answering = answeringPartsIn(question.parts ?? [])
    .filter(({ part }) => !pointedPartIds || pointedPartIds.has(part.id))
  for (const { name, part } of answering) {
    if (part.type !== 'multiple-choice') continue
    answerFormat.push(
      columnsMenu(
        `Part ${name} · Answer columns`,
        part.grid?.columns ?? DEFAULT_COLUMNS,
        (next) => onSetColumns([part.id], next),
      ),
    )
  }
  if (answerFormat.length > 0) {
    items.push({ kind: 'separator' }, { kind: 'label', label: 'Answer format' }, ...answerFormat)
  }
  // A Short Answer Part leaves room under its own id, as a Short Answer
  // question does under its.
  for (const { name, part } of answering) {
    if (part.type === 'multiple-choice') continue
    items.push(
      { kind: 'separator' },
      ...workSpaceMenu(
        `Part ${name} · Work space`,
        `Part ${name} · Fill rest of page`,
        workSpaceOfPart(part.id),
        [part.id],
        onSetWorkSpace,
      ),
    )
  }
  // Room for working is a Short Answer question's business, set here on the
  // sheet rather than in the question editor: how much a student needs depends
  // on the test, and on what else shares the page. The store leaves any other
  // Question Type in the selection alone.
  if (takesWorkSpace(question.type)) {
    items.push(
      { kind: 'separator' },
      ...workSpaceMenu('Work space', 'Fill rest of page', workSpace, actedOnIds, onSetWorkSpace),
    )
  }
  items.push(
    { kind: 'separator' },
    { kind: 'label', label: 'Vary' },
    // Both shuffles sit side by side under one heading, each with its own
    // icon: crossed arrows for reordering questions across the sheet, a list
    // with a return arrow for reordering the answers inside each question.
    // Shuffling answers keeps how many incorrect answers each question shows
    // and draws again which ones (ADR-0038).
    {
      kind: 'action',
      label: 'Shuffle question order',
      icon: <Shuffle />,
      onSelect: () => onShuffleSelected(actedOnIds),
    },
    {
      kind: 'action',
      label: 'Shuffle answer order',
      icon: <ListRestart />,
      onSelect: () => onShuffleSelectedAnswers(actedOnIds),
    },
  )
  // Remove, never Delete: this takes the question off the Working Copy and leaves
  // its Question Bank record alone, so it is neither destructive nor worth a
  // confirmation. Permanent deletion is not offered in this workspace at all.
  items.push(
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Remove',
      icon: <CircleMinus />,
      // Taking a question off the sheet is the one thing in this menu that
      // undoes work, so the row says so on hover rather than sitting there in
      // warning colours all the time.
      destructive: true,
      onSelect: () => onRemove(actedOnIds),
    },
  )
  return items
}

// The pair of controls a question reveals on hover, out in the sheet's margin:
// a plus that adds another question below this one, and a three-dot button that
// opens the question's menu beside it. Dragging is not their business — the
// whole question is the drag source, so there is nothing left for a grip to do.
//
// Clicks are stopped from bubbling to the question's own handler, so reaching
// for a handle never also selects, deselects, or extends a range through the
// question underneath. A right-click is deliberately left to bubble: landing on
// a handle rather than the text is a miss, and should still get the menu.
function QuestionHandles({
  question,
  onOpenMenu,
}: {
  question: PlannedQuestion
  onOpenMenu: (questionId: string, point: MenuPoint, side?: MenuSide) => void
}) {
  // Beside the grip and to its left, not under the pointer: a menu opened from
  // a handle should read as belonging to that handle, and opening leftwards
  // keeps it off the question it acts on. The point is the menu's right edge —
  // `side` is what makes it one.
  const openBeside = (handle: HTMLElement) => {
    const bounds = handle.getBoundingClientRect()
    onOpenMenu(question.id, { x: bounds.left - 6, y: bounds.top }, 'left')
  }
  return (
    <aside
      className="question-handles"
      aria-label={`Question ${numberLabelOf(question)} controls`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="question-handle menu-handle"
        aria-haspopup="menu"
        aria-label={`Actions for question ${numberLabelOf(question)}`}
        onClick={(event) => openBeside(event.currentTarget)}
        // The keyboard's own ways to ask for a context menu open the same one,
        // on every platform — Shift+F10 raises no context menu on a Mac.
        onKeyDown={(event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
          event.preventDefault()
          openBeside(event.currentTarget)
        }}
      >
        <EllipsisVertical />
      </button>
    </aside>
  )
}

// The bar under a Short Answer question that drags its work space open, taller
// or shut. It is editing chrome: absolutely placed in the gap below the
// question, so it takes none of the height `dom-measure.ts` measured, and
// hidden from print with the rest of the chrome.
//
// A drag previews locally and commits once, on release — one undo step per
// gesture, and one repagination rather than one per pixel. The sheet keeps
// showing the released height until it has repaginated with it
// (`WorkSpaceSizing`), so a release never flashes the old one. Heights snap to
// whole rows, laid out at the Paper Style's pitch — closer under Condensed —
// so blank and lined space always agree about size, and what is committed is
// the stored height of those rows (`storedWorkSpaceHeight`). Dragging
// a space that fills its page takes over from the fill: the teacher is now
// saying how much room they want, so what they drag to is what they get.
//
// A separator in ARIA terms, so it takes the keyboard too: arrows move by a
// line, Home shuts it, End opens it as far as a drag could.
function WorkSpaceHandle({
  label,
  space,
  max,
  selected = false,
  onPreview,
  onRelease,
  onCommit,
}: {
  label: string
  /** Whether its Work Space is the sheet's selected piece, which is when the
   *  bar shows (ADR-0050); an empty one shows under a selected question. */
  selected?: boolean
  /** The space as this page lays it out: its height, and the rows it is in. */
  space: PlannedWorkSpace
  /** The most room a drag may open on the page: less on an Exam whose
   *  margins leave a shorter page (`maxWorkSpaceHeight`). */
  max: number
  /** The height on the page a drag is showing. */
  onPreview: (height: number) => void
  /** The drag has ended, `committed` when it stored a new height. */
  onRelease: (committed: boolean) => void
  /** The stored height the teacher settled on. */
  onCommit: (height: number) => void
}) {
  const { height } = space
  const rows = rowsOfPlanned(space)
  const gesture = useRef<{ id: number; startY: number; next: number } | null>(null)
  const lines = rowsIn(height, rows)
  // Commits a whole count of rows, unless it is the count already showing,
  // and says whether it did.
  const settle = (stored: number): boolean => {
    const snapped = storedWorkSpaceHeight(laidWorkSpaceHeight(stored, rows), rows, max)
    if (snapped / WORK_SPACE_LINE_PITCH === lines && !space.fill) return false
    onCommit(snapped)
    return true
  }
  return (
    <div
      className="work-space-handle"
      data-selected={selected ? 'true' : undefined}
      data-empty={height === 0 ? 'true' : undefined}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={rowsIn(max, rows)}
      aria-valuenow={lines}
      aria-valuetext={`${lines} ${lines === 1 ? 'line' : 'lines'} of work space`}
      title="Drag to change the work space"
      tabIndex={0}
      // Never a question drag, a selection click or an editor double-click:
      // this gesture is the bar's alone.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.preventDefault()
        gesture.current = {
          id: event.pointerId,
          startY: event.clientY,
          next: lines * WORK_SPACE_LINE_PITCH,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const drag = gesture.current
        if (!drag || drag.id !== event.pointerId) return
        event.stopPropagation()
        const next = storedWorkSpaceHeight(height + event.clientY - drag.startY, rows, max)
        if (next === drag.next) return
        drag.next = next
        onPreview(laidWorkSpaceHeight(next, rows))
      }}
      onPointerUp={(event) => {
        const drag = gesture.current
        if (!drag || drag.id !== event.pointerId) return
        event.stopPropagation()
        gesture.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        onRelease(settle(drag.next))
      }}
      onPointerCancel={(event) => {
        if (gesture.current?.id !== event.pointerId) return
        gesture.current = null
        onRelease(false)
      }}
      onKeyDown={(event) => {
        const next =
          event.key === 'ArrowDown' ? lines + 1
            : event.key === 'ArrowUp' ? Math.max(0, lines - 1)
              : event.key === 'Home' ? 0
                : event.key === 'End' ? rowsIn(max, rows)
                  : null
        if (next === null) return
        event.preventDefault()
        event.stopPropagation()
        settle(next * WORK_SPACE_LINE_PITCH)
      }}
    >
      <span className="work-space-grip" aria-hidden="true" />
    </div>
  )
}

// A question on the page, or the piece of one this page carries: the same
// content `dom-measure.ts` measured, wrapped in the chrome that makes it
// selectable, editable and droppable. A continued piece is chrome-free — its
// handles, and everything they do, belong to the piece that carries the
// question's number.
// A printed `[n]` on the sheet, under a Paper Style that prints Points
// (ADR-0045): the very text the page prints, made the control that changes
// the Points it shows. Points never show on the sheet otherwise — like
// Question Metadata, only where the style prints them — and the Export
// Preview draws the plan without this. Clicking turns the `[n]` into a field
// of the same height, so the page measured with the plain text still fits: a
// whole number sets the Points, an empty field clears them, and anything else
// changes nothing. Points belong to the Question, so what is typed here edits
// the Question in its bank (ADR-0042).
function EditablePoints({
  label,
  points,
  text,
  onRule = false,
  onSet,
}: {
  /** What it is the Points of, for a screen reader: "question 3", "question 3 part b (ii)". */
  label: string
  points: number
  /** The `[n]` as the style prints it. */
  text: string
  /** Set on the last rule of a Work Space, inside its row, rather than on a
   *  line of its own. */
  onRule?: boolean
  onSet: (points: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [typed, setTyped] = useState('')
  const finish = (keep: boolean) => {
    setEditing(false)
    if (!keep) return
    const next = parsePointsInput(typed)
    if (next !== undefined && next !== points) onSet(next)
  }
  // Nothing in or on the field is the question's own gesture: no selecting,
  // dragging or opening the editor from it.
  const stop = {
    onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
    onDoubleClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
    onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
    onContextMenu: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  }
  const Line = onRule ? 'span' : 'p'
  return (
    <Line className={onRule ? undefined : 'points-after'}>
      {editing ? (
        <input
          className="points-after-input"
          type="text"
          inputMode="numeric"
          aria-label={`Points for ${label}`}
          aria-invalid={parsePointsInput(typed) === undefined ? true : undefined}
          size={3}
          autoFocus
          value={typed}
          {...stop}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              finish(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="points-after-button"
          aria-label={`Points for ${label}: ${pointsLabel(points)}`}
          title="Change points"
          {...stop}
          onClick={(event) => {
            event.stopPropagation()
            setTyped(String(points))
            setEditing(true)
          }}
        >
          {text}
        </button>
      )}
    </Line>
  )
}

/** The sheet's Work Space drags as a question on it sees them, by the position
 *  each sizes: the question's id, or a Part's or Subpart's. The sheet holds
 *  them, not the question, so a question drawn afresh — a new page, a new
 *  piece — keeps a released drag's height until the sheet has repaginated
 *  with it (`work-space-preview.ts`). */
export type WorkSpaceSizing = {
  /** The height to draw over the planned space, or `null` for the plan's own. */
  shownHeight: (positionId: string, planned: PlannedWorkSpace) => number | null
  /** Whether the pointer is down on any of these positions' handles. */
  isSizing: (positionIds: readonly string[]) => boolean
  onPreview: (positionId: string, height: number) => void
  /** The drag has ended, `committed` when it stored a new height. */
  onRelease: (positionId: string, committed: boolean) => void
}

/** A question on the sheet, with its chrome. Exported for its tests. */
export function QuestionView({
  item,
  sectionId,
  selected,
  orderedIds,
  selection,
  onEdit,
  onOpenMenu,
  onSetWorkSpace,
  onSetPoints,
  maxWorkSpace,
  workSpaceSizing,
  dragging,
  dropped,
  dropState,
  onDragStart,
  onDragMove,
  onDrop,
  onDragEnd,
}: {
  item: QuestionItem
  /** The Question Section this question is in, which a gesture reads. */
  sectionId: string
  onSetWorkSpace: SetWorkSpace
  /** Present in the editor: sets Points from the sheet. */
  onSetPoints?: SetPoints
  maxWorkSpace: number
  /** The sheet's Work Space drags, which it holds rather than the question. */
  workSpaceSizing: WorkSpaceSizing
  selected: boolean
  orderedIds: readonly string[]
  selection: Selection
  onEdit: (questionId: string) => void
  onOpenMenu: (questionId: string, point: MenuPoint, side?: MenuSide) => void
  dragging: boolean
  dropped: boolean
  dropState: QuestionDropState
  onDragStart: (
    question: PlannedQuestion,
    element: HTMLElement,
    point: { x: number; y: number },
  ) => void
  onDragMove: (point: { x: number; y: number }) => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  const pointerDrag = useRef<{
    id: number
    startX: number
    startY: number
    dragging: boolean
  } | null>(null)
  const suppressClick = useRef(false)
  const question = item.question
  const pieces = useContext(SheetPiecesContext)
  // A work space drawn at the height its drag is showing, when the sheet holds
  // one for it (`workSpaceSizing`), and otherwise as the plan draws it.
  const previewed = (positionId: string, space: PlannedWorkSpace): PlannedWorkSpace => {
    const height = workSpaceSizing.shownHeight(positionId, space)
    return height === null
      ? space
      : { ...space, height, lines: space.style === 'lines' ? rowsIn(height, rowsOfPlanned(space)) : 0, fill: false }
  }
  const previewedPart = <Part extends { id: string; workSpace: PlannedWorkSpace | null }>(part: Part): Part => {
    const space = part.workSpace && previewed(part.id, part.workSpace)
    return space === part.workSpace ? part : { ...part, workSpace: space }
  }
  const questionSpace = item.workSpace && previewed(question.id, item.workSpace)
  const parts = item.parts && item.parts.map((part) => {
    const subparts = part.subparts.map(previewedPart)
    const own = previewedPart(part)
    return own === part && subparts.every((subpart, index) => subpart === part.subparts[index])
      ? part
      : { ...own, subparts }
  })
  const shown: QuestionItem =
    questionSpace === item.workSpace && (parts ?? []).every((part, index) => part === item.parts![index])
      ? item
      : { ...item, workSpace: questionSpace, parts }
  // A Short Answer Part's or Subpart's work space, with the bar that sizes it
  // in the gap below it, exactly as a Short Answer question's bar sits below it.
  const answeringHere = answeringPartsIn(item.parts ?? [])
  const renderPartWorkSpace = (partId: string, space: PlannedWorkSpace, points?: ReactNode) => {
    const here = answeringHere.find(({ part }) => part.id === partId)
    return (
      <div className="part-work-space">
        <WorkSpaceView space={space} points={points} />
        <WorkSpaceHandle
          label={`Work space for question ${numberLabelOf(question)} part ${here?.name ?? ''}`}
          space={here?.part.workSpace ?? space}
          max={maxWorkSpace}
          selected={pieces?.selected === spacePieceOf(partId)}
          onPreview={(height) => workSpaceSizing.onPreview(partId, height)}
          onRelease={(committed) => workSpaceSizing.onRelease(partId, committed)}
          onCommit={(height) => onSetWorkSpace([partId], { height, fill: false })}
        />
      </div>
    )
  }

  // The `[n]` the Paper Style prints after the question or one of its Parts
  // or Subparts, as the control that changes it.
  const renderPoints: RenderPrintedPoints | undefined = onSetPoints
    ? ({ partId, points, text, onRule }) => {
        const here = partId === null ? undefined : answeringHere.find(({ part }) => part.id === partId)
        return (
          <EditablePoints
            label={`question ${numberLabelOf(question)}${here ? ` part ${here.name}` : ''}`}
            points={points}
            text={text}
            onRule={onRule}
            onSet={(next) => onSetPoints(question.id, partId, next)}
          />
        )
      }
    : undefined

  const releasePointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const classes = ['exam-question']
  if (selected) classes.push('exam-question--selected')
  if (dragging) classes.push('exam-question--dragging')
  if (dropped) classes.push('exam-question--dropped')
  // Only while the pointer is down: a released drag's height may still show.
  if (workSpaceSizing.isSizing([question.id, ...answeringHere.map(({ part }) => part.id)])) {
    classes.push('exam-question--sizing')
  }

  return (
    <section
      className={classes.join(' ')}
      data-question-id={question.id}
      data-section-id={sectionId}
      data-drop-target={item.numbered ? question.type : undefined}
      data-drop={dropState ?? undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const target = event.target as HTMLElement
        if (target.closest('button, input, textarea, select, a, [contenteditable="true"]')) {
          return
        }
        // A press on a Work Space selects it, as a press on a picture does
        // (`SheetPicture`), and its question with it.
        if (target.closest('.work-space')) {
          const part = target.closest<HTMLElement>('.part-work-space')?.closest<HTMLElement>('[data-part-id]')
          pieces?.select(spacePieceOf(part?.dataset.partId ?? question.id))
        }
        // Shift-click extends the app's question range, not the browser's
        // native text range. Cancelling pointer-down is early enough to stop
        // the native selection while still allowing the click event below.
        if (event.shiftKey) event.preventDefault()
        pointerDrag.current = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          dragging: false,
        }
        suppressClick.current = false
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const gesture = pointerDrag.current
        if (!gesture || gesture.id !== event.pointerId) return
        if (!gesture.dragging) {
          const distance = Math.hypot(
            event.clientX - gesture.startX,
            event.clientY - gesture.startY,
          )
          if (distance < 5) return
          gesture.dragging = true
          suppressClick.current = true
          onDragStart(question, event.currentTarget, {
            x: gesture.startX,
            y: gesture.startY,
          })
        }
        event.preventDefault()
        onDragMove({ x: event.clientX, y: event.clientY })
      }}
      onPointerUp={(event) => {
        const gesture = pointerDrag.current
        if (!gesture || gesture.id !== event.pointerId) return
        pointerDrag.current = null
        releasePointer(event)
        if (!gesture.dragging) return
        event.preventDefault()
        onDrop()
      }}
      onPointerCancel={(event) => {
        const gesture = pointerDrag.current
        if (!gesture || gesture.id !== event.pointerId) return
        pointerDrag.current = null
        releasePointer(event)
        if (gesture.dragging) {
          suppressClick.current = false
          onDragEnd()
        }
      }}
      onLostPointerCapture={(event) => {
        const gesture = pointerDrag.current
        if (!gesture || gesture.id !== event.pointerId) return
        pointerDrag.current = null
        if (gesture.dragging) {
          suppressClick.current = false
          onDragEnd()
        }
      }}
      onClick={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false
          event.preventDefault()
          event.stopPropagation()
          return
        }
        // The first click has already selected immediately. Ignore the second
        // click's selection semantics and let `dblclick` open the editor; this
        // also prevents Ctrl/Cmd-double-click from toggling the item twice.
        if (event.detail > 1) return
        selection.selectOne(question.id, orderedIds, {
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
        })
      }}
      onDoubleClick={() => onEdit(question.id)}
      // A right-click anywhere on the question raises the same menu the grip
      // does, under the pointer. A continued piece answers too — it is the
      // same question, even though its handles belong to the numbered piece.
      //
      // Raised from the keyboard — the ContextMenu key, or Shift+F10, on a
      // focused handle — there is no pointer to open under, and the event
      // reports none, so the menu opens at the element that has focus.
      onContextMenu={(event) => {
        event.preventDefault()
        const fromKeyboard =
          (event.nativeEvent as PointerEvent).pointerType === ''
          || (event.clientX === 0 && event.clientY === 0)
        if (fromKeyboard) {
          // The handle has already opened the menu beside itself on keydown.
          if ((event.target as HTMLElement).closest('.question-handles')) return
          const bounds = (event.target as HTMLElement).getBoundingClientRect()
          onOpenMenu(question.id, { x: bounds.left, y: bounds.bottom })
          return
        }
        onOpenMenu(question.id, { x: event.clientX, y: event.clientY })
      }}
    >
      {item.numbered && (
        <QuestionHandles question={question} onOpenMenu={onOpenMenu} />
      )}
      <SheetQuestionContext.Provider value={question.id}>
        <QuestionContent
          item={shown}
          showCorrectness
          renderPartWorkSpace={renderPartWorkSpace}
          renderPoints={renderPoints}
        />
      </SheetQuestionContext.Provider>
      {/* Editing chrome, like the work space bar: placed in the gap below
          the answers, so it takes none of the height the page measured. */}
      {item.grid && question.answerVisibility && (
        <p className="answer-visibility-note" role="note">
          {answerVisibilityNote(question.answerVisibility)}
        </p>
      )}
      {item.workSpace && (
        <WorkSpaceHandle
          label={`Work space for question ${numberLabelOf(question)}`}
          space={item.workSpace}
          max={maxWorkSpace}
          selected={pieces?.selected === spacePieceOf(question.id)}
          onPreview={(height) => workSpaceSizing.onPreview(question.id, height)}
          onRelease={(committed) => workSpaceSizing.onRelease(question.id, committed)}
          onCommit={(height) => onSetWorkSpace([question.id], { height, fill: false })}
        />
      )}
    </section>
  )
}

/** How long after a Section is moved from its controls the sheet keeps its
 *  controls where they were, through each pass of repagination. */
const MOVE_ANCHOR_MS = 1200

/** A new-Section target a gesture has opened: the Section it opened beneath,
 *  and whether the pointer is over it, which is when a release makes one. */
type NewSectionTargetState = { afterSectionId: string; armed: boolean }

// The target that makes a new Question Section, opened beneath the foot of a
// Section once a gesture's line has rested there. It opens in the sheet's flow,
// between this Section and the next, pushing the next Section's dashed rule
// down to make room, and says what a release over it does before it does it.
function NewSectionTarget({ afterSectionId, armed }: NewSectionTargetState) {
  return (
    <div
      className="new-section-target"
      data-new-section-after={afterSectionId}
      data-active={armed ? 'true' : undefined}
      aria-hidden="true"
    >
      Drop here to create a new section
    </div>
  )
}

/** Rewords a Question Section's heading on this Exam; `null` restores a part. */
export type SetSectionHeading = (sectionId: string, change: SectionHeadingChange) => void

/** What a Question Section's own controls do: move it past a neighbour, or
 *  delete it and Remove its questions — and, behind its more button, insert
 *  an empty Section beside it or merge it with a neighbour. A Section with no
 *  neighbour on a side can neither move nor merge that way. */
export type SectionControls = {
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
  onInsert: (placement: SectionPlacement) => void
  onMerge: (direction: -1 | 1) => void
}

// The Section's less frequent structural actions, behind its more button: two
// rows, each with its two directions side by side, rather than four rows that
// say "section" four times. Merging keeps this Section's wording, so a merge
// is named from this Section — "Merge with" the one above or below.
function sectionMenuItems(controls: SectionControls): MenuItem[] {
  // Two plain actions, each on the Section above: inserting or merging below
  // is the same action taken from the next Section, and the arrows move one.
  return [
    {
      kind: 'action',
      label: 'Insert section above',
      icon: <InsertSectionAboveIcon />,
      onSelect: () => controls.onInsert('above'),
    },
    {
      kind: 'action',
      label: 'Merge with section above',
      icon: <FoldVertical />,
      disabled: !controls.canMoveUp,
      onSelect: () => controls.onMerge(-1),
    },
  ]
}

// One part of a section heading, typed where it prints. The underline and the
// field are the Exam title's: a transparent line until hover, the accent once
// focused. It is a textarea laid over a hidden copy of its own value, so it
// wraps exactly as the printed text does and the heading keeps the height
// `dom-measure.ts` measured; the text is a single line, so Enter finishes.
function SectionHeadingField({
  label,
  value,
  placeholder,
  disabled,
  autoFocus = false,
  onChange,
  onFocusChange,
}: {
  label: string
  value: string
  placeholder: string
  disabled: boolean
  /** Focused as it appears: what bringing a cleared heading back does. */
  autoFocus?: boolean
  onChange: (value: string) => void
  onFocusChange: (focused: boolean) => void
}) {
  // Focused as it appears, its text is selected too: a heading asked for from
  // the Section's controls — a new Section's placeholder heading, say — is
  // there to be typed over.
  const field = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (autoFocus) field.current?.select()
  }, [autoFocus])
  return (
    <span className="section-heading-field" data-value={value || placeholder}>
      <textarea
        ref={field}
        aria-label={label}
        className="section-heading-input"
        rows={1}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        spellCheck
        onChange={(event) => onChange(event.target.value.replace(/\s*\n\s*/g, ' '))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
      />
    </span>
  )
}

// A section heading on the sheet, reworded where it prints. A part the teacher
// clears stays open to type into while it has focus, and prints nothing once
// they leave it; a heading cleared of both is kept at no height, and the
// Section's controls in the gutter beside the sheet can give it one again.
function EditableSectionHeading({
  item,
  disabled,
  onChange,
  emptyActive,
  newSectionTarget,
  revealTitle,
  onRevealed,
}: {
  item: SectionHeadingItem
  disabled: boolean
  onChange: SetSectionHeading
  /** For an empty Section: whether a gesture would land in it. */
  emptyActive: boolean
  newSectionTarget: NewSectionTargetState | null
  /** Asked, from the Section's controls, to open its cleared heading. */
  revealTitle: boolean
  onRevealed: () => void
}) {
  const [focused, setFocused] = useState<'title' | 'instructions' | null>(null)
  const focus = (part: 'title' | 'instructions') => (on: boolean) => {
    if (on && part === 'title') onRevealed()
    setFocused((current) => (on ? part : current === part ? null : current))
  }
  const showTitle = item.title !== '' || focused === 'title' || revealTitle
  const showInstructions = item.instructions !== '' || focused === 'instructions'
  // An empty Section prints just its heading, so at rest that is all the sheet
  // draws of it, and its heading is where a gesture drops into it. While a
  // gesture is aimed at it, a box opens in the sheet's flow below the heading,
  // pushing what follows down, to show where the questions will go.
  const emptyMarks = item.empty
    ? { 'data-empty-section': '', 'data-section-id': item.sectionId }
    : {}
  const hint = item.empty && emptyActive && (
    <div className="exam-section-empty-drop" data-active="true" {...emptyMarks}>
      Drag questions here
    </div>
  )
  const opened = newSectionTarget && <NewSectionTarget {...newSectionTarget} />
  if (!showTitle && !showInstructions) {
    // An untitled Section prints nothing above its questions, so the sheet
    // names it faintly in the gap above them, taking no room — otherwise
    // where one Section ends and the next begins is invisible until pointed
    // at, and a heading the teacher never had looks like one that went missing.
    return (
      <>
        <div className="exam-section-hidden" {...emptyMarks} data-section-id={item.sectionId}>
          <span className="exam-section-untitled" aria-hidden="true">Untitled section</span>
        </div>
        {hint}
        {opened}
      </>
    )
  }
  const styles = sectionHeadingStyles(item.size)
  return (
    <>
    <header
      className="exam-section exam-section--editable"
      {...emptyMarks}
      data-section-id={item.sectionId}
    >
      {showTitle && (
        <h2 className="section-title" style={styles.title}>
          <SectionHeadingField
            label="Section heading"
            value={item.title}
            placeholder="Section heading"
            disabled={disabled}
            autoFocus={revealTitle}
            onChange={(title) => onChange(item.sectionId, { title })}
            onFocusChange={focus('title')}
          />
        </h2>
      )}
      {showInstructions && (
        <p className="section-instructions" style={styles.instructions}>
          <SectionHeadingField
            label="Section directions"
            value={item.instructions}
            placeholder="Directions"
            disabled={disabled}
            onChange={(instructions) => onChange(item.sectionId, { instructions })}
            onFocusChange={focus('instructions')}
          />
        </p>
      )}
    </header>
    {hint}
    {opened}
    </>
  )
}

// The controls of the Section the pointer is in — anywhere across its rows, on
// the paper or beside it — drawn in the gutter to the left of the sheet, at the
// top of that Section's stretch of the sheet. Pointing at them highlights the
// Section they act on.
function SectionRail({
  controls,
  hidden,
  disabled,
  style,
  menuOpen,
  onRevealTitle,
  onHover,
  onOpenMenu,
}: {
  controls: SectionControls
  /** Whether the Section's heading is cleared, which offers one again. */
  hidden: boolean
  disabled: boolean
  style: CSSProperties
  /** Whether this Section's more menu is open. */
  menuOpen: boolean
  onRevealTitle: () => void
  onHover: (on: boolean) => void
  /** Opens the Section's more menu, hanging from `point`. */
  onOpenMenu: (point: MenuPoint) => void
}) {
  const openMenu = (button: HTMLElement) => {
    const bounds = button.getBoundingClientRect()
    onOpenMenu({ x: bounds.right + 6, y: bounds.top })
  }
  return (
    <div
      className="section-rail"
      style={style}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      {hidden && (
        <button
          type="button"
          className="question-handle"
          aria-label="Add a section heading"
          title="Add a heading"
          disabled={disabled}
          onClick={onRevealTitle}
        >
          <Heading aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="question-handle"
        aria-label="Move section up"
        title="Move section up"
        disabled={disabled || !controls.canMoveUp}
        onClick={() => controls.onMove(-1)}
      >
        <ArrowUp aria-hidden="true" />
      </button>
      <button
        type="button"
        className="question-handle"
        aria-label="Move section down"
        title="Move section down"
        disabled={disabled || !controls.canMoveDown}
        onClick={() => controls.onMove(1)}
      >
        <ArrowDown aria-hidden="true" />
      </button>
      <button
        type="button"
        className="question-handle"
        aria-label="Delete section"
        title="Delete section and remove its questions"
        disabled={disabled}
        onClick={controls.onDelete}
      >
        <X aria-hidden="true" />
      </button>
      <button
        type="button"
        className="question-handle"
        aria-label="More section actions"
        title="More section actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={disabled}
        onClick={(event) => openMenu(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ContextMenu'
            && !(event.shiftKey && event.key === 'F10')) return
          event.preventDefault()
          openMenu(event.currentTarget)
        }}
      >
        <Ellipsis aria-hidden="true" />
      </button>
    </div>
  )
}

function PageItemView({
  item,
  orderedIds,
  selection,
  onEdit,
  onOpenMenu,
  onSetWorkSpace,
  onSetPoints,
  maxWorkSpace,
  workSpaceSizing,
  draggedQuestionIds,
  droppedQuestionIds,
  dropState,
  onDragStart,
  onDragMove,
  onDrop,
  onDragEnd,
  onSectionHeadingChange,
  sectionHeadingDisabled = false,
  sectionIdOf,
  newSectionTarget,
  emptySectionActive,
  revealTitleOf,
  onTitleRevealed,
}: {
  item: PageItem
  /** Present in the editor: rewords a section heading where it prints. */
  onSectionHeadingChange?: SetSectionHeading
  sectionHeadingDisabled?: boolean
  /** The Section whose cleared heading its controls asked to open, if any. */
  revealTitleOf: string | null
  onTitleRevealed: () => void
  /** The Section each question on the sheet is in. */
  sectionIdOf: (questionId: string) => string
  /** The new-Section target a gesture has opened beneath this item, if any. */
  newSectionTarget: (item: PageItem) => NewSectionTargetState | null
  /** Whether a gesture would land in this empty Section. */
  emptySectionActive: (sectionId: string) => boolean
  orderedIds: readonly string[]
  selection: Selection
  onEdit: (questionId: string) => void
  onOpenMenu: (questionId: string, point: MenuPoint, side?: MenuSide) => void
  onSetWorkSpace: SetWorkSpace
  onSetPoints?: SetPoints
  /** The most room a work space may be dragged to on this sheet. */
  maxWorkSpace: number
  workSpaceSizing: WorkSpaceSizing
  draggedQuestionIds: ReadonlySet<string>
  droppedQuestionIds: ReadonlySet<string>
  dropState: (item: QuestionItem) => QuestionDropState
  onDragStart: (
    question: PlannedQuestion,
    element: HTMLElement,
    point: { x: number; y: number },
  ) => void
  onDragMove: (point: { x: number; y: number }) => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  switch (item.kind) {
    case 'paper-total':
      return <PaperTotalContent item={item} />
    case 'section-heading':
      return onSectionHeadingChange ? (
        <EditableSectionHeading
          item={item}
          disabled={sectionHeadingDisabled}
          onChange={onSectionHeadingChange}
          emptyActive={emptySectionActive(item.sectionId)}
          newSectionTarget={newSectionTarget(item)}
          revealTitle={revealTitleOf === item.sectionId}
          onRevealed={onTitleRevealed}
        />
      ) : (
        <SectionHeadingContent item={item} />
      )
    case 'question': {
      const target = newSectionTarget(item)
      return (
        <>
        <QuestionView
          item={item}
          sectionId={sectionIdOf(item.question.id)}
          selected={selection.isSelected(item.question.id)}
          orderedIds={orderedIds}
          selection={selection}
          onEdit={onEdit}
          onOpenMenu={onOpenMenu}
          onSetWorkSpace={onSetWorkSpace}
          onSetPoints={onSetPoints}
          maxWorkSpace={maxWorkSpace}
          workSpaceSizing={workSpaceSizing}
          dragging={draggedQuestionIds.has(item.question.id)}
          dropped={droppedQuestionIds.has(item.question.id) && item.numbered}
          dropState={dropState(item)}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
        />
        {target && <NewSectionTarget {...target} />}
        </>
      )
    }
    case 'answer-key-heading':
      return <AnswerKeyHeading item={item} />
    case 'answer-key-section':
      return <AnswerKeySection item={item} />
    case 'answer-key-entry':
      return <AnswerKeyEntry item={item} />
    default: {
      const unreachable: never = item
      return unreachable
    }
  }
}

function keyOf(item: PageItem): string {
  switch (item.kind) {
    case 'paper-total':
      return 'paper-total'
    case 'section-heading':
      return `heading-${item.sectionId}`
    case 'question':
      // A split question never has two of its pieces on one page, so its id is
      // still unique within the page that keys by it.
      return `question-${item.question.id}`
    case 'answer-key-heading':
      return 'answer-key-heading'
    case 'answer-key-section':
      return `answer-key-section-${item.sectionId}`
    case 'answer-key-entry':
      return `answer-key-entry-${item.number}`
    default: {
      const unreachable: never = item
      return unreachable
    }
  }
}

// Clears the selection when the click landed on the background element
// itself — the page or the workspace — rather than bubbling up from a
// question or a control inside one.
function clearOnBackgroundClick(selection: Selection) {
  return (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
    if (event.target === event.currentTarget) selection.clear()
  }
}

/** Today's sheet, for a page drawn with no plan of its own behind it. */
export const PAGE_GEOMETRY = pageGeometry(US_LETTER)

// How long *editing* settles before the page is measured and packed again.
// Measurement is the expensive, DOM-touching half of the render, and the exam
// title is typed a keystroke at a time, so content changes wait for a pause.
//
// Reordering does not: a drop or a shuffle is one discrete gesture with nothing
// to coalesce, and waiting on it is just latency the teacher can feel. See
// `usePaginatedExam`.
const REPAGINATE_DEBOUNCE_MS = 150

// Pagination, kept in state rather than computed while rendering.
//
// `planExport` is pure, but the `Measure` the app gives it reads real layout,
// which cannot be done from inside a React render. So the first pass runs in a
// layout effect — before the browser paints, so no unpaginated flash is ever
// seen — and every pass after it is debounced.
//
// Two things can invalidate a measurement after the fact: a web font arriving
// (KaTeX loads its own), and an image finishing decoding, since an image whose
// bytes have not arrived measures as nothing. Each gets one re-measurement per
// edit — enough to settle, and bounded, so a measurement can never chase its
// own result round in a loop.
//
// The plan comes with the Exam it was planned from, which lags the Exam being
// edited while a pass waits: how the sheet tells it has caught up with an edit.
type PaginatedExam = { plan: LayoutPlan; plannedFrom: Exam }

function usePaginatedExam(
  exam: Exam,
  arrangement: Arrangement,
  workspace: RefObject<HTMLElement | null>,
  selection: ExportContentSelection,
): PaginatedExam {
  const { test, answerKey } = selection
  const [paginated, setPaginated] = useState<PaginatedExam>(() => ({
    plan: planExport({ exam, arrangement, selection, measure: unmeasured }),
    plannedFrom: exam,
  }))
  const measured = useRef(false)
  // What the last pagination was for, so this one can tell an edit from a
  // reorder. A `Arrangement` carries an ordering and nothing else, so a change to
  // it alone cannot alter a single item's height.
  const lastExam = useRef(exam)
  // Bumped when a font or an image has settled and the remembered heights have
  // been thrown away. It is a dependency rather than a captured callback so the
  // re-measure always runs against the current exam, never a stale closure.
  const [settled, setSettled] = useState(0)

  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let live = true
    const repaginate = () => setPaginated({
      plan: planExport({
        exam,
        arrangement,
        selection: { test, answerKey },
        measure: domMeasure,
      }),
      plannedFrom: exam,
    })
    const schedule = () => {
      if (!live) return
      clearTimeout(timer)
      timer = setTimeout(repaginate, REPAGINATE_DEBOUNCE_MS)
    }

    const edited = lastExam.current !== exam
    lastExam.current = exam

    if (!measured.current) {
      measured.current = true
      repaginate()
    } else if (edited) {
      // Content changed, and it may still be being typed.
      schedule()
    } else {
      // Ordering only. Nothing to wait for, and — because the items' markup is
      // unchanged apart from their printed numbers — almost every height comes
      // straight back out of `domMeasure`'s cache.
      clearTimeout(timer)
      repaginate()
    }

    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [exam, arrangement, workspace, test, answerKey, settled])

  // Assets settling is its own concern, and deliberately keyed on the exam
  // rather than the arrangement.
  //
  // `document.fonts.ready` is already resolved once the page has loaded, so a
  // `.then` attached per pagination fires on the very next microtask — every
  // time, reorders included. Left inside the effect above, that meant every
  // drop threw the measured heights away and paid for a second pagination,
  // which is exactly the cost the cache exists to avoid.
  //
  // Keyed on `exam`, it is what it was always meant to be: one re-measurement
  // per edit — enough to settle, and bounded, so a measurement can never chase
  // its own result round in a loop.
  //
  // It waits for every picture in the exam, not the first to arrive: a test of
  // maps re-measured when its first map loaded went on planning the rest as
  // nothing, and printed its questions off the foot of the page.
  //
  // A picture can also arrive later than that wait — one imported a moment ago
  // may not be servable yet — so a picture the page has not seen load before
  // re-measures it too, once per picture, which keeps it bounded.
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = () => {
      if (!live) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!live) return
        // Before the re-measure, never after: the whole point is that this
        // same markup measures differently now.
        domMeasure.invalidate()
        setSettled((count) => count + 1)
      }, 0)
    }
    const sources = imageSourcesOfDocuments(
      exam.questions.flatMap((question) => [question.doc, question.suggestedAnswer]),
    )
    Promise.all([
      document.fonts?.ready.catch(() => {}),
      domMeasure.loadImages(sources),
    ]).then(settle)
    const seen = new Set<string>()
    const onLoad = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLImageElement)) return
      const source = target.currentSrc || target.src
      if (seen.has(source)) return
      seen.add(source)
      settle()
    }
    const element = workspace.current
    element?.addEventListener('load', onLoad, true)
    return () => {
      live = false
      clearTimeout(timer)
      element?.removeEventListener('load', onLoad, true)
    }
  }, [exam, workspace])

  return paginated
}

// The sheet's Work Space drags (`WorkSpaceSizing`), held here, above the
// questions, by the position each sizes. A release is held against the sheet
// as it stood when the pointer came up, and lets go once the sheet has caught
// up with it (`work-space-preview.ts`).
function useWorkSpaceSizing(exam: Exam, plannedFrom: Exam): WorkSpaceSizing {
  const [previews, setPreviews] = useState(NO_WORK_SPACE_PREVIEWS)
  const sheet: SheetState = { exam, plannedFrom }
  useEffect(() => {
    setPreviews((current) => settled(current, { exam, plannedFrom }))
  }, [exam, plannedFrom])
  return {
    shownHeight: (positionId, planned) => shownHeight(previews, positionId, planned, sheet),
    isSizing: (positionIds) => positionIds.some((positionId) => previews.get(positionId)?.released === null),
    onPreview: (positionId, height) => setPreviews((current) => dragged(current, positionId, height)),
    onRelease: (positionId, committed) =>
      setPreviews((current) => released(current, positionId, committed, sheet)),
  }
}

// The print Export Adapter's own document.
//
// One export is the canonical student test and answer key for one immutable
// Arrangement. This mounts every planned page in preparation order for the internal
// print-reference and preview paths.
//
// It plans nothing. `ExamPage` above paginates what the teacher is editing;
// this draws plans that were already resolved, which is what lets several
// Arrangements print together without any of them being repaginated per format.
// Each document is its own workspace, and print CSS breaks a page between them.
export function ExportPreview({ plan }: { plan: LayoutPlan }) {
  return (
    <main className="exam-workspace" style={pageGeometry(plan.pageSize)}>
      {plan.pages.map((page) => (
        <article
          className="exam-page"
          key={`${page.stream}-${page.header}-${page.number}`}
          data-paper={plan.pageSize.paper}
        >
          <PageHeaderContent header={page.header} furniture={page.furniture} />
          <div
            className="page-content"
            style={pageContentStyle(plan.textSize)}
            data-paper-style={plan.paperStyle}
          >
            {page.items.map((item) => (
              <PageItemMeasureView key={keyOf(item)} item={item} />
            ))}
          </div>
          <PageFooterContent furniture={page.furniture} />
        </article>
      ))}
    </main>
  )
}

export function ExamPage({
  exam,
  arrangement,
  selection,
  drag,
  revealQuestionId,
  onRevealed,
  onEdit,
  onDuplicate,
  onShuffleSelected,
  onShuffleSelectedAnswers,
  onSetShownIncorrect,
  onRemove,
  onSetColumns,
  onSetWordBankLayout,
  onSetWorkSpace,
  onSetPoints,
  onTitleChange,
  onSectionHeadingChange,
  onMoveSection,
  onDeleteSection,
  onSplitSection,
  onMoveToNewSection,
  onInsertSection,
  onMergeSection,
  onHeaderLineChange,
  titleDisabled = false,
  unsavedDraft = false,
  contentSelection = { test: true, answerKey: true },
  onPasteQuestions,
  onSetPictureSize,
}: {
  exam: Exam
  arrangement: Arrangement
  selection: Selection
  /** The gesture in flight, coordinated across both panes of the workspace. */
  drag: WorkspaceDrag
  /** A question an authoring action has just put on the Working Copy. It is
   *  scrolled to and briefly highlighted once repagination has actually put it
   *  on a page — which, for an insertion, is not the same moment. */
  revealQuestionId?: string | null
  onRevealed?: () => void
  onEdit: (questionId: string) => void
  onDuplicate: (questionId: string) => void
  onShuffleSelected: (questionIds: readonly string[]) => void
  onShuffleSelectedAnswers: (questionIds: readonly string[]) => void
  /** Has Multiple Choice questions show this many incorrect answers;
   *  `Infinity` shows them all. */
  onSetShownIncorrect?: (questionIds: readonly string[], count: number) => void
  onRemove: (questionIds: readonly string[]) => void
  onSetColumns: (questionIds: readonly string[], columns: ColumnSetting) => void
  /** Sets where Matching questions' Word Banks print. Absent offers no
   *  Word Bank menu. */
  onSetWordBankLayout?: (questionIds: readonly string[], layout: WordBankLayout) => void
  /** Changes the room left for work below Short Answer questions. */
  onSetWorkSpace: SetWorkSpace
  /** Sets Points from the sheet, editing the Question in its bank. Absent
   *  offers no Points controls. */
  onSetPoints?: SetPoints
  /** Renames the Exam from its own title line. See `PageHeaderContent`. */
  onTitleChange?: (title: string) => void
  /** Rewords a section heading from where it prints. See `EditableSectionHeading`. */
  onSectionHeadingChange?: SetSectionHeading
  /** Moves a Question Section past its neighbour. */
  onMoveSection?: (sectionId: string, direction: -1 | 1) => void
  /** Deletes a Question Section and Removes its questions. */
  onDeleteSection?: (sectionId: string) => void
  /** Starts a new Section at a question, taking the rest of its Section. */
  onSplitSection?: (questionId: string) => void
  /** Makes questions one new Section where the first of them is. */
  onMoveToNewSection?: (questionIds: readonly string[]) => void
  /** Inserts an empty Section beside one, returning the new Section's id. */
  onInsertSection?: (sectionId: string, placement: SectionPlacement) => string | null
  /** Merges a Section with its neighbour above (`-1`) or below (`1`). */
  onMergeSection?: (sectionId: string, direction: -1 | 1) => void
  /** Rewords a test page's header line; `null` restores its default. */
  onHeaderLineChange?: (line: HeaderLine, text: string | null) => void
  titleDisabled?: boolean
  unsavedDraft?: boolean
  contentSelection?: ExportContentSelection
  /** Cmd/Ctrl-V of copied Questions: the Questions the paste names, in the
   *  order they were copied, and the selected question they go after — the
   *  last one on the page — or `null` for the end of the Exam. */
  onPasteQuestions?: (questionIds: string[], after: string | null) => void
  /** Sets how wide this Exam prints one of a question's pictures, as a share
   *  of its container; `null` goes back to its Default Picture Size. */
  onSetPictureSize?: (questionId: string, picture: string, size: number | null) => void
}) {
  const workspace = useRef<HTMLElement | null>(null)
  // The one picture or Work Space selected for resizing (ADR-0050). A press
  // anywhere lets it go first; a press on a piece then takes it again.
  const [piece, setPiece] = useState<SheetPiece | null>(null)
  useEffect(() => {
    const release = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.('.work-space-handle, .sheet-picture-handle')) return
      setPiece(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPiece(null)
    }
    document.addEventListener('pointerdown', release, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', release, true)
      document.removeEventListener('keydown', escape)
    }
  }, [])
  // A released corner drag's size, held until the sheet is planned with it —
  // as a Work Space drag's height is (`work-space-preview.ts`).
  const [pictureHolds, setPictureHolds] = useState(NO_WORK_SPACE_PREVIEWS)

  const blank = exam.questions.length === 0
  const { plan, plannedFrom } = usePaginatedExam(exam, arrangement, workspace, contentSelection)
  useEffect(() => {
    setPictureHolds((current) => settled(current, { exam, plannedFrom }))
  }, [exam, plannedFrom])
  const pieces = useMemo<SheetPieces>(() => {
    const sheet = { exam, plannedFrom }
    return {
      selected: piece,
      select: setPiece,
      ...(onSetPictureSize ? { onResizePicture: onSetPictureSize } : {}),
      heldPictureSize: (held, planned) => shownHeight(pictureHolds, held, { height: planned ?? -1 }, sheet),
      holdPictureSize: (held, size) =>
        setPictureHolds((current) => released(dragged(current, held, size), held, true, sheet)),
    }
  }, [piece, onSetPictureSize, pictureHolds, exam, plannedFrom])
  const workSpaceSizing = useWorkSpaceSizing(exam, plannedFrom)
  const pages = plan.pages
  const orderedIds = orderedQuestionIds(pages)
  const columnSettings = columnSettingsOf(exam)
  const clearOnBackground = clearOnBackgroundClick(selection)
  // Every Question on the draft, a Multipart or Matching Question being one.
  useSelectAll('exam-draft', workspace, orderedIds, selection.selectAll)
  // Cmd/Ctrl-C copies the selected Questions in page order; Cmd/Ctrl-V adds
  // copied ones after the last of them.
  const selectedInOrder = distinctIds(orderedIds).filter((id) => selection.isSelected(id))
  useQuestionClipboard(
    'exam-draft',
    workspace,
    selectedInOrder.flatMap((id) => exam.questions.filter((question) => question.id === id)),
    (questionIds) => onPasteQuestions?.(questionIds, selectedInOrder.at(-1) ?? null),
  )
  // Dragging is coordinated above this pane, because one gesture spans both of
  // them: a Question Bank question composed onto the Working Copy starts in the
  // other pane entirely. What stays here is what only this pane knows — which
  // questions a gesture picks up, and what their markup is — and the pointer
  // capture and page-owned preview that gesture has always used.
  const { draggedQuestionIds, droppedQuestionIds } = drag
  // The page order when a reorder was lifted. See the landing effect below.
  const orderAtLift = useRef<string | null>(null)
  const beginDrag = useCallback((
    question: PlannedQuestion,
    element: HTMLElement,
    point: { x: number; y: number },
  ) => {
    const ids = selection.isSelected(question.id)
      ? [...new Set(orderedIds.filter((id) => selection.isSelected(id)))]
      : [question.id]
    if (!selection.isSelected(question.id)) {
      selection.selectOne(question.id, orderedIds, {
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      })
    }
    const elements = Array.from(
      workspace.current?.querySelectorAll<HTMLElement>('.exam-question[data-question-id]') ?? [],
    ).filter((candidate) => ids.includes(candidate.dataset.questionId ?? ''))
    orderAtLift.current = orderedIds.join('\n')
    drag.begin(
      { pane: 'exam-draft', questionIds: ids, type: question.type },
      { elements, bounds: element.getBoundingClientRect(), point },
    )
  }, [drag, orderedIds, selection])

  // A question split across sheets draws its line above on its first piece and
  // its line below on its last, which is where the drop would actually land.
  const piecesOf = new Map<string, { first: QuestionItem; last: QuestionItem }>()
  for (const item of pages.flatMap((page) => page.items)) {
    if (item.kind !== 'question') continue
    const pieces = piecesOf.get(item.question.id)
    if (pieces) pieces.last = item
    else piecesOf.set(item.question.id, { first: item, last: item })
  }
  const questionDropState = (item: QuestionItem): QuestionDropState => {
    const state = dropStateOf(drag.intent, item.question.id)
    const pieces = piecesOf.get(item.question.id)
    if (state === 'before') return pieces?.first === item ? state : null
    if (state === 'after') return pieces?.last === item ? state : null
    return null
  }

  // Following a reordered question to where it landed.
  //
  // A drop lands at the nearest legal line, which need not be anywhere near
  // the pointer — a question flicked into another section goes to the edge of
  // its own, perhaps sheets away. A reorder repaginates in the same frame, but
  // the commit that records the drop is still drawing the old order, so this
  // waits until the page order has actually changed from the one the gesture
  // lifted, then scrolls the moved question into view. A drop that moved
  // nothing never changes the order, and scrolls nowhere.
  useLayoutEffect(() => {
    if (droppedQuestionIds.size === 0 || orderAtLift.current === null) return
    if (orderedIds.join('\n') === orderAtLift.current) return
    orderAtLift.current = null
    const moved = orderedIds.find((id) => droppedQuestionIds.has(id))
    if (!moved) return
    workspace.current
      ?.querySelector<HTMLElement>(`.exam-question[data-question-id="${CSS.escape(moved)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [plan, droppedQuestionIds, orderedIds])

  // Revealing a question an authoring action has just put on the Working Copy.
  //
  // Insertion changes the exam's *content*, and content changes wait
  // for a pause before the page is measured and packed again. So the question
  // is not on the page in the frame the action was taken — it arrives one
  // repagination later, possibly on a different sheet from the one that was in
  // view. This runs on every plan until the question is actually there, then
  // scrolls to it. Being scrolled to is the whole of the reveal: the question
  // is selected, which is a mark that stays put, and a second mark that faded
  // out over it only made the selection look like it was arriving late.
  useEffect(() => {
    if (!revealQuestionId) return
    const element = workspace.current?.querySelector<HTMLElement>(
      `.exam-question[data-question-id="${CSS.escape(revealQuestionId)}"]`,
    )
    // Not paginated onto a page yet: this effect runs again on the next plan.
    if (!element) return
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    onRevealed?.()
  }, [revealQuestionId, plan, onRevealed])

  // Keyed on the numbered piece: a split question's handles and menu belong to
  // the piece carrying its number, and that is the one holding its `number`.
  const questionsById = new Map(
    pages
      .flatMap((page) => page.items)
      .flatMap((item) =>
        item.kind === 'question' && item.numbered
          ? [[item.question.id, item.question] as const]
          : [],
      ),
  )
  // The Exam's Sections, and the one each question is in: what a Section's
  // controls, and a gesture reading the sheet, both need.
  const sections = sectionsOf(exam)
  const sectionOfQuestion = new Map(
    sections.flatMap((section) =>
      questionsInSection(exam, arrangement, section.id).map(({ id }) => [id, section.id] as const),
    ),
  )
  const sectionIdOf = (questionId: string) => sectionOfQuestion.get(questionId) ?? ''
  // Where each Section is drawn: one band per sheet it appears on, across the
  // paper's whole width, from just above its heading — its dashed rule — to
  // where the next Section begins, or just below its last piece. Read off the
  // rendered pieces, since a Section may run across several sheets and the
  // plan knows nothing of where they are drawn. Each band is kept both from
  // its sheet's top edge, for the highlight drawn on the sheet, and from the
  // workspace's, for the controls drawn in the gutter beside it.
  const [sectionBands, setSectionBands] = useState<SectionBand[]>([])
  const measureSectionBands = useCallback(() => {
    const root = workspace.current
    if (!root) return
    const origin = root.getBoundingClientRect()
    const bands: SectionBand[] = []
    root.querySelectorAll<HTMLElement>('.exam-page').forEach((page, pageIndex) => {
      // An open new-Section target is a Section in the making: the Section
      // above it ends where it begins.
      const pieces = [...page.querySelectorAll<HTMLElement>(
        '.page-content [data-section-id], .page-content [data-new-section-after]',
      )].map((piece) => {
        const box = piece.getBoundingClientRect()
        return { sectionId: piece.dataset.sectionId ?? NEW_SECTION_BAND, top: box.top, bottom: box.bottom }
      })
      bands.push(...sheetBands(pieces, pageIndex, page.getBoundingClientRect(), origin))
    })
    setSectionBands((current) =>
      current.length === bands.length
      && current.every((band, index) => sameBand(band, bands[index]!))
        ? current
        : bands,
    )
  }, [])
  useLayoutEffect(measureSectionBands, [measureSectionBands, plan, drag.intent])
  useEffect(() => {
    // A target that opens in the sheet's flow grows into place, so the bands
    // are read again once it has.
    const root = workspace.current
    window.addEventListener('resize', measureSectionBands)
    root?.addEventListener('animationend', measureSectionBands)
    return () => {
      window.removeEventListener('resize', measureSectionBands)
      root?.removeEventListener('animationend', measureSectionBands)
    }
  }, [measureSectionBands])
  // The sheet also moves under the bands without a new plan: a picture that
  // decodes after the page was drawn, a cleared heading that opens while it
  // has focus, a field that wraps as it is typed in. Bands read before such a
  // shift drew their rules where the heading used to be — through its
  // directions — so every piece a band is read from, and each sheet's header
  // above them, is watched, and the bands are read again when any resizes.
  useLayoutEffect(() => {
    const root = workspace.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measureSectionBands())
    for (const element of root.querySelectorAll<HTMLElement>(
      '.exam-page .page-header, .page-content [data-section-id], .page-content [data-new-section-after]',
    )) {
      observer.observe(element)
    }
    return () => observer.disconnect()
  }, [measureSectionBands, plan, drag.intent])
  // The Section band the pointer is in, anywhere across its rows — never while
  // a gesture is in flight, which has its own feedback to give.
  const [pointedBand, setPointedBand] = useState<SectionBand | null>(null)
  // A Section just moved from its controls: where its band was, and where on
  // screen. Once the sheet has repaginated, the Exam is scrolled so its band —
  // and its controls — are back where they were, under a pointer that has not
  // moved, ready to be pressed again.
  //
  // A move repaginates in more than one pass — once at once, and again as
  // what it moved is measured afresh — so the Exam is scrolled back into place
  // after every pass that moves the Section, for as long as the move is recent.
  const moveAnchor = useRef<{
    sectionId: string
    from: SectionBand
    screenTop: number
    until: number
  } | null>(null)
  useLayoutEffect(() => {
    const anchor = moveAnchor.current
    const root = workspace.current
    if (!anchor || !root) return
    if (performance.now() > anchor.until) {
      moveAnchor.current = null
      return
    }
    const band = sectionBands.find(({ sectionId }) => sectionId === anchor.sectionId)
    if (!band || sameBand(band, anchor.from)) return
    anchor.from = band
    const lane = root.closest('.editor-output')
    const scroller =
      lane && /auto|scroll/.test(getComputedStyle(lane).overflowY)
        ? lane
        : document.scrollingElement
    if (scroller) {
      scroller.scrollTop += root.getBoundingClientRect().top + band.top - anchor.screenTop
    }
    setPointedBand(band)
  }, [sectionBands])
  const pointAt = (clientY: number, target: EventTarget | null) => {
    // Over the controls themselves, they stay with their Section, however
    // short it is: reaching down to delete an empty Section must not pass
    // into the next one first.
    if (target instanceof Element && target.closest('.section-rail')) return
    const origin = workspace.current?.getBoundingClientRect()
    if (!origin || drag.source) return setPointedBand(null)
    const y = clientY - origin.top
    const band = sectionBands.find(({ top, bottom }) => y >= top && y < bottom) ?? null
    setPointedBand((current) => (current && band && sameBand(current, band) ? current : band))
  }
  // The Section pointed at through its controls, whose every band is
  // highlighted so the teacher sees what they would move or delete. Editing
  // its heading highlights nothing.
  const [hoveredSectionId, setHoveredSectionId] = useState<string | null>(null)
  // The Section whose more menu is open, and where it hangs. The Section stays
  // highlighted while it is open, as it is while its controls are pointed at:
  // the menu, portalled away from the rail, is still acting on it.
  const [sectionMenu, setSectionMenu] = useState<{ sectionId: string; point: MenuPoint } | null>(null)
  const closeSectionMenu = useCallback(() => setSectionMenu(null), [])
  const highlightedSectionId = drag.source ? null : hoveredSectionId ?? sectionMenu?.sectionId ?? null
  // The Section ruled off above and below: the one the pointer is in, or,
  // mid-gesture, the one it would land in. An armed new-Section target rules
  // itself off instead.
  const intent = drag.intent
  const ruledSectionId = drag.source
    ? intent?.kind === 'insert'
      ? sectionOfQuestion.get(intent.targetQuestionId) ?? null
      : intent?.kind === 'section-end'
        ? intent.sectionId
        : null
    : pointedBand?.sectionId ?? null
  // A cleared heading its controls asked to open, until its field has focus.
  const [revealTitleOf, setRevealTitleOf] = useState<string | null>(null)
  const sectionControls =
    onMoveSection && onDeleteSection && onInsertSection && onMergeSection
      ? (sectionId: string): SectionControls => {
          const index = sections.findIndex(({ id }) => id === sectionId)
          return {
            canMoveUp: index > 0,
            canMoveDown: index >= 0 && index < sections.length - 1,
            onMove: (direction) => {
              // Where this Section's controls are on screen now, so the sheet
              // can be scrolled to put them back there once it has moved.
              const band = pointedBand?.sectionId === sectionId ? pointedBand : null
              const origin = workspace.current?.getBoundingClientRect()
              moveAnchor.current = band && origin
                ? {
                    sectionId,
                    from: band,
                    screenTop: origin.top + band.top,
                    until: performance.now() + MOVE_ANCHOR_MS,
                  }
                : null
              onMoveSection(sectionId, direction)
            },
            onDelete: () => onDeleteSection(sectionId),
            // A Section inserted empty has a heading waiting to be typed over,
            // so its heading takes focus once it is on the sheet.
            onInsert: (placement) => {
              const inserted = onInsertSection(sectionId, placement)
              if (inserted) setRevealTitleOf(inserted)
            },
            onMerge: (direction) => onMergeSection(sectionId, direction),
          }
        }
      : undefined
  // The question after this one in its Section, where a Section inserted
  // below this one begins; `null` for the last of its Section.
  const nextInSection = (questionId: string): string | null => {
    const section = sectionOfQuestion.get(questionId)
    const inSection = distinctIds(orderedIds).filter((id) => sectionOfQuestion.get(id) === section)
    return inSection[inSection.indexOf(questionId) + 1] ?? null
  }
  // What a question's menu offers for Sections, asking the Exam's own rules
  // whether each would change anything rather than restating them here.
  const questionSectionActions: QuestionSectionActions | undefined =
    onSplitSection && onMoveToNewSection
      ? {
          canSplit: (questionId) => {
            const next = nextInSection(questionId)
            return next
              ? splitSection(exam, arrangement, next, () => '') !== null
              : onInsertSection !== undefined && sectionOfQuestion.has(questionId)
          },
          onSplit: (questionId) => {
            const next = nextInSection(questionId)
            if (next) onSplitSection(next)
            else onInsertSection?.(sectionOfQuestion.get(questionId)!, 'below')
          },
          canMoveToNewSection: (questionIds) =>
            moveToNewSection(exam, arrangement, questionIds, () => '') !== null,
          onMoveToNewSection,
        }
      : undefined
  // Where a gesture has opened a new-Section target: beneath the last piece of
  // the last question of that Section it is not carrying — or, for an empty
  // Section, beneath its box.
  const opensBelow = drag.intent?.opensBelow ?? null
  const armed = drag.intent?.kind === 'new-section' && drag.intent.armed
  const footQuestionId = opensBelow
    ? orderedIds
        .filter((id) => sectionOfQuestion.get(id) === opensBelow && !draggedQuestionIds.has(id))
        .at(-1) ?? null
    : null
  const newSectionTarget = (item: PageItem): NewSectionTargetState | null => {
    if (!opensBelow) return null
    const target: NewSectionTargetState = { afterSectionId: opensBelow, armed }
    // An empty Section never has a new Section opened beneath it.
    if (item.kind === 'section-heading') return null
    if (item.kind !== 'question' || item.question.id !== footQuestionId) return null
    return piecesOf.get(item.question.id)?.last === item ? target : null
  }
  const emptySectionActive = (sectionId: string) =>
    drag.intent?.kind === 'section-end' && drag.intent.sectionId === sectionId
  // An Exam with nothing on it yet: the whole pane is the target, and the
  // first question starts its first Section.
  const startsFirstSection =
    drag.intent?.kind === 'new-section' && drag.intent.afterSectionId === null
  // Which question's menu is open, and where it was raised. Held here rather
  // than per question, so opening one menu closes any other by construction.
  const [menu, setMenu] = useState<{
    questionId: string
    point: MenuPoint
    side: MenuSide
    /** The Part or Subpart a right-click landed on, if it was one. */
    partId: string | null
    /** The picture a right-click landed on, by its `pictureKey`, if any. */
    picture: string | null
  } | null>(null)
  // Set as a right-click passes down through the sheet, and taken by the menu
  // it opens; a menu opened any other way finds none.
  const pointedPart = useRef<string | null>(null)
  const pointedPicture = useRef<string | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const openMenu = useCallback(
    (questionId: string, point: MenuPoint, side: MenuSide = 'right') => {
      // A menu raised from outside the selection changes the command scope to
      // that question. Raised from inside it, the selection remains intact.
      if (!selection.isSelected(questionId)) selection.select(questionId)
      setMenu({ questionId, point, side, partId: pointedPart.current, picture: pointedPicture.current })
      pointedPart.current = null
      pointedPicture.current = null
    },
    [selection],
  )
  // A question deleted while its own menu is open leaves the menu with nothing
  // to act on, so it simply stops being rendered.
  const menuQuestion = menu ? questionsById.get(menu.questionId) : undefined

  // The name is typed once, on the first sheet that prints it. Every later
  // repetition — a continuation page's, the answer key's — is that same name
  // shown again, so it is drawn as text rather than as a second field.
  const titleLine = pages.findIndex((page) => page.furniture.title !== null)
  // Every test page's header line can be typed on, and every later page shows
  // the one later line: they are the same words printed again.
  const identityEditorFor = (header: PageHeader): IdentityLineEditor | undefined => {
    if (!onHeaderLineChange || (header !== 'first' && header !== 'later')) return undefined
    return {
      text: headerLineOf(exam.header, header),
      edited: exam.header?.[header] !== undefined,
      disabled: titleDisabled,
      onChange: (text) => onHeaderLineChange(header, text),
    }
  }
  const workspaceClasses = ['exam-workspace']
  if (unsavedDraft) workspaceClasses.push('exam-workspace--unsaved')
  if (draggedQuestionIds.size > 0) workspaceClasses.push('exam-workspace--dragging')
  if (droppedQuestionIds.size > 0) workspaceClasses.push('exam-workspace--drop-feedback')

  return (
    <SheetPiecesContext.Provider value={pieces}>
    <main
      className={workspaceClasses.join(' ')}
      ref={workspace}
      onContextMenuCapture={(event) => {
        const target = event.target as HTMLElement
        pointedPart.current = target.closest<HTMLElement>('[data-part-id]')?.dataset.partId ?? null
        pointedPicture.current = target.closest<HTMLElement>('[data-picture-key]')?.dataset.pictureKey ?? null
      }}
      {...selectAllPaneProps('exam-draft')}
      style={pageGeometry(plan.pageSize)}
      data-drop-zone=""
      data-active={startsFirstSection ? 'true' : undefined}
      onClick={clearOnBackground}
      onPointerMove={(event) => {
        if (!drag.source && droppedQuestionIds.size > 0) drag.clearDropFeedback()
        pointAt(event.clientY, event.target)
      }}
      onPointerLeave={() => setPointedBand(null)}
    >
      {pages.map((page, index) => (
        <article
          className="exam-page"
          key={`${page.header}-${page.number}`}
          data-paper={plan.pageSize.paper}
          onClick={clearOnBackground}
        >
          {sectionBands
            .filter((band) => band.pageIndex === index && band.sectionId === highlightedSectionId)
            .map((band) => (
              <div
                key={band.sectionId}
                className="section-highlight"
                style={{ top: band.topInPage, height: band.height }}
                aria-hidden="true"
              />
            ))}
          {/* The Section the pointer is in — or, mid-gesture, the Section the
              gesture would land in — is marked off by a dashed rule at its
              real top and its real foot. A Section that runs over a page
              break draws no rule at the break, on either sheet. */}
          {ruledSectionId && sectionBands
            .filter((band) => band.pageIndex === index && band.sectionId === ruledSectionId)
            .flatMap((band) => {
              const edges = bandEdges(sectionBands, band)
              return [
                ...(edges.top
                  ? [
                      <div
                        key={`${band.sectionId}-top`}
                        className="section-rule"
                        style={{ top: band.topInPage }}
                        aria-hidden="true"
                      />,
                    ]
                  : []),
                ...(edges.bottom
                  ? [
                      <div
                        key={`${band.sectionId}-bottom`}
                        className="section-rule"
                        style={{ top: band.topInPage + band.height }}
                        aria-hidden="true"
                      />,
                    ]
                  : []),
              ]
            })}
          <PageHeaderContent
            header={page.header}
            furniture={page.furniture}
            identityEditor={identityEditorFor(page.header)}
            onTitleChange={index === titleLine ? onTitleChange : undefined}
            titleDisabled={titleDisabled}
          />
          <div
            className="page-content"
            style={pageContentStyle(plan.textSize)}
            data-paper-style={plan.paperStyle}
            onClick={clearOnBackground}
          >
            {/* An exam with nothing in it yet offers the first question where
                the first question will go, rather than leaving a blank sheet
                and a button in the header as the only way in. It is editing
                chrome: it appears only while the exam is empty, and it is
                never part of the printed document. It lights up with the
                pane, which is the drop target; it is not one of its own. */}
            {blank && index === 0 && (
              <div
                className="secondary-button empty-exam-button"
                data-active={startsFirstSection ? 'true' : undefined}
              >
                Drag or add a Question from an open Question Bank
              </div>
            )}
            {page.items.map((item) => (
              <PageItemView
                key={keyOf(item)}
                item={item}
                onSectionHeadingChange={onSectionHeadingChange}
                revealTitleOf={revealTitleOf}
                onTitleRevealed={() => setRevealTitleOf(null)}
                sectionHeadingDisabled={titleDisabled}
                sectionIdOf={sectionIdOf}
                newSectionTarget={newSectionTarget}
                emptySectionActive={emptySectionActive}
                orderedIds={orderedIds}
                selection={selection}
                onEdit={onEdit}
                onOpenMenu={openMenu}
                onSetWorkSpace={onSetWorkSpace}
                onSetPoints={onSetPoints}
                maxWorkSpace={maxWorkSpaceHeight(plan.pageSize, runningHeadHeight(plan.paperStyle))}
                workSpaceSizing={workSpaceSizing}
                draggedQuestionIds={draggedQuestionIds}
                droppedQuestionIds={droppedQuestionIds}
                dropState={questionDropState}
                onDragStart={beginDrag}
                onDragMove={drag.move}
                onDrop={drag.drop}
                onDragEnd={drag.cancel}
              />
            ))}
          </div>
          <PageFooterContent furniture={page.furniture} />
        </article>
      ))}

      {pointedBand && sectionControls && !drag.source && (
        <SectionRail
          controls={sectionControls(pointedBand.sectionId)}
          hidden={(() => {
            const section = sections.find(({ id }) => id === pointedBand.sectionId)
            return !!section && section.title === '' && section.instructions === ''
          })()}
          disabled={titleDisabled}
          style={{ top: pointedBand.top + SECTION_RULE_OFFSET, left: pointedBand.pageLeft }}
          menuOpen={sectionMenu?.sectionId === pointedBand.sectionId}
          onRevealTitle={() => setRevealTitleOf(pointedBand.sectionId)}
          onHover={(on) => setHoveredSectionId(on ? pointedBand.sectionId : null)}
          onOpenMenu={(point) => setSectionMenu({ sectionId: pointedBand.sectionId, point })}
        />
      )}

      {/* Held apart from the rail, which comes and goes with the pointer: the
          menu outlives the pointer leaving for it. A Section gone from under
          its open menu — merged away, undone — leaves nothing to act on. */}
      {sectionMenu && sectionControls && sections.some(({ id }) => id === sectionMenu.sectionId) && (
        <ContextMenu
          point={sectionMenu.point}
          ariaLabel="Section actions"
          items={sectionMenuItems(sectionControls(sectionMenu.sectionId))}
          onClose={closeSectionMenu}
        />
      )}

      {menu && menuQuestion && (
        <ContextMenu
          point={menu.point}
          side={menu.side}
          ariaLabel={`Question ${numberLabelOf(menuQuestion)} actions`}
          items={questionMenuItems({
            question: menuQuestion,
            columns: columnSettings[menuQuestion.id] ?? DEFAULT_COLUMNS,
            onEdit,
            onDuplicate,
            onShuffleSelected,
            onShuffleSelectedAnswers,
            shownIncorrect: (() => {
              const question = exam.questions.find(({ id }) => id === menuQuestion.id)
              if (!question) return null
              const actedOn = selection.selectedIds.has(question.id)
                ? exam.questions.filter(({ id }) => selection.selectedIds.has(id))
                : [question]
              return shownIncorrectMenuOf(question, actedOn, arrangement)
            })(),
            onSetShownIncorrect,
            onRemove,
            onSetColumns,
            wordBankLayout: (() => {
              const question = exam.questions.find(({ id }) => id === menuQuestion.id)
              return question?.type === 'matching' ? wordBankLayoutOf(exam, question) : 'beside'
            })(),
            onSetWordBankLayout,
            workSpace: workSpaceOf(exam, menuQuestion.id),
            workSpaceOfPart: (partId) => workSpaceOf(exam, partId),
            onSetWorkSpace,
            selectedQuestionIds: [...selection.selectedIds],
            sectionActions: questionSectionActions,
            pointedPartIds: pointedPartIdsOf(menuQuestion, menu.partId),
            // A picture this Exam has resized can go back to its own size.
            onResetPictureSize: menu.picture !== null
              && exam.pictureSizes?.[menuQuestion.id]?.[menu.picture] !== undefined
              && onSetPictureSize
              ? () => onSetPictureSize(menuQuestion.id, menu.picture!, null)
              : undefined,
          })}
          onClose={closeMenu}
        />
      )}
    </main>
    </SheetPiecesContext.Provider>
  )
}
