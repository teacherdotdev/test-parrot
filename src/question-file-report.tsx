import { AlertTriangle, Info, XCircle } from 'lucide-react'
import type { QuestionFileSummary } from './question-formats'
import type { ImportIssue } from './question-formats/types'

/**
 * What reading a question file from another tool found, shown above its
 * preview: how many questions it held and how many are coming in, and every
 * problem, each with the line to find it on. The format it was read as is
 * named in the dialog's header; a file read wrongly is one to email us. Nothing
 * is imported until the teacher confirms.
 */

const ICONS: Record<ImportIssue['severity'], typeof Info> = { error: XCircle, warning: AlertTriangle, info: Info }

const plural = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`

export function QuestionFileReport({
  reading,
  busy,
  onConvertInstead,
}: {
  reading: QuestionFileSummary
  busy: boolean
  /** For a Word document: convert it with an AI after all. */
  onConvertInstead?: () => void
}) {
  const leftOut = Math.max(0, reading.found - reading.imported)
  const errors = reading.issues.filter((issue) => issue.severity === 'error')
  const others = reading.issues.filter((issue) => issue.severity !== 'error')

  return <section className="question-file-report" aria-label="How your file was read">
    <div className="question-file-report-head">
      <p role="status">
        {plural(reading.found, 'question')} found · <strong>{reading.imported} coming in</strong>
        {leftOut > 0 && <> · <span className="question-file-report-left-out">{leftOut} left out</span></>}
      </p>
      {onConvertInstead && (
        <button type="button" className="link-button" disabled={busy} onClick={onConvertInstead}>
          Convert it with your AI instead
        </button>
      )}
    </div>
    {reading.issues.length > 0 && (
      <details className="question-file-report-issues" open={errors.length > 0}>
        <summary>
          {[
            errors.length ? plural(errors.length, 'question left out', 'questions left out') : '',
            others.length ? plural(others.length, 'note') : '',
          ].filter(Boolean).join(' · ')}
        </summary>
        <ul>
          {[...errors, ...others].map((issue, index) => {
            const Icon = ICONS[issue.severity]
            return <li key={index} data-severity={issue.severity}>
              <Icon aria-hidden="true" />
              <span>
                {issue.message}
                {issue.excerpt && <q>{issue.excerpt}</q>}
              </span>
            </li>
          })}
        </ul>
      </details>
    )}
  </section>
}
