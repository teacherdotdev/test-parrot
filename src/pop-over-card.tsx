// One Question in the Question Bank Pop-over: drawn small, laid out as it will
// land in the document — its answer columns, where its Word Bank goes, the
// lines a written answer is left — with the controls that change that layout
// for this copy only (ADR-0030). A Multipart question shows its shared stem and
// then each Part, each with its own layout; the Question travels whole.

import { useLayoutEffect, useRef, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { ColumnLayoutIcon } from './column-layout-icon'
import { DifficultyBadge } from './badges'
import { DocView } from './doc-view'
import { SECTION_LABELS, choicesOf, partsOf, promptsOf, type ColumnSetting, type Question, type Subpart } from './exam'
import { layOutColumns, subpartLabelAt } from './export-plan'
import { bankLetter } from './matching'
import { stemNodesOf, type ProseMirrorJSON } from './question-doc'
import { defaultWordBank, type CopyFormat, type CopyPartFormat } from './question-copy'

const childrenOf = (node: ProseMirrorJSON): ProseMirrorJSON[] =>
  Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []

const COLUMN_OPTIONS: readonly { value: ColumnSetting; label: string }[] = [
  { value: 1, label: '1 column' },
  { value: 2, label: '2 columns' },
  { value: 4, label: '4 columns' },
]

const LINE_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'No lines' },
  { value: 2, label: '2 lines' },
  { value: 4, label: '4 lines' },
  { value: 6, label: '6 lines' },
  { value: 10, label: '10 lines' },
]

/** A layout control. It belongs to the card but is not a click on it: using
 *  it neither selects the Question nor starts a drag. */
function FormatSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return <select
    className="pop-over-format"
    aria-label={label}
    title={label}
    value={String(value)}
    draggable={false}
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}
    onKeyDown={(event) => event.stopPropagation()}
    onChange={(event) => {
      const chosen = options.find((option) => String(option.value) === event.target.value)
      if (chosen) onChange(chosen.value)
    }}
  >
    {options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
  </select>
}

/** Lettered answers in the columns chosen, filled down each column. */
function Answers({ answers, columns }: { answers: readonly ProseMirrorJSON[][]; columns: ColumnSetting }) {
  const lettered = answers.map((content, index) => ({ content, letter: bankLetter(index) }))
  const { rows } = layOutColumns(lettered, columns)
  return <ol
    className="pop-over-answers"
    style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(rows, 1)}, auto)` }}
  >
    {lettered.map((answer) => (
      <li key={answer.letter}><span>{answer.letter}.</span><DocView content={answer.content} /></li>
    ))}
  </ol>
}

function Rules({ count }: { count: number }) {
  return count > 0
    ? <div className="pop-over-rules" aria-label={`${count} answer lines`}>{Array.from({ length: count }, (_unused, index) => <span key={index} />)}</div>
    : null
}

function Blank() {
  return <span className="pop-over-blank" aria-hidden="true">_____</span>
}

/** Answer columns as three icons — one, two and four columns — the way a
 *  toolbar offers alignment. Using it neither selects nor drags the card. */
function ColumnToggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: ColumnSetting
  onChange: (value: ColumnSetting) => void
}) {
  return <span
    className="pop-over-columns"
    role="radiogroup"
    aria-label={label}
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}
  >
    {COLUMN_OPTIONS.map(({ value: columns, label: name }) => (
      <button
        key={columns}
        type="button"
        role="radio"
        aria-checked={value === columns}
        aria-label={name}
        title={name}
        draggable={false}
        onClick={() => onChange(columns)}
      ><ColumnLayoutIcon columns={columns} withDataAttribute={false} /></button>
    ))}
  </span>
}

/** One half of a card, cut off after a few lines and faded only when it is:
 *  a short stem or a short answer list ends where it ends. */
function Clipped({ className, children }: { className: string; children: ReactNode }) {
  const clip = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = clip.current
    if (!element) return
    if (element.scrollHeight > element.clientHeight + 1) element.dataset.cut = 'true'
    else delete element.dataset.cut
  })
  return <div className={className} ref={clip}>{children}</div>
}

/** What a card shows: the controls for its layout, the stem, and the answers
 *  laid out as they will land — two halves with a dashed rule between. */
function body(question: Question, format: CopyFormat, onFormat: (format: CopyFormat) => void): {
  controls: ReactNode
  stem: ReactNode
  answers: ReactNode
} {
  const stem = <DocView className="pop-over-stem" content={stemNodesOf(question.doc)} />
  switch (question.type) {
    case 'multiple-choice': {
      const columns = format.columns ?? question.columns
      return {
        controls: <ColumnToggle label="Answer columns" value={columns} onChange={(value) => onFormat({ ...format, columns: value })} />,
        stem,
        answers: <Answers answers={choicesOf(question).map(({ node }) => childrenOf(node))} columns={columns} />,
      }
    }
    case 'true-false':
      // No answer half: the T and F a student circles lead the stem, as the
      // test prints them before the number.
      return {
        controls: null,
        stem: <div className="pop-over-led"><span className="pop-over-marks" aria-hidden="true">T  F</span>{stem}</div>,
        answers: null,
      }
    case 'matching': {
      const wordBank = format.wordBank ?? defaultWordBank(question)
      const items = <ul className="pop-over-items">
        {promptsOf(question).map((prompt) => (
          <li key={prompt.id}><Blank /><DocView content={childrenOf(prompt.node)} /></li>
        ))}
      </ul>
      const bank = <Answers answers={choicesOf(question).map(({ node }) => childrenOf(node))} columns={1} />
      return {
        controls: <FormatSelect
          label="Word Bank"
          value={wordBank}
          options={[{ value: 'beside', label: 'Word Bank beside' }, { value: 'above', label: 'Word Bank above' }]}
          onChange={(value) => onFormat({ ...format, wordBank: value })}
        />,
        stem,
        answers: wordBank === 'beside'
          ? <div className="pop-over-beside">{items}{bank}</div>
          : <>{bank}{items}</>,
      }
    }
    case 'fill-in-the-blank':
      // The sentence is the whole question, its Blanks drawn as lines.
      return { controls: null, stem, answers: null }
    case 'open':
      return {
        controls: <FormatSelect label="Answer lines" value={format.lines ?? 0} options={LINE_OPTIONS} onChange={(value) => onFormat({ ...format, lines: value })} />,
        stem,
        answers: (format.lines ?? 0) > 0 ? <Rules count={format.lines ?? 0} /> : null,
      }
    case 'multipart':
      // The shared stem, then each Part split the same way as a whole card:
      // its own stem, a dashed rule, its own answers.
      return {
        controls: null,
        stem,
        answers: <ol className="pop-over-parts">
          {partsOf(question).map((part, index) => {
            const letter = bankLetter(index).toLowerCase()
            // A Part that holds Subparts answers nothing itself: its lead-in,
            // then its Subparts, each formatted as a Part is, under its own id.
            const answering = (one: Subpart, label: string, name: string) => {
              const partFormat: CopyPartFormat = format.parts?.[one.id] ?? {}
              const setPart = (next: CopyPartFormat) => onFormat({ ...format, parts: { ...format.parts, [one.id]: next } })
              const answers = one.type === 'multiple-choice'
                ? <Answers answers={one.choices.map(({ node }) => childrenOf(node))} columns={partFormat.columns ?? one.columns} />
                : (partFormat.lines ?? 0) > 0 ? <Rules count={partFormat.lines ?? 0} /> : null
              return <li key={one.id} className="pop-over-part">
                <div className="pop-over-part-head">
                  <span className="pop-over-part-letter">{label}.</span>
                  <span className="pop-over-part-type">{SECTION_LABELS[one.type]}</span>
                  <span className="pop-over-card-controls">
                    {one.type === 'multiple-choice'
                      ? <ColumnToggle label={`Part ${name} answer columns`} value={partFormat.columns ?? one.columns} onChange={(value) => setPart({ ...partFormat, columns: value })} />
                      : <FormatSelect label={`Part ${name} answer lines`} value={partFormat.lines ?? 0} options={LINE_OPTIONS} onChange={(value) => setPart({ ...partFormat, lines: value })} />}
                  </span>
                </div>
                <DocView className="pop-over-stem" content={one.stem} />
                {answers && <div className="pop-over-answer-half">{answers}</div>}
              </li>
            }
            if (part.type !== 'subparts') return answering({ ...part, type: part.type }, letter, letter)
            return <li key={part.id} className="pop-over-part">
              <div className="pop-over-part-head">
                <span className="pop-over-part-letter">{letter}.</span>
              </div>
              <DocView className="pop-over-stem" content={part.stem} />
              <ol className="pop-over-parts pop-over-subparts">
                {part.subparts.map((subpart, subpartIndex) => {
                  const label = subpartLabelAt(subpartIndex)
                  return answering(subpart, label, `${letter} (${label})`)
                })}
              </ol>
            </li>
          })}
        </ol>,
      }
  }
}

export function PopOverCard({
  question,
  name,
  format,
  onFormat,
  selected,
  onSelect,
  onDragStart,
}: {
  /** The Question as it is shown — its pictures already readable here. */
  question: Question
  name: string
  format: CopyFormat
  onFormat: (format: CopyFormat) => void
  selected: boolean
  onSelect: (modifiers: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void
  onDragStart: (event: DragEvent<HTMLLIElement>) => void
}) {
  const { controls, stem, answers } = body(question, format, onFormat)
  const whole = question.type === 'multipart'
  return <li
    className="pop-over-card"
    role="option"
    aria-selected={selected}
    aria-label={name}
    tabIndex={0}
    draggable
    data-question-id={question.id}
    data-type={question.type}
    onClick={(event: MouseEvent<HTMLLIElement>) => onSelect(event)}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget || (event.key !== ' ' && event.key !== 'Enter')) return
      event.preventDefault()
      onSelect({ shiftKey: event.shiftKey, metaKey: true, ctrlKey: false })
    }}
    onDragStart={(event) => {
      // A drag that began on a layout control is that control's.
      if ((event.target as HTMLElement).closest?.('select, .pop-over-columns')) {
        event.preventDefault()
        return
      }
      onDragStart(event)
    }}
  >
    <div className="pop-over-card-head">
      <span className="question-reading-type">{SECTION_LABELS[question.type]}</span>
      {question.difficulty && <DifficultyBadge difficulty={question.difficulty} />}
      <span className="pop-over-card-controls">{controls}</span>
    </div>
    {/* A Multipart question shows every Part whole, since each has its own
        layout; any other card cuts each half off at a few lines. */}
    {whole
      ? <div className="pop-over-stem-half">{stem}</div>
      : <Clipped className="pop-over-stem-half">{stem}</Clipped>}
    {answers && (whole
      ? <div className="pop-over-answer-half">{answers}</div>
      : <Clipped className="pop-over-answer-half">{answers}</Clipped>)}
  </li>
}
