import { duplicateQuestion, type Question } from './exam'
import { requestPersistentStorage } from './durable-storage'
import { collectUnusedMediaAssets } from './local-images'
import { NO_FILTER, type QuestionBankFilter } from './question-bank-view'
import { examDatabaseName } from './exam-workspaces'
import { createIndexedDBAuthoringBackend } from './indexeddb-authoring'
import { upgradeStoredQuestion } from './stored-upgrade'
import { pointsOnQuestion, readPoints } from './points'
import {
  CANONICAL_QUESTION_STORE,
  EDITOR_WORKSPACE_STORE,
  EXAM_STORE,
  EXAM_WORKSPACE_STORE,
  QUESTION_BANK_REGISTRY_STORE,
  QUESTION_BANK_WORKSPACE_STORE,
  MEDIA_ASSET_STORE,
  STORAGE_NAME,
  STORAGE_VERSION,
} from './storage-schema'

export const UNTITLED_QUESTION_BANK = 'Untitled Question Bank'

export type QuestionBankProvenance = {
  description?: string
  author?: string
  license?: { name: string; url?: string }
}

export type QuestionBankResource = QuestionBankProvenance & {
  id: string
  name: string
  createdAt: string
  lastUpdatedAt: string
  questions: Question[]
}

export type QuestionBankSummary = Omit<QuestionBankResource, 'questions'> & {
  questionCount: number
  topics: string[]
}

export type DeletionCascade = (questionIds: readonly string[]) => Promise<{
  rollback(): Promise<void>
  finalize(): Promise<void>
}>

type StoredBank = Omit<QuestionBankResource, 'questions'> & { questionIds: string[] }
type StoredQuestion = Question & { bankId: string }
type BankWorkspace = { key: 'active'; bankId: string }
/** Which Exam the editor was last on, so a bare `/editor` can restore it.
 *  There is one editor and it edits an Exam; a Question Bank is a page of its
 *  own and never occupies this record. */
export type EditorWorkspace = {
  key: 'active'
  mode: 'exam'
  resourceId: string
}

/** Tab state belongs to the Exam whose editor is showing it. */
export type BankWorkspaceContext = {
  examId: string
}

export type QuestionBankTabsWorkspace = {
  openBankIds: string[]
  activeBankId: string | null
  filters: Record<string, QuestionBankFilter>
  pane: { bankPercent: number }
}

export const DEFAULT_BANK_TABS_WORKSPACE: QuestionBankTabsWorkspace = {
  openBankIds: [],
  activeBankId: null,
  filters: {},
  pane: { bankPercent: 33 },
}

type StoredTabsWorkspace = QuestionBankTabsWorkspace & {
  key: string
  examId: string
}

/** The Question Bank Pop-over's tabs belong to no Exam: there is one set,
 *  kept under a key of its own beside every Exam's (ADR-0030). */
const POP_OVER_KEY = 'pop-over'
type StoredPopOverWorkspace = QuestionBankTabsWorkspace & { key: typeof POP_OVER_KEY }

const copyFilter = (filter: QuestionBankFilter = NO_FILTER): QuestionBankFilter => ({
  search: filter.search,
  types: [...filter.types],
  difficulties: [...filter.difficulties],
  topics: [...filter.topics],
  sort: filter.sort ?? 'newest',
})

const copyTabsWorkspace = (workspace: QuestionBankTabsWorkspace): QuestionBankTabsWorkspace => ({
  openBankIds: [...workspace.openBankIds],
  activeBankId: workspace.activeBankId,
  filters: Object.fromEntries(
    Object.entries(workspace.filters).map(([id, filter]) => [id, copyFilter(filter)]),
  ),
  pane: { ...workspace.pane },
})

export function openBankTab(
  workspace: QuestionBankTabsWorkspace,
  bankId: string,
): QuestionBankTabsWorkspace {
  const next = copyTabsWorkspace(workspace)
  if (!next.openBankIds.includes(bankId)) next.openBankIds.push(bankId)
  next.activeBankId = bankId
  if (!next.filters[bankId]) next.filters[bankId] = copyFilter()
  return next
}

export function closeBankTab(
  workspace: QuestionBankTabsWorkspace,
  bankId: string,
): QuestionBankTabsWorkspace {
  const index = workspace.openBankIds.indexOf(bankId)
  if (index === -1) return copyTabsWorkspace(workspace)
  const next = copyTabsWorkspace(workspace)
  next.openBankIds.splice(index, 1)
  delete next.filters[bankId]
  if (next.activeBankId === bankId) {
    next.activeBankId = next.openBankIds[Math.min(index, next.openBankIds.length - 1)] ?? null
  }
  return next
}

export function updateBankTabFilter(
  workspace: QuestionBankTabsWorkspace,
  bankId: string,
  filter: QuestionBankFilter,
): QuestionBankTabsWorkspace {
  const next = copyTabsWorkspace(workspace)
  next.filters[bankId] = copyFilter(filter)
  return next
}

function tabsKey(context: BankWorkspaceContext): string {
  return `exam:${context.examId}`
}

/** What one import made, so the caller can decide where the teacher lands. */
export type ImportResult = {
  createdBankIds: string[]
  updatedBankIds: string[]
  createdExamIds: string[]
  /** Questions added across every bank. */
  questionCount: number
}

export type BankChange =
  | { kind: 'rename'; name: string }
  | { kind: 'update-provenance'; provenance: QuestionBankProvenance }
  | { kind: 'create-question'; question: Question }
  | { kind: 'update-question'; question: Question }
  | { kind: 'duplicate-question'; questionId: string }
  /** New Questions added at the end of the bank, in order, as one change —
   *  what a paste of copied Questions brings in. */
  | { kind: 'create-questions'; questions: readonly Question[] }

/** A Question as the bank's store holds it, read into the shape the app
 *  uses. Exported for its tests. */
export function questionOf(stored: Question & { bankId?: string }): Question {
  const question: Question = {
    id: stored.id,
    type: stored.type,
    doc: stored.doc,
    ...(stored.suggestedAnswer ? { suggestedAnswer: stored.suggestedAnswer } : {}),
    columns: stored.columns,
  }
  if (stored.difficulty) question.difficulty = stored.difficulty
  if (stored.topics) question.topics = [...stored.topics]
  // A question stored before Points existed has none, and is simply unpointed;
  // a Multipart question's worth is its Parts', never a field of its own. One
  // stored while they were called Marks has `marks` instead.
  const points = readPoints(stored.points ?? (stored as { marks?: unknown }).marks)
  if (points !== undefined && pointsOnQuestion(stored)) question.points = points
  // Written by an earlier build, perhaps: see `stored-upgrade.ts`.
  return upgradeStoredQuestion(question)
}

export function isPristineQuestionBank(bank: QuestionBankResource | null): boolean {
  return Boolean(
    bank
    && bank.name === UNTITLED_QUESTION_BANK
    && bank.questions.length === 0,
  )
}

function requestOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function completionOf(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function createGlobalStores(database: IDBDatabase) {
  if (!database.objectStoreNames.contains(EXAM_STORE)) database.createObjectStore(EXAM_STORE, { keyPath: 'id' })
  if (!database.objectStoreNames.contains(EXAM_WORKSPACE_STORE)) database.createObjectStore(EXAM_WORKSPACE_STORE, { keyPath: 'key' })
  if (!database.objectStoreNames.contains(QUESTION_BANK_REGISTRY_STORE)) database.createObjectStore(QUESTION_BANK_REGISTRY_STORE, { keyPath: 'id' })
  if (!database.objectStoreNames.contains(CANONICAL_QUESTION_STORE)) database.createObjectStore(CANONICAL_QUESTION_STORE, { keyPath: 'id' })
  if (!database.objectStoreNames.contains(QUESTION_BANK_WORKSPACE_STORE)) database.createObjectStore(QUESTION_BANK_WORKSPACE_STORE, { keyPath: 'key' })
  if (!database.objectStoreNames.contains(EDITOR_WORKSPACE_STORE)) database.createObjectStore(EDITOR_WORKSPACE_STORE, { keyPath: 'key' })
  if (!database.objectStoreNames.contains(MEDIA_ASSET_STORE)) database.createObjectStore(MEDIA_ASSET_STORE, { keyPath: 'hash' })
}

function openRegistry(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STORAGE_NAME, STORAGE_VERSION)
    request.onupgradeneeded = () => createGlobalStores(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(`Could not open ${STORAGE_NAME}`))
  })
}

async function readBank(database: IDBDatabase, id: string): Promise<QuestionBankResource | null> {
  const transaction = database.transaction(
    [QUESTION_BANK_REGISTRY_STORE, CANONICAL_QUESTION_STORE],
    'readonly',
  )
  const bankRequest = transaction.objectStore(QUESTION_BANK_REGISTRY_STORE).get(id)
  const questionsRequest = transaction.objectStore(CANONICAL_QUESTION_STORE).getAll()
  const [bank, questions] = await Promise.all([
    requestOf(bankRequest) as Promise<StoredBank | undefined>,
    requestOf(questionsRequest) as Promise<StoredQuestion[]>,
    completionOf(transaction),
  ])
  if (!bank) return null
  const byId = new Map(
    questions
      .filter((question) => question.bankId === bank.id)
      .map((question) => [question.id, question]),
  )
  return {
    id: bank.id,
    name: bank.name,
    ...(bank.description !== undefined ? { description: bank.description } : {}),
    ...(bank.author !== undefined ? { author: bank.author } : {}),
    ...(bank.license !== undefined ? { license: { ...bank.license } } : {}),
    createdAt: bank.createdAt,
    lastUpdatedAt: bank.lastUpdatedAt,
    questions: bank.questionIds.flatMap((questionId) => {
      const stored = byId.get(questionId)
      if (!stored) return []
      return [questionOf(stored)]
    }),
  }
}

/** Global durable ownership for independent Question Banks and their Questions. */
export function createQuestionBankWorkspaceService(
  options: { now?: () => Date; createId?: () => string } = {},
) {
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? (() => crypto.randomUUID())
  const registry = openRegistry()

  const transact = async <T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    operation: (transaction: IDBTransaction) => Promise<T> | T,
  ) => {
    const transaction = (await registry).transaction(stores, mode)
    const completed = completionOf(transaction)
    try {
      const result = await operation(transaction)
      await completed
      return result
    } catch (error) {
      try { transaction.abort() } catch { /* already settled */ }
      await completed.catch(() => undefined)
      throw error
    }
  }

  let workspaceWrites: Promise<void> = Promise.resolve()
  const queueWorkspaceWrite = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = workspaceWrites.then(operation)
    workspaceWrites = result.then(() => undefined, () => undefined)
    return result
  }

  const removeBankFromWorkspaceTransaction = async (
    transaction: IDBTransaction,
    bankId: string,
  ) => {
    transaction.objectStore(QUESTION_BANK_REGISTRY_STORE).delete(bankId)
    const workspaces = transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE)
    const stored = await requestOf(workspaces.getAll()) as (StoredTabsWorkspace | BankWorkspace)[]
    for (const record of stored) {
      if (record.key === 'active') continue
      workspaces.put({ ...record, ...closeBankTab(record as StoredTabsWorkspace, bankId) })
    }
    const active = stored.find((record) => record.key === 'active') as BankWorkspace | undefined
    if (active?.bankId === bankId) workspaces.delete('active')
  }

  const mutateWorkspace = (
    context: BankWorkspaceContext,
    change: (workspace: QuestionBankTabsWorkspace) => QuestionBankTabsWorkspace,
  ) => queueWorkspaceWrite(() =>
    transact(QUESTION_BANK_WORKSPACE_STORE, 'readwrite', async (transaction) => {
      const store = transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE)
      const stored = await requestOf(store.get(tabsKey(context))) as StoredTabsWorkspace | undefined
      const next = change(stored ?? DEFAULT_BANK_TABS_WORKSPACE)
      store.put({ key: tabsKey(context), examId: context.examId, ...next } satisfies StoredTabsWorkspace)
      return next
    }),
  )

  const service = {
    async activeId(): Promise<string | null> {
      return transact(QUESTION_BANK_WORKSPACE_STORE, 'readonly', async (transaction) => {
        const workspace = await requestOf(
          transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).get('active'),
        ) as BankWorkspace | undefined
        return workspace?.bankId ?? null
      })
    },
    async activeEditor(): Promise<EditorWorkspace | null> {
      return transact(EDITOR_WORKSPACE_STORE, 'readonly', async (transaction) => {
        return await requestOf(
          transaction.objectStore(EDITOR_WORKSPACE_STORE).get('active'),
        ) as EditorWorkspace | undefined ?? null
      })
    },
    async workspace(context: BankWorkspaceContext): Promise<QuestionBankTabsWorkspace> {
      await workspaceWrites
      return transact(QUESTION_BANK_WORKSPACE_STORE, 'readonly', async (transaction) => {
        const stored = await requestOf(
          transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).get(tabsKey(context)),
        ) as StoredTabsWorkspace | undefined
        return stored ? copyTabsWorkspace(stored) : copyTabsWorkspace(DEFAULT_BANK_TABS_WORKSPACE)
      })
    },
    async saveWorkspace(
      context: BankWorkspaceContext,
      workspace: QuestionBankTabsWorkspace,
    ): Promise<QuestionBankTabsWorkspace> {
      const saved = copyTabsWorkspace(workspace)
      return queueWorkspaceWrite(async () => {
        await transact(QUESTION_BANK_WORKSPACE_STORE, 'readwrite', (transaction) => {
          transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).put({
            key: tabsKey(context), examId: context.examId, ...saved,
          } satisfies StoredTabsWorkspace)
        })
        return saved
      })
    },
    async openTab(context: BankWorkspaceContext, bankId: string) {
      return queueWorkspaceWrite(async () => {
        const bank = await readBank(await registry, bankId)
        if (!bank) return null
        const workspace = await transact(
          [QUESTION_BANK_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE],
          'readwrite',
          async (transaction) => {
            const workspaces = transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE)
            const stored = await requestOf(workspaces.get(tabsKey(context))) as StoredTabsWorkspace | undefined
            const next = openBankTab(stored ?? DEFAULT_BANK_TABS_WORKSPACE, bankId)
            workspaces.put({
              key: tabsKey(context), examId: context.examId, ...next,
            } satisfies StoredTabsWorkspace)
            transaction.objectStore(EDITOR_WORKSPACE_STORE).put({
              key: 'active', mode: 'exam', resourceId: context.examId,
            } satisfies EditorWorkspace)
            return next
          },
        )
        return { bank, workspace }
      })
    },
    async closeTab(context: BankWorkspaceContext, bankId: string) {
      return queueWorkspaceWrite(() => transact(
        [QUESTION_BANK_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE],
        'readwrite',
        async (transaction) => {
          const workspaces = transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE)
          const stored = await requestOf(workspaces.get(tabsKey(context))) as StoredTabsWorkspace | undefined
          const next = closeBankTab(stored ?? DEFAULT_BANK_TABS_WORKSPACE, bankId)
          workspaces.put({
            key: tabsKey(context), examId: context.examId, ...next,
          } satisfies StoredTabsWorkspace)
          return next
        },
      ))
    },
    async updateFilter(
      context: BankWorkspaceContext,
      bankId: string,
      filter: QuestionBankFilter,
    ) {
      return mutateWorkspace(context, (workspace) => updateBankTabFilter(workspace, bankId, filter))
    },
    async updatePane(context: BankWorkspaceContext, bankPercent: number) {
      return mutateWorkspace(context, (workspace) => ({
        ...copyTabsWorkspace(workspace),
        pane: { bankPercent: Math.min(80, Math.max(20, bankPercent)) },
      }))
    },
    async carryWorkspace(from: BankWorkspaceContext, to: BankWorkspaceContext) {
      return service.saveWorkspace(to, await service.workspace(from))
    },
    /** The Question Bank Pop-over's tabs and their filters. Deleting a bank
     *  closes its tab here as it does in every Exam's. */
    async popOverWorkspace(): Promise<QuestionBankTabsWorkspace> {
      await workspaceWrites
      return transact(QUESTION_BANK_WORKSPACE_STORE, 'readonly', async (transaction) => {
        const stored = await requestOf(
          transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).get(POP_OVER_KEY),
        ) as StoredPopOverWorkspace | undefined
        return copyTabsWorkspace(stored ?? DEFAULT_BANK_TABS_WORKSPACE)
      })
    },
    async savePopOverWorkspace(workspace: QuestionBankTabsWorkspace): Promise<void> {
      const saved = copyTabsWorkspace(workspace)
      await queueWorkspaceWrite(() => transact(QUESTION_BANK_WORKSPACE_STORE, 'readwrite', (transaction) => {
        transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).put({
          key: POP_OVER_KEY, ...saved,
        } satisfies StoredPopOverWorkspace)
      }))
    },
    /**
     * Apply one import: create or append to banks, store Media Assets, and
     * create each allowed Exam, all or nothing.
     *
     * Each Exam lives in its own database, so those are written first and are
     * invisible until the one registry transaction below lists them. If that
     * transaction fails — an existing target bank gone, storage full — it
     * aborts every bank, Question and Exam entry together, and the Exam
     * databases written ahead of it are deleted before the failure is
     * reported.
     */
    async commitImport(
      proposal: import('./package-import').ImportProposal,
      selection: import('./import-selection').ImportSelection,
      options: {
        /** Pending Images resolved in Resolve Images. */
        resolution?: import('./pending-images').PendingImageResolution
        /** Measures a Word Bank answer, so a Matching position the record
         *  does not place takes the layout that fits (`wordBankLayoutFor`). */
        bankAnswerWidth?: import('./export-plan').BankAnswerWidth
        /** What the import history records once it lands: the file, and the
         *  waiting import it finishes — whose Source Document is then deleted
         *  — when it was paired with one. */
        history?: {
          fileName: string
          kind: import('./import-history').ImportFileKind
          waitingImportId?: string
        }
      } = {},
    ): Promise<ImportResult> {
      const { planImport } = await import('./package-commit')
      const plan = planImport(proposal, selection, createId, options.resolution, options.bankAnswerWidth)
      const timestamp = now().toISOString()
      const written: string[] = []
      const bankNames = new Map(plan.banks.flatMap(({ bankId, created }) => (created ? [[bankId, created.name] as const] : [])))
      try {
        for (const exam of plan.exams) {
          written.push(exam.examId)
          const backend = createIndexedDBAuthoringBackend(examDatabaseName(exam.examId))
          try {
            await backend.initialize(exam.saved, { ...exam.saved, dirty: false })
          } finally {
            await backend.close()
          }
        }
        await transact(
          [
            QUESTION_BANK_REGISTRY_STORE,
            CANONICAL_QUESTION_STORE,
            MEDIA_ASSET_STORE,
            QUESTION_BANK_WORKSPACE_STORE,
            EXAM_STORE,
          ],
          'readwrite',
          async (transaction) => {
            const registryStore = transaction.objectStore(QUESTION_BANK_REGISTRY_STORE)
            const questionStore = transaction.objectStore(CANONICAL_QUESTION_STORE)
            for (const bank of plan.banks) {
              if (bank.created) {
                registryStore.add({
                  id: bank.bankId,
                  ...bank.created,
                  createdAt: timestamp,
                  lastUpdatedAt: timestamp,
                  questionIds: bank.questions.map(({ id }) => id),
                } satisfies StoredBank)
              } else {
                const existing = await requestOf(registryStore.get(bank.bankId)) as StoredBank | undefined
                if (!existing) throw new Error('The Question Bank chosen to add to is no longer on this device.')
                bankNames.set(bank.bankId, existing.name)
                registryStore.put({
                  ...existing,
                  lastUpdatedAt: timestamp,
                  questionIds: [...existing.questionIds, ...bank.questions.map(({ id }) => id)],
                } satisfies StoredBank)
              }
              for (const question of bank.questions) {
                questionStore.add({ ...question, bankId: bank.bankId } satisfies StoredQuestion)
              }
            }
            const mediaStore = transaction.objectStore(MEDIA_ASSET_STORE)
            for (const asset of plan.media) {
              mediaStore.put({
                hash: asset.id.slice('sha256:'.length),
                mimeType: asset.mimeType,
                bytes: asset.bytes.slice().buffer,
                width: asset.width,
                height: asset.height,
              })
            }
            const workspaces = transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE)
            const firstBank = plan.banks[0]
            if (firstBank) workspaces.put({ key: 'active', bankId: firstBank.bankId } satisfies BankWorkspace)
            for (const exam of plan.exams) {
              transaction.objectStore(EXAM_STORE).add({
                id: exam.examId,
                createdAt: timestamp,
                lastOpenedAt: timestamp,
              })
              // An imported Exam opens with the banks it was built from as
              // its tabs, the first of them active.
              const tabs = exam.bankIds.reduce(openBankTab, DEFAULT_BANK_TABS_WORKSPACE)
              workspaces.put({
                key: tabsKey({ examId: exam.examId }),
                examId: exam.examId,
                ...tabs,
                activeBankId: exam.bankIds[0] ?? null,
              } satisfies StoredTabsWorkspace)
            }
          },
        )
      } catch (error) {
        await Promise.all(written.map((id) => new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(examDatabaseName(id))
          request.onsuccess = request.onblocked = request.onerror = () => resolve()
        })))
        throw error
      }
      void requestPersistentStorage()
      if (options.history) {
        const [{ recordImport }, { pendingImagesOfQuestions }] = await Promise.all([
          import('./import-history'),
          import('./pending-images'),
        ])
        await recordImport(options.history, {
          banks: plan.banks.map(({ bankId }) => ({ id: bankId, name: bankNames.get(bankId) ?? '' })),
          exams: plan.exams.map(({ examId, saved }) => ({ id: examId, name: saved.workingCopy.title })),
          questions: plan.banks.reduce((total, { questions }) => total + questions.length, 0),
          picturesNeeded: plan.banks.reduce((total, { questions }) => total + pendingImagesOfQuestions(questions).length, 0),
        }).catch(() => undefined)
      }
      return {
        createdBankIds: plan.banks.filter(({ created }) => created).map(({ bankId }) => bankId),
        updatedBankIds: plan.banks.filter(({ created }) => !created).map(({ bankId }) => bankId),
        createdExamIds: plan.exams.map(({ examId }) => examId),
        questionCount: plan.banks.reduce((total, { questions }) => total + questions.length, 0),
      }
    },
    async create(): Promise<QuestionBankResource> {
      const timestamp = now().toISOString()
      const bank: QuestionBankResource = {
        id: createId(),
        name: UNTITLED_QUESTION_BANK,
        createdAt: timestamp,
        lastUpdatedAt: timestamp,
        questions: [],
      }
      await transact(
        [QUESTION_BANK_REGISTRY_STORE, QUESTION_BANK_WORKSPACE_STORE],
        'readwrite',
        (transaction) => {
          transaction.objectStore(QUESTION_BANK_REGISTRY_STORE).add({
            id: bank.id,
            name: bank.name,
            createdAt: bank.createdAt,
            lastUpdatedAt: bank.lastUpdatedAt,
            questionIds: [],
          } satisfies StoredBank)
          transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).put({ key: 'active', bankId: bank.id } satisfies BankWorkspace)
        },
      )
      return bank
    },
    async read(id: string) {
      return readBank(await registry, id)
    },
    async ownerOfQuestion(questionId: string): Promise<QuestionBankResource | null> {
      const database = await registry
      const transaction = database.transaction(CANONICAL_QUESTION_STORE, 'readonly')
      const stored = await requestOf(
        transaction.objectStore(CANONICAL_QUESTION_STORE).get(questionId),
      ) as StoredQuestion | undefined
      await completionOf(transaction)
      return stored ? readBank(database, stored.bankId) : null
    },
    /** The Questions these ids name, wherever they live, each with the bank
     *  that owns it, in the order asked for. An id nothing owns any more is
     *  left out. */
    async locateQuestions(questionIds: readonly string[]): Promise<{ bankId: string; question: Question }[]> {
      const database = await registry
      const transaction = database.transaction(CANONICAL_QUESTION_STORE, 'readonly')
      const store = transaction.objectStore(CANONICAL_QUESTION_STORE)
      const stored = await Promise.all(
        questionIds.map((id) => requestOf(store.get(id)) as Promise<StoredQuestion | undefined>),
      )
      await completionOf(transaction)
      return stored.flatMap((question) =>
        question ? [{ bankId: question.bankId, question: questionOf(question) }] : [])
    },
    async open(id: string): Promise<QuestionBankResource | null> {
      const bank = await readBank(await registry, id)
      if (!bank) return null
      await transact([QUESTION_BANK_WORKSPACE_STORE], 'readwrite', (transaction) => {
        transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).put({ key: 'active', bankId: id } satisfies BankWorkspace)
      })
      return bank
    },
    async permanentlyDeleteQuestion(
      bankId: string,
      questionId: string,
      cascade: DeletionCascade,
    ): Promise<QuestionBankResource | null> {
      const before = await readBank(await registry, bankId)
      if (!before) throw new Error('That Question Bank is unavailable on this device.')
      if (!before.questions.some(({ id }) => id === questionId)) throw new Error('That Question does not belong to this Question Bank.')
      const exams = await cascade([questionId])
      const timestamp = now().toISOString()
      try {
        const remainingIds = before.questions.map(({ id }) => id).filter((id) => id !== questionId)
        const removeBank = before.name === UNTITLED_QUESTION_BANK && remainingIds.length === 0
        await transact(
          [QUESTION_BANK_REGISTRY_STORE, CANONICAL_QUESTION_STORE, QUESTION_BANK_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE],
          'readwrite',
          async (transaction) => {
            transaction.objectStore(CANONICAL_QUESTION_STORE).delete(questionId)
            if (!removeBank) {
              transaction.objectStore(QUESTION_BANK_REGISTRY_STORE).put({
                id: before.id, name: before.name, createdAt: before.createdAt,
                ...(before.description !== undefined ? { description: before.description } : {}),
                ...(before.author !== undefined ? { author: before.author } : {}),
                ...(before.license !== undefined ? { license: before.license } : {}),
                lastUpdatedAt: timestamp, questionIds: remainingIds,
              } satisfies StoredBank)
              return
            }
            await removeBankFromWorkspaceTransaction(transaction, bankId)
          },
        )
        await exams.finalize().catch((error) => console.error('Could not clean up a pristine Exam after deletion', error))
        await collectUnusedMediaAssets().catch((error) => console.error('Could not collect unused media', error))
        void requestPersistentStorage()
        return removeBank ? null : {
          ...before,
          lastUpdatedAt: timestamp,
          questions: before.questions.filter(({ id }) => id !== questionId),
        }
      } catch (error) {
        await exams.rollback()
        throw error
      }
    },
    async permanentlyDeleteBank(bankId: string, cascade: DeletionCascade): Promise<void> {
      const before = await readBank(await registry, bankId)
      if (!before) throw new Error('That Question Bank is unavailable on this device.')
      const exams = await cascade(before.questions.map(({ id }) => id))
      try {
        await transact(
          [QUESTION_BANK_REGISTRY_STORE, CANONICAL_QUESTION_STORE, QUESTION_BANK_WORKSPACE_STORE, EDITOR_WORKSPACE_STORE],
          'readwrite',
          async (transaction) => {
            const questions = transaction.objectStore(CANONICAL_QUESTION_STORE)
            for (const question of before.questions) questions.delete(question.id)
            await removeBankFromWorkspaceTransaction(transaction, bankId)
          },
        )
        await exams.finalize().catch((error) => console.error('Could not clean up a pristine Exam after deletion', error))
        await collectUnusedMediaAssets().catch((error) => console.error('Could not collect unused media', error))
        void requestPersistentStorage()
      } catch (error) {
        await exams.rollback()
        throw error
      }
    },
    async commitCanonicalQuestion(
      id: string,
      question: Question,
      propagate: (question: Question) => Promise<void>,
    ): Promise<QuestionBankResource> {
      const before = await readBank(await registry, id)
      if (!before) throw new Error('That Question Bank is unavailable on this device.')
      const previous = before.questions.find((candidate) => candidate.id === question.id)
      if (!previous) throw new Error('That Question does not belong to this Question Bank.')
      try {
        const updated = await service.commit(id, { kind: 'update-question', question }, false)
        await propagate(question)
        void requestPersistentStorage()
        return updated
      } catch (error) {
        // Exam projection handles its own compensation. Restore the exact
        // canonical record and bank timestamp so a failed multi-resource save
        // is observationally identical to no save at all.
        await transact(
          [QUESTION_BANK_REGISTRY_STORE, CANONICAL_QUESTION_STORE],
          'readwrite',
          (transaction) => {
            const stored = transaction.objectStore(CANONICAL_QUESTION_STORE)
            stored.put({ ...previous, bankId: id } satisfies StoredQuestion)
            const { questions: previousQuestions, ...storedBank } = before
            transaction.objectStore(QUESTION_BANK_REGISTRY_STORE).put({
              ...storedBank,
              questionIds: previousQuestions.map((candidate) => candidate.id),
            } satisfies StoredBank)
          },
        ).catch(() => undefined)
        throw error
      }
    },
    async commit(
      id: string,
      change: BankChange,
      requestDurability = true,
    ): Promise<QuestionBankResource> {
      const timestamp = now().toISOString()
      await transact(
        [QUESTION_BANK_REGISTRY_STORE, CANONICAL_QUESTION_STORE],
        'readwrite',
        async (transaction) => {
          const banks = transaction.objectStore(QUESTION_BANK_REGISTRY_STORE)
          const questions = transaction.objectStore(CANONICAL_QUESTION_STORE)
          const bank = await requestOf(banks.get(id)) as StoredBank | undefined
          if (!bank) throw new Error('That Question Bank is unavailable on this device.')

          if (change.kind === 'rename') {
            if (change.name === bank.name) return
            banks.put({ ...bank, name: change.name, lastUpdatedAt: timestamp })
            return
          }

          if (change.kind === 'update-provenance') {
            const next = {
              ...bank,
              description: change.provenance.description?.trim() || undefined,
              author: change.provenance.author?.trim() || undefined,
              license: change.provenance.license?.name.trim()
                ? {
                    name: change.provenance.license.name.trim(),
                    ...(change.provenance.license.url?.trim()
                      ? { url: change.provenance.license.url.trim() }
                      : {}),
                  }
                : undefined,
            }
            if (JSON.stringify(next) === JSON.stringify(bank)) return
            banks.put({ ...next, lastUpdatedAt: timestamp })
            return
          }

          if (change.kind === 'create-questions') {
            for (const question of change.questions) {
              const existing = await requestOf(questions.get(question.id)) as StoredQuestion | undefined
              if (existing) throw new Error('That Question already belongs to a Question Bank.')
              questions.add({ ...question, bankId: id } satisfies StoredQuestion)
            }
            if (change.questions.length === 0) return
            banks.put({
              ...bank,
              questionIds: [...bank.questionIds, ...change.questions.map(({ id }) => id)],
              lastUpdatedAt: timestamp,
            })
            return
          }

          if (change.kind === 'create-question') {
            const existing = await requestOf(questions.get(change.question.id)) as StoredQuestion | undefined
            if (existing) throw new Error('That Question already belongs to a Question Bank.')
            questions.add({ ...change.question, bankId: id } satisfies StoredQuestion)
            banks.put({ ...bank, questionIds: [...bank.questionIds, change.question.id], lastUpdatedAt: timestamp })
            return
          }

          const questionId = change.kind === 'update-question'
            ? change.question.id
            : change.questionId
          const existing = await requestOf(questions.get(questionId)) as StoredQuestion | undefined
          if (!existing || existing.bankId !== id || !bank.questionIds.includes(questionId)) {
            throw new Error('That Question does not belong to this Question Bank.')
          }
          if (change.kind === 'update-question') {
            if (change.question.type !== existing.type) {
              throw new Error('A Question Type cannot be changed after creation.')
            }
            if (JSON.stringify(questionOf(existing)) === JSON.stringify(change.question)) return
            questions.put({ ...change.question, bankId: id } satisfies StoredQuestion)
            banks.put({ ...bank, lastUpdatedAt: timestamp })
          } else if (change.kind === 'duplicate-question') {
            const copy = duplicateQuestion(questionOf(existing))
            questions.add({ ...copy, bankId: id } satisfies StoredQuestion)
            const at = bank.questionIds.indexOf(questionId)
            const questionIds = [...bank.questionIds]
            questionIds.splice(at + 1, 0, copy.id)
            banks.put({ ...bank, questionIds, lastUpdatedAt: timestamp })
          }
        },
      )
      const updated = await readBank(await registry, id)
      if (!updated) throw new Error('That Question Bank is unavailable on this device.')
      if (requestDurability) void requestPersistentStorage()
      return updated
    },
    async recent(): Promise<QuestionBankSummary[]> {
      const database = await registry
      const transaction = database.transaction(
        [QUESTION_BANK_REGISTRY_STORE, CANONICAL_QUESTION_STORE],
        'readonly',
      )
      const [banks, questions] = await Promise.all([
        requestOf(transaction.objectStore(QUESTION_BANK_REGISTRY_STORE).getAll()) as Promise<StoredBank[]>,
        requestOf(transaction.objectStore(CANONICAL_QUESTION_STORE).getAll()) as Promise<StoredQuestion[]>,
        completionOf(transaction),
      ])
      return banks.map((bank) => {
        const owned = questions.filter((question) => question.bankId === bank.id)
        return {
          id: bank.id,
          name: bank.name,
          ...(bank.description !== undefined ? { description: bank.description } : {}),
          ...(bank.author !== undefined ? { author: bank.author } : {}),
          ...(bank.license !== undefined ? { license: { ...bank.license } } : {}),
          createdAt: bank.createdAt,
          lastUpdatedAt: bank.lastUpdatedAt,
          questionCount: owned.length,
          topics: [...new Set(owned.flatMap((question) => question.topics ?? []))],
        }
      }).sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt))
    },
    async removePristine(id: string): Promise<boolean> {
      const bank = await readBank(await registry, id)
      if (!isPristineQuestionBank(bank)) return false
      await transact(
        [QUESTION_BANK_REGISTRY_STORE, QUESTION_BANK_WORKSPACE_STORE],
        'readwrite',
        async (transaction) => {
          transaction.objectStore(QUESTION_BANK_REGISTRY_STORE).delete(id)
          const bankWorkspace = await requestOf(transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).get('active')) as BankWorkspace | undefined
          if (bankWorkspace?.bankId === id) transaction.objectStore(QUESTION_BANK_WORKSPACE_STORE).delete('active')
        },
      )
      return true
    },
    async cleanupPristine({ includeActive = false }: { includeActive?: boolean } = {}) {
      const active = await service.activeId()
      const banks = await service.recent()
      await Promise.all(
        banks
          .filter((bank) => includeActive || bank.id !== active)
          .map((bank) => service.removePristine(bank.id)),
      )
    },
  }
  return service
}

export type QuestionBankWorkspaceService = ReturnType<typeof createQuestionBankWorkspaceService>

/** React-facing commit boundary. State changes only after the durable operation succeeds. */
export function createQuestionBankResourceStore(
  initial: QuestionBankResource,
  commit: (change: BankChange) => Promise<QuestionBankResource>,
) {
  let state = initial
  const listeners = new Set<() => void>()
  const apply = async (change: BankChange) => {
    const durable = await commit(change)
    state = durable
    for (const listener of listeners) listener()
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    rename: (name: string) => apply({ kind: 'rename', name }),
    updateProvenance: (provenance: QuestionBankProvenance) =>
      apply({ kind: 'update-provenance', provenance }),
    createQuestion: (question: Question) => apply({ kind: 'create-question', question }),
    updateQuestion: (question: Question) => apply({ kind: 'update-question', question }),
    duplicateQuestion: (questionId: string) => apply({ kind: 'duplicate-question', questionId }),
  }
}

export type QuestionBankResourceStore = ReturnType<typeof createQuestionBankResourceStore>
