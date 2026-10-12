import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useModalScrollLock } from './use-modal-scroll-lock'
import { ExportPreview } from './exam-page'
import type { LayoutPlan } from './export-plan'
import type {
  ExportConfiguration,
  PreparationProgress,
} from './export-preparation'
import { exportTime } from './export-time'
import {
  DEFAULT_VERSION_COUNT,
  NO_SHUFFLE,
  shufflesAnything,
  versionCountError,
  versionNamesIn,
} from './export-versions'

function progressMessage(progress: PreparationProgress): string {
  return progress.stage === 'planning'
    ? `Laying out document ${progress.completed} of ${progress.total}…`
    : 'Recording export…'
}

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.matches(':disabled') && element.closest('[inert]') === null,
  )
}

/**
 * The Versions under a dialog's settings, one line each. Naming one snaps the
 * preview to that Version's first paper; where `included` is given, each also
 * has a checkbox choosing whether it prints.
 */
function VersionLine({
  names,
  current,
  onSnap,
  included,
  onIncludedChange,
  disabled,
}: {
  names: readonly string[]
  current: string | null
  onSnap: (name: string) => void
  included?: readonly string[]
  onIncludedChange?: (name: string, included: boolean) => void
  disabled: boolean
}) {
  return (
    <section className="export-version-line" aria-label="Versions">
      <h3>{names.length === 1 ? '1 Version' : `${names.length} Versions`}</h3>
      <ul>
        {names.map((name) => (
          <li key={name}>
            {included && (
              <input
                type="checkbox"
                aria-label={`Re-export ${name}`}
                checked={included.includes(name)}
                disabled={disabled}
                onChange={(event) => onIncludedChange?.(name, event.target.checked)}
              />
            )}
            <button
              type="button"
              className="export-version-name"
              aria-current={current === name ? 'true' : undefined}
              onClick={() => onSnap(name)}
            >
              {name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Format, Content selection and Shuffled Versions: the settings an export is
 * made with. Frozen, they show a recorded export's settings and change nothing.
 */
function ExportSettings({
  configuration,
  onChange,
  maxVersions,
  frozen,
  disabled,
}: {
  configuration: ExportConfiguration
  onChange?: (configuration: ExportConfiguration) => void
  maxVersions?: number
  frozen: boolean
  disabled: boolean
}) {
  const id = useId()
  const { selection } = configuration
  const shuffle = configuration.shuffle ?? NO_SHUFFLE
  const shuffling = shufflesAnything(shuffle)
  const versionCount = configuration.versionCount ?? DEFAULT_VERSION_COUNT
  const change = (next: Partial<ExportConfiguration>) =>
    onChange?.({ ...configuration, shuffle, versionCount, ...next })
  const locked = frozen || disabled

  return (
    <>
      <fieldset className="export-field" disabled={locked}>
        <legend>Format</legend>
        {(['pdf', 'docx'] as const).map((format) => (
          <label key={format}>
            <input
              type="radio"
              name={`${id}-format`}
              value={format}
              checked={configuration.format === format}
              onChange={() => change({ format })}
            />
            {format.toUpperCase()}
          </label>
        ))}
      </fieldset>

      <fieldset className="export-field" disabled={locked}>
        <legend>Content selection</legend>
        <label>
          <input
            type="checkbox"
            checked={selection.test}
            onChange={(event) => change({ selection: { ...selection, test: event.target.checked } })}
          />
          Student test
        </label>
        <label>
          <input
            type="checkbox"
            checked={selection.answerKey}
            onChange={(event) => change({ selection: { ...selection, answerKey: event.target.checked } })}
          />
          Answer key
        </label>
      </fieldset>

      <fieldset className="export-field" disabled={locked} aria-describedby={`${id}-version-hint`}>
        <legend>Shuffled Versions</legend>
        <label>
          <input
            type="checkbox"
            checked={shuffle.questions}
            onChange={(event) => change({ shuffle: { ...shuffle, questions: event.target.checked } })}
          />
          Shuffle question order
        </label>
        <label>
          <input
            type="checkbox"
            checked={shuffle.answers}
            onChange={(event) => change({ shuffle: { ...shuffle, answers: event.target.checked } })}
          />
          Shuffle answer order
        </label>
        <label className="export-count">
          Versions
          <input
            type="number"
            min={1}
            max={Math.max(1, maxVersions ?? versionCount)}
            step={1}
            inputMode="numeric"
            value={Number.isNaN(versionCount) ? '' : versionCount}
            disabled={!shuffling}
            onChange={(event) => change({ versionCount: event.target.valueAsNumber })}
          />
        </label>
        {!frozen && (
          <p className="export-hint" id={`${id}-version-hint`}>
            {shuffling
              ? `Each Version gets its own name, printed at the top right. Up to ${Math.max(0, maxVersions ?? 0)} for this Exam.`
              : 'Turn on a shuffle to print named Versions. Otherwise the Exam prints as you see it.'}
          </p>
        )}
      </fieldset>
    </>
  )
}

/**
 * The frame both export dialogs share: an output-faithful preview beside the
 * settings, a line of Versions that snaps the preview, and one action. It owns
 * the modal behaviour — focus, Escape, preparation progress and failure.
 */
function ExportDialogFrame({
  title,
  eyebrow,
  previewPlans,
  settings,
  versions,
  notes,
  submitLabel,
  submitDisabled,
  initialError,
  onSubmit,
  onCancel,
}: {
  title: string
  eyebrow?: string
  previewPlans: readonly LayoutPlan[]
  settings: (disabled: boolean) => ReactNode
  versions?: {
    included?: readonly string[]
    onIncludedChange?: (name: string, included: boolean) => void
  }
  notes?: ReactNode
  submitLabel: string
  submitDisabled: boolean
  initialError?: string | null
  onSubmit: (onProgress: (progress: PreparationProgress) => void) => Promise<void>
  onCancel: () => void
}) {
  const [preparing, setPreparing] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [current, setCurrent] = useState<string | null>(null)
  const dialog = useRef<HTMLElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const id = useId()
  const names = versionNamesIn(previewPlans)

  useEffect(() => {
    const [first] = focusableWithin(dialog.current!)
    first?.focus()
  }, [])

  useModalScrollLock()

  // Preparation disables every dialog control. Keep focus on the dialog itself
  // during that interval so Tab cannot escape into the authoring workspace.
  useLayoutEffect(() => {
    if (preparing) {
      dialog.current?.focus()
      return
    }
    // Restore a predictable in-dialog target after a recoverable failure.
    if (error) {
      const [first] = focusableWithin(dialog.current!)
      first?.focus()
    }
  }, [error, preparing])

  const close = () => {
    if (!preparing) onCancel()
  }

  // Scroll the preview, and only the preview, to a Version's first paper.
  const snap = (name: string) => {
    setCurrent(name)
    const scroller = preview.current
    const paper = scroller?.querySelector<HTMLElement>(`[data-version="${CSS.escape(name)}"]`)
    if (!scroller || !paper) return
    const top = paper.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTo({ top: scroller.scrollTop + top - 18, behavior: 'smooth' })
  }

  const submit = async () => {
    if (preparing || submitDisabled) return
    setPreparing(true)
    setError(null)
    setProgress('Preparing document…')
    try {
      await onSubmit((update) => setProgress(progressMessage(update)))
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Something went wrong while preparing the export. Please try again.',
      )
      setPreparing(false)
      setProgress(null)
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close()
          return
        }
        if (event.key !== 'Tab' || !dialog.current) return
        const focusable = focusableWithin(dialog.current)
        const first = focusable[0]
        const last = focusable.at(-1)
        if (!first || !last) {
          event.preventDefault()
          dialog.current.focus()
          return
        }
        const active = document.activeElement
        if (active === dialog.current) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        } else if (
          event.shiftKey &&
          (active === first || !dialog.current.contains(active))
        ) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <section
        className="export-dialog export-dialog--publication"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        ref={dialog}
        tabIndex={-1}
      >
        <header className="dialog-header">
          <h2 id={`${id}-title`}>{title}</h2>
          {eyebrow && <p className="export-dialog-eyebrow">{eyebrow}</p>}
        </header>

        <div className="export-publication-body">
          {/* The preview is output-faithful, not an alternate reading or
              navigation surface. `inert` prevents authored links and any
              future focusable document content from escaping this dialog. */}
          <div className="export-preview" aria-label="Export Preview" ref={preview}>
            {/* Keep paper content inert while leaving its scroll container live:
                browsing a long preview must not pass wheel input through to
                the document under this modal. */}
            <div inert>
              {previewPlans.map((plan, index) => (
                <div
                  key={`${plan.arrangement.id}-${plan.pages[0]?.stream ?? 'empty'}-${index}`}
                  data-version={plan.arrangement.version}
                >
                  <ExportPreview plan={plan} />
                </div>
              ))}
            </div>
          </div>

          <div className="export-controls">
            {settings(preparing)}
            {names.length > 0 && (
              <VersionLine
                names={names}
                current={current}
                onSnap={snap}
                disabled={preparing}
                {...versions}
              />
            )}
            {notes}
          </div>
        </div>

        <footer className="dialog-actions export-actions">
          <p
            className="export-status"
            role="status"
            aria-live="polite"
            aria-label="Export preparation status"
          >
            {preparing ? progress : null}
          </p>
          {error && (
            <p className="export-error export-failure" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={preparing}
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={preparing || submitDisabled}
            onClick={() => void submit()}
          >
            {preparing ? 'Preparing…' : submitLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}

export function ExportDialog({
  configuration,
  onConfigurationChange,
  previewPlans,
  maxVersions,
  empty,
  blocked = null,
  initialError,
  onSubmit,
  onCancel,
}: {
  configuration: ExportConfiguration
  onConfigurationChange: (configuration: ExportConfiguration) => void
  previewPlans: readonly LayoutPlan[]
  /** How many shuffled Versions the current shuffle options allow. */
  maxVersions: number
  empty: boolean
  /** Why this Exam cannot be exported as it is — a Question still needing a
   *  picture — shown in place of the preview's paper. */
  blocked?: string | null
  initialError?: string | null
  onSubmit: (
    configuration: ExportConfiguration,
    onProgress: (progress: PreparationProgress) => void,
  ) => Promise<void>
  onCancel: () => void
}) {
  const { selection } = configuration
  const selectionError =
    !selection.test && !selection.answerKey
      ? 'Choose the student test, the answer key, or both.'
      : null
  const emptyError = empty
    ? 'Add at least one question to the Working Copy before exporting.'
    : null
  const shuffling = shufflesAnything(configuration.shuffle)
  const versionError = !shuffling || empty
    ? null
    : versionCountError(configuration.versionCount ?? DEFAULT_VERSION_COUNT, maxVersions)
  const problem = selectionError ?? emptyError ?? blocked ?? versionError

  return (
    <ExportDialogFrame
      title="Export"
      previewPlans={previewPlans}
      settings={(disabled) => (
        <ExportSettings
          configuration={configuration}
          onChange={onConfigurationChange}
          maxVersions={maxVersions}
          frozen={false}
          disabled={disabled}
        />
      )}
      notes={
        <>
          <p className="export-durability-note">
            Export History is stored only in this browser. It is useful for
            local re-export, but it is not an archival backup.
          </p>
          {problem && (
            <p className="export-error" role="alert">
              {problem}
            </p>
          )}
        </>
      }
      submitLabel={`Download ${configuration.format.toUpperCase()}`}
      submitDisabled={problem !== null}
      initialError={initialError}
      onSubmit={(onProgress) => onSubmit(configuration, onProgress)}
      onCancel={onCancel}
    />
  )
}

/**
 * A recorded export, opened from Export History. Its settings are frozen as
 * they were exported; the only choice is which of its Versions to print again.
 */
export function ReExportDialog({
  number,
  name,
  createdAt,
  configuration,
  plans,
  onSubmit,
  onCancel,
}: {
  /** Its place in the Exam's Export History, counting from the first. */
  number: number
  name: string
  createdAt: string
  configuration: ExportConfiguration
  plans: readonly LayoutPlan[]
  onSubmit: (
    versions: readonly string[] | undefined,
    onProgress: (progress: PreparationProgress) => void,
  ) => Promise<void>
  onCancel: () => void
}) {
  const names = versionNamesIn(plans)
  const [included, setIncluded] = useState<string[]>(names)

  return (
    <ExportDialogFrame
      title="Re-export"
      eyebrow="Export Record, Immutable"
      previewPlans={plans}
      settings={(disabled) => (
        <>
          <dl className="export-record-identity">
            <div><dt>Export</dt><dd>#{number}</dd></div>
            <div><dt>Title</dt><dd>{name}</dd></div>
            <div><dt>Exported</dt><dd><time dateTime={createdAt}>{exportTime(createdAt)}</time></dd></div>
          </dl>
          <ExportSettings configuration={configuration} frozen disabled={disabled} />
        </>
      )}
      versions={names.length > 0
        ? {
            included,
            onIncludedChange: (name, on) =>
              // Kept in the record's own order, whatever order they were ticked in.
              setIncluded(names.filter((candidate) => (candidate === name ? on : included.includes(candidate)))),
          }
        : undefined}
      notes={names.length > 0 && included.length === 0 && (
        <p className="export-error" role="alert">Choose at least one Version to re-export.</p>
      )}
      submitLabel={`Re-export ${configuration.format.toUpperCase()}`}
      submitDisabled={names.length > 0 && included.length === 0}
      onSubmit={(onProgress) => onSubmit(names.length > 0 ? included : undefined, onProgress)}
      onCancel={onCancel}
    />
  )
}
