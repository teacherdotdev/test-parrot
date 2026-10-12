// A page item, drawn.
//
// Everything that takes up vertical space on a page is drawn here, and only
// here: `exam-page.tsx` wraps these in the editing chrome a teacher clicks, and
// `dom-measure.ts` renders the same components off-screen to find out how tall
// they come out. Sharing them is what makes measurement honest — the heights
// packing is given are the heights the printer will produce, because they were
// taken from this markup.
//
// Nothing in here is interactive beyond a single optional callback, and nothing
// reads a page's furniture: a header, a footer and a page number belong to the
// page, not to the items on it.

import { type ReactNode } from 'react'
import { TITLE_PX, sectionHeadingStyles } from './export-typography'
import { Check, Lock, RotateCcw } from 'lucide-react'
import { DifficultyBadge, TopicBadge } from './badges'
import { DocView } from './doc-view'
import { pointsLabel } from './points'
import {
  hasAnswerBlank,
  headerHeightOf,
  numberColumnOf,
  partsOpenNumberLine,
  pointsOnLastRule,
  printsNumberLine,
  subpartsOpenLabelLine,
  type AnswerKeyEntryItem,
  type AnswerKeyHeadingItem,
  answerKeyPointsText,
  answerKeyTotalText,
  type AnswerKeySectionItem,
  printedLabel,
  printedNumberOf,
  type ChoiceGrid,
  type PaperTotalItem,
  type MatchingSet,
  type PageFurniture,
  type PlannedBankAnswer,
  type PlannedPart,
  type PlannedSubpart,
  type PlannedWorkSpace,
  type PageHeader,
  type PageItem,
  type QuestionItem,
  type SectionHeadingItem,
  rowsOfPlanned,
} from './export-plan'
import type { ProseMirrorJSON } from './question-doc'

/** The blocks inside a node — a choice's own paragraphs, say. */
function blocksOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

// The grid is drawn as a real table so that a cell's answer stays inside its
// column, and every border is off: on paper this is a layout, not a table.
export function ChoiceGridView({
  grid,
  showCorrectness = false,
}: {
  grid: ChoiceGrid
  /** The Working Copy alone may reveal correctness; previews and artifacts may not. */
  showCorrectness?: boolean
}) {
  return (
    <table className="choice-grid" data-columns={grid.columns}>
      <tbody>
        {grid.cells.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((choice, columnIndex) => (
              <td
                key={columnIndex}
                className="choice-cell"
                data-correct-answer={
                  showCorrectness && choice?.correct ? 'true' : undefined
                }
              >
                {choice && (
                  <>
                    <span className="choice-letter">
                      {/* Beside the answer rather than out at the right-hand
                          margin, where it was read as belonging to the row. It
                          takes no width and paints into the gutter left of the
                          letter, so the choice grid measures and prints exactly
                          as it would without it. */}
                      {showCorrectness && choice.correct && !choice.locked && (
                        <span
                          className="choice-correctness-marker"
                          role="img"
                          aria-label="Correct answer"
                        >
                          <Check aria-hidden="true" />
                        </span>
                      )}
                      {/* A Locked Answer keeps its letter when answers are
                          shuffled. Its lock stands where the check would, in
                          the same gutter and taking no width, so the grid
                          measures as it prints; a correct one keeps the
                          correct answer's colour and says both. */}
                      {showCorrectness && choice.locked && (
                        <span
                          className="choice-correctness-marker choice-lock-marker"
                          role="img"
                          aria-label={choice.correct ? 'Correct answer, locked' : 'Locked answer'}
                          title="Locked: keeps its letter when answers are shuffled"
                        >
                          <Lock aria-hidden="true" />
                        </span>
                      )}
                      {printedLabel(choice.letter, choice.printed)}
                    </span>
                    <DocView className="choice-body" content={blocksOf(choice.node)} />
                  </>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// A matching set. Every prompt carries its own blank and number in a column
// the width of the page's own number column, so the numbers line up with the
// questions around them; the Word Bank letters its answers by this
// arrangement's order. A short bank sits beside the prompts as one borderless
// row of two cells, each column stacking on its own so a long item never
// pushes the bank down beside it. A long bank sits above the prompts in a
// borderless grid, column-major, the way a choice grid is drawn.
export function BankAnswer({ answer }: { answer: PlannedBankAnswer }) {
  return (
    <div className="matching-answer">
      <span className="matching-letter">{printedLabel(answer.letter, answer.printed)}</span>
      <DocView className="matching-body" content={blocksOf(answer.node)} />
    </div>
  )
}

export function MatchingSetView({
  set,
  showCorrectness = false,
}: {
  set: MatchingSet
  /** The Working Copy alone may reveal each prompt's letter; previews and
   *  artifacts may not. */
  showCorrectness?: boolean
}) {
  const prompts = set.prompts.map((prompt) => (
    <div className="matching-prompt" key={prompt.id}>
      <span className="matching-number">
        {/* The letter is drawn inside the blank, in colour, without taking
            any width of its own, so a set measures and prints exactly as it
            would without it. */}
        <span
          className="matching-blank"
          aria-label="Answer blank"
          data-answer={showCorrectness && prompt.letter ? prompt.letter : undefined}
        />
        <span className="matching-count">{printedLabel(prompt.number, prompt.printed)}</span>
      </span>
      <DocView className="matching-body" content={blocksOf(prompt.node)} />
    </div>
  ))
  if (set.bankGrid) {
    return (
      <div className="matching-set" data-layout="above">
        <table className="matching-bank-grid" data-columns={set.bankGrid.columns}>
          <tbody>
            {set.bankGrid.cells.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((answer, columnIndex) => (
                  <td key={columnIndex} className="matching-bank-cell">
                    {answer && <BankAnswer answer={answer} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="matching-items">{prompts}</div>
      </div>
    )
  }
  return (
    <div className="matching-set" data-layout="beside">
      <table className="matching-columns">
        <tbody>
          <tr>
            <td className="matching-items">{prompts}</td>
            <td
              className="matching-bank"
              style={set.bankWidth ? { width: `${set.bankWidth}px` } : undefined}
            >
              {set.bank.map((answer) => (
                <BankAnswer answer={answer} key={answer.id} />
              ))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// The room a Short Answer question leaves for a student's work: exactly as tall
// as the plan says, and either empty or ruled with the plan's own count of
// lines, each one pitch tall with its rule along the bottom. Nothing is drawn
// for a question that has no room, so a zero-height space measures as nothing.
//
// `points` are the `[n]` of the answer the space ends, when they stand on its
// last rule (`pointsOnLastRule`): at the rule's right end, the rule stopping
// short of them, in the row's own height.
export function WorkSpaceView({ space, points }: { space: PlannedWorkSpace; points?: ReactNode }) {
  if (space.height <= 0) return null
  const rows = rowsOfPlanned(space)
  return (
    <div
      className="work-space"
      data-style={space.style}
      data-lines={space.style === 'lines' ? space.lines : undefined}
      data-fill={space.fill ? 'true' : undefined}
      data-ruling={space.ruling}
      style={{ height: `${space.height}px` }}
    >
      {Array.from({ length: space.lines }, (_unused, index) => {
        const height = { height: `${index === 0 ? rows.first : rows.pitch}px` }
        return points !== undefined && index === space.lines - 1 ? (
          <div className="work-space-line work-space-line--points" key={index} style={height}>
            <span className="work-space-rule" />
            <span className="work-space-points">{points}</span>
          </div>
        ) : (
          <div className="work-space-line" key={index} style={height} />
        )
      })}
    </div>
  )
}

// Points a Paper Style prints after an answer or a question, against the
// right margin on a line of their own: `[2]`, `[Total: 9]`. A paragraph, so it
// measures, prints and reads back as one.
export function PointsAfter({ text }: { text: string }) {
  return <p className="points-after">{text}</p>
}

/** What a printed `[n]` is the Points of: a Part or Subpart by its id, or —
 *  `partId` `null` — the question itself. `onRule` when it stands on the last
 *  rule of a Work Space, inside that rule's row, rather than on a line of its
 *  own. */
export type PrintedPoints = { partId: string | null; points: number; text: string; onRule: boolean }

/** Draws a printed `[n]` in place of `PointsAfter`, or of the bare text on a
 *  rule. The sheet uses it to make the `[n]` the control that changes the
 *  Points it shows; it must take the same room the plain one does, since the
 *  page was measured with that. */
export type RenderPrintedPoints = (printed: PrintedPoints) => ReactNode

function printedPoints(
  text: string,
  partId: string | null,
  points: number | undefined,
  render: RenderPrintedPoints | undefined,
  onRule = false,
): ReactNode {
  if (render && points !== undefined) return render({ partId, points, text, onRule })
  return onRule ? text : <PointsAfter text={text} />
}

/** An answer's room and the `[n]` after it: on the space's last rule where it
 *  has one, otherwise on a line of their own below it. */
function AnswerSpace({
  id,
  space,
  pointsAfter,
  points,
  renderWorkSpace,
  renderPoints,
}: {
  /** The Part's or Subpart's id, or `null` for the question itself. */
  id: string | null
  space: PlannedWorkSpace | null
  pointsAfter: string | undefined
  points: number | undefined
  renderWorkSpace?: (partId: string, space: PlannedWorkSpace, points?: ReactNode) => ReactNode
  renderPoints?: RenderPrintedPoints
}) {
  const onRule = pointsAfter !== undefined && pointsOnLastRule(space)
  const ruled = onRule ? printedPoints(pointsAfter, id, points, renderPoints, true) : undefined
  return (
    <>
      {space
        && (renderWorkSpace && id !== null
          ? renderWorkSpace(id, space, ruled)
          : <WorkSpaceView space={space} points={ruled} />)}
      {!onRule && pointsAfter && printedPoints(pointsAfter, id, points, renderPoints)}
    </>
  )
}

// One Part of a Multipart question, drawn the way a question of its kind is, one level
// in: a short letter column — no answer blank, for either kind — then its
// stem, its choice grid or its work space, or the Subparts it holds.
// `renderWorkSpace` lets the sheet wrap a Short Answer Part's or Subpart's
// space in the handle that sizes it.
export function PartContent({
  part,
  showCorrectness = false,
  renderWorkSpace,
  renderPoints,
}: {
  part: PlannedPart
  showCorrectness?: boolean
  renderWorkSpace?: (partId: string, space: PlannedWorkSpace, points?: ReactNode) => ReactNode
  /** How the sheet draws a Part's or Subpart's printed `[n]`. */
  renderPoints?: RenderPrintedPoints
}) {
  // A piece continued from an earlier page keeps the letter column, empty, so
  // its Subparts stand where they would have under the lead-in.
  return (
    <div
      className="multipart-part-print"
      data-part-id={part.id}
      data-part-type={part.type}
      {...(part.continued ? { 'data-continued': 'true' } : {})}
    >
      <div className="part-letter">
        {!part.continued && <span className="part-count">{printedLabel(part.letter, part.printed)}</span>}
      </div>
      <div className="part-body">
        {/* A continued piece prints the stem blocks it carries, if any. */}
        {(!part.continued || part.stem.length > 0) && <DocView className="question-stem" content={part.stem} />}
        {part.grid && <ChoiceGridView grid={part.grid} showCorrectness={showCorrectness} />}
        <AnswerSpace
          id={part.id}
          space={part.workSpace}
          pointsAfter={part.pointsAfter}
          points={part.points}
          renderWorkSpace={renderWorkSpace}
          renderPoints={renderPoints}
        />
        {/* A Part with no lead-in opens with Subpart (i) on its own line. */}
        {part.subparts.length > 0 && (
          <div
            className={
              subpartsOpenLabelLine(part)
                ? 'multipart-subparts-print multipart-subparts-print--opening'
                : 'multipart-subparts-print'
            }
          >
            {part.subparts.map((subpart) => (
              <SubpartContent
                key={subpart.id}
                subpart={subpart}
                showCorrectness={showCorrectness}
                renderWorkSpace={renderWorkSpace}
                renderPoints={renderPoints}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// One Subpart, drawn as a Part is, one level further in under its Part's
// lead-in: its label column, then its stem and its choice grid or work space.
function SubpartContent({
  subpart,
  showCorrectness,
  renderWorkSpace,
  renderPoints,
}: {
  subpart: PlannedSubpart
  showCorrectness: boolean
  renderWorkSpace?: (partId: string, space: PlannedWorkSpace, points?: ReactNode) => ReactNode
  renderPoints?: RenderPrintedPoints
}) {
  // A piece continued from an earlier page keeps the label column, empty.
  return (
    <div
      className="multipart-part-print multipart-subpart-print"
      data-part-id={subpart.id}
      data-part-type={subpart.type}
      {...(subpart.continued ? { 'data-continued': 'true' } : {})}
    >
      <div className="part-letter">
        {!subpart.continued && <span className="part-count">{printedLabel(subpart.label, subpart.printed)}</span>}
      </div>
      <div className="part-body">
        <DocView className="question-stem" content={subpart.stem} />
        {subpart.grid && <ChoiceGridView grid={subpart.grid} showCorrectness={showCorrectness} />}
        <AnswerSpace
          id={subpart.id}
          space={subpart.workSpace}
          pointsAfter={subpart.pointsAfter}
          points={subpart.points}
          renderWorkSpace={renderWorkSpace}
          renderPoints={renderPoints}
        />
      </div>
    </div>
  )
}

// A question, or the piece of one this page carries. The number column is drawn
// either way so a continued question's text stays in the same place down the
// page; only the first piece puts a number and an answer blank in it — and a
// matching set never does, since its numbers print on its prompts.
export function QuestionContent({
  item,
  showCorrectness = false,
  renderPartWorkSpace,
  renderPoints,
}: {
  item: QuestionItem
  /** Correct-answer feedback is authoring chrome, never export content. */
  showCorrectness?: boolean
  /** The sheet's own drawing of a Short Answer Part's work space, with its
   *  sizing handle; everywhere else the space is drawn plain. */
  renderPartWorkSpace?: (partId: string, space: PlannedWorkSpace, points?: ReactNode) => ReactNode
  /** How the sheet draws each printed `[n]` — the question's, a Part's or a
   *  Subpart's. A total, which no one sets, is always drawn plain. */
  renderPoints?: RenderPrintedPoints
}) {
  const numbered = printsNumberLine(item)
  const column = numberColumnOf(item.question)
  return (
    <>
      {/* The column holds the number, and whatever the Paper Style puts
          before it — a True/False question's marks, or an answer blank —
          `questionIndentOf` in export-plan.ts is the same width for the
          adapters. */}
      <div
        className={
          column === 'plain' ? 'question-number' : `question-number question-number--${column}`
        }
      >
        {numbered && item.question.marks.length > 0 && (
          <span
            className="question-marks"
            aria-label={hasAnswerBlank(item.question) ? 'Answer blank' : 'Circle one'}
          >
            {item.question.marks.map((mark) => (
              <span key={mark} className="question-mark">{mark}</span>
            ))}
          </span>
        )}
        {numbered && <span className="question-count">{printedNumberOf(item.question)}</span>}
      </div>
      <div className="question-body">
        <DocView className="question-stem" content={item.stem} />
        {item.grid && (
          <ChoiceGridView grid={item.grid} showCorrectness={showCorrectness} />
        )}
        {item.workSpace && (
          <WorkSpaceView
            space={item.workSpace}
            points={item.pointsAfter && pointsOnLastRule(item.workSpace)
              ? printedPoints(item.pointsAfter, null, item.question.totalPoints, renderPoints, true)
              : undefined}
          />
        )}
        {/* With no stem above them, Part (a) opens on the number's line. */}
        {item.parts && item.parts.length > 0 && (
          <div
            className={
              partsOpenNumberLine(item)
                ? 'multipart-parts-print multipart-parts-print--opening'
                : 'multipart-parts-print'
            }
          >
            {item.parts.map((part) => (
              <PartContent
                key={part.id}
                part={part}
                showCorrectness={showCorrectness}
                renderWorkSpace={renderPartWorkSpace}
                renderPoints={renderPoints}
              />
            ))}
          </div>
        )}
      </div>
      {item.matching && (
        <MatchingSetView set={item.matching} showCorrectness={showCorrectness} />
      )}
      {/* The question's own `[n]`, where no ruled Work Space carries it,
          then the totals no one sets: a Multipart question's, and any
          Section's. */}
      {((item.pointsAfter && !pointsOnLastRule(item.workSpace)) || item.closingPoints) && (
        <div className="question-closing">
          {item.pointsAfter && !pointsOnLastRule(item.workSpace)
            && printedPoints(item.pointsAfter, null, item.question.totalPoints, renderPoints)}
          {(item.closingPoints ?? []).map((text, index) => <PointsAfter text={text} key={index} />)}
        </div>
      )}
    </>
  )
}

// The paper's total, beneath the title on the test's first page, under a
// Paper Style that prints it there (ADR-0045).
export function PaperTotalContent({ item }: { item: PaperTotalItem }) {
  return <p className="paper-total">{item.text}</p>
}

// A cleared part prints nothing — not an empty line — and a heading cleared of
// both prints nothing at all, so it measures, and packs, at no height.
export function SectionHeadingContent({ item }: { item: SectionHeadingItem }) {
  if (!item.title && !item.instructions) return null
  const styles = sectionHeadingStyles(item.size)
  return (
    <>
      <header className="exam-section">
        {item.title && <h2 className="section-title" style={styles.title}>{item.title}</h2>}
        {item.instructions && (
          <p className="section-instructions" style={styles.instructions}>{item.instructions}</p>
        )}
      </header>
    </>
  )
}

// The paper's total Points stand at the right of the heading's own line, so
// the heading measures the same height with a total as without one.
export function AnswerKeyHeading({ item }: { item: AnswerKeyHeadingItem }) {
  return (
    <h2 className="answer-key-heading">
      Answer Section
      {item.totalPoints !== undefined && (
        <>
          {' '}
          <span className="answer-key-total">{answerKeyTotalText(item.totalPoints)}</span>
        </>
      )}
    </h2>
  )
}

/** Points as the Answer Key prints them after an answer: `[2]`. */
function AnswerKeyPoints({ points }: { points: number | undefined }) {
  if (points === undefined) return null
  return <span className="answer-key-points" aria-label={pointsLabel(points)}>{answerKeyPointsText(points)}</span>
}

export function AnswerKeySection({ item }: { item: AnswerKeySectionItem }) {
  return <h3 className="answer-key-section">{item.title}</h3>
}

export function AnswerKeyEntry({ item }: { item: AnswerKeyEntryItem }) {
  return (
    <div
      className={item.points !== undefined ? 'answer-key-entry answer-key-entry--pointed' : 'answer-key-entry'}
    >
      <span>{item.number}.</span>
      <span className="answer-key-answer" aria-label={item.letter ?? 'Blank answer'}>
        {item.letter}
      </span>
      <AnswerKeyPoints points={item.points} />
      {(item.difficulty || (item.topics?.length ?? 0) > 0) && (
        <span className="answer-key-metadata" aria-label="Question Metadata">
          {item.difficulty && <DifficultyBadge difficulty={item.difficulty} />}
          {(item.topics ?? []).map((topic) => <TopicBadge topic={topic} key={topic} />)}
        </span>
      )}
      {item.suggestedAnswer && (
        <DocView className="answer-key-suggested" content={item.suggestedAnswer} />
      )}
      {item.parts && (
        <div
          className={
            item.parts.some((part) => part.subpart)
              ? 'answer-key-parts answer-key-parts--subparts'
              : 'answer-key-parts'
          }
        >
          {item.parts.map((part) => (
            <div className="answer-key-part" key={part.letter}>
              <span className="answer-key-part-letter">{part.letter}.</span>
              <span
                className="answer-key-answer"
                aria-label={part.answer ?? 'Blank answer'}
              >
                {part.answer}
              </span>
              <AnswerKeyPoints points={part.points} />
              {part.suggestedAnswer && (
                <DocView className="answer-key-suggested" content={part.suggestedAnswer} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// The furniture at the top of a sheet, drawn from the variant packing chose.
// The first page identifies the paper and names the test; every later page
// carries just enough to reunite a dropped stack and to stop a student swapping
// a page in from another arrangement. Neither repeats the section heading — that is
// content, and content is packed, not drawn here.
//
// Driven by the plan's own furniture rather than by a switch of its own: the
// identity fields, the repeated title and the arrangement label are planning
// decisions, so the DOCX adapter prints exactly the same ones. The header
// variant survives only as a class, because how tall each variant is remains a
// layout constant that CSS and packing must agree on.
// What the header line prints left of the ID. A plan recorded before the line
// was text carries only its fields, which print as ruled blanks as they did.
function IdentityText({ furniture }: { furniture: PageFurniture }) {
  if (furniture.identityLine !== undefined) {
    return <span className="identity-line">{furniture.identityLine}</span>
  }
  return (
    <>
      {furniture.identityFields.map((field) => (
        <span className="identity-field" key={field}>
          {field}:
          <span className="identity-blank" />
        </span>
      ))}
    </>
  )
}

/** Where a header line is reworded: its current text, whether it departs from
 *  the default, and the change — `null` restoring the default. */
export type IdentityLineEditor = {
  text: string
  edited: boolean
  disabled: boolean
  onChange: (text: string | null) => void
}

// The header line on the sheet, reworded where it prints. Like the title, it
// is always the field: the line is plain text, so the field reads exactly as
// it prints, and a click puts the caret where it lands. Enter or Escape
// finishes. The ID beside it is never part of it.
function EditableIdentityText({ editor }: { editor: IdentityLineEditor }) {
  return (
    <span className="identity-edit">
      {editor.edited && (
        <span className="identity-handles">
          <button
            type="button"
            className="question-handle"
            aria-label="Restore the default header"
            title="Restore the default header"
            disabled={editor.disabled}
            onClick={() => editor.onChange(null)}
          >
            <RotateCcw aria-hidden="true" />
          </button>
        </span>
      )}
      {/* Sized by a mirrored copy of its value, like the title's field, so the
          underline is as wide as the words and not the page. */}
      <span className="identity-input-field" data-value={editor.text || ' '}>
        <input
          aria-label="Header printed on the exam"
          className="identity-input"
          size={1}
          value={editor.text}
          disabled={editor.disabled}
          spellCheck
          onChange={(event) => editor.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
        />
      </span>
    </span>
  )
}

export function PageHeaderContent({
  header,
  furniture,
  identityEditor,
  onTitleChange,
  titleDisabled = false,
}: {
  header: PageHeader
  furniture: PageFurniture
  /** Present only in the editor, on test pages: rewords this page's line. */
  identityEditor?: IdentityLineEditor
  /** Present only in the editor. The Exam's name is furniture on its own first
   *  page, so it can be typed there as well as in the document bar — one
   *  value, two places to reach it. Every other caller (measurement, print
   *  reference, export preview) renders plain text, which is what the DOCX
   *  adapter prints too. */
  onTitleChange?: (title: string) => void
  titleDisabled?: boolean
}) {
  // A title that wraps, or a page number printed above the line, grows its
  // header by what the plan measured, which the stylesheet's fixed band per
  // variant cannot know.
  const height = (furniture.titleLines && furniture.titleLines > 1) || furniture.pageNumberAt === 'top'
    ? { height: `${headerHeightOf(header, furniture)}px` }
    : undefined
  return (
    <header className={`page-header page-header--${header}`} style={height}>
      {furniture.pageNumberAt === 'top' && (
        <div className="page-running-head">{furniture.pageNumber}</div>
      )}
      <div className="page-identity">
        {identityEditor ? (
          <EditableIdentityText editor={identityEditor} />
        ) : (
          <IdentityText furniture={furniture} />
        )}
        <span className="page-id">{furniture.arrangementLabel}</span>
      </div>
      {furniture.title !== null && (
        <h1
          className="exam-title"
          style={furniture.titleSize ? { fontSize: TITLE_PX[furniture.titleSize] } : undefined}
        >
          {onTitleChange ? (
            // The underline belongs to the name, not to the width of the
            // page: the mirrored value behind the field is what sizes it, so
            // the field is exactly as wide as what has been typed, and wraps
            // onto as many lines as the printed title does. The title is one
            // line of text, so Enter finishes rather than breaking it.
            <span className="exam-title-field" data-value={furniture.title || 'Untitled Exam'}>
              <textarea
                aria-label="Title printed on the exam"
                className="exam-title-input"
                rows={1}
                value={furniture.title}
                disabled={titleDisabled}
                placeholder="Untitled Exam"
                spellCheck
                onChange={(event) => onTitleChange(event.target.value.replace(/\s*\n\s*/g, ' '))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'Escape') {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                }}
              />
            </span>
          ) : (
            furniture.title
          )}
        </h1>
      )}
    </header>
  )
}

// The foot of a sheet: its page number, centred, on every style that prints
// it there; and "Turn over" against the right under a style that prints it
// (ADR-0045).
export function PageFooterContent({ furniture }: { furniture: PageFurniture }) {
  return (
    <footer className={furniture.footRight ? 'page-footer page-footer--running' : 'page-footer'}>
      {furniture.pageNumberAt === undefined && (
        <span className="page-footer-number">{furniture.pageNumber}</span>
      )}
      {furniture.footRight && <span className="page-foot-right">{furniture.footRight}</span>}
    </footer>
  )
}

// One page item at its printed size, with no handlers and no gutter — what
// `dom-measure.ts` renders off-screen to read a height back off.
//
// Exhaustive over `PageItem`: a new kind (#8's answer key) does not compile
// until it has been given a way to be drawn, and therefore measured.
export function PageItemMeasureView({ item }: { item: PageItem }) {
  switch (item.kind) {
    case 'paper-total':
      return <PaperTotalContent item={item} />
    case 'section-heading':
      return (
        <SectionHeadingContent item={item} />
      )
    case 'question':
      return (
        <section className="exam-question">
          <QuestionContent item={item} />
        </section>
      )
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
