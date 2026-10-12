import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, EllipsisVertical, FileImage, FileJson, FileText, FolderOpen, ImageIcon, Library, Trash2 } from 'lucide-react'
import { AppShell } from './app-shell'
import type { PersistentStorageStatus } from './durable-storage'
import {
  WAITING_IMPORT_LIFETIME_MS,
  discardWaitingImport,
  listImports,
  readWaitingImport,
  type ImportEntry,
  type ImportFileKind,
  type WaitingImport,
} from './import-history'
import { Link } from './site-chrome'
import { ContextMenu, type MenuItem, type MenuPoint } from './context-menu'
import { SourceDocumentSteps } from './source-document-steps'
import { ImportError } from './import-error'
import { inspectUploadedFile, isRecordFile } from './question-bank-upload'

/**
 * The Imports section: every import this browser has started. Those still
 * waiting for the file an assistant makes come first, each continued on its
 * own page; below them, what every finished import brought in.
 */

const KIND_LABELS: Record<ImportFileKind, string> = {
  pdf: 'PDF',
  photo: 'Photo',
  word: 'Word document',
  record: 'Test Parrot file',
  questions: 'Question file',
}

const plural = (count: number, singular: string) => `${count} ${count === 1 ? singular : `${singular}s`}`

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** How long a waiting import has left, in words. */
function timeLeft(createdAt: string, now: Date): string {
  const days = Math.ceil((new Date(createdAt).getTime() + WAITING_IMPORT_LIFETIME_MS - now.getTime()) / (24 * 60 * 60 * 1000))
  return days <= 1 ? 'Expires within a day' : `Expires in ${days} days`
}

/** One import's own page. */
const importHref = (id: string) => `/import?id=${encodeURIComponent(id)}`

/** An import's first page, drawn from the thumbnail it kept — or, for a
 *  waiting import from before thumbnails were kept, from its file. A Word
 *  document or a Test Parrot file has no page to show, so says what it is. */
function ImportSheet({ entry }: { entry: ImportEntry }) {
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    let url: string | null = null
    const show = (png: Uint8Array | undefined) => {
      if (!png || !current) return
      url = URL.createObjectURL(new Blob([png.slice().buffer as ArrayBuffer], { type: 'image/png' }))
      setSource(url)
    }
    if (entry.thumbnail) show(entry.thumbnail)
    else if (entry.stage === 'waiting' && (entry.kind === 'pdf' || entry.kind === 'photo')) {
      void readWaitingImport(entry.id)
        .then(async (waiting) => (waiting ? (await import('./source-file')).firstPageThumbnail(waiting) : undefined))
        .then(show, () => undefined)
    }
    return () => {
      current = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [entry])
  const Icon = entry.kind === 'record' ? FileJson : entry.kind === 'word' ? FileText : FileImage
  return <div className="exam-sheet import-sheet" aria-hidden="true">
    {source
      ? <img src={source} alt="" />
      : <span className="import-sheet-placeholder"><Icon />{KIND_LABELS[entry.kind]}</span>}
  </div>
}

function ImportCard({
  entry,
  picturesNeeded,
  onDiscard,
}: {
  entry: ImportEntry
  /** How many of its pictures are still needed now, once counted. */
  picturesNeeded: number | undefined
  onDiscard: () => void
}) {
  const [menu, setMenu] = useState<MenuPoint | null>(null)
  const needed = entry.stage === 'imported' ? picturesNeeded ?? entry.imported.picturesNeeded : 0
  // The editor and a bank's page are loaded as the page starts, so they are
  // opened with a full load, as their own cards open them.
  const opens = entry.stage === 'imported'
    ? [
        ...entry.imported.exams.map((exam) => ({ label: exam.name || 'Untitled Test', href: `/editor?exam=${exam.id}`, Icon: FileText })),
        ...entry.imported.banks.map((bank) => ({ label: bank.name || 'Untitled Question Bank', href: `/question-bank?id=${bank.id}`, Icon: Library })),
      ]
    : []
  const items: MenuItem[] = entry.stage === 'waiting'
    ? [
        { kind: 'action', label: 'Continue', icon: <FolderOpen />, onSelect: () => window.location.assign(importHref(entry.id)) },
        { kind: 'separator' },
        { kind: 'action', label: 'Discard', icon: <Trash2 />, destructive: true, onSelect: onDiscard },
      ]
    : opens.map(({ label, href, Icon }) => ({ kind: 'action', label: `Open ${label}`, icon: <Icon />, onSelect: () => window.location.assign(href) }))
  const caption = <>
    <ImportSheet entry={entry} />
    <span className="import-card-caption">
      <span className="import-card-title">{entry.fileName}</span>
      <span className="import-card-facts">
        {entry.stage === 'waiting'
          ? <>
              {entry.tags > 0 ? `${plural(entry.tags, 'picture')} detected · ` : ''}
              {timeLeft(entry.createdAt, new Date())}
            </>
          : entry.stage === 'imported'
            ? `${plural(entry.imported.questions, 'Question')} · ${when(entry.importedAt)}`
            : `Not imported within seven days`}
      </span>
      {needed > 0 && (
        <span className="import-pictures-needed">
          <ImageIcon aria-hidden="true" />{plural(needed, 'picture')} still needed
        </span>
      )}
    </span>
  </>
  const first = opens[0]
  return <li className="import-card" aria-label={entry.fileName} data-stage={entry.stage}>
    {entry.stage === 'waiting'
      ? <Link href={importHref(entry.id)} className="import-card-main" aria-label={`Continue ${entry.fileName}`}>{caption}</Link>
      : first
        ? <a href={first.href} className="import-card-main" aria-label={`Open ${first.label}`}>{caption}</a>
        : <div className="import-card-main">{caption}</div>}
    {items.length > 0 && (
      <button
        type="button"
        className="bank-card-menu import-card-menu"
        aria-label={`${entry.fileName} actions`}
        aria-haspopup="menu"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          setMenu({ x: bounds.right, y: bounds.bottom + 4 })
        }}
      >
        <EllipsisVertical aria-hidden="true" />
      </button>
    )}
    {menu && (
      <ContextMenu
        point={menu}
        side="left"
        ariaLabel={`${entry.fileName} actions`}
        items={items}
        onClose={() => setMenu(null)}
      />
    )}
  </li>
}

export function ImportsPage({
  onImport,
  persistentStorage,
  revision,
  picturesNeededIn,
}: {
  /** Start an import, in the Import dialog. */
  onImport: () => void
  persistentStorage: PersistentStorageStatus
  /** Changes whenever an import may have finished, so the list is read again. */
  revision: number
  /** How many Pending Images the given banks hold now: an import's count
   *  falls as its pictures are added, long after it finished. */
  picturesNeededIn: (bankIds: readonly string[]) => Promise<number>
}) {
  const [entries, setEntries] = useState<readonly ImportEntry[] | null>(null)
  const [needed, setNeeded] = useState<ReadonlyMap<string, number>>(new Map())
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let current = true
    void listImports().then(async (found) => {
      if (!current) return
      setEntries(found)
      const counts = await Promise.all(found.flatMap((entry) =>
        entry.stage === 'imported' && entry.imported.picturesNeeded > 0
          ? [picturesNeededIn(entry.imported.banks.map(({ id }) => id)).then((count) => [entry.id, count] as const, () => null)]
          : []))
      if (current) setNeeded(new Map(counts.filter((count) => count !== null)))
    }, () => { if (current) setEntries([]) })
    return () => { current = false }
  }, [revision, reload, picturesNeededIn])

  const waiting = entries?.filter((entry): entry is Extract<ImportEntry, { stage: 'waiting' }> => entry.stage === 'waiting') ?? []
  const finished = entries?.filter((entry): entry is Exclude<ImportEntry, { stage: 'waiting' }> => entry.stage !== 'waiting') ?? []

  return <AppShell crumbs={[{ label: 'Home', href: '/' }, { label: 'Imports' }]} persistentStorage={persistentStorage}>
    <header className="collection-heading">
      <h1>Imports</h1>
      <div className="collection-actions">
        <button type="button" className="primary-button" onClick={onImport}>Import</button>
      </div>
    </header>
    {entries === null
      ? <p className="import-list-status" role="status">Loading imports…</p>
      : entries.length === 0
        ? <div className="home-empty">
            <h2>No imports yet</h2>
            <p>Every test you convert and every file you import is listed here.</p>
          </div>
        : <>
            {waiting.length > 0 && <section className="import-section" aria-labelledby="imports-waiting">
              <h2 id="imports-waiting">Pending</h2>
              <ul className="collection-grid collection-grid--exams import-grid">
                {waiting.map((entry) => (
                  <ImportCard
                    key={entry.id}
                    entry={entry}
                    picturesNeeded={undefined}
                    onDiscard={() => void discardWaitingImport(entry.id).then(() => setReload((count) => count + 1))}
                  />
                ))}
              </ul>
            </section>}
            {finished.length > 0 && <section className="import-section" aria-labelledby="imports-history">
              <h2 id="imports-history">History</h2>
              <ul className="collection-grid collection-grid--exams import-grid">
                {finished.map((entry) => (
                  <ImportCard key={entry.id} entry={entry} picturesNeeded={needed.get(entry.id)} onDiscard={() => undefined} />
                ))}
              </ul>
            </section>}
          </>}
  </AppShell>
}

/** How wide the preview is drawn: its column at twice the pixels, sharp on
 *  a dense screen. */
const PREVIEW_WIDTH = 560

/**
 * A waiting import's pages as its AI will see them: the labeled copy when the
 * test has pictures — the version with a number on each, which is the one to
 * attach — or the pages themselves when it has none. Arrows, shown on hover
 * or focus, turn the page. A Word document cannot be drawn in the browser, so
 * says what it is.
 */
function WaitingPreview({ waiting }: { waiting: WaitingImport }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [source, setSource] = useState<{ page: number; url: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const labeled = waiting.kind !== 'photo' && waiting.tags.length > 0
  const pages = waiting.kind === 'word' ? 0 : waiting.pageCount
  // The labeled copy is made once; each page is drawn from it as it is shown.
  useEffect(() => {
    if (waiting.kind === 'word') return
    let current = true
    void (async () => {
      if (!labeled) return waiting.bytes
      const [{ labelSourceDocument }, { browserPdfFonts }] = await Promise.all([import('./source-document'), import('./pdf-export')])
      return labelSourceDocument(waiting.bytes, waiting.tags, browserPdfFonts)
    })().then((made) => { if (current) setBytes(made) }, () => { if (current) setFailed(true) })
    return () => { current = false }
  }, [waiting, labeled])
  useEffect(() => {
    if (!bytes) return
    let current = true
    let url: string | null = null
    void (async () => {
      const { renderSourcePage, browserRaster } = await import('./source-document')
      const png = await renderSourcePage(bytes, pageNumber, browserRaster, PREVIEW_WIDTH)
      if (!current) return
      url = URL.createObjectURL(new Blob([png.slice().buffer as ArrayBuffer], { type: 'image/png' }))
      setSource({ page: pageNumber, url })
    })().catch(() => { if (current) setFailed(true) })
    return () => {
      current = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [bytes, pageNumber])
  const shown = source?.page ?? pageNumber
  const name = `Page ${shown}${labeled ? ' of the labeled copy' : ''}`
  return <figure className="import-preview">
    <div className="import-preview-sheet">
      {source
        ? <img src={source.url} alt={name} />
        : waiting.kind === 'word' || failed
          ? <span className="import-sheet-placeholder"><FileText aria-hidden="true" />{waiting.kind === 'word' ? 'Word document' : 'No preview'}</span>
          : <span className="import-sheet-placeholder" role="status">Drawing page {pageNumber}…</span>}
      {pages > 1 && <>
        <button
          type="button"
          className="import-preview-turn"
          data-side="previous"
          aria-label="Previous page"
          disabled={pageNumber === 1}
          onClick={() => setPageNumber(pageNumber - 1)}
        ><ChevronLeft aria-hidden="true" /></button>
        <button
          type="button"
          className="import-preview-turn"
          data-side="next"
          aria-label="Next page"
          disabled={pageNumber === pages}
          onClick={() => setPageNumber(pageNumber + 1)}
        ><ChevronRight aria-hidden="true" /></button>
      </>}
    </div>
    {pages > 0 && <figcaption>
      {pages > 1 ? `Page ${pageNumber} of ${pages}` : 'Page 1'}
      {labeled ? ', labeled: each picture carries the number your AI will name it by.' : ''}
    </figcaption>}
  </figure>
}

/** What is known about a waiting import, under its preview. */
function WaitingFacts({ waiting }: { waiting: WaitingImport }) {
  const kind = waiting.kind ?? 'pdf'
  return <dl className="import-facts" aria-label="About this import">
    <div><dt>File</dt><dd title={waiting.fileName}>{waiting.fileName}</dd></div>
    <div><dt>Type</dt><dd>{KIND_LABELS[kind]}</dd></div>
    {kind !== 'word' && <div><dt>Pages</dt><dd>{waiting.pageCount}</dd></div>}
    <div><dt>Pictures detected</dt><dd>{kind === 'photo' ? 'Cropped after importing' : waiting.tags.length}</dd></div>
    <div><dt>Started</dt><dd>{when(waiting.createdAt)}</dd></div>
    <div><dt>Kept until</dt><dd>{when(new Date(new Date(waiting.createdAt).getTime() + WAITING_IMPORT_LIFETIME_MS).toISOString())}</dd></div>
  </dl>
}

/** One import still waiting, continued where it was left: its first page and
 *  what is known about it beside the steps and the drop for the file the AI
 *  gives back.
 *
 *  The file the AI gives back is read here before the import dialog opens: a
 *  file that cannot be imported is answered on this page, beside the steps
 *  that fix it, rather than in a dialog over them. */
export function WaitingImportPage({
  id,
  persistentStorage,
  revision,
  dropped,
  onReturnedFile,
}: {
  id: string
  persistentStorage: PersistentStorageStatus
  revision: number
  /** A file dropped anywhere on the page, taken as if dropped on the zone. */
  dropped: { file: File; id: number } | null
  /** A returned file that reads, for the import dialog to review. */
  onReturnedFile: (file: File) => void
}) {
  const [waiting, setWaiting] = useState<WaitingImport | null | 'loading'>('loading')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    void readWaitingImport(id).then((found) => { if (current) setWaiting(found) }, () => { if (current) setWaiting(null) })
    return () => { current = false }
  }, [id, revision])

  const take = async (file: File) => {
    setError(null)
    // Only the AI's JSON is checked here. Anything else — a Test Parrot PDF,
    // or another test — is the dialog's to sort out, as it always was.
    if (isRecordFile(file)) {
      setReading(true)
      try {
        await inspectUploadedFile(file)
      } catch (reason) {
        setError(reason instanceof Error && reason.message ? reason.message : 'This file could not be read.')
        return
      } finally {
        setReading(false)
      }
    }
    onReturnedFile(file)
  }
  // A drop made before this page was shown was never meant for it.
  const taken = useRef(dropped?.id ?? null)
  useEffect(() => {
    if (!dropped || taken.current === dropped.id) return
    taken.current = dropped.id
    void take(dropped.file)
  })
  const name = waiting && waiting !== 'loading' ? waiting.fileName : 'Import'
  return <AppShell
    crumbs={[{ label: 'Home', href: '/' }, { label: 'Imports', href: '/imports' }, { label: name }]}
    persistentStorage={persistentStorage}
  >
    {waiting === 'loading'
      ? <p className="import-list-status" role="status">Loading…</p>
      : waiting
        ? <div className="import-page">
            <h1 className="import-page-title" title={waiting.fileName}>
              <span>Converting</span> <span className="import-page-name">{waiting.fileName}</span>
            </h1>
            <aside className="import-page-side">
              <WaitingPreview key={waiting.id} waiting={waiting} />
              <WaitingFacts waiting={waiting} />
            </aside>
            <SourceDocumentSteps
              waiting={waiting}
              noted={false}
              busy={reading}
              onReturnedFile={(file) => void take(file)}
              problem={error && <ImportError message={error} aiMade />}
            />
          </div>
        : <div className="home-empty">
            <h2>This import is no longer waiting</h2>
            <p>It was imported, discarded, or expired. <Link href="/imports">See every import</Link>.</p>
          </div>}
  </AppShell>
}
