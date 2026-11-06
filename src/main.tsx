import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MilkdownProvider } from '@milkdown/react'
import App from './App'
import { loadExamStore } from './exam-store'
import { domMeasure } from './dom-measure'
import { createExamWorkspaceService } from './exam-workspaces'
import {
  createQuestionBankWorkspaceService,
  type QuestionBankResource,
} from './question-bank-workspaces'
import { persistentStorageStatus } from './durable-storage'
import { createLibraryService } from './library'
import { applyStagedRestore } from './account-backup'
import { expireWaitingImports } from './import-history'
import { PopOverProvider } from './question-bank-pop-over'
import { onUpgradeBlocked } from './storage-schema'
import './styles.css'

// Opening the database after an update waits while a tab still running the
// older Test Parrot holds it. Say so, so the page is never just blank.
onUpgradeBlocked((blocked) => {
  const existing = document.getElementById('upgrade-blocked')
  if (!blocked) { existing?.remove(); return }
  if (existing) return
  const notice = document.createElement('div')
  notice.id = 'upgrade-blocked'
  notice.className = 'upgrade-blocked'
  notice.setAttribute('role', 'alert')
  notice.innerHTML = '<strong>Test Parrot has been updated.</strong>'
    + '<span>Close your other Test Parrot tabs to finish. This page will carry on by itself; nothing is lost.</span>'
  document.body.append(notice)
})

async function start() {
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('/image-worker.js')
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) { window.location.reload(); return }
  }
  // A restore replaces the account before anything below opens it.
  const restored = await applyStagedRestore()
  const restoreError = restored && !restored.applied
    ? 'The backup could not be restored, so nothing in this browser was changed.'
    : ''
  // A Source Document left waiting for more than seven days is deleted.
  void expireWaitingImports().catch(() => undefined)
  const workspaces = createExamWorkspaceService()
  const bankWorkspaces = createQuestionBankWorkspaceService()
  const library = createLibraryService({ workspaces, bankWorkspaces })
  // Whatever has been in Trash for 30 days is deleted for good, the next time
  // the app is open (ADR-0051).
  await library.expireTrash().catch((reason) => console.error('Could not empty expired Trash', reason))
  const startingOnEditor = window.location.pathname === '/editor'
  // Home has no workspace to restore, so it also clears an active placeholder
  // that was abandoned by closing or leaving the editor. A bare editor reload
  // deliberately retains that active workspace long enough to restore it.
  await workspaces.cleanupPristine({ includeActive: !startingOnEditor })
  const startingOnBank = window.location.pathname === '/question-bank'
  // The bank page's own bank is the active one, so it must survive the sweep
  // that disposes abandoned Untitled placeholders.
  await bankWorkspaces.cleanupPristine({ includeActive: !startingOnEditor && !startingOnBank })
  const parameters = new URLSearchParams(window.location.search)
  let store = null
  let bank: QuestionBankResource | null = null
  let editorId: string | null = null
  let error: string | null = restoreError || null

  if (startingOnBank) {
    // Unlike the editor's one-time launch parameters, the bank page keeps its
    // id in the URL: a Question Bank is a place with an address, and reload
    // and Back both have to find their way to the same one.
    const id = parameters.get('id')
    bank = id ? await bankWorkspaces.open(id) : null
    if (!bank) {
      error = 'That Question Bank is unavailable on this device.'
      window.history.replaceState(null, '', '/')
    }
  } else if (startingOnEditor) {
    const launchId = parameters.get('exam')
    // The editor edits an Exam. A bare `/editor` restores the one it was last
    // on, and goes Home when there is none.
    const restore = async () => {
      const activeEditor = await bankWorkspaces.activeEditor()
      if (!activeEditor || !await workspaces.exists(activeEditor.resourceId)) return false
      editorId = activeEditor.resourceId
      store = await loadExamStore(workspaces.backendFor(activeEditor.resourceId), undefined, domMeasure.bankAnswerWidth)
      return true
    }
    if (launchId) {
      if (await workspaces.open(launchId)) {
        editorId = launchId
        store = await loadExamStore(workspaces.backendFor(launchId), undefined, domMeasure.bankAnswerWidth)
        window.history.replaceState(null, '', '/editor')
      } else {
        error = 'That Exam is unavailable on this device.'
        window.history.replaceState(null, '', await restore() ? '/editor' : '/')
      }
    } else {
      window.history.replaceState(null, '', await restore() ? '/editor' : '/')
    }
  }

  const [{ entries, folders }, storageStatus] = await Promise.all([
    library.snapshot(),
    persistentStorageStatus(),
  ])
  // Nothing in Trash is offered anywhere but Trash.
  const live = entries.filter((entry) => !library.inTrash(entry, folders))
  const exams = live.flatMap((entry) => (entry.kind === 'exam' ? [entry.exam] : []))
  const collection = live.flatMap((entry) => (entry.kind === 'bank' ? [entry.bank] : []))
  createRoot(document.getElementById('root')!).render(<StrictMode><MilkdownProvider><PopOverProvider service={bankWorkspaces}><App store={store} bank={bank} workspaces={workspaces} bankWorkspaces={bankWorkspaces} library={library} initialExams={exams} initialBankCollection={collection} persistentStorage={storageStatus} initialEditorId={editorId} initialError={error} /></PopOverProvider></MilkdownProvider></StrictMode>)
}
void start()
