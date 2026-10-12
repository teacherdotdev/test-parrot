import type { RecentExam } from './exam-workspaces'
import type { PersistentStorageStatus } from './durable-storage'
import type { QuestionBankCollectionItem } from './resource-collections'
import { homePreview } from './resource-collections'
import { CreateFirstCard, ExamCard, NewResourceCard, QuestionBankCard, ResourceCarousel } from './resource-cards'
import { AppShell } from './app-shell'

/**
 * Home is a resume surface and nothing else: a shelf of the Exams you were
 * working on, then every Question Bank you have. There is nothing to explain
 * and nothing to label twice — the left nav already says where things live, so
 * each section gets a quiet label rather than a title. Creating happens on
 * the shelf itself: an empty shelf is one full-width dotted invitation, and a
 * shelf with anything on it ends with a ghost card the size of the next
 * one. The only button is Import, at the end of the first shelf's bar: a
 * test or a Question Bank made elsewhere has nowhere on a shelf to come from.
 */
export function HomePage({
  exams,
  banks,
  error,
  persistentStorage,
  onNewExam,
  onOpen,
  onNewBank,
  onOpenBank,
  onExportBank,
  onDeleteBank,
  onDeleteExam,
  onImport,
}: {
  exams: readonly RecentExam[]
  banks: readonly QuestionBankCollectionItem[]
  error: string | null
  persistentStorage: PersistentStorageStatus
  onNewExam: () => void
  onOpen: (id: string) => void
  onNewBank: () => void
  onOpenBank: (id: string) => void
  onExportBank: (bank: QuestionBankCollectionItem) => void
  onDeleteBank: (bank: QuestionBankCollectionItem) => void
  onDeleteExam: (exam: RecentExam) => void
  onImport: () => void
}) {
  const recentExams = homePreview(exams)
  const importLink = <button type="button" className="primary-button" onClick={onImport}>Import</button>
  return (
    <AppShell crumbs={[{ label: 'Home' }]} persistentStorage={persistentStorage}>
      {error && (
        <p className="home-error" role="alert">
          {error}
        </p>
      )}

      <section className="home-shelf" aria-labelledby="recent-exams-heading">
        {recentExams.length === 0 ? (
          <>
            <div className="shelf-bar">
              <h1 id="recent-exams-heading" className="shelf-label">
                Pick up where you left off
              </h1>
              {importLink}
            </div>
            <CreateFirstCard label="New Exam" onClick={onNewExam} />
          </>
        ) : (
          <ResourceCarousel
            label="Recent Exams"
            actions={importLink}
            heading={
              <h1 id="recent-exams-heading" className="shelf-label">
                Pick up where you left off
              </h1>
            }
          >
            {recentExams.map((exam) => (
              <div role="listitem" key={exam.id}>
                <ExamCard exam={exam} onOpen={onOpen} onDelete={onDeleteExam} />
              </div>
            ))}
            <div role="listitem">
              <NewResourceCard label="New Exam" shape="sheet" onClick={onNewExam} />
            </div>
          </ResourceCarousel>
        )}
      </section>

      <section className="home-shelf" aria-labelledby="question-banks-heading">
        <div className="shelf-bar">
          <h2 id="question-banks-heading" className="shelf-label">
            Question Banks
          </h2>
        </div>
        {banks.length === 0 ? (
          <CreateFirstCard label="New Question Bank" onClick={onNewBank} />
        ) : (
          <div className="collection-grid">
            {banks.map((bank) => (
              <QuestionBankCard
                key={bank.id}
                bank={bank}
                onOpen={onOpenBank}
                onExport={onExportBank}
                onDelete={onDeleteBank}
              />
            ))}
            <NewResourceCard label="New Question Bank" shape="card" onClick={onNewBank} />
          </div>
        )}
      </section>

    </AppShell>
  )
}
