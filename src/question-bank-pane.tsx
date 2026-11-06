// The Question Bank, beside the Working Copy.
//
// A compact, scannable table of the canonical questions a teacher has written,
// newest first, with everything needed to find one and put it on the exam: a
// stem search, Question Type, Difficulty and Topic filters, and a row that
// opens and adds its own question. Beside an Exam it lists only what is not on
// the Exam yet: a Question leaves the list as it is added and returns when it
// is Removed, and a line under the list says how many are on the Exam. Where on the exam a question lands
// is said by dragging it there, rather than by a row action reaching for
// whatever happens to be selected on the sheet.
//
// A row is a projection, not a rendering (see `question-summary.tsx`, which
// the Exam Outline shares).
//
// Nothing here can Delete Question Content, and nothing here assembles an
// authoring action out of smaller ones: every action calls exactly one of the
// store's operations, so it is one undo step however it was reached. Search,
// Filter values and row selection are handed in rather than stored here. The
// workspace may persist filters, but neither state enters authoring history.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownAZ, Ellipsis, Pencil, Plus, Search, Upload } from 'lucide-react'
import { ContextMenu, type MenuItem, type MenuPoint } from './context-menu'
import { QuestionBankOutline } from './question-bank-outline'
import { QuestionReading } from './question-reading'
import { readingOfQuestion } from './question-reading-content'
import { stemPreview } from './stem-preview'
import type { Question, QuestionType } from './exam'
import { QuestionSummary, UNTITLED } from './question-summary'
import { BankQueryBar } from './bank-query-bar'
import type { QuestionBank } from './question-bank'
import type { WorkspaceDrag } from './use-workspace-drag'
import { DIFFICULTY_OPTIONS, SORT_OPTIONS, TYPE_OPTIONS, type FilterOption } from './question-bank-filter-options'
import { CopyQuestionButton } from './question-copy-feedback'
import { useQuestionCopy } from './use-question-copy'
import { selectAllPaneProps, useSelectAll } from './use-select-all'
import { useQuestionClipboard } from './use-question-clipboard'
import {
  NO_FILTER,
  browseQuestionBank,
  isFilterActive,
  topicOptions,
  type QuestionBankFilter,
  type QuestionBankSort,
} from './question-bank-view'

/** The width the filter list is laid out at, and the gap it keeps from the
 *  window edge. Both are also in the stylesheet; they are here because the
 *  list is placed against the viewport rather than by the cascade. */
const LIST_WIDTH = 190
const MARGIN = 8


/**
 * One filter category: a button that opens a list of the values in it.
 *
 * Every category permits several values, so these are checkboxes rather than a
 * choice — the view combines what is ticked with OR, and combines the
 * categories with AND.
 */
function FilterDropdown<T extends string>({
  label,
  options,
  selected,
  emptyMessage,
  onChange,
}: {
  label: string
  options: readonly FilterOption<T>[]
  selected: readonly T[]
  emptyMessage: string
  onChange: (values: T[]) => void
}) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // Where the list sits, in viewport coordinates. The bank scrolls, so a list
  // positioned within it is clipped by the pane it belongs to; anchoring it to
  // the viewport is what lets a list longer than the bank is tall still be
  // read. Measured when it opens, and again if the workspace moves under it.
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)

  const placeList = useCallback(() => {
    const bounds = button.current?.getBoundingClientRect()
    if (!bounds) return
    // The list stays over the bank it belongs to. Past the pane's right edge
    // are the divider and the rendered sheet — a different surface, and a list
    // spilling onto the paper reads as something printed on it.
    const pane = container.current?.closest('.question-bank')?.getBoundingClientRect()
    const limit = (pane?.right ?? window.innerWidth) - MARGIN
    // Right-aligned to the button when a left-aligned list would run past that
    // edge, which is the ordinary case for the filters at the pane's own end.
    const wanted = bounds.left + LIST_WIDTH > limit ? bounds.right - LIST_WIDTH : bounds.left
    setAnchor({
      left: Math.max(MARGIN, Math.min(wanted, limit - LIST_WIDTH)),
      top: bounds.bottom + 4,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    placeList()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      // The list is portalled out of this element, so "outside" means outside
      // both halves of the control.
      if (container.current?.contains(target) || list.current?.contains(target)) return
      setOpen(false)
    }
    // A scroll or a resize moves the button out from under its own list.
    const reposition = () => placeList()
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, placeList])

  return (
    <div
      className="bank-filter"
      ref={container}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        // Closing the list is the whole of what Escape means while it is open;
        // the workspace listens for the same key to clear its selection.
        event.stopPropagation()
        setOpen(false)
      }}
    >
      <button
        ref={button}
        type="button"
        className="bank-filter-button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        data-active={selected.length > 0 ? 'true' : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
        {selected.length > 0 && <span className="bank-filter-count">{selected.length}</span>}
      </button>
      {/* Portalled to the body: the bank pane clips what overflows it, so a
          list left inside is cut off at the pane's own edge — and in the Exam
          editor it is painted under the divider and the sheet besides,
          however high its `z-index` is. */}
      {open && anchor && createPortal(
        <div
          className="bank-filter-list"
          ref={list}
          role="group"
          aria-label={label}
          style={{ left: anchor.left, top: anchor.top }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            setOpen(false)
            button.current?.focus()
          }}
        >
          {options.length === 0 ? (
            <p className="bank-filter-empty">{emptyMessage}</p>
          ) : (
            options.map((option) => (
              <label className="bank-filter-option" key={option.value}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option.value]
                        : selected.filter((value) => value !== option.value),
                    )
                  }
                />
                {option.label}
              </label>
            ))
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

export function QuestionBankPane({
  bank,
  layout = 'rows',
  heading,
  moreItems = [],
  workingCopyIds,
  filter,
  onFilterChange,
  selectedQuestionIds,
  onSelect,
  onClearSelection,
  onSelectAll,
  onCreate,
  onExport,
  exportBlocked = false,
  onEdit,
  onAddToWorkingCopy,
  onAddManyToWorkingCopy,
  onPasteQuestions,
  drag,
}: {
  bank: QuestionBank
  /** `rows` is the compact table beside the Working Copy. `page` is the
   *  Question Bank page, where the bank is the whole screen: each Question is
   *  read in full, as the import dialog previews a bank, and a click opens
   *  it in the Question editor. */
  layout?: 'rows' | 'page'
  /** What names the bank above the filters. The Exam editor's pane says which
   *  pane this is; the Question Bank page hands in its own editable name,
   *  which is already the page's title and leaves no room for a second one. */
  heading?: ReactNode
  /** Actions belonging to the surface the pane is mounted on rather than to
   *  the bank, laid out ahead of the bank's own. */
  /** What the surface adds to the bank page's More menu, before Export. */
  moreItems?: readonly MenuItem[]
  /** Which bank records the Working Copy currently references. Beside an
   *  Exam these are not listed at all: the pane offers what is left to add,
   *  so a Question leaves it as it is added and returns when it is Removed. */
  workingCopyIds: ReadonlySet<string>
  filter: QuestionBankFilter
  onFilterChange: (filter: QuestionBankFilter) => void
  /** The rows a teacher has clicked. Transient: selecting is not an authoring
   *  action. */
  selectedQuestionIds: ReadonlySet<string>
  onSelect: (
    questionId: string,
    orderedIds: readonly string[],
    modifiers: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => void
  onClearSelection: () => void
  /** Cmd/Ctrl-A: every Question the search and filters currently show. */
  onSelectAll: (orderedIds: readonly string[]) => void
  onCreate?: (point: MenuPoint) => void
  /** Exports this complete active bank, never the filtered row projection. */
  onExport?: () => void
  /** An open Question editor must be resolved before export can begin. */
  exportBlocked?: boolean
  onEdit: (questionId: string) => void
  onAddToWorkingCopy?: (questionId: string) => void
  /** Adds every supplied, currently visible bank record as one composition. */
  onAddManyToWorkingCopy?: (questionIds: readonly string[]) => void
  /** Cmd/Ctrl-V of copied Questions: the Questions the paste names, in the
   *  order they were copied (see `question-clipboard.ts`). */
  onPasteQuestions?: (questionIds: string[]) => void
  /** The gesture in flight. Every listed row is a drag source onto the
   *  Working Copy: a Question already on it is not listed at all. */
  drag: WorkspaceDrag
}) {
  const [moreMenu, setMoreMenu] = useState<MenuPoint | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const copying = useQuestionCopy()
  // Beside an Exam the rows are what can still be added to it. The Question
  // Bank page lists every Question, and is handed no Working Copy.
  const questions = browseQuestionBank(bank, filter)
    .filter(({ id }) => layout === 'page' || !workingCopyIds.has(id))
  const inExamCount = layout === 'rows'
    ? bank.questions.filter(({ id }) => workingCopyIds.has(id)).length
    : 0
  const allInExam = inExamCount > 0 && inExamCount === bank.questions.length
  const orderedIds = questions.map(({ id }) => id)
  const root = useRef<HTMLElement>(null)
  useSelectAll('question-bank', root, orderedIds, onSelectAll)
  // Cmd/Ctrl-C copies the selected Questions, in the bank's order; Cmd/Ctrl-V
  // brings copied ones in.
  useQuestionClipboard(
    'question-bank',
    root,
    bank.questions.filter(({ id }) => selectedQuestionIds.has(id)),
    (questionIds) => onPasteQuestions?.(questionIds),
  )
  const addableQuestions = questions
  const filtered = isFilterActive(filter)
  // A gesture that has not yet moved far enough to be a drag. One pointer
  // drags at a time, so this is the pane's rather than each row's — and until
  // it passes the threshold a press is still on its way to being a click.
  const gesture = useRef<{
    id: number
    questionId: string
    type: QuestionType
    startX: number
    startY: number
    dragging: boolean
  } | null>(null)
  // The row whose next click is the tail of a drag rather than a selection.
  // Kept as an id rather than a flag, and given up on its own, so a click that
  // never arrives — a row remounted under the pointer, a capture lost on a path
  // nobody has thought of — cannot leave the whole bank unclickable.
  const suppressClickFor = useRef<string | null>(null)

  const forgetSuppressedClick = () => {
    setTimeout(() => {
      suppressClickFor.current = null
    }, 0)
  }

  const releasePointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /** The pointer handlers a row carries when there is an Exam to add it to. */
  const dragHandlers = (question: Question) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement
      if (target.closest('button, input, textarea, select, a')) return
      gesture.current = {
        id: event.pointerId,
        questionId: question.id,
        type: question.type,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      }
      suppressClickFor.current = null
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const held = gesture.current
      if (!held || held.id !== event.pointerId) return
      if (!held.dragging) {
        const distance = Math.hypot(
          event.clientX - held.startX,
          event.clientY - held.startY,
        )
        if (distance < 5) return
        held.dragging = true
        suppressClickFor.current = held.questionId
        const questionIds = selectedQuestionIds.has(held.questionId)
          ? questions
              .filter((candidate) => selectedQuestionIds.has(candidate.id))
              .map(({ id }) => id)
          : [held.questionId]
        if (!selectedQuestionIds.has(held.questionId)) {
          onSelect(held.questionId, orderedIds, {
            shiftKey: false,
            metaKey: false,
            ctrlKey: false,
          })
        }
        const elements = Array.from(
          event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
            '.question-bank-row[data-question-id]',
          ) ?? [],
        ).filter((candidate) => questionIds.includes(candidate.dataset.questionId ?? ''))
        drag.begin(
          { pane: 'question-bank', questionIds, type: held.type },
          {
            elements,
            bounds: event.currentTarget.getBoundingClientRect(),
            point: { x: held.startX, y: held.startY },
          },
        )
      }
      event.preventDefault()
      drag.move({ x: event.clientX, y: event.clientY })
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const held = gesture.current
      if (!held || held.id !== event.pointerId) return
      gesture.current = null
      releasePointer(event)
      if (!held.dragging) return
      event.preventDefault()
      drag.drop()
      // The click this press is about to raise is the one to swallow. A timer
      // rather than a flag left standing: click is dispatched before timers, so
      // this runs after the click that is coming and nothing survives it.
      forgetSuppressedClick()
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
      const held = gesture.current
      if (!held || held.id !== event.pointerId) return
      gesture.current = null
      releasePointer(event)
      if (held.dragging) {
        suppressClickFor.current = null
        drag.cancel()
      }
    },
    onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => {
      const held = gesture.current
      if (!held || held.id !== event.pointerId) return
      gesture.current = null
      if (held.dragging) {
        suppressClickFor.current = null
        drag.cancel()
      }
    },
  })

  // Beside an Exam the bank is queried as a Notion database is: a search box,
  // Filter and Sort, what is set as chips beneath, and New at the end. Adding
  // everything shown is Cmd/Ctrl-A and a drag, as for any selection.
  const newQuestion = onCreate && (
    <button
      type="button"
      className="primary-button bank-query-new"
      aria-label="New question"
      aria-haspopup="menu"
      onClick={(event) => {
        // Below the button and aligned with it, so the list of types reads as
        // belonging to the control that asked for it.
        const bounds = event.currentTarget.getBoundingClientRect()
        onCreate({ x: bounds.left, y: bounds.bottom + 4 })
      }}
    >
      <Plus aria-hidden="true" />
      New
    </button>
  )
  const queryBar = (
    <BankQueryBar
      filter={filter}
      topics={topicOptions(bank)}
      onChange={onFilterChange}
      trailing={newQuestion}
    />
  )

  const filterBar = (
      <div className="question-bank-filters">
        <div className="bank-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            aria-label="Search question stems"
            placeholder="Search questions"
            value={filter.search}
            onChange={(event) => onFilterChange({ ...filter, search: event.target.value })}
          />
        </div>
        {/* The page's outline chooses a type and a topic; only the pane beside
            the Working Copy, which has no outline, needs them as lists. */}
        {layout === 'rows' && <FilterDropdown
          label="Question Type"
          options={TYPE_OPTIONS}
          selected={filter.types}
          emptyMessage="No Question Types"
          onChange={(types) => onFilterChange({ ...filter, types })}
        />}
        <FilterDropdown
          label="Difficulty"
          options={DIFFICULTY_OPTIONS}
          selected={filter.difficulties}
          emptyMessage="No Difficulties"
          onChange={(difficulties) => onFilterChange({ ...filter, difficulties })}
        />
        {/* The Topics actually in the bank, exactly as they were typed. There is
            no vocabulary to offer beyond what the teacher has already used. */}
        {layout === 'rows' && <FilterDropdown
          label="Topic"
          options={topicOptions(bank).map((topic) => ({ value: topic, label: topic }))}
          selected={filter.topics}
          emptyMessage="No Topics yet"
          onChange={(topics) => onFilterChange({ ...filter, topics })}
        />}
        <label className="bank-sort">
          <ArrowDownAZ aria-hidden="true" />
          <span className="sr-only">Sort Questions</span>
          <select
            aria-label="Sort Questions"
            value={filter.sort ?? 'newest'}
            onChange={(event) => onFilterChange({
              ...filter,
              sort: event.target.value as QuestionBankSort,
            })}
          >
            {SORT_OPTIONS.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {onAddManyToWorkingCopy && (
          <button
            type="button"
            className="bank-add-all"
            title={filtered ? 'Add all matching questions to the exam' : 'Add all questions to the exam'}
            disabled={addableQuestions.length === 0}
            onClick={() => onAddManyToWorkingCopy(addableQuestions.map(({ id }) => id))}
          >
            <Plus aria-hidden="true" />
            Add all
          </button>
        )}
        {filtered && (
          <button
            type="button"
            className="bank-filter-clear"
            onClick={() => onFilterChange({ ...NO_FILTER, sort: filter.sort ?? 'newest' })}
          >
            Clear filters
          </button>
        )}
      </div>
  )

  // How many of this bank's Questions the pane is not listing because they
  // are on the Exam already — said under the list, so a teacher looking for
  // one knows where it went.
  const inExamLine = inExamCount > 0 && (
    <p className="question-bank-in-exam" data-empty={allInExam ? 'all-in-exam' : undefined}>
      {inExamCount} of this bank's questions {inExamCount === 1 ? 'is' : 'are'} in this exam
    </p>
  )

  const list = (
      questions.length === 0 ? (
        // Three different nothings: a bank nobody has written into yet, a bank
        // whose every Question is on the Exam already, and a bank whose
        // questions are all behind the current search.
        allInExam ? inExamLine : filtered ? (
          <p className="question-bank-empty" data-empty="no-matches">
            No questions match this search and these filters.
          </p>
        ) : (
          <p className="question-bank-empty" data-empty="no-questions">
            {layout === 'page'
              ? 'No questions yet. New question writes the first one into this bank.'
              : 'No questions yet. Add Question writes one into the bank without putting it on the Exam.'}
          </p>
        )
      ) : layout === 'page' ? (
        <div
          className="question-bank-reading-lane"
          onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
        >
          <ul className="question-bank-reading" aria-label="Questions">
            {questions.map((question) => {
              const name = stemPreview(question).text || UNTITLED
              return (
                <li
                  className="question-reading question-bank-reading-item"
                  key={question.id}
                  data-question-id={question.id}
                  aria-current={selectedQuestionIds.has(question.id) ? 'true' : undefined}
                  tabIndex={0}
                  // The whole Question is the target: a click opens it to
                  // change it. Cmd/Ctrl- or Shift-click selects instead, as a
                  // row does beside an Exam, for Cmd/Ctrl-C to copy.
                  onClick={(event: ReactMouseEvent<HTMLElement>) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey) {
                      onSelect(question.id, orderedIds, {
                        shiftKey: event.shiftKey,
                        metaKey: event.metaKey,
                        ctrlKey: event.ctrlKey,
                      })
                      return
                    }
                    onEdit(question.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.target !== event.currentTarget) return
                    event.preventDefault()
                    onEdit(question.id)
                  }}
                >
                  <QuestionReading
                    content={readingOfQuestion(question)}
                    aside={<span className="question-bank-reading-actions">
                      <CopyQuestionButton
                        question={question}
                        name={name}
                        state={copying.state(question.id)}
                        onCopy={copying.copy}
                        className="toolbar-icon-button question-bank-reading-copy"
                      />
                      <button
                        type="button"
                        className="toolbar-icon-button question-bank-reading-edit"
                        aria-label={`Edit ${name}`}
                        title="Edit"
                        onClick={(event) => {
                          event.stopPropagation()
                          onEdit(question.id)
                        }}
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                    </span>}
                  />
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <div
          className="question-bank-list-lane"
          onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
        >
        <ul className="question-bank-list">
          {questions.map((question) => {
            const draggable = onAddToWorkingCopy !== undefined
            const name = stemPreview(question).text || UNTITLED
            return (
              <li
                className="question-bank-row"
                key={question.id}
                data-question-id={question.id}
                data-draggable={draggable ? 'true' : undefined}
                data-dragging={drag.draggedQuestionIds.has(question.id) ? 'true' : undefined}
                aria-current={selectedQuestionIds.has(question.id) ? 'true' : undefined}
                tabIndex={0}
                {...(draggable ? dragHandlers(question) : {})}
                onClick={(event: ReactMouseEvent<HTMLElement>) => {
                  // The press that has just finished dragging is not a click —
                  // that press, on that row, and no other click anywhere.
                  if (suppressClickFor.current === question.id) {
                    suppressClickFor.current = null
                    return
                  }
                  onSelect(question.id, orderedIds, {
                    shiftKey: event.shiftKey,
                    metaKey: event.metaKey,
                    ctrlKey: event.ctrlKey,
                  })
                }}
                // Single-click selects, so opening the whole question needs a
                // second click, the Enter key, or the Edit action.
                onDoubleClick={() => onEdit(question.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.target !== event.currentTarget) return
                  event.preventDefault()
                  onEdit(question.id)
                }}
              >
                <QuestionSummary question={question} />
                <div
                  className="question-bank-row-actions"
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="question-bank-action"
                    aria-label={`Edit ${name}`}
                    title="Edit"
                    onClick={() => onEdit(question.id)}
                  >
                    <Pencil />
                  </button>
                  <CopyQuestionButton
                    question={question}
                    name={name}
                    state={copying.state(question.id)}
                    onCopy={copying.copy}
                    className="question-bank-action"
                  />
                  {onAddToWorkingCopy && (
                    <button
                      type="button"
                      className="question-bank-action"
                      aria-label={`Add ${name} to the exam`}
                      title="Add to the exam"
                      onClick={() => onAddToWorkingCopy(question.id)}
                    >
                      <Plus />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {inExamLine}
        </div>
      )
  )

  return (
    <section
      ref={root}
      className="question-bank"
      aria-label="Question Bank"
      {...selectAllPaneProps('question-bank')}
      // The rule under the toolbar is drawn only while there is something
      // above it to have scrolled past.
      data-scrolled={scrolled ? 'true' : undefined}
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (!target.closest('.question-bank-row, .question-bank-reading-item, button, input, select, a')) {
          onClearSelection()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClearSelection()
      }}
    >
      {/* What the bank is, what you can do to it, and what is currently hidden
          are all answers to questions you ask while looking at the list, so
          they stay outside the scroll area rather than sticking to the top of
          it: the list of questions is the only thing that scrolls, and the
          scrollbar is as tall as the list rather than as tall as the pane. */}
      <div className="question-bank-toolbar">
        {/* Beside an Exam the pane's own header names the bank and offers
            nothing to do to it: writing and exporting a bank are its page's. */}
        {layout === 'page' && <header className="question-bank-header">
          {heading ?? <h2>Question Bank</h2>}
          <div className="question-bank-header-actions">
            {onCreate && <button
              type="button"
              className={layout === 'page' ? 'primary-button' : 'toolbar-icon-button'}
              aria-label={layout === 'page' ? undefined : 'Add Question'}
              title={layout === 'page' ? undefined : 'Add Question'}
              aria-haspopup="menu"
              onClick={(event) => {
                // Below the button and aligned with it, so the list of types
                // reads as belonging to the control that asked for it.
                const bounds = event.currentTarget.getBoundingClientRect()
                onCreate({ x: bounds.left, y: bounds.bottom + 4 })
              }}
            >
              <Plus aria-hidden="true" />
              {layout === 'page' && 'New question'}
            </button>}
            {/* Everything but New question waits behind one More button after
                it, so the header stays quiet beside the bank's name. */}
            {(moreItems.length > 0 || onExport) && <button
              type="button"
              className="toolbar-icon-button question-bank-more-button"
              aria-label="More actions"
              title="More actions"
              aria-haspopup="menu"
              aria-expanded={moreMenu !== null}
              aria-describedby={onExport && bank.questions.length === 0 ? 'empty-bank-export-help' : onExport && exportBlocked ? 'editing-bank-export-help' : undefined}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                setMoreMenu((current) => (current ? null : { x: bounds.right, y: bounds.bottom + 4 }))
              }}
            >
              <Ellipsis aria-hidden="true" />
            </button>}
            {moreMenu && <ContextMenu
              point={moreMenu}
              side="left"
              ariaLabel="More actions"
              items={[
                ...moreItems,
                ...(onExport ? [{
                  kind: 'action' as const,
                  label: 'Export',
                  icon: <Upload />,
                  disabled: bank.questions.length === 0 || exportBlocked,
                  onSelect: onExport,
                }] : []),
              ]}
              onClose={() => setMoreMenu(null)}
            />}
            {onExport && bank.questions.length === 0 && <span id="empty-bank-export-help" className="sr-only">At least one Question is required.</span>}
            {onExport && exportBlocked && <span id="editing-bank-export-help" className="sr-only">Save or cancel the open Question edit before exporting.</span>}
          </div>
        </header>}
        {layout === 'rows' && heading}
        {layout === 'rows' && queryBar}
      </div>

      {layout === 'page' ? (
        <div className="bank-page-body">
          <QuestionBankOutline
            questions={browseQuestionBank(bank, { ...NO_FILTER, sort: filter.sort })}
            filter={filter}
            onFilterChange={onFilterChange}
          />
          <div className="bank-page-column">
            {filterBar}
            {list}
          </div>
        </div>
      ) : list}
    </section>
  )
}
