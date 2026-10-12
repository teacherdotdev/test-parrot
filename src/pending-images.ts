import { bankLetter } from './matching'
import {
  holdsSubparts,
  partLetter,
  type PendingImageReference,
  type QuestionBankRecordAnsweringPart,
  type QuestionBankRecordPart,
  type QuestionBankRecordQuestion,
  type SemanticDocument,
  type SemanticNode,
} from './question-bank-export'
import type { ParsedQuestionBankRecord } from './question-bank-import'
import { positionColumns, type ImportProposal } from './package-import'
import { DEFAULT_COLUMNS, type ColumnSetting } from './exam'
import { pendingImageOf, type ProseMirrorJSON } from './question-doc'
import { subpartLabelAt } from './export-plan'

/**
 * Pending Images in a proposal, read and resolved without touching storage.
 *
 * A Pending Image is found by where it sits: its bank, its Question, the part
 * of the Question (the stem, a choice, a matching item or Word Bank answer,
 * the Suggested Answer) and its place among that part's Pending Images. That
 * location is its key, so the teacher's choices in Resolve Images are plain
 * data — key to Media Asset — handed to the import plan with the rest of the
 * selection, and written in the same commit.
 */

export type MediaAssetDeclaration = ParsedQuestionBankRecord['media'][number]

export type PendingImageOccurrence = {
  key: string
  bankId: string
  /** 1-based position of the Question in its bank. */
  questionNumber: number
  /** Where in the Question it sits, as a teacher reads it: “Question”,
   *  “Answer B”, “Item 2”, “Word Bank C”, “Suggested Answer”. */
  where: string
  pending: PendingImageReference
  alt?: string
  caption?: string
  /** How to name it where the Question number says nothing, such as inside
   *  the Question's own editor. */
  label?: string
  /** Whether it sits in a Side-by-Side's Panel, which it is sized to fill. */
  inPanel?: true
  /** For a picture in a Multiple Choice answer, how many columns its answers
   *  print in — how wide the cell it is sized to is. */
  answerColumns?: ColumnSetting
}

/** The picture that fills a Pending Image, and the Authored Image Size it
 *  arrives at when its size on the Source Document’s page is known: a share
 *  of its container, as Record 0.7.0’s `authoredSize` is. */
export type ResolvedImage = { asset: MediaAssetDeclaration; authoredSize?: number }

/** Key → the picture that fills it. Absent keys stay Pending Images. */
export type PendingImageResolution = ReadonlyMap<string, ResolvedImage>

type Part = { id: string; where: string; document: SemanticDocument; answerColumns?: ColumnSetting }

// `columns` is what the Question's answers print in. A Part's are the columns
// a Part is imported with.
function partsOf(question: QuestionBankRecordQuestion, columns: ColumnSetting): Part[] {
  return [
    { id: 'stem', where: 'Question', document: question.stem },
    ...(question.choices ?? []).map((choice, index) => ({
      id: choice.id,
      where: `Answer ${bankLetter(index)}`,
      document: choice.content,
      answerColumns: columns,
    })),
    ...(question.prompts ?? []).map((prompt, index) => ({
      id: prompt.id,
      where: `Item ${index + 1}`,
      document: prompt.content,
    })),
    ...(question.wordBank ?? []).map((answer, index) => ({
      id: answer.id,
      where: `Word Bank ${bankLetter(index)}`,
      document: answer.content,
    })),
    ...(question.suggestedAnswer
      ? [{ id: 'suggested-answer', where: 'Suggested Answer', document: question.suggestedAnswer }]
      : []),
    ...(question.parts ?? []).flatMap((part, index) => recordPartsOf(part, `Part ${partLetter(index)}`)),
  ]
}

// A Part's own stem, then its answers — or the Subparts it holds, each named
// under its Part: “Part b (ii), Answer C”.
function recordPartsOf(part: QuestionBankRecordPart, where: string): Part[] {
  if (holdsSubparts(part)) {
    return [
      { id: part.id, where, document: part.stem },
      ...part.subparts.flatMap((subpart, index) =>
        recordPartsOf(subpart, `${where} (${subpartLabelAt(index)})`)),
    ]
  }
  return [
    { id: part.id, where, document: part.stem },
    ...(part.choices ?? []).map((choice, choiceIndex) => ({
      id: choice.id,
      where: `${where}, Answer ${bankLetter(choiceIndex)}`,
      document: choice.content,
      answerColumns: DEFAULT_COLUMNS,
    })),
    ...(part.suggestedAnswer
      ? [{ id: `${part.id}-suggested-answer`, where: `${where}, Suggested Answer`, document: part.suggestedAnswer }]
      : []),
  ]
}

function pendingNodes(document: SemanticDocument): { node: SemanticNode; inPanel: boolean }[] {
  const found: { node: SemanticNode; inPanel: boolean }[] = []
  const visit = (node: SemanticNode, inPanel: boolean) => {
    if ((node.type === 'inline-image' || node.type === 'block-image') && node.pending) {
      found.push({ node, inPanel })
    }
    for (const child of node.content ?? []) visit(child, inPanel || node.type === 'panel')
  }
  for (const node of document.content) visit(node, false)
  return found
}

const keyOf = (bankId: string, questionId: string, partId: string, index: number) =>
  `${bankId}/${questionId}/${partId}/${index}`

/** Every Pending Image in a bank's record, in the order its Questions and
 *  their parts are read — the order an assistant wrote them, so a caption
 *  gets the picture that follows it. */
export function pendingImagesOfRecord(
  bankId: string,
  record: Pick<ParsedQuestionBankRecord, 'bank'>,
  columnsOf: (questionId: string) => ColumnSetting | undefined = () => undefined,
): PendingImageOccurrence[] {
  return record.bank.questions.flatMap((question, questionIndex) =>
    // A Question no Exam lays out is sized for the columns a Question
    // starts with: answers made of pictures are nearly always a grid.
    partsOf(question, columnsOf(question.id) ?? DEFAULT_COLUMNS).flatMap((part) =>
      pendingNodes(part.document).map(({ node, inPanel }, index) => ({
        key: keyOf(bankId, question.id, part.id, index),
        bankId,
        questionNumber: questionIndex + 1,
        where: part.where,
        pending: { ...node.pending! },
        ...(node.alt !== undefined ? { alt: node.alt } : {}),
        ...(node.caption !== undefined ? { caption: node.caption } : {}),
        ...(inPanel ? { inPanel: true as const } : {}),
        ...(part.answerColumns ? { answerColumns: part.answerColumns } : {}),
      })),
    ),
  )
}

/** Every Pending Image in the banks a selection brings in. */
export function pendingImagesOf(
  proposal: Pick<ImportProposal, 'banks'> & Partial<Pick<ImportProposal, 'exams'>>,
  allowed: (bankId: string) => boolean = () => true,
): PendingImageOccurrence[] {
  // The columns each Question's answers print in, as the first Exam that lays
  // it out gives them.
  const typeOf = new Map(proposal.banks.flatMap((bank) =>
    bank.record.bank.questions.map((question) => [`${bank.id}/${question.id}`, question.type] as const)))
  const columns = new Map<string, ColumnSetting>()
  for (const exam of proposal.exams ?? []) {
    const laidOut = positionColumns(exam.positions, (position) =>
      typeOf.get(`${position.question.bank}/${position.question.question}`) === 'multiple-choice')
    for (const [key, count] of laidOut) if (!columns.has(key)) columns.set(key, count)
  }
  return proposal.banks
    .filter((bank) => allowed(bank.id))
    .flatMap((bank) => pendingImagesOfRecord(bank.id, bank.record, (id) => columns.get(`${bank.id}/${id}`)))
}

/** A bank's record with each Pending Image replaced by what `change` makes
 *  of it, given its key. */
function mapPendingImages(
  bankId: string,
  record: ParsedQuestionBankRecord,
  change: (key: string, node: SemanticNode) => SemanticNode,
): ParsedQuestionBankRecord {
  const resolveDocument = (questionId: string, partId: string, document: SemanticDocument): SemanticDocument => {
    let index = 0
    const visit = (node: SemanticNode): SemanticNode => {
      if ((node.type === 'inline-image' || node.type === 'block-image') && node.pending) {
        const key = keyOf(bankId, questionId, partId, index)
        index += 1
        return change(key, node)
      }
      return node.content ? { ...node, content: node.content.map(visit) } : node
    }
    return { ...document, content: document.content.map(visit) }
  }
  const questions = record.bank.questions.map((question) => ({
    ...question,
    stem: resolveDocument(question.id, 'stem', question.stem),
    ...(question.choices
      ? { choices: question.choices.map((choice) => ({ ...choice, content: resolveDocument(question.id, choice.id, choice.content) })) }
      : {}),
    ...(question.prompts
      ? { prompts: question.prompts.map((prompt) => ({ ...prompt, content: resolveDocument(question.id, prompt.id, prompt.content) })) }
      : {}),
    ...(question.wordBank
      ? { wordBank: question.wordBank.map((answer) => ({ ...answer, content: resolveDocument(question.id, answer.id, answer.content) })) }
      : {}),
    ...(question.suggestedAnswer
      ? { suggestedAnswer: resolveDocument(question.id, 'suggested-answer', question.suggestedAnswer) }
      : {}),
    ...(question.parts
      ? {
          parts: question.parts.map((part): QuestionBankRecordPart => {
            const resolveAnswering = (one: QuestionBankRecordAnsweringPart): QuestionBankRecordAnsweringPart => ({
              ...one,
              stem: resolveDocument(question.id, one.id, one.stem),
              ...(one.choices
                ? { choices: one.choices.map((choice) => ({ ...choice, content: resolveDocument(question.id, choice.id, choice.content) })) }
                : {}),
              ...(one.suggestedAnswer
                ? { suggestedAnswer: resolveDocument(question.id, `${one.id}-suggested-answer`, one.suggestedAnswer) }
                : {}),
            })
            return holdsSubparts(part)
              ? {
                  ...part,
                  stem: resolveDocument(question.id, part.id, part.stem),
                  subparts: part.subparts.map(resolveAnswering),
                }
              : resolveAnswering(part)
          }),
        }
      : {}),
  }))
  return { ...record, bank: { ...record.bank, questions } }
}

/** A bank's record with every resolved Pending Image made an ordinary image
 *  of its Media Asset, declared once however many places use it. Unresolved
 *  ones are left exactly as they were. */
export function withResolvedImages(
  bankId: string,
  record: ParsedQuestionBankRecord,
  resolution: PendingImageResolution,
): ParsedQuestionBankRecord {
  const declared = new Map(record.media.map((asset) => [asset.id, asset]))
  const resolved = mapPendingImages(bankId, record, (key, node) => {
    const picture = resolution.get(key)
    if (!picture) return node
    declared.set(picture.asset.id, picture.asset)
    const { pending: _pending, ...rest } = node
    void _pending
    if (picture.authoredSize === undefined) return { ...rest, asset: picture.asset.id }
    // A resolution's size is a share of the picture's container, as Record
    // 0.7.0's is, whatever version the record declared: it replaces any
    // legacy ratio the Pending Image was written with.
    const { legacyRatio: _legacyRatio, ...sized } = rest
    void _legacyRatio
    return { ...sized, asset: picture.asset.id, authoredSize: picture.authoredSize }
  })
  return { ...resolved, media: [...declared.values()] }
}

/**
 * A bank's record with each Pending Image's key written beside what it names,
 * for a preview that has to know which picture is which after the record has
 * become editor documents. Only a preview reads it: nothing that is stored or
 * exported ever carries it.
 */
export function withPendingKeys(bankId: string, record: ParsedQuestionBankRecord): ParsedQuestionBankRecord {
  return mapPendingImages(bankId, record, (key, node) => ({
    ...node,
    pending: { ...node.pending, key } as unknown as PendingImageReference,
  }))
}

/** The key `withPendingKeys` wrote into an editor image node, if any. */
export function pendingKeyOf(node: ProseMirrorJSON): string | undefined {
  const attrs = node.attrs as Record<string, unknown> | null | undefined
  const pending = attrs?.pending as { key?: unknown } | null | undefined
  return typeof pending?.key === 'string' ? pending.key : undefined
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The Media Asset declaration for a picture's bytes, addressed by content —
 *  so one tag used in several places is one asset. */
export async function mediaAssetOf(
  bytes: Uint8Array,
  mimeType: MediaAssetDeclaration['mimeType'],
): Promise<MediaAssetDeclaration> {
  // Loaded on demand: the record parsers are not wanted until a picture is.
  const { mediaDimensions } = await import('./question-bank-import')
  const dimensions = mediaDimensions(mimeType, bytes)
  if (!dimensions) throw new Error(`This picture is not a valid ${mimeType} image.`)
  const digest = hex(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
  return { id: `sha256:${digest}`, mimeType, ...dimensions, bytes: bytes.slice() }
}

/** What the text check needs of a Source Document. */
export type SourceDocumentFacts = { tags: readonly { tag: number }[]; pageText: readonly string[] }

export type SourceDocumentCheck = {
  /** Tags the record names that the document does not have. */
  unknownTags: number[]
  /** Stems long enough to look for, and how many were found. Both zero when
   *  the document has no text layer. */
  stemsChecked: number
  stemsFound: number
  /** Whether the record seems to come from this document. */
  matches: boolean
}

const normalized = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** A stem's longest unbroken run of text: math, images and breaks split it,
 *  since the document's text layer need not spell those the same way. */
function longestRun(document: SemanticDocument): string {
  const runs: string[] = ['']
  const visit = (node: SemanticNode) => {
    if (node.type === 'text') runs[runs.length - 1] += node.text ?? ''
    else if (node.content) {
      if (node.type !== 'paragraph') runs.push('')
      for (const child of node.content) visit(child)
      runs.push('')
    } else runs.push('')
  }
  for (const node of document.content) visit(node)
  return runs.map(normalized).sort((a, b) => b.length - a.length)[0] ?? ''
}

const MIN_WORDS = 3

/**
 * Whether a record seems to come from a Source Document: every tag it names
 * exists, and — when the document has a text layer — most of its stems appear
 * in the document's text. It is a check, not a proof: a teacher warned by it
 * may still import.
 */
export function checkAgainstSourceDocument(
  proposal: Pick<ImportProposal, 'banks'>,
  source: SourceDocumentFacts,
): SourceDocumentCheck {
  const tags = new Set(source.tags.map(({ tag }) => tag))
  const unknownTags = [
    ...new Set(
      pendingImagesOf(proposal).flatMap(({ pending }) =>
        'image' in pending && !tags.has(pending.image) ? [pending.image] : [],
      ),
    ),
  ].sort((a, b) => a - b)
  const text = normalized(source.pageText.join(' '))
  let stemsChecked = 0
  let stemsFound = 0
  if (text) {
    for (const bank of proposal.banks) {
      for (const question of bank.record.bank.questions) {
        const run = longestRun(question.stem)
        if (run.split(' ').length < MIN_WORDS) continue
        stemsChecked += 1
        if (text.includes(run)) stemsFound += 1
      }
    }
  }
  return {
    unknownTags,
    stemsChecked,
    stemsFound,
    matches: unknownTags.length === 0 && (stemsChecked === 0 || stemsFound * 2 > stemsChecked),
  }
}

type EditorQuestion = { id: string; doc: ProseMirrorJSON; suggestedAnswer?: ProseMirrorJSON }

const editorChildren = (node: ProseMirrorJSON): ProseMirrorJSON[] =>
  Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []

/** Every Pending Image of stored Questions, numbered as the bank lists them.
 *  Keyed by Question and place in its document, the way Resolve Images keys
 *  them in an import. */
export function pendingImagesOfQuestions(questions: readonly EditorQuestion[]): PendingImageOccurrence[] {
  return questions.flatMap((question, index) => {
    const found: PendingImageOccurrence[] = []
    const counts = { doc: 0, suggestedAnswer: 0 }
    // `grid` is the columns answers here print in — a Part's own, or the
    // columns a Question starts with, since which Exam lays it out is not
    // known here; `answerColumns` is set inside an answer.
    const visit = (
      part: 'doc' | 'suggestedAnswer',
      node: ProseMirrorJSON,
      where: string,
      inPanel = false,
      grid: ColumnSetting = DEFAULT_COLUMNS,
      answerColumns?: ColumnSetting,
    ) => {
      const pending = pendingImageOf(node)
      if (pending) {
        const attrs = node.attrs as Record<string, unknown>
        found.push({
          key: `${question.id}/${part}/${counts[part]++}`,
          bankId: '',
          questionNumber: index + 1,
          where,
          pending,
          ...(typeof attrs.alt === 'string' && attrs.alt ? { alt: attrs.alt } : {}),
          ...(typeof attrs.caption === 'string' && attrs.caption ? { caption: attrs.caption } : {}),
          ...(inPanel ? { inPanel: true as const } : {}),
          ...(answerColumns ? { answerColumns } : {}),
        })
      }
      const partColumns = (node.attrs as Record<string, unknown> | undefined)?.columns
      const answersGrid: ColumnSetting = (node.type === 'multipartPart' || node.type === 'multipartSubpart')
        && (partColumns === 1 || partColumns === 2 || partColumns === 4)
        ? partColumns
        : grid
      // A Multipart question's Parts are lettered, their Subparts numbered
      // under them, and the answers inside each lettered too: “Part b,
      // Answer C”, “Part b (ii), Answer A”.
      const answers = editorChildren(node).filter((child) => child.type === 'multipleChoiceChoice')
      const parts = editorChildren(node).filter((child) => child.type === 'multipartPart')
      const subparts = editorChildren(node).filter((child) => child.type === 'multipartSubpart')
      const within = (place: string) => (where === 'Question' ? place : `${where}, ${place}`)
      for (const child of editorChildren(node)) {
        const letter = answers.indexOf(child)
        const partIndex = parts.indexOf(child)
        const subpartIndex = subparts.indexOf(child)
        visit(
          part,
          child,
          letter >= 0
            ? within(`Answer ${bankLetter(letter)}`)
            : partIndex >= 0
              ? `Part ${partLetter(partIndex)}`
              : subpartIndex >= 0
                ? `${where} (${subpartLabelAt(subpartIndex)})`
                : child.type === 'suggestedAnswer' && where !== 'Question'
                  ? within('Suggested Answer')
                  : where,
          inPanel || child.type === 'sideBySidePanel',
          answersGrid,
          letter >= 0 ? answersGrid : answerColumns,
        )
      }
    }
    visit('doc', question.doc, 'Question')
    if (question.suggestedAnswer) visit('suggestedAnswer', question.suggestedAnswer, 'Suggested Answer')
    return found
  })
}

/** A stored picture's source, and the Authored Image Size it arrives at. */
export type StoredPicture = { src: string; size?: number }

/** A stored Question with each resolved Pending Image given its stored
 *  picture's source, found by the same keys `pendingImagesOfQuestions` gave. */
export function withStoredPictures<Q extends EditorQuestion>(question: Q, sources: ReadonlyMap<string, StoredPicture>): Q {
  const resolve = (part: 'doc' | 'suggestedAnswer', document: ProseMirrorJSON): ProseMirrorJSON => {
    let index = 0
    const visit = (node: ProseMirrorJSON): ProseMirrorJSON => {
      if (pendingImageOf(node)) {
        const picture = sources.get(`${question.id}/${part}/${index}`)
        index += 1
        if (!picture) return node
        const { pending: _pending, ...attrs } = node.attrs as Record<string, unknown>
        void _pending
        return { ...node, attrs: { ...attrs, src: picture.src, ...(picture.size !== undefined ? { size: picture.size } : {}) } }
      }
      return Array.isArray(node.content) ? { ...node, content: editorChildren(node).map(visit) } : node
    }
    return visit(document)
  }
  return {
    ...question,
    doc: resolve('doc', question.doc),
    ...(question.suggestedAnswer ? { suggestedAnswer: resolve('suggestedAnswer', question.suggestedAnswer) } : {}),
  }
}
