import { useMemo, useState } from 'react'
import type { RecentExam } from './exam-workspaces'
import type { PersistentStorageStatus } from './durable-storage'
import { CreateFirstCard, ExamCard, QuestionBankCard } from './resource-cards'
import {
  filterExamCollection,
  filterQuestionBankCollection,
  type QuestionBankCollectionItem,
} from './resource-collections'
import { AppShell } from './app-shell'

export function ResourceCollectionPage({
  kind,
  exams,
  banks,
  persistentStorage,
  onOpenExam,
  onOpenBank,
  onNewExam,
  onNewBank,
  onExportBank,
  onDeleteBank,
  onDeleteExam,
  onImportBank,
}: {
  kind: 'exams' | 'question-banks'
  exams: readonly RecentExam[]
  banks: readonly QuestionBankCollectionItem[]
  persistentStorage: PersistentStorageStatus
  onOpenExam: (id: string) => void
  onOpenBank: (id: string) => void
  onNewExam?: () => void
  onNewBank?: () => void
  onExportBank?: (bank: QuestionBankCollectionItem) => void
  onDeleteBank?: (bank: QuestionBankCollectionItem) => void
  onDeleteExam?: (exam: RecentExam) => void
  onImportBank?: () => void
}) {
  const [query, setQuery] = useState('')
  const shownExams = useMemo(
    () => filterExamCollection(exams, query),
    [exams, query],
  )
  const shownBanks = useMemo(
    () => filterQuestionBankCollection(banks, query),
    [banks, query],
  )
  const isExams = kind === 'exams'
  const resources = isExams ? shownExams : shownBanks
  const resourceName = isExams ? 'Exams' : 'Question Banks'
  const create = isExams ? onNewExam : onNewBank

  return (
    <AppShell
      crumbs={[{ label: 'Home', href: '/' }, { label: resourceName }]}
      persistentStorage={persistentStorage}
    >
      {/* The bar above is navigation. Acting on this collection happens on the
          collection, and the page already says which one it is — so the buttons
          are just Import and New. */}
      <header className="collection-heading">
        <h1>{resourceName}</h1>
        <div className="collection-actions">
          {!isExams && onImportBank && (
            <button type="button" className="secondary-button" onClick={onImportBank}>
              Import
            </button>
          )}
          {create && (
            <button type="button" className="primary-button" onClick={create}>
              New
            </button>
          )}
        </div>
      </header>
      <div className="collection-filter">
        <label className="collection-search">
          <span className="sr-only">Search {resourceName}</span>
          <input
            type="search"
            autoFocus
            placeholder={`Search ${resourceName}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <p className="collection-count" role="status" aria-live="polite">
          {resources.length}{' '}
          {resources.length === 1 ? resourceName.replace(/s$/, '') : resourceName}
        </p>
      </div>
      {resources.length === 0 ? (
        <section aria-label={`${resourceName} search results`}>
          {query ? (
            <div className="home-empty">
              <h2>No {resourceName} match “{query.trim()}”</h2>
              <p>Try another search.</p>
            </div>
          ) : (
            create && (
              <CreateFirstCard
                label={isExams ? 'Create your first Exam' : 'Create your first Question Bank'}
                onClick={create}
              />
            )
          )}
        </section>
      ) : (
        <section
          className={isExams ? 'collection-grid collection-grid--exams' : 'collection-grid'}
          aria-label={`${resourceName} search results`}
        >
          {isExams
            ? shownExams.map((exam) => (
                <ExamCard key={exam.id} exam={exam} onOpen={onOpenExam} onDelete={onDeleteExam} />
              ))
            : shownBanks.map((bank) => (
                <QuestionBankCard
                  key={bank.id}
                  bank={bank}
                  onOpen={onOpenBank}
                  onExport={onExportBank}
                  onDelete={onDeleteBank}
                />
              ))}
        </section>
      )}
    </AppShell>
  )
}
