// The browser's Library as Sync with Drive sees it (ADR-0052): each Resource
// rendered as its Drive Copy, and each Drive Copy that comes down written back
// through the same import path a Test Parrot file takes, keeping Questions'
// own ids from the copy's identity map.

import type { LibraryService } from '../library'
import type { ExamWorkspaceService } from '../exam-workspaces'
import type { QuestionBankWorkspaceService } from '../question-bank-workspaces'
import type { Question } from '../exam'
import { inTrash } from '../resource-places'
import { attachedPackage, bankIdentities, identityFile, openUrl, readIdentityFile, remapIds, withOpenBanner, IDENTITY_FILE, type IdentityMap } from './drive-copy'
import type { Applied, Incoming, LocalRef, LocalResource, LocalSide } from './sync-engine'

export type BrowserLibraryServices = {
  library: LibraryService
  workspaces: ExamWorkspaceService
  bankWorkspaces: QuestionBankWorkspaceService
  createId?: () => string
}

/** The package a Drive Copy carries, its identity map, and what importing
 *  it would make. */
export async function readDriveCopy(bytes: Uint8Array) {
  const [{ readCanonicalAttachment, QUESTION_BANK_ATTACHMENT_DESCRIPTION }, { inspectImportRecord }, { readPackageZip, isPackageZip }] = await Promise.all([
    import('../question-bank-import').then(async (module) => ({ ...module, ...(await import('../question-bank-export')) })),
    import('../package-import'),
    import('../package-zip'),
  ])
  // A Drive Copy is a PDF Test Parrot wrote with pdf-lib, read back the same
  // way; anything else takes the general reader a dropped file takes.
  let attachment = await attachedPackage(bytes, QUESTION_BANK_ATTACHMENT_DESCRIPTION)
  if (!attachment) {
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
    if (!pdf.GlobalWorkerOptions.workerSrc) {
      pdf.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href
    }
    attachment = await readCanonicalAttachment(bytes)
  }
  const proposal = await inspectImportRecord(attachment)
  const identity = isPackageZip(attachment)
    ? readIdentityFile((await readPackageZip(attachment)).files.get(IDENTITY_FILE))
    : null
  return { proposal, identity }
}

export function createBrowserLibrary({ library, workspaces, bankWorkspaces, createId = () => crypto.randomUUID() }: BrowserLibraryServices): LocalSide {
  const cascade = (ids: readonly string[]) => workspaces.forceDeleteQuestions(ids)

  async function renderBank(id: string, fileId: string): Promise<Uint8Array> {
    const [{ prepareQuestionBankExport }, { createQuestionBankPdf }] = await Promise.all([
      import('../question-bank-export'),
      import('../question-bank-pdf'),
    ])
    const bank = await bankWorkspaces.read(id)
    if (!bank) throw new Error('That Question Bank is no longer in this browser.')
    const prepared = await prepareQuestionBankExport(bank)
    prepared.files.set(IDENTITY_FILE, identityFile(
      { kind: 'bank', id, name: bank.name },
      bankIdentities(bank.questions, prepared.record.bank.questions),
    ))
    return withOpenBanner(await createQuestionBankPdf(prepared), openUrl(fileId, { kind: 'bank', title: bank.name, questions: bank.questions.length }))
  }

  async function renderExam(id: string, fileId: string): Promise<Uint8Array> {
    const [{ selectedExam }, { prepareExport, EMPTY_EXPORT_HISTORY }, { examPackage }, { writePackageZip }, { createPublicationPdf }, { domMeasure, imageSourcesOfDocuments }] = await Promise.all([
      import('../selected-exam'),
      import('../export-preparation'),
      import('../exam-package-export'),
      import('../package-zip'),
      import('../pdf-export'),
      import('../dom-measure'),
    ])
    const backend = workspaces.backendFor(id)
    let state
    try {
      state = await backend.read()
    } finally {
      await backend.close()
    }
    if (!state) throw new Error('That Exam is no longer in this browser.')
    // The Drive Copy is the Working Copy: what the teacher sees.
    const { exam, arrangement } = selectedExam(state.questionBank, state.workingCopy)
    await domMeasure.loadImages(imageSourcesOfDocuments(exam.questions.flatMap((question) => [question.doc, question.suggestedAnswer])))
    // Planned as an export is, but nothing is recorded: a Drive Copy is not
    // an export, and leaves the Exam's Export History alone.
    const prepared = prepareExport({
      examId: id,
      exam,
      arrangement,
      configuration: { format: 'pdf', selection: { test: true, answerKey: true } },
      history: EMPTY_EXPORT_HISTORY,
      measure: domMeasure,
      createdAt: new Date().toISOString(),
    })
    const carried = await examPackage({ exam, arrangement, ownerOf: (questionId) => bankWorkspaces.ownerOfQuestion(questionId) })
    carried.files.set(IDENTITY_FILE, identityFile({ kind: 'exam', id, name: exam.title }, carried.identities))
    const zip = await writePackageZip(JSON.stringify(carried.package), carried.files)
    const pdf = await createPublicationPdf(prepared.documents, undefined, undefined, zip)
    return withOpenBanner(pdf.bytes, openUrl(fileId, { kind: 'exam', title: exam.title, questions: exam.questions.length }))
  }

  /** The fresh ids an import made, mapped back to the ids the copy names. */
  function stableIdsOf(identities: Map<string, { question: Question; answers: ReadonlyMap<string, string> }> | undefined, identity: IdentityMap | null) {
    const pairs: { recordId: string; fresh: string; stable?: string; question: boolean; owner: string }[] = []
    for (const [recordId, { question, answers }] of identities ?? []) {
      pairs.push({ recordId, fresh: question.id, question: true, owner: recordId, ...(identity?.ids[recordId] ? { stable: identity.ids[recordId] } : {}) })
      for (const [recordAnswer, fresh] of answers) {
        pairs.push({ recordId: recordAnswer, fresh, question: false, owner: recordId, ...(identity?.ids[recordAnswer] ? { stable: identity.ids[recordAnswer] } : {}) })
      }
    }
    return pairs
  }

  async function applyBank(incoming: Incoming): Promise<Applied> {
    const [{ planImport }, { initialSelection }] = await Promise.all([import('../package-commit'), import('../import-selection')])
    const { proposal, identity } = await readDriveCopy(incoming.bytes)
    const plan = planImport(proposal, initialSelection(proposal), createId)
    const planned = plan.banks[0]
    if (!planned) throw new Error('This Drive Copy holds no Question Bank.')
    const pairs = stableIdsOf(plan.identities.get(planned.source), identity)
    const map = new Map(pairs.flatMap(({ fresh, stable }) => (stable ? [[fresh, stable] as const] : [])))
    const targetId = incoming.id
      ?? (identity && identity.resource.kind === 'bank' && !await bankWorkspaces.read(identity.resource.id) ? identity.resource.id : createId())
    // A Question this browser already keeps in another bank cannot also be
    // in this one: it arrives as a new Question.
    const located = await bankWorkspaces.locateQuestions([...map.values()])
    for (const { bankId, question } of located) {
      if (bankId === targetId) continue
      for (const [fresh, stable] of map) if (stable === question.id) map.delete(fresh)
    }
    const questions = remapIds(planned.questions, map)
    const { bank, changed } = await bankWorkspaces.applyDriveCopy({
      id: targetId,
      name: planned.created?.name ?? proposal.banks[0]!.record.bank.name,
      ...(planned.created?.description !== undefined ? { description: planned.created.description } : {}),
      ...(planned.created?.author !== undefined ? { author: planned.created.author } : {}),
      ...(planned.created?.license !== undefined ? { license: planned.created.license } : {}),
      parentId: incoming.parentId,
      questions,
      media: plan.media,
    }, cascade)
    for (const question of changed) await workspaces.propagateCanonicalQuestion(question)
    return { id: bank.id, name: bank.name, modifiedAt: bank.lastUpdatedAt }
  }

  async function applyExam(incoming: Incoming): Promise<Applied> {
    const [{ planImport }, { initialSelection }, { domMeasure }] = await Promise.all([
      import('../package-commit'),
      import('../import-selection'),
      import('../dom-measure'),
    ])
    const { proposal, identity } = await readDriveCopy(incoming.bytes)
    const plan = planImport(proposal, initialSelection(proposal), createId, undefined, domMeasure.bankAnswerWidth)
    const plannedExam = plan.exams[0]
    if (!plannedExam) throw new Error('This Drive Copy holds no Exam.')
    const plannedBank = plan.banks[0]
    const pairs = stableIdsOf(plannedBank ? plan.identities.get(plannedBank.source) : undefined, identity)

    // An Exam links to the Questions of a bank this browser keeps as a Drive
    // Copy; the rest arrive as the Exam's own bank, as an import does.
    const stableQuestionIds = pairs.flatMap(({ question, stable }) => (question && stable ? [stable] : []))
    const located = new Map((await bankWorkspaces.locateQuestions(stableQuestionIds))
      .filter(({ bankId }) => incoming.isDriveCopy(bankId))
      .map(({ question }) => [question.id, question]))
    const linkedRecords = new Set(pairs.flatMap(({ question, stable, recordId }) => (question && stable && located.has(stable) ? [recordId] : [])))
    const previousOwn = (incoming.memo?.ownIds ?? {}) as Record<string, string>
    const ownIds: Record<string, string> = {}
    const map = new Map<string, string>()
    for (const pair of pairs) {
      if (linkedRecords.has(pair.owner)) {
        if (pair.stable) map.set(pair.fresh, pair.stable)
        continue
      }
      // The Exam's own bank keeps the ids it was given the first time.
      const key = pair.stable ?? pair.recordId
      const local = previousOwn[key] ?? pair.fresh
      ownIds[key] = local
      if (local !== pair.fresh) map.set(pair.fresh, local)
    }
    const saved = remapIds(plannedExam.saved, map)
    saved.questionBank.questions = saved.questionBank.questions.map((question) => located.get(question.id) ?? question)
    const linkedFresh = new Set(pairs.flatMap(({ question, fresh, owner }) => (question && linkedRecords.has(owner) ? [fresh] : [])))
    const own = remapIds((plannedBank?.questions ?? []).filter(({ id }) => !linkedFresh.has(id)), map)
    const title = saved.workingCopy.title
    let ownBankId = incoming.memo?.ownBankId as string | undefined
    if (own.length > 0) {
      if (ownBankId && !await bankWorkspaces.read(ownBankId)) ownBankId = undefined
      ownBankId ??= createId()
      const { changed } = await bankWorkspaces.applyDriveCopy({
        id: ownBankId,
        name: plannedBank?.created?.name ?? `${title} Question Bank`,
        parentId: incoming.parentId,
        questions: own,
        media: plan.media,
      }, cascade)
      for (const question of changed) await workspaces.propagateCanonicalQuestion(question)
    }
    const examId = incoming.id
      ?? (identity && identity.resource.kind === 'exam' && !await workspaces.exists(identity.resource.id) ? identity.resource.id : createId())
    const modifiedAt = await workspaces.applyDriveCopy(examId, saved, incoming.parentId)
    return {
      id: examId,
      name: title,
      modifiedAt,
      memo: { ownIds, ...(ownBankId ? { ownBankId } : {}) },
    }
  }

  return {
    async snapshot() {
      const { entries, folders } = await library.snapshot()
      const resources: LocalResource[] = entries.flatMap((entry): LocalResource[] => {
        if (entry.kind === 'folder') return []
        return [{
          kind: entry.kind,
          id: entry.id,
          name: entry.name,
          parentId: entry.parentId,
          modifiedAt: entry.lastModifiedAt,
          trashed: inTrash(entry, folders),
          ...(entry.trashedAt ? { trashedAt: entry.trashedAt } : {}),
          empty: entry.kind === 'exam' ? entry.exam.questionCount === 0 : entry.bank.questionCount === 0,
        }]
      })
      return {
        resources,
        folders: entries.flatMap((entry) => (entry.kind === 'folder'
          ? [{ id: entry.id, name: entry.name, parentId: entry.parentId, trashed: inTrash(entry, folders) }]
          : [])),
      }
    },
    render(ref: LocalRef, fileId: string) {
      return ref.kind === 'bank' ? renderBank(ref.id, fileId) : renderExam(ref.id, fileId)
    },
    apply(incoming: Incoming) {
      return incoming.kind === 'bank' ? applyBank(incoming) : applyExam(incoming)
    },
    async createFolder(name, parentId) {
      return (await library.createFolder(name, parentId)).id
    },
    async trash(ref) {
      await library.trash([ref])
    },
    async duplicate(ref, name) {
      // Keep both: the browser's version, as a new Resource with new ids.
      const bytes = await (ref.kind === 'bank' ? renderBank(ref.id, '') : renderExam(ref.id, ''))
      const parentId = await library.placeOf(ref)
      const applied = await (ref.kind === 'bank' ? applyBank : applyExam)({
        kind: ref.kind,
        id: createId(),
        parentId,
        bytes,
        isDriveCopy: () => true,
      })
      await library.rename({ kind: ref.kind, id: applied.id }, name)
      const { resources } = await this.snapshot()
      return resources.find((resource) => resource.kind === ref.kind && resource.id === applied.id)!
    },
    async backup() {
      const { captureAccount, accountBackupBlob } = await import('../account-backup')
      return new Uint8Array(await (await accountBackupBlob(await captureAccount())).arrayBuffer())
    },
  }
}
