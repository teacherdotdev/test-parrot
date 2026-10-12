import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { DocView } from './doc-view'
import {
  RECORD_PART_TYPE_LABELS,
  RECORD_TYPE_LABELS,
  holdsSubparts,
  prepareQuestionBankExport,
  recordBlankAnswers,
  recordDocumentToEditorNodes,
  wordBankLettersOf,
  type PreparedQuestionBankExport,
  type QuestionBankRecord,
  type QuestionBankRecordPart,
  type QuestionBankRecordQuestion,
  type SemanticDocument,
} from './question-bank-export'
import {
  IMPORT_URL,
  NO_TOPIC_LABEL,
  questionBankFileOutline,
  sectionKey,
  topicKey,
  type OutlineSection,
  type QuestionBankFileOutline,
} from './question-bank-file-outline'
import type { QuestionBankResource } from './question-bank-workspaces'
import { topicTint } from './topic-tint'

/** How many rows of the preview are drawn at a time. A bank of thousands of
 *  Questions is drawn a batch at a time as the teacher scrolls, rather than
 *  all at once before the dialog can show anything. */
const PREVIEW_BATCH = 60

/** One row of the preview, in the order the PDF prints it. */
type PreviewRow =
  | { kind: 'section'; key: string; section: OutlineSection }
  | { kind: 'topic'; key: string; section: OutlineSection; topic: string | null; count: number }
  | { kind: 'question'; key: string; question: QuestionBankRecordQuestion; number: number }

function previewRows(outline: QuestionBankFileOutline): PreviewRow[] {
  return outline.sections.flatMap((section) => {
    const topics = section.groups.some((group) => group.topic !== null)
    return [
      { kind: 'section' as const, key: sectionKey(section.type), section },
      ...section.groups.flatMap((group) => [
        ...(topics
          ? [{ kind: 'topic' as const, key: topicKey(section.type, group.topic), section, topic: group.topic, count: group.questions.length }]
          : []),
        ...group.questions.map(({ question, number }) => ({ kind: 'question' as const, key: question.id, question, number })),
      ]),
    ]
  })
}

const plural = (count: number, word: string) => `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`

export function QuestionBankExportDialog({
  bank,
  onClose,
}: {
  bank: QuestionBankResource
  onClose: () => void
}) {
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  const [prepared, setPrepared] = useState<PreparedQuestionBankExport | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<{ drawn: number; total: number } | null>(null)
  const exportingRef = useRef(exporting)
  exportingRef.current = exporting

  useEffect(() => {
    let current = true
    void prepareQuestionBankExport(bank).then(
      (next) => {
        if (current) setPrepared(next)
      },
      (reason) => {
        if (current)
          setError(
            reason instanceof Error
              ? reason.message
              : 'The Question Bank cannot be prepared.',
          )
      },
    )
    return () => {
      current = false
    }
  }, [bank])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    requestAnimationFrame(() =>
      dialog.current?.querySelector<HTMLElement>('button')?.focus(),
    )
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exportingRef.current) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled)',
        ) ?? [],
      )
      if (controls.length === 0) return
      const first = controls[0]!
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus()
      })
    }
  }, [onClose])

  const download = async () => {
    if (!prepared || exporting) return
    setExporting(true)
    setError(null)
    try {
      // Package all bytes before handing anything to the browser. Preparation
      // and PDF creation are read-only, so any failure leaves every resource
      // untouched and cannot leave a partial download.
      const { createQuestionBankPdf } = await import('./question-bank-pdf')
      const bytes = await createQuestionBankPdf(prepared, undefined, {
        onProgress: (drawn, total) => setProgress({ drawn, total }),
      })
      const url = URL.createObjectURL(
        new Blob([bytes], { type: 'application/pdf' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = prepared.filename
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      onClose()
    } catch (reason) {
      console.error('Could not export the Question Bank', reason)
      setError(
        reason instanceof Error
          ? reason.message
          : 'The Question Bank PDF could not be created. Try again.',
      )
      setExporting(false)
      setProgress(null)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialog}
        className="question-bank-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={!prepared && !error ? true : exporting}
      >
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>Export Question Bank</h2>
            <p>
              For teachers: this file contains correct answers and Suggested
              Answers. It is separate from publishing an Exam.
            </p>
          </div>
        </header>
        {error && (
          <p className="dialog-save-error" role="alert">
            {error}
          </p>
        )}
        {!prepared && !error ? (
          <p role="status" aria-live="polite">Preparing Question Bank Record and complete preview…</p>
        ) : (
          prepared && <BankFilePreview record={prepared.record} />
        )}
        {progress && (
          <div className="question-bank-export-progress" role="status" aria-live="polite">
            <progress max={progress.total} value={progress.drawn} />
            <span>
              {progress.drawn < progress.total
                ? `Drawing ${plural(progress.drawn, 'Question')} of ${progress.total.toLocaleString()}…`
                : 'Finishing the PDF…'}
            </span>
          </div>
        )}
        <footer className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={exporting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!prepared || exporting}
            onClick={() => void download()}
          >
            {exporting ? 'Creating PDF…' : 'Download PDF'}
          </button>
        </footer>
      </section>
    </div>
  )
}

/** The PDF's pages as a scrolling preview: its front matter, then each
 *  Question Type and Topic in the same order, each outline entry a button
 *  that scrolls to it. */
function BankFilePreview({ record }: { record: QuestionBankRecord }) {
  const outline = useMemo(() => questionBankFileOutline(record), [record])
  const rows = useMemo(() => previewRows(outline), [outline])
  const [shown, setShown] = useState(PREVIEW_BATCH)
  const [target, setTarget] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const { bank } = record
  const hasTopics = outline.sections.some((section) => section.groups.some((group) => group.topic !== null))

  // Draw the next batch as the teacher nears the end of what is drawn.
  useEffect(() => {
    const end = sentinel.current
    if (!end || shown >= rows.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setShown((count) => count + PREVIEW_BATCH)
      },
      { root: scroller.current, rootMargin: '600px 0px' },
    )
    observer.observe(end)
    return () => observer.disconnect()
  }, [rows.length, shown])

  // A jump to an entry not drawn yet draws up to it first, then scrolls.
  useEffect(() => {
    if (!target) return
    const element = scroller.current?.querySelector<HTMLElement>(`[data-outline-key="${CSS.escape(target)}"]`)
    if (!element) return
    element.scrollIntoView({ block: 'start' })
    setTarget(null)
  }, [target, shown])
  const jump = (key: string) => {
    const index = rows.findIndex((row) => row.key === key)
    if (index < 0) return
    setShown((count) => Math.max(count, index + PREVIEW_BATCH))
    setTarget(key)
  }

  // A crop's shape comes from its picture's size, which the record's media knows.
  const previewNodes = (document: SemanticDocument) =>
    recordDocumentToEditorNodes(document, record.media)
  const counts = [
    plural(bank.questions.length, 'Question'),
    ...(outline.difficulties.easy ? [`${outline.difficulties.easy} Easy`] : []),
    ...(outline.difficulties.medium ? [`${outline.difficulties.medium} Medium`] : []),
    ...(outline.difficulties.hard ? [`${outline.difficulties.hard} Hard`] : []),
  ]

  return (
    <div
      ref={scroller}
      className="question-bank-export-preview"
      aria-label="Question Bank PDF preview"
    >
      <p className="question-bank-file-brand">
        <img src="/logo.png" alt="" width={28} height={28} />
        Test Parrot · Question Bank File
      </p>
      <h1>{bank.name || 'Untitled Question Bank'}</h1>
      {bank.author && <p><strong>Declared author (unverified):</strong> {bank.author}</p>}
      {bank.license && <p><strong>License:</strong> {bank.license.name}{bank.license.url ? ` — ${bank.license.url}` : ''}</p>}
      {bank.description && <p>{bank.description}</p>}
      <p><strong>{counts.join(' · ')}</strong></p>
      <aside className="question-bank-file-notice">
        <a href={IMPORT_URL} target="_blank" rel="noopener noreferrer">
          <strong>A digital file for importing into Test Parrot</strong>
        </a>
        <p>
          It holds the whole Question Bank, answers included. Import works only from this original file:
          printing it, scanning it, or saving it again as a PDF removes the data Test Parrot reads.
        </p>
      </aside>
      <nav className="question-bank-file-outline" aria-label="Question Types">
        <h2>Question Types</h2>
        <p>{hasTopics ? 'Choose a type, or one of its Topics, to go straight to it.' : 'Choose a type to go straight to it.'}</p>
        <ul>
          {outline.sections.map((section) => (
            <li key={section.type}>
              <button type="button" className="question-bank-file-type" onClick={() => jump(sectionKey(section.type))}>
                <span>{RECORD_TYPE_LABELS[section.type]}</span>
                <span>{section.count.toLocaleString()}</span>
              </button>
              <TopicBubbles section={section} onJump={jump} />
            </li>
          ))}
        </ul>
      </nav>
      <p className="question-bank-file-credit">
        <a href="https://teacher.dev" target="_blank" rel="noopener noreferrer" aria-hidden="true" tabIndex={-1}>
          <img src="/edtechathon-logo.svg" alt="" width={18} height={18} />
        </a>
        <span>
          Test Parrot is a free exam builder by{' '}
          <a href="https://teacher.dev" target="_blank" rel="noopener noreferrer">teacher.dev</a>.
        </span>
      </p>
      {rows.slice(0, shown).map((row) => {
        if (row.kind === 'section') {
          return (
            <section key={row.key} data-outline-key={row.key} className="question-bank-file-section">
              <h2>{RECORD_TYPE_LABELS[row.section.type]}</h2>
              <p>{plural(row.section.count, 'Question')}</p>
              <TopicBubbles section={row.section} onJump={jump} />
            </section>
          )
        }
        if (row.kind === 'topic') {
          return (
            <h3
              key={row.key}
              data-outline-key={row.key}
              className="question-bank-file-topic"
              data-tint={row.topic === null ? undefined : topicTint(row.topic)}
            >
              {row.topic ?? NO_TOPIC_LABEL}
              <span>{plural(row.count, 'Question')}</span>
            </h3>
          )
        }
        return (
          <RecordQuestion key={row.key} question={row.question} number={row.number} previewNodes={previewNodes} />
        )
      })}
      {shown < rows.length && <div ref={sentinel} className="question-bank-file-more">Loading more…</div>}
    </div>
  )
}

function TopicBubbles({ section, onJump }: { section: OutlineSection; onJump: (key: string) => void }) {
  if (!section.groups.some((group) => group.topic !== null)) return null
  return (
    <div className="question-bank-file-bubbles">
      {section.groups.map((group) => (
        <button
          key={group.topic ?? ''}
          type="button"
          className={group.topic === null ? 'badge' : 'badge badge-topic'}
          data-tint={group.topic === null ? undefined : topicTint(group.topic)}
          onClick={() => onJump(topicKey(section.type, group.topic))}
        >
          {group.topic ?? NO_TOPIC_LABEL}
          <strong>{group.questions.length.toLocaleString()}</strong>
        </button>
      ))}
    </div>
  )
}

// One Part of a record Question: its stem, then its choices or Suggested
// Answer — or, for a Part that holds Subparts, its lead-in and then its
// Subparts, numbered (i), (ii)… beneath it.
function RecordPart({
  part,
  previewNodes,
}: {
  part: QuestionBankRecordPart
  previewNodes: (document: SemanticDocument) => ReturnType<typeof recordDocumentToEditorNodes>
}) {
  if (holdsSubparts(part)) {
    return (
      <li aria-label="Subparts">
        <DocView content={previewNodes(part.stem)} />
        <ol type="i" className="record-multipart-parts">
          {part.subparts.map((subpart) => (
            <RecordPart key={subpart.id} part={subpart} previewNodes={previewNodes} />
          ))}
        </ol>
      </li>
    )
  }
  return (
    <li aria-label={RECORD_PART_TYPE_LABELS[part.type]}>
      <DocView content={previewNodes(part.stem)} />
      {part.choices && (
        <ol type="A" className="question-bank-export-choices">
          {part.choices.map((choice) => (
            <li key={choice.id}>
              <DocView content={previewNodes(choice.content)} />
              {choice.correct && (
                <strong className="question-bank-correct">
                  Correct answer
                </strong>
              )}
            </li>
          ))}
        </ol>
      )}
      {part.suggestedAnswer && (
        <section>
          <h3>Suggested Answer</h3>
          <DocView content={previewNodes(part.suggestedAnswer)} />
        </section>
      )}
    </li>
  )
}

function RecordQuestion({
  question,
  number,
  previewNodes,
}: {
  question: QuestionBankRecordQuestion
  number: number
  previewNodes: (document: SemanticDocument) => ReturnType<typeof recordDocumentToEditorNodes>
}): ReactNode {
  return (
    <article className="question-bank-export-question">
      <h2>Question {number}</h2>
      <dl>
        <div>
          <dt>Difficulty</dt>
          <dd>
            {question.difficulty
              ? question.difficulty[0]!.toUpperCase() +
                question.difficulty.slice(1)
              : 'Unspecified'}
          </dd>
        </div>
        <div>
          <dt>Topics</dt>
          <dd>{question.topics?.join(', ') || 'None'}</dd>
        </div>
      </dl>
      <DocView
        content={previewNodes(question.stem)}
      />
      {question.choices && (
        <ol type="A" className="question-bank-export-choices">
          {question.choices.map((choice) => (
            <li key={choice.id}>
              <DocView
                content={previewNodes(
                  choice.content,
                )}
              />
              {choice.correct && (
                <strong className="question-bank-correct">
                  Correct answer
                </strong>
              )}
            </li>
          ))}
        </ol>
      )}
      {question.prompts && question.wordBank && (
        <div className="record-matching">
          <ol className="record-matching-items">
            {question.prompts.map((prompt) => (
              <li key={prompt.id}>
                <span
                  className="record-matching-blank"
                  aria-label={
                    prompt.answer ? 'Matched answer' : 'Unmatched'
                  }
                >
                  {wordBankLettersOf(question).get(prompt.answer ?? '') ?? '—'}
                </span>
                <DocView
                  content={previewNodes(prompt.content)}
                />
              </li>
            ))}
          </ol>
          <ol type="A" className="question-bank-export-choices">
            {question.wordBank.map((answer) => (
              <li key={answer.id}>
                <DocView
                  content={previewNodes(answer.content)}
                />
              </li>
            ))}
          </ol>
        </div>
      )}
      {question.parts && (
        // The Multipart question is the stem above; its Parts follow,
        // lettered as the test prints them.
        <ol type="a" className="record-multipart-parts">
          {question.parts.map((part) => (
            <RecordPart key={part.id} part={part} previewNodes={previewNodes} />
          ))}
        </ol>
      )}
      {question.type === 'fill-in-the-blank' && (() => {
        const answers = recordBlankAnswers(question.stem)
        return answers && (
          <section>
            <h3>Answers</h3>
            <DocView content={previewNodes(answers)} />
          </section>
        )
      })()}
      {question.suggestedAnswer && (
        <section>
          <h3>Suggested Answer</h3>
          <DocView
            content={previewNodes(
              question.suggestedAnswer,
            )}
          />
        </section>
      )}
    </article>
  )
}
