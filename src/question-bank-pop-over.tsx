// The Question Bank Pop-over: a compact, read-only view of Question Banks that
// stays on top of the document a teacher is writing. Questions are selected as
// in the Exam editor's bank pane — a click, Shift for a range, Cmd for one more
// — and dragged into the document, or Copied (see CONTEXT.md and ADR-0030).
//
// It is a Document Picture-in-Picture window. That window has no page of its
// own: this document renders into it through a portal, which is why the
// provider sits above every route and why every screen is reached without a
// document load — the window closes with the document that opened it.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Copy, Plus, Search, Settings, SlidersHorizontal, X } from 'lucide-react'
import type { Question } from './exam'
import type { ProseMirrorJSON } from './question-doc'
import { stemPreview } from './stem-preview'
import { PopOverCard } from './pop-over-card'
import { setCopyMathMode, useCopyMathMode } from './copy-settings'
import { useSelection } from './use-selection'
import {
  copyBlocksOf,
  copyContentOf,
  copyQuestions,
  prepareCopyMedia,
  type CopyFormat,
  type CopyMathMode,
} from './question-copy'
import { DIFFICULTY_OPTIONS, SORT_OPTIONS, TYPE_OPTIONS } from './question-bank-filter-options'
import { PopOverContext } from './pop-over-context'
import {
  NO_FILTER,
  browseQuestionBank,
  isFilterActive,
  topicOptions,
  type QuestionBankFilter,
} from './question-bank-view'
import {
  closeBankTab,
  openBankTab,
  updateBankTabFilter,
  type QuestionBankResource,
  type QuestionBankSummary,
  type QuestionBankTabsWorkspace,
  type QuestionBankWorkspaceService,
} from './question-bank-workspaces'

/** Chrome's Document Picture-in-Picture, which not every browser offers. */
type DocumentPictureInPicture = {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>
  window: Window | null
}

function pictureInPicture(): DocumentPictureInPicture | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture
}

/** The size the window opens at: a narrow column beside a document. The
 *  teacher can resize it, and the browser remembers what they chose. */
const POP_OVER_SIZE = { width: 380, height: 680 }

/** Give the new window this document's styles, so the Pop-over is drawn as
 *  everything else is. */
function prepareWindow(view: Window) {
  const target = view.document
  const base = target.createElement('base')
  base.href = window.location.origin
  target.head.append(base)
  for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    target.head.append(node.cloneNode(true))
  }
  target.title = 'Question Bank Pop-over'
  target.documentElement.lang = document.documentElement.lang || 'en'
  target.body.className = 'pop-over-body'
}

export function PopOverProvider({
  service,
  children,
}: {
  service: QuestionBankWorkspaceService
  children: ReactNode
}) {
  const [view, setView] = useState<Window | null>(null)
  const [request, setRequest] = useState<{ bankId: string; nonce: number } | null>(null)
  const viewRef = useRef<Window | null>(null)
  const supported = pictureInPicture() !== undefined
  const open = useCallback((bankId: string) => {
    setRequest({ bankId, nonce: performance.now() })
    const existing = viewRef.current
    if (existing && !existing.closed) {
      existing.focus()
      return
    }
    // Asked for at once, inside the click: the browser opens this window only
    // for a gesture.
    void pictureInPicture()?.requestWindow(POP_OVER_SIZE).then((opened) => {
      prepareWindow(opened)
      opened.addEventListener('pagehide', () => {
        viewRef.current = null
        setView(null)
      }, { once: true })
      viewRef.current = opened
      setView(opened)
    }, () => {
      // Refused — the click's permission to open a window had lapsed, or the
      // browser declined. Nothing opens, and nothing is left waiting to.
      if (!viewRef.current) setRequest(null)
    })
  }, [])
  const value = useMemo(() => ({ supported, open }), [open, supported])
  return <PopOverContext.Provider value={value}>
    {children}
    {view && request && createPortal(
      <QuestionBankPopOver service={service} view={view} request={request} />,
      view.document.body,
    )}
  </PopOverContext.Provider>
}

const childrenOf = (node: ProseMirrorJSON): ProseMirrorJSON[] =>
  Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []

const isPicture = (node: ProseMirrorJSON) => node.type === 'image' || node.type === 'image-block'

function localPictureSources(questions: readonly Question[]): string[] {
  const found = new Set<string>()
  const visit = (node: ProseMirrorJSON) => {
    const src = (node.attrs as Record<string, unknown> | undefined)?.src
    if (isPicture(node) && typeof src === 'string' && src.startsWith('/local-images/')) found.add(src)
    childrenOf(node).forEach(visit)
  }
  questions.forEach((question) => visit(question.doc))
  return [...found]
}

function withPictureSources(node: ProseMirrorJSON, sources: ReadonlyMap<string, string>): ProseMirrorJSON {
  const attrs = node.attrs as Record<string, unknown> | undefined
  const src = typeof attrs?.src === 'string' ? sources.get(attrs.src) : undefined
  const content = Array.isArray(node.content)
    ? { content: childrenOf(node).map((child) => withPictureSources(child, sources)) }
    : {}
  return { ...node, ...content, ...(isPicture(node) && src ? { attrs: { ...attrs, src } } : {}) }
}

/**
 * The Pop-over's window has no service worker of its own, so a Media Asset's
 * local address finds nothing there. Each picture is fetched here, where the
 * worker answers, and handed across as an object URL; a Question is shown
 * with those, and still Copied from its own.
 */
function usePictureSources(questions: readonly Question[]): (question: Question) => Question {
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map())
  const made = useRef(new Map<string, string>())
  const wanted = localPictureSources(questions).filter((src) => !made.current.has(src)).join(' ')
  useEffect(() => {
    if (!wanted) return
    let current = true
    void Promise.all(wanted.split(' ').map(async (src) => {
      const response = await fetch(src)
      return response.ok ? [src, URL.createObjectURL(await response.blob())] as const : null
    })).then((fetched) => {
      for (const entry of fetched) if (entry) made.current.set(...entry)
      if (current) setSources(new Map(made.current))
    }, () => undefined)
    return () => { current = false }
  }, [wanted])
  useEffect(() => {
    const urls = made.current
    return () => { for (const url of urls.values()) URL.revokeObjectURL(url) }
  }, [])
  return useCallback(
    (question: Question) => sources.size === 0 ? question : { ...question, doc: withPictureSources(question.doc, sources) },
    [sources],
  )
}

/** Every bank these tabs name that still exists, read afresh. */
async function readOpenBanks(
  service: QuestionBankWorkspaceService,
  ids: readonly string[],
): Promise<Record<string, QuestionBankResource>> {
  const banks = await Promise.all(ids.map((id) => service.read(id)))
  return Object.fromEntries(
    banks.filter((bank): bank is QuestionBankResource => bank !== null).map((bank) => [bank.id, bank]),
  )
}

/** The tabs, less any whose bank has gone. */
function withoutMissing(
  workspace: QuestionBankTabsWorkspace,
  banks: Record<string, QuestionBankResource>,
): QuestionBankTabsWorkspace {
  return workspace.openBankIds
    .filter((id) => !banks[id])
    .reduce(closeBankTab, workspace)
}

function QuestionBankPopOver({
  service,
  view,
  request,
}: {
  service: QuestionBankWorkspaceService
  view: Window
  request: { bankId: string; nonce: number }
}) {
  const [workspace, setWorkspace] = useState<QuestionBankTabsWorkspace | null>(null)
  const [banks, setBanks] = useState<Record<string, QuestionBankResource>>({})
  const [picker, setPicker] = useState<QuestionBankSummary[] | null>(null)
  const workspaceRef = useRef<QuestionBankTabsWorkspace | null>(null)
  // How each Question is laid out for copying. This window's alone: nothing
  // keeps it, so it is gone when the window closes.
  const [formats, setFormats] = useState<Readonly<Record<string, CopyFormat>>>({})

  const commit = useCallback((next: QuestionBankTabsWorkspace) => {
    workspaceRef.current = next
    setWorkspace(next)
    void service.savePopOverWorkspace(next)
  }, [service])

  // Opened on a bank, or asked for it again: that bank's tab, beside the ones
  // it was left with.
  useEffect(() => {
    let current = true
    void (async () => {
      const saved = workspaceRef.current ?? await service.popOverWorkspace()
      const next = openBankTab(saved, request.bankId)
      const read = await readOpenBanks(service, next.openBankIds)
      if (!current) return
      setBanks(read)
      setPicker(null)
      commit(withoutMissing(next, read))
    })()
    return () => { current = false }
  }, [commit, request, service])

  // What changed in the tab behind arrives when the teacher comes back here.
  useEffect(() => {
    const refresh = () => {
      const ids = workspaceRef.current?.openBankIds ?? []
      void readOpenBanks(service, ids).then((read) => {
        setBanks(read)
        const current = workspaceRef.current
        if (current && Object.keys(read).length !== current.openBankIds.length) {
          commit(withoutMissing(current, read))
        }
      })
    }
    view.addEventListener('focus', refresh)
    return () => view.removeEventListener('focus', refresh)
  }, [commit, service, view])

  const openPicker = async () => setPicker(await service.recent())
  const choose = async (id: string) => {
    const bank = await service.read(id)
    if (!bank || !workspaceRef.current) return
    setBanks((current) => ({ ...current, [id]: bank }))
    setPicker(null)
    commit(openBankTab(workspaceRef.current, id))
  }
  const close = (id: string) => {
    if (!workspaceRef.current) return
    commit(closeBankTab(workspaceRef.current, id))
  }

  if (!workspace) return <p className="pop-over-loading">Opening…</p>
  const active = workspace.activeBankId ? banks[workspace.activeBankId] : undefined
  const showingPicker = picker !== null || !active
  return <div className="pop-over">
    <div className="pop-over-tabs">
      <div role="tablist" aria-label="Open Question Banks">
        {workspace.openBankIds.map((id) => {
          const bank = banks[id]
          if (!bank) return null
          const selected = id === workspace.activeBankId && picker === null
          return <div className="pop-over-tab" key={id} data-active={selected ? 'true' : undefined}>
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              title={bank.name}
              onClick={() => {
                setPicker(null)
                commit(openBankTab(workspace, id))
              }}
            >{bank.name}</button>
            <button type="button" aria-label={`Close ${bank.name}`} onClick={() => close(id)}><X /></button>
          </div>
        })}
      </div>
      <button
        type="button"
        className="pop-over-add"
        aria-label="Open Question Bank"
        title="Open Question Bank"
        aria-pressed={picker !== null}
        onClick={() => void (picker ? setPicker(null) : openPicker())}
      ><Plus /></button>
      <CopySettings />
    </div>
    {showingPicker
      ? <BankPicker
          banks={picker}
          openIds={workspace.openBankIds}
          onLoad={openPicker}
          onChoose={(id) => void choose(id)}
        />
      : <PopOverBank
          key={active.id}
          bank={active}
          view={view}
          filter={workspace.filters[active.id] ?? NO_FILTER}
          onFilterChange={(filter) => commit(updateBankTabFilter(workspace, active.id, filter))}
          formats={formats}
          onFormat={(questionId, format) => setFormats((current) => ({ ...current, [questionId]: format }))}
        />}
  </div>
}

function BankPicker({
  banks,
  openIds,
  onLoad,
  onChoose,
}: {
  banks: QuestionBankSummary[] | null
  openIds: readonly string[]
  onLoad: () => void
  onChoose: (id: string) => void
}) {
  // With every tab closed the picker is all there is, so it fetches its own
  // list rather than waiting for the plus.
  useEffect(() => { if (!banks) onLoad() }, [banks, onLoad])
  if (!banks) return <p className="pop-over-loading">Loading Question Banks…</p>
  return <section className="pop-over-picker" aria-label="Open a Question Bank">
    <h2>Open a Question Bank</h2>
    {banks.length === 0
      ? <p className="pop-over-empty">No Question Banks yet.</p>
      : <ul>
          {banks.map((bank) => (
            <li key={bank.id}>
              <button type="button" onClick={() => onChoose(bank.id)}>
                <span>{bank.name}</span>
                <small>
                  {bank.questionCount} {bank.questionCount === 1 ? 'Question' : 'Questions'}
                  {openIds.includes(bank.id) && ' · open'}
                </small>
              </button>
            </li>
          ))}
        </ul>}
  </section>
}

/** What a chip says it is filtering on: nothing, the one value, or how many. */
function chipSummary(labels: readonly string[]): string | undefined {
  if (labels.length === 0) return undefined
  return labels.length <= 2 ? labels.join(', ') : `${labels.length} selected`
}

/**
 * One filter, as a chip in the row under the search: its name and what it is
 * set to, opening a short list of values beneath it. The list is kept inside
 * the Pop-over's own document and turned leftwards when the narrow window has
 * no room for it on the right.
 */
function FilterChip({
  label,
  summary,
  children,
}: {
  label: string
  summary?: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [alignEnd, setAlignEnd] = useState(false)
  const chip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = chip.current
    if (!open || !element) return
    const document = element.ownerDocument
    const view = document.defaultView
    if (view) setAlignEnd(element.getBoundingClientRect().left + 200 > view.innerWidth - 8)
    const onPointerDown = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  return <div className="pop-over-chip" ref={chip}>
    <button
      type="button"
      aria-expanded={open}
      aria-haspopup="true"
      data-active={summary ? 'true' : undefined}
      onClick={() => setOpen((current) => !current)}
    >
      {label}
      {summary && <>: <strong>{summary}</strong></>}
      <ChevronDown aria-hidden="true" />
    </button>
    {open && <div className="pop-over-chip-menu" role="group" aria-label={label} data-align={alignEnd ? 'end' : undefined}>
      {children(() => setOpen(false))}
    </div>}
  </div>
}

/** A chip whose values combine: any number ticked, shown with OR. */
function ChoiceChip<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  selected: readonly T[]
  onChange: (values: T[]) => void
}) {
  const labels = options.filter((option) => selected.includes(option.value)).map((option) => option.label)
  return <FilterChip label={label} summary={chipSummary(labels)}>
    {() => options.map((option) => (
      <label key={option.value} className="pop-over-chip-option">
        <input
          type="checkbox"
          checked={selected.includes(option.value)}
          onChange={(event) => onChange(event.target.checked
            ? [...selected, option.value]
            : selected.filter((value) => value !== option.value))}
        />
        {option.label}
      </label>
    ))}
  </FilterChip>
}

const MATH_MODES: readonly { value: CopyMathMode; label: string; detail: string }[] = [
  { value: 'picture', label: 'Pictures', detail: 'For Google Docs, and anywhere else.' },
  { value: 'word', label: 'Word equations', detail: 'Native, editable equations in Microsoft Word.' },
]

/** How Questions leave the Pop-over: for now, how their mathematics travels.
 *  Google Docs takes no equation from outside itself, so pictures are its
 *  choice; Word turns MathML into its own. */
function CopySettings() {
  const [open, setOpen] = useState(false)
  const mode = useCopyMathMode()
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = container.current
    if (!open || !element) return
    const document = element.ownerDocument
    const onPointerDown = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  return <div className="pop-over-settings" ref={container}>
    <button
      type="button"
      className="pop-over-add"
      aria-label="Copy settings"
      title="Copy settings"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
    ><Settings /></button>
    {open && <div className="pop-over-settings-menu" role="group" aria-label="Copy settings">
      <h2>Copy settings</h2>
      <fieldset>
        <legend>Mathematics</legend>
        {MATH_MODES.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name="copy-math"
              checked={mode === option.value}
              onChange={() => setCopyMathMode(option.value)}
            />
            <span><strong>{option.label}</strong><small>{option.detail}</small></span>
          </label>
        ))}
      </fieldset>
    </div>}
  </div>
}

function PopOverBank({
  bank,
  view,
  filter,
  onFilterChange,
  formats,
  onFormat,
}: {
  bank: QuestionBankResource
  view: Window
  filter: QuestionBankFilter
  onFilterChange: (filter: QuestionBankFilter) => void
  formats: Readonly<Record<string, CopyFormat>>
  onFormat: (questionId: string, format: CopyFormat) => void
}) {
  // Open from the start when something is already filtered, so a filter
  // is never in force out of sight.
  const [filtersOpen, setFiltersOpen] = useState(() => isFilterActive(filter) || (filter.sort ?? 'newest') !== 'newest')
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const selection = useSelection()
  const mathMode = useCopyMathMode()
  const questions = browseQuestionBank(bank, filter)
  const orderedIds = questions.map(({ id }) => id)
  const shown = usePictureSources(bank.questions)
  const activeFilters = filter.types.length + filter.difficulties.length + filter.topics.length

  // A drag hands over its content the moment it starts, so every picture
  // and formula the visible Questions need is made ahead of it.
  const visibleKey = `${mathMode}|${orderedIds.join(',')}`
  useEffect(() => {
    for (const question of bank.questions) {
      if (visibleKey.includes(question.id)) void prepareCopyMedia(copyBlocksOf(question), mathMode)
    }
  }, [bank.questions, mathMode, visibleKey])

  /** The selected Questions in the order they are shown, with their layouts. */
  const chosen = (ids: ReadonlySet<string>) => questions
    .filter(({ id }) => ids.has(id))
    .map((question) => ({ question, format: formats[question.id] }))

  const announce = (message: string) => {
    setAnnouncement(message)
    view.setTimeout(() => setAnnouncement((current) => (current === message ? null : current)), 1_800)
  }
  const describe = (count: number) => `${count} ${count === 1 ? 'Question' : 'Questions'}`

  const copySelection = () => {
    const items = chosen(selection.selectedIds)
    if (items.length === 0) return
    copyQuestions(items, mathMode, view).then(
      () => announce(`Copied ${describe(items.length)}`),
      () => announce('Could not copy — this browser refused the clipboard.'),
    )
  }

  // Cmd-C copies the selection, Cmd-A selects every Question shown, and
  // Escape lets go — anywhere but in a field, where they are the field's.
  useEffect(() => {
    const document = view.document
    const inField = () => (document.activeElement as HTMLElement | null)?.closest?.('input, select, textarea') != null
    const onCopy = (event: ClipboardEvent) => {
      if (inField() || selection.selectedIds.size === 0 || !event.clipboardData) return
      const items = chosen(selection.selectedIds)
      const content = copyContentOf(items, mathMode)
      event.clipboardData.setData('text/html', content.html)
      event.clipboardData.setData('text/plain', content.text)
      event.preventDefault()
      announce(`Copied ${describe(items.length)}`)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (inField()) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        selection.selectAll(orderedIds)
      } else if (event.key === 'Escape') {
        selection.clear()
      }
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('keydown', onKeyDown)
    }
  })

  const startDrag = (questionId: string, event: DragEvent<HTMLLIElement>) => {
    // Dragging a selected Question takes the whole selection; dragging any
    // other takes that one, and selects it.
    const ids = selection.selectedIds.has(questionId) ? selection.selectedIds : new Set([questionId])
    if (!selection.selectedIds.has(questionId)) selection.select(questionId)
    const items = chosen(ids)
    const content = copyContentOf(items, mathMode)
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/html', content.html)
    event.dataTransfer.setData('text/plain', content.text)
    if (items.length > 1) {
      const badge = view.document.createElement('div')
      badge.className = 'pop-over-drag-badge'
      badge.textContent = describe(items.length)
      view.document.body.append(badge)
      event.dataTransfer.setDragImage(badge, 12, 12)
      view.setTimeout(() => badge.remove(), 0)
    }
  }

  const selectedCount = questions.filter(({ id }) => selection.selectedIds.has(id)).length
  return <section className="pop-over-bank" aria-label={bank.name}>
    <div className="pop-over-controls">
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
      <button
        type="button"
        className="pop-over-filters-button"
        aria-expanded={filtersOpen}
        data-active={activeFilters > 0 ? 'true' : undefined}
        onClick={() => setFiltersOpen((open) => !open)}
      >
        <SlidersHorizontal aria-hidden="true" />
        Filters
        {activeFilters > 0 && <span className="bank-filter-count">{activeFilters}</span>}
      </button>
    </div>
    {filtersOpen && <div className="pop-over-filters">
      <ChoiceChip
        label="Question Type"
        options={TYPE_OPTIONS}
        selected={filter.types}
        onChange={(types) => onFilterChange({ ...filter, types })}
      />
      <ChoiceChip
        label="Difficulty"
        options={DIFFICULTY_OPTIONS}
        selected={filter.difficulties}
        onChange={(difficulties) => onFilterChange({ ...filter, difficulties })}
      />
      {/* Only the Topics the bank has, and no chip at all when it has none. */}
      {topicOptions(bank).length > 0 && <ChoiceChip
        label="Topic"
        options={topicOptions(bank).map((topic) => ({ value: topic, label: topic }))}
        selected={filter.topics}
        onChange={(topics) => onFilterChange({ ...filter, topics })}
      />}
      <FilterChip
        label="Sort"
        summary={SORT_OPTIONS.find((option) => option.value === (filter.sort ?? 'newest'))?.label}
      >
        {(close) => SORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="pop-over-chip-option"
            aria-pressed={(filter.sort ?? 'newest') === option.value}
            onClick={() => {
              onFilterChange({ ...filter, sort: option.value })
              close()
            }}
          >
            <Check aria-hidden="true" />
            {option.label}
          </button>
        ))}
      </FilterChip>
      {isFilterActive(filter) && <button
        type="button"
        className="bank-filter-clear"
        onClick={() => onFilterChange({ ...NO_FILTER, sort: filter.sort ?? 'newest' })}
      >Clear</button>}
    </div>}
    {questions.length === 0
      ? <p className="pop-over-empty">
          {isFilterActive(filter) ? 'No questions match this search and these filters.' : 'No questions in this bank yet.'}
        </p>
      : <ul
          className="pop-over-cards"
          role="listbox"
          aria-multiselectable="true"
          aria-label="Questions"
          onClick={(event) => {
            if (event.target === event.currentTarget) selection.clear()
          }}
        >
          {questions.map((question) => (
            <PopOverCard
              key={question.id}
              question={shown(question)}
              name={stemPreview(question).text || 'Untitled question'}
              format={formats[question.id] ?? {}}
              onFormat={(format) => onFormat(question.id, format)}
              selected={selection.selectedIds.has(question.id)}
              onSelect={(modifiers) => selection.selectOne(question.id, orderedIds, modifiers)}
              onDragStart={(event) => startDrag(question.id, event)}
            />
          ))}
        </ul>}
    <footer className="pop-over-footer" data-selected={selectedCount > 0 ? 'true' : undefined}>
      {selectedCount > 0
        ? <>
            <span>{describe(selectedCount)} selected</span>
            <button type="button" className="pop-over-footer-copy" onClick={copySelection}><Copy aria-hidden="true" />Copy</button>
            <button type="button" className="bank-filter-clear" onClick={selection.clear}>Clear</button>
          </>
        : <span className="pop-over-footer-hint">Select Questions, then drag them into your document.</span>}
      <span className="sr-only" role="status">{announcement ?? ''}</span>
      {announcement && <span className="pop-over-toast" aria-hidden="true"><Check />{announcement}</span>}
    </footer>
  </section>
}
