import { looksLikeHtml } from '../rich-text'
import { decodeText } from '../text'
import type { Blocks, FormatInput, FormatSpec, ParseResult, ZipFiles } from '../types'
import { attributeOf, childOf, childrenOf, descendantsOf, documentElement, parseXml, textOf, type XmlElement } from '../xml'
import { resolveEntryPath, safeEntryPath, zipFile } from '../zip'
import { assessmentTitle, Gatherer, manifestResources, readQti12Item, type Reading } from './qti'

/**
 * A Blackboard pool or test export: the .zip Blackboard's “Export” saves,
 * and the one the Blackboard Test Generator's “Download Pool” builds.
 *
 * Its `imsmanifest.xml` names a `.dat` file for each pool or test, by the
 * resource's `bb:file` (never assumed to be `res00001.dat`). A `.dat` is one
 * of two things:
 *
 * - Blackboard's own QTI 1.2 (`assessment/x-bb-qti-pool`, `…-qti-test`):
 *   `<questestinterop>`, each item's type in `bbmd_questiontype`. A test's
 *   Random Block draws from a pool in the same export; that pool's
 *   questions come in once, whether the test or the pool names them first.
 * - Blackboard 5's older pool (`assessment/x-bb-pool`), which the Test
 *   Generator still writes: `<POOL>` with a `<TITLE>`, and a
 *   `QUESTION_MULTIPLECHOICE`, `QUESTION_TRUEFALSE`, `QUESTION_MATCH`, … for
 *   each question, its correct answers named in `GRADABLE/CORRECTANSWER`.
 *
 * A bare `.dat` or `.xml` in either form, not zipped, is read too. Pictures
 * are read from the archive: Blackboard writes
 * `@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-123_1` for a file saved
 * under `csfiles/home_dir/` as `…__xid-123_1.png`. The pool or test's title
 * names the bank. A QTI item's points (`qmd_absolutescore_max`) are kept as
 * its Points when a whole number; Blackboard 5's pools carry none. Feedback
 * is not kept.
 */

const BLACKBOARD_RESOURCE = /^assessment\/x-bb-(qti-pool|qti-test|pool)$/i

// ——— Blackboard 5 pools ———

const LEGACY_TYPES: Record<string, string> = {
  QUESTION_MULTIPLECHOICE: 'Multiple Choice',
  QUESTION_MULTIPLEANSWER: 'Multiple Answer',
  QUESTION_TRUEFALSE: 'True/False',
  QUESTION_ESSAY: 'Essay',
  QUESTION_SHORTRESPONSE: 'Short Response',
  QUESTION_FILLINBLANK: 'Fill in the Blank',
  QUESTION_MATCH: 'Matching',
  QUESTION_ORDER: 'Ordering',
  QUESTION_NUMERIC: 'Numeric',
}

const textIn = (element: XmlElement | undefined) => textOf(childOf(element, 'TEXT'))

/** One Blackboard 5 question, such as `<QUESTION_MULTIPLECHOICE>`. */
function readLegacyQuestion(question: XmlElement, html: (source: string) => Blocks): Reading {
  const sourceType = LEGACY_TYPES[question.local]
  if (!sourceType) {
    return {
      code: 'unsupported-type',
      error: `Test Parrot has no “${question.local.replace(/^QUESTION_/, '').toLowerCase()}” questions, so it was left out.`,
    }
  }
  const rich = (text: string) => html(looksLikeHtml(text) ? text : escapeLines(text))
  const stem = rich(textIn(childOf(question, 'BODY')))
  const answers = childrenOf(question, 'ANSWER')
    .map((answer, index) => ({ answer, position: Number(attributeOf(answer, 'position') ?? index + 1) || index + 1 }))
    .sort((a, b) => a.position - b.position)
    .map(({ answer }) => answer)
  const gradable = childOf(question, 'GRADABLE')
  const corrects = childrenOf(gradable, 'CORRECTANSWER')
  const correctIds = new Set(corrects.map((correct) => attributeOf(correct, 'answer_id') ?? ''))
  const base = { sourceType, stem }

  switch (question.local) {
    case 'QUESTION_MULTIPLECHOICE':
    case 'QUESTION_MULTIPLEANSWER': {
      const choices = answers.map((answer) => ({
        content: rich(textIn(answer)),
        correct: correctIds.has(attributeOf(answer, 'id') ?? ''),
      }))
      return {
        question: { ...base, kind: question.local === 'QUESTION_MULTIPLEANSWER' ? 'multiple-answer' : 'multiple-choice', choices },
      }
    }
    case 'QUESTION_TRUEFALSE': {
      const right = answers.find((answer) => correctIds.has(attributeOf(answer, 'id') ?? ''))
      const word = right ? textIn(right).trim().toLowerCase() : ''
      const answer = !right ? null : word.startsWith('t') ? true : word.startsWith('f') ? false : answers.indexOf(right) === 0
      return { question: { ...base, kind: 'true-false', answer } }
    }
    case 'QUESTION_ESSAY':
    case 'QUESTION_SHORTRESPONSE': {
      const model = answers.map(textIn).find((text) => text.trim())
      return { question: { ...base, kind: 'short-answer', ...(model ? { suggestedAnswer: rich(model) } : {}) } }
    }
    case 'QUESTION_FILLINBLANK':
      return { question: { ...base, kind: 'fill-in-blank', accepted: answers.map((answer) => textIn(answer).trim()) } }
    case 'QUESTION_NUMERIC': {
      const values = [...corrects.map((correct) => textOf(correct)), ...answers.map(textIn)].map((value) => value.trim()).filter(Boolean)
      return { question: { ...base, kind: 'numeric', answers: [...new Set(values)].map((value) => ({ value })) } }
    }
    case 'QUESTION_ORDER': {
      const byId = new Map(answers.map((answer) => [attributeOf(answer, 'id') ?? '', answer]))
      const ordered = corrects.map((correct) => byId.get(attributeOf(correct, 'answer_id') ?? '')).filter((answer): answer is XmlElement => Boolean(answer))
      const rest = answers.filter((answer) => !ordered.includes(answer))
      return { question: { ...base, kind: 'ordering', items: [...ordered, ...rest].map((answer) => rich(textIn(answer))) } }
    }
    default: {
      // Matching: items are ANSWERs, their matches CHOICEs, paired in
      // GRADABLE. A generator that wrote only ANSWERs wrote “left / right”.
      const choices = childrenOf(question, 'CHOICE')
      if (!choices.length) {
        return {
          question: {
            ...base,
            kind: 'matching',
            pairs: answers.map((answer) => {
              const [left = '', ...right] = textIn(answer).split('/')
              return { left: left.trim() ? rich(left.trim()) : null, right: right.join('/').trim() ? rich(right.join('/').trim()) : null }
            }),
          },
        }
      }
      const choiceById = new Map(choices.map((choice) => [attributeOf(choice, 'id') ?? '', choice]))
      const used = new Set<XmlElement>()
      const pairs: { left: Blocks | null; right: Blocks | null }[] = answers.map((answer) => {
        const link = corrects.find((correct) => attributeOf(correct, 'answer_id') === attributeOf(answer, 'id'))
        const choice = link ? choiceById.get(attributeOf(link, 'choice_id') ?? '') : undefined
        if (choice) used.add(choice)
        return { left: rich(textIn(answer)), right: choice ? rich(textIn(choice)) : null }
      })
      for (const choice of choices) if (!used.has(choice)) pairs.push({ left: null, right: rich(textIn(choice)) })
      return { question: { ...base, kind: 'matching', pairs } }
    }
  }
}

const escapeLines = (text: string) =>
  text.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>')

/** A Test Generator pool's description is its own boilerplate. */
const GENERATOR_DESCRIPTION = /^Created by the .*Quiz Generator$/i

function readPool(root: XmlElement, gatherer: Gatherer): { title: string; description: string } {
  for (const question of childrenOf(root).filter((child) => child.local.startsWith('QUESTION_'))) {
    gatherer.begin()
    gatherer.add(readLegacyQuestion(question, gatherer.html), textIn(childOf(question, 'BODY')))
  }
  const description = textIn(childOf(root, 'DESCRIPTION')).trim()
  return {
    title: attributeOf(childOf(root, 'TITLE'), 'value') ?? '',
    description: GENERATOR_DESCRIPTION.test(description) ? '' : description,
  }
}

// ——— Reading a package ———

type Source = { identifier: string; path: string | null; root: XmlElement | null; present: boolean }

/** The `csfiles/home_dir` files by their `xid-…` id. */
function xidIndex(files: ZipFiles): Map<string, string> {
  const index = new Map<string, string>()
  for (const path of files.keys()) {
    const match = /__(xid-\d+_\d+)(?:\.[^/]*)?$/i.exec(path)
    if (match && /^csfiles\//i.test(path)) index.set(match[1]!.toLowerCase(), path)
  }
  return index
}

function pictureResolver(gatherer: Gatherer, files: ZipFiles, from: string, xids: Map<string, string>) {
  return (source: string): string | null => {
    const xid = /xid-\d+_\d+/i.exec(source)?.[0]
    if (xid) return gatherer.picture(files, xids.get(xid.toLowerCase()) ?? null)
    if (/^(https?:|\/\/)/i.test(source)) return null
    // Blackboard's older `@X@EmbeddedFile.location@X@name.png`: a file
    // beside the .dat, or in the folder named after it.
    const path = source.replace(/^@X@[^@]*@X@/, '').replace(/[?#].*$/, '')
    const folder = from.replace(/\.[^./]+$/, '')
    return gatherer.picture(files, resolveEntryPath(from, path)) ??
      gatherer.picture(files, safeEntryPath(`${folder}/${decode(path)}`))
  }
}

const decode = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function readRoot(text: string): XmlElement | null {
  try {
    return documentElement(parseXml(text)) ?? null
  } catch {
    return null
  }
}

/** Blackboard QTI: every assessment's items, and the pools its Random
 *  Blocks draw from. */
function readQuestestinterop(root: XmlElement, gatherer: Gatherer, topics: boolean, drawFrom: (ref: string) => void): string[] {
  const titles: string[] = []
  for (const assessment of descendantsOf(root, 'assessment')) {
    const title = assessmentTitle(assessment)
    if (title) titles.push(title)
    for (const section of descendantsOf(assessment, 'section')) {
      for (const item of childrenOf(section, 'item')) {
        gatherer.begin()
        gatherer.add(readQti12Item(item, gatherer.html), attributeOf(item, 'title') ?? '', topics && title ? [title] : undefined)
      }
      for (const ref of descendantsOf(section, 'sourcebank_ref')) drawFrom(textOf(ref).trim())
    }
  }
  return titles
}

export async function parseBbPackage(input: FormatInput): Promise<ParseResult> {
  const gatherer = new Gatherer()
  const files = await input.zip()
  if (!files) {
    const root = readRoot(input.text())
    if (!root) {
      gatherer.issues.push({ severity: 'error', code: 'unreadable-file', message: 'This file is not well-formed XML, so no questions could be read from it.' })
      return gatherer.result()
    }
    if (root.local === 'POOL') {
      const { title, description } = readPool(root, gatherer)
      return { ...gatherer.result(title), ...(description ? { description } : {}) }
    }
    const titles = readQuestestinterop(root, gatherer, false, () => {})
    return gatherer.result(titles.length === 1 ? titles[0] : undefined)
  }

  const resources = (manifestResources(files) ?? []).filter((resource) => BLACKBOARD_RESOURCE.test(resource.type))
  const sources: Source[] = resources.map((resource) => {
    const bytes = resource.file ? zipFile(files, resource.file) : undefined
    return {
      identifier: resource.identifier,
      path: resource.file,
      root: bytes ? readRoot(decodeText(bytes).text) : null,
      present: Boolean(bytes),
    }
  })
  const assessments = sources.reduce((count, source) =>
    count + (source.root?.local === 'POOL' ? 1 : descendantsOf(source.root ?? undefined, 'assessment').length), 0)
  const topics = assessments > 1
  const xids = xidIndex(files)
  const read = new Set<string>()
  const titles: string[] = []
  let description = ''

  const readSource = (source: Source) => {
    if (read.has(source.identifier)) return
    read.add(source.identifier)
    if (!source.root) {
      gatherer.issues.push({
        severity: 'error',
        code: 'unreadable-file',
        message: source.present
          ? `“${source.path}” in this archive is not well-formed XML, so its questions were left out.`
          : `The archive's manifest names “${source.path ?? source.identifier}”, which is not in it, so its questions were left out.`,
      })
      return
    }
    gatherer.resolve = pictureResolver(gatherer, files, source.path ?? '', xids)
    if (source.root.local === 'POOL') {
      const before = gatherer.questions.length
      const pool = readPool(source.root, gatherer)
      if (topics && pool.title) for (const question of gatherer.questions.slice(before)) question.topics = [pool.title]
      if (pool.title) titles.push(pool.title)
      description ||= pool.description
      return
    }
    titles.push(...readQuestestinterop(source.root, gatherer, topics, (ref) => {
      const pool = sources.find((candidate) => candidate.identifier === ref)
      if (pool) {
        readSource(pool)
        gatherer.resolve = pictureResolver(gatherer, files, source.path ?? '', xids)
      } else {
        gatherer.issues.push({
          severity: 'warning',
          code: 'question-bank-missing',
          message: 'A Random Block draws questions from a pool that is not in this export. Export the pool too to bring those questions in.',
        })
      }
    }))
  }
  sources.forEach(readSource)

  const distinct = [...new Set(titles)]
  return { ...gatherer.result(distinct.length === 1 ? distinct[0] : undefined), ...(description ? { description } : {}) }
}

const LEGACY_ROOT = /^\s*(?:<\?[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>\s*)*<POOL[\s>]/
const BLACKBOARD_MARK = /<bbmd_[a-z_]+[\s>]/

async function detect(input: FormatInput): Promise<number> {
  const files = await input.zip()
  if (!files) {
    const head = input.text().slice(0, 8192)
    if (LEGACY_ROOT.test(head) && /<QUESTIONLIST[\s>]|<QUESTION_[A-Z]+[\s>]/.test(head)) return 0.95
    if (/<(?:[\w-]+:)?questestinterop[\s>]/.test(head) && BLACKBOARD_MARK.test(head)) return 0.95
    return 0
  }
  const resources = manifestResources(files)
  if (resources?.some((resource) => BLACKBOARD_RESOURCE.test(resource.type))) return 0.98
  return 0
}

export const bbPackage: FormatSpec = {
  id: 'bb-package',
  detect,
  parse: parseBbPackage,
}
