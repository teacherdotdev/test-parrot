// Copy: Questions on the clipboard, or dragged, ready to land in another
// document.
//
// What travels is what a student reads — the stem, lettered answers, the T
// and F to circle, a Word Bank and blank-led Items, lettered Parts — unnumbered, so the document it
// lands in numbers it. Correctness, a Suggested Answer, Question Metadata and
// Work Space never travel (see CONTEXT.md, "Copy", and ADR-0030).
//
// Three steps, the first two pure. `copyBlocksOf` lays a Question out as
// blocks under a `CopyFormat` — the answer columns and answer lines chosen for
// this copy only; `copyHtmlOf` and `copyTextOf` write those blocks as rich and
// plain text, given the pictures and formulas `copyMediaOf` names. Only the
// last part touches a browser: it fetches pictures, renders mathematics, and
// keeps what it made, so a drag — which must hand over its content the moment
// it starts — can be written from what is already here.

import { isCentred } from './centring'
import { BLANK_LINE } from './blank'
import { bankLetter } from './matching'
import { encoded } from './export-media'
import { keptPixels, legacyRatioOf, pictureCropOf, pictureKey, pictureSizeOf, printedPictureWidth, type CropBox } from './picture-geometry'
import { layOutColumns, MATCHING_BESIDE_LIMIT, subpartLabelAt, TRUE_FALSE_MARKS } from './export-plan'
import { pendingImageOf, stemNodesOf, type ProseMirrorJSON } from './question-doc'
import { choicesOf, partsOf, promptsOf, type ColumnSetting, type Part, type Question } from './exam'
import { mathJaxTools } from './mathjax'

/** One paragraph's worth of a copied Question: blocks of Question Content,
 *  led by a label such as "A. " or "_____ ", and indented under a Part when it
 *  belongs to one. */
export type CopyLine = {
  kind: 'line'
  lead?: string
  indent?: number
  content: readonly ProseMirrorJSON[]
}

/** Answers in columns, column-major as the test prints them: reading down a
 *  column gives consecutive letters. `null` where the last column runs out. */
export type CopyGrid = { kind: 'grid'; indent?: number; cells: (CopyLine | null)[][] }

/** A short Word Bank printed beside the Items it is matched against. */
export type CopyBeside = { kind: 'beside'; left: CopyLine[]; right: CopyLine[] }

/** Ruled lines left for a written answer. */
export type CopyRules = { kind: 'rules'; count: number; indent?: number }

export type CopyBlock = CopyLine | CopyGrid | CopyBeside | CopyRules

/** How one Part of a Multipart question is laid out for this copy. */
export type CopyPartFormat = { columns?: ColumnSetting; lines?: number }

/**
 * How a Question is laid out for this copy only: its answer columns, where a
 * Word Bank goes, how many lines a written answer is left. Anything unset
 * follows the Question itself, or the test's own rule. Never saved.
 */
export type CopyFormat = {
  columns?: ColumnSetting
  wordBank?: 'beside' | 'above'
  lines?: number
  parts?: Readonly<Record<string, CopyPartFormat>>
}

/** How mathematics travels: as a picture of itself, which every editor
 *  shows, or as MathML, which Microsoft Word turns into its own equation. */
export type CopyMathMode = 'picture' | 'word'

/** A picture, as bytes the destination can keep, at the size it pastes at. */
export type CopyPicture = { src: string; width: number; height: number }

/** Every picture and formula a copy needs, already resolved: pictures by
 *  `src` or `mathKey`, and MathML by `mathKey`. */
export type CopyMedia = {
  pictures: ReadonlyMap<string, CopyPicture>
  mathml: ReadonlyMap<string, string>
}

export const NO_MEDIA: CopyMedia = { pictures: new Map(), mathml: new Map() }

/** The blank a Matching Item is answered in. */
export const ANSWER_BLANK = '_____ '

/** What leads a True/False question: the T and F a student circles, as the
 *  test prints them before its number. */
export const TRUE_FALSE_LEAD = `${TRUE_FALSE_MARKS.join('  ')}  `

/** One ruled line for a written answer. */
export const ANSWER_RULE = '_'.repeat(64)

/** The column a picture is sized against: a US Letter page with one-inch
 *  margins, at CSS pixels. Google Docs' default page is exactly this. */
export const COPY_COLUMN_WIDTH = 624

const childrenOf = (node: ProseMirrorJSON): ProseMirrorJSON[] =>
  Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []

const attrsOf = (node: ProseMirrorJSON): Record<string, unknown> =>
  typeof node.attrs === 'object' && node.attrs !== null
    ? (node.attrs as Record<string, unknown>)
    : {}

const stringOf = (value: unknown): string => (typeof value === 'string' ? value : '')

const line = (content: readonly ProseMirrorJSON[], lead?: string, indent?: number): CopyLine => ({
  kind: 'line',
  content,
  ...(lead ? { lead } : {}),
  ...(indent ? { indent } : {}),
})

/** Lettered answers, in columns when there is more than one. */
function answersOf(answers: readonly ProseMirrorJSON[][], columns: ColumnSetting, indent = 0): CopyBlock[] {
  const lettered = answers.map((content, index) => line(content, `${bankLetter(index)}. `))
  if (lettered.length === 0) return []
  if (columns === 1 || lettered.length === 1) return lettered.map((answer) => ({ ...answer, ...(indent ? { indent } : {}) }))
  return [{ kind: 'grid', ...(indent ? { indent } : {}), cells: layOutColumns(lettered, columns).cells }]
}

function rulesOf(count: number | undefined, indent = 0): CopyBlock[] {
  return count && count > 0 ? [{ kind: 'rules', count, ...(indent ? { indent } : {}) }] : []
}

/** The layout a Question's Word Bank takes when nothing is chosen: beside a
 *  short one, above a long one, as the test prints it. */
export function defaultWordBank(question: Question): 'beside' | 'above' {
  return choicesOf(question).length > MATCHING_BESIDE_LIMIT ? 'above' : 'beside'
}

/** A Question, as the blocks a student would read, laid out as `format` says. */
export function copyBlocksOf(question: Question, format: CopyFormat = {}): CopyBlock[] {
  const stem = stemNodesOf(question.doc)
  const content = (node: ProseMirrorJSON) => childrenOf(node)
  switch (question.type) {
    case 'true-false':
      // The pair is never printed as answers; a student circles T or F.
      return [line(stem, TRUE_FALSE_LEAD)]
    case 'multiple-choice':
      return [
        ...(stem.length > 0 ? [line(stem)] : []),
        ...answersOf(choicesOf(question).map(({ node }) => content(node)), format.columns ?? question.columns),
      ]
    case 'matching': {
      const bank = choicesOf(question).map(({ node }, index) => line(content(node), `${bankLetter(index)}. `))
      const items = promptsOf(question).map(({ node }) => line(content(node), ANSWER_BLANK))
      const directions = stem.length > 0 ? [line(stem)] : []
      if ((format.wordBank ?? defaultWordBank(question)) === 'beside' && bank.length > 0 && items.length > 0) {
        return [...directions, { kind: 'beside', left: items, right: bank }]
      }
      return [...directions, ...bank, ...items]
    }
    case 'multipart':
      return [
        ...(stem.length > 0 ? [line(stem)] : []),
        ...partsOf(question).flatMap((part, index) => {
          // Answers and lines one level in under what they answer: a Part's
          // under the Part, a Subpart's under the Subpart, itself one level in
          // under its Part's lead-in. Each is formatted under its own id.
          const answering = (
            one: Pick<Part, 'id' | 'type' | 'choices' | 'columns'>,
            level: number,
          ): CopyBlock[] => {
            const own = format.parts?.[one.id] ?? {}
            if (one.type === 'subparts') return []
            return one.type === 'multiple-choice'
              ? answersOf(one.choices.map(({ node }) => content(node)), own.columns ?? one.columns, level)
              : rulesOf(own.lines, level)
          }
          return [
            line(part.stem, `${bankLetter(index).toLowerCase()}. `),
            ...answering(part, 1),
            ...part.subparts.flatMap((subpart, subpartIndex) => [
              line(subpart.stem, `${subpartLabelAt(subpartIndex)}. `, 1),
              ...answering(subpart, 2),
            ]),
          ]
        }),
      ]
    case 'fill-in-the-blank':
      // The sentence is the whole question; its Blanks print as lines.
      return stem.length > 0 ? [line(stem)] : []
    case 'open':
      return [...(stem.length > 0 ? [line(stem)] : []), ...rulesOf(format.lines)]
  }
}

/** Every line of these blocks, wherever it sits. */
function linesOf(blocks: readonly CopyBlock[]): CopyLine[] {
  return blocks.flatMap((block) => {
    switch (block.kind) {
      case 'line': return [block]
      case 'grid': return block.cells.flat().filter((cell): cell is CopyLine => cell !== null)
      case 'beside': return [...block.left, ...block.right]
      case 'rules': return []
    }
  })
}

function isDisplayMath(node: ProseMirrorJSON): boolean {
  return node.type === 'code_block' && stringOf(attrsOf(node).language).toLowerCase() === 'latex'
}

function sourceOf(node: ProseMirrorJSON): string {
  return childrenOf(node).map((child) => stringOf(child.text)).join('')
}

/** The key a formula is stored under in `CopyMedia`. */
export function mathKey(source: string, display: boolean): string {
  return `${display ? 'display' : 'inline'}:${source}`
}

/** A picture or a formula a copy has to resolve before it can be written. */
export type CopyMediaRequest =
  | { kind: 'image'; key: string; src: string; crop?: CropBox; sizing: PictureSizing; block: boolean }
  | { kind: 'math'; source: string; display: boolean }

/** What a pasted picture's width follows: its Authored Image Size, or the
 *  legacy ratio of one no one has resized since. An inline picture has none. */
type PictureSizing = { size?: number; ratio?: number }

function sizingOf(node: ProseMirrorJSON): PictureSizing {
  if (node.type !== 'image-block') return {}
  const attrs = attrsOf(node)
  const size = pictureSizeOf(attrs)
  return size !== null ? { size } : { ratio: legacyRatioOf(attrs) }
}

/** The key a picture is stored under in `CopyMedia`: each crop and size of a
 *  Media Asset pastes as its own picture. */
export function copyPictureKey(node: ProseMirrorJSON): string {
  const sizing = sizingOf(node)
  const key = node.type === 'image-block' ? pictureKey(attrsOf(node)) : stringOf(attrsOf(node).src)
  return sizing.size !== undefined ? `${key}@${sizing.size}` : sizing.ratio !== undefined ? `${key}@r${sizing.ratio}` : key
}

/** Every picture and formula in these blocks, once each. */
export function copyMediaOf(blocks: readonly CopyBlock[]): CopyMediaRequest[] {
  const found = new Map<string, CopyMediaRequest>()
  const visit = (node: ProseMirrorJSON) => {
    // A Blank's answer never reaches the clipboard, so nothing in it is drawn.
    if (node.type === 'blank') return
    if (node.type === 'math_inline') {
      const source = stringOf(attrsOf(node).value)
      found.set(mathKey(source, false), { kind: 'math', source, display: false })
      return
    }
    if (isDisplayMath(node)) {
      const source = sourceOf(node)
      found.set(mathKey(source, true), { kind: 'math', source, display: true })
      return
    }
    if ((node.type === 'image' || node.type === 'image-block') && !pendingImageOf(node)) {
      const src = stringOf(attrsOf(node).src)
      const crop = node.type === 'image-block' ? pictureCropOf(attrsOf(node)) : null
      const key = copyPictureKey(node)
      if (src) found.set(key, {
        kind: 'image',
        key,
        src,
        ...(crop ? { crop } : {}),
        sizing: sizingOf(node),
        block: node.type === 'image-block',
      })
      return
    }
    childrenOf(node).forEach(visit)
  }
  linesOf(blocks).forEach((copied) => copied.content.forEach(visit))
  return [...found.values()]
}

/** The width a picture pastes at: its Authored Image Size against the page,
 *  given the natural width of what it shows. */
export function copyImageWidth(naturalWidth: number, sizing: PictureSizing): number {
  return Math.round(printedPictureWidth(naturalWidth, COPY_COLUMN_WIDTH, sizing))
}

// ---- Rich text ------------------------------------------------------------

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Writer = { media: CopyMedia; math: CopyMathMode }

function pictureHtml(picture: CopyPicture | undefined, alt: string): string {
  if (!picture) return escapeHtml(alt ? `[${alt}]` : '[Picture]')
  return `<img src="${escapeHtml(picture.src)}" width="${picture.width}" height="${picture.height}" alt="${escapeHtml(alt)}">`
}

/** A formula as the chosen mode has it, or its own source when that has not
 *  been made. The picture's alt text is always the LaTeX it was drawn from. */
function mathHtml(source: string, display: boolean, writer: Writer): string {
  const key = mathKey(source, display)
  if (writer.math === 'word') {
    const mathml = writer.media.mathml.get(key)
    if (mathml) return mathml
  }
  const picture = writer.media.pictures.get(key)
  return picture ? pictureHtml(picture, source) : escapeHtml(source)
}

function marksHtml(node: ProseMirrorJSON, inner: string): string {
  const marks = Array.isArray(node.marks) ? (node.marks as ProseMirrorJSON[]) : []
  return marks.reduce((html, mark) => {
    switch (mark.type) {
      case 'strong': return `<b>${html}</b>`
      case 'emphasis': return `<i>${html}</i>`
      case 'inlineCode': return `<code>${html}</code>`
      case 'strike_through': return `<s>${html}</s>`
      case 'subscript': return `<sub>${html}</sub>`
      case 'superscript': return `<sup>${html}</sup>`
      case 'link': return `<a href="${escapeHtml(stringOf(attrsOf(mark).href))}">${html}</a>`
      default: return html
    }
  }, inner)
}

function inlineHtml(node: ProseMirrorJSON, writer: Writer): string {
  switch (node.type) {
    case 'text':
      return marksHtml(node, escapeHtml(stringOf(node.text)))
    case 'hardbreak':
      return '<br>'
    case 'math_inline':
      return mathHtml(stringOf(attrsOf(node).value), false, writer)
    case 'blank':
      return BLANK_LINE
    case 'image':
      return pendingImageOf(node)
        ? '[Picture needed]'
        : pictureHtml(writer.media.pictures.get(copyPictureKey(node)), stringOf(attrsOf(node).alt))
    default:
      return childrenOf(node).map((child) => inlineHtml(child, writer)).join('')
  }
}

const paragraphStyle = (indent: number): string =>
  // Word processors read a paragraph's own margins; a stylesheet never
  // reaches the clipboard.
  `margin:0 0 0 ${indent * 0.5}in`

// Tables that only arrange things carry no lines, in every editor.
const LAYOUT_TABLE = 'border="0" cellpadding="0" cellspacing="0" style="width:100%;border:none;border-collapse:collapse;table-layout:fixed"'
const LAYOUT_CELL = 'style="border:none;padding:0 6pt 0 0;vertical-align:top"'

function nodeHtml(node: ProseMirrorJSON, writer: Writer, lead: string, indent: number): string {
  // A Centred block pastes centred: Word and Google Docs read text-align.
  const centred = isCentred(node)
  const style = `${paragraphStyle(indent)}${centred ? ';text-align:center' : ''}`
  const open = `<p style="${style}">${escapeHtml(lead)}`
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return `${open}${childrenOf(node).map((child) => inlineHtml(child, writer)).join('')}</p>`
    case 'image-block': {
      const caption = stringOf(attrsOf(node).caption)
      const picture = pendingImageOf(node)
        ? '[Picture needed]'
        : pictureHtml(writer.media.pictures.get(copyPictureKey(node)), caption)
      return `${open}${picture}</p>${caption ? `<p style="${style}"><i>${escapeHtml(caption)}</i></p>` : ''}`
    }
    case 'code_block': {
      const source = sourceOf(node)
      if (isDisplayMath(node)) return `${open}${mathHtml(source, true, writer)}</p>`
      return `${open}<code>${escapeHtml(source).replace(/\n/g, '<br>')}</code></p>`
    }
    case 'hr':
      return lead ? `${open}</p><hr>` : '<hr>'
    case 'bullet_list':
    case 'ordered_list': {
      const tag = node.type === 'bullet_list' ? 'ul' : 'ol'
      const items = childrenOf(node).map((item) =>
        `<li>${childrenOf(item).map((child) => child.type === 'paragraph'
          ? childrenOf(child).map((inline) => inlineHtml(inline, writer)).join('')
          : nodeHtml(child, writer, '', 0)).join('<br>')}</li>`,
      ).join('')
      return `${lead ? `${open}</p>` : ''}<${tag} style="margin:0 0 0 ${indent * 0.5 + 0.25}in">${items}</${tag}>`
    }
    case 'table': {
      const rows = childrenOf(node).map((row) =>
        `<tr>${childrenOf(row).map((cell) => {
          const tag = cell.type === 'table_header' ? 'th' : 'td'
          return `<${tag} style="border:1px solid #000;padding:2pt 4pt">${childrenOf(cell).map((child) => nodeHtml(child, writer, '', 0)).join('')}</${tag}>`
        }).join('')}</tr>`,
      ).join('')
      const table = centred
        ? '<table align="center" style="width:100%;border-collapse:collapse;table-layout:fixed;margin:0 auto">'
        : '<table style="width:100%;border-collapse:collapse;table-layout:fixed">'
      return `${lead ? `<p style="${paragraphStyle(indent)}">${escapeHtml(lead)}</p>` : ''}${table}<tbody>${rows}</tbody></table>`
    }
    default:
      // Anything unrecognised gives up its children rather than disappearing,
      // as it does on the exam page.
      return childrenOf(node).map((child, index) => nodeHtml(child, writer, index === 0 ? lead : '', indent)).join('')
        || (lead ? `${open}</p>` : '')
  }
}

function lineHtml(copied: CopyLine, writer: Writer): string {
  const indent = copied.indent ?? 0
  const lead = copied.lead ?? ''
  if (copied.content.length === 0) return lead ? `<p style="${paragraphStyle(indent)}">${escapeHtml(lead)}</p>` : ''
  return copied.content.map((node, index) => nodeHtml(node, writer, index === 0 ? lead : '', indent)).join('')
}

function layoutTable(rows: string[][], indent: number): string {
  const margin = indent ? ` style="margin-left:${indent * 0.5}in"` : ''
  return `<div${margin}><table ${LAYOUT_TABLE}><tbody>${rows.map((cells) =>
    `<tr>${cells.map((cell) => `<td ${LAYOUT_CELL}>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}

function blockHtml(block: CopyBlock, writer: Writer): string {
  switch (block.kind) {
    case 'line':
      return lineHtml(block, writer)
    case 'grid':
      return layoutTable(block.cells.map((row) => row.map((cell) => (cell ? lineHtml({ ...cell, indent: 0 }, writer) : ''))), block.indent ?? 0)
    case 'beside':
      return layoutTable([[
        block.left.map((item) => lineHtml(item, writer)).join(''),
        block.right.map((answer) => lineHtml(answer, writer)).join(''),
      ]], 0)
    case 'rules':
      return Array.from({ length: block.count }, () =>
        `<p style="${paragraphStyle(block.indent ?? 0)};line-height:2">${ANSWER_RULE}</p>`).join('')
  }
}

/** Several Questions' blocks as rich text, an empty line between each. */
export function copyHtmlOf(
  questions: readonly (readonly CopyBlock[])[],
  media: CopyMedia = NO_MEDIA,
  math: CopyMathMode = 'picture',
): string {
  const writer = { media, math }
  return `<meta charset="utf-8"><div>${questions
    .map((blocks) => blocks.map((block) => blockHtml(block, writer)).join(''))
    .join('<p style="margin:0">&nbsp;</p>')}</div>`
}

// ---- Plain text -----------------------------------------------------------

function inlineText(node: ProseMirrorJSON): string {
  switch (node.type) {
    case 'text': return stringOf(node.text)
    case 'hardbreak': return '\n'
    case 'math_inline': return `$${stringOf(attrsOf(node).value)}$`
    case 'blank': return BLANK_LINE
    case 'image': return pendingImageOf(node) ? '[Picture needed]' : '[Picture]'
    default: return childrenOf(node).map(inlineText).join('')
  }
}

function nodeText(node: ProseMirrorJSON): string[] {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return [childrenOf(node).map(inlineText).join('')]
    case 'image-block':
      return [pendingImageOf(node) ? '[Picture needed]' : '[Picture]']
    case 'code_block':
      return isDisplayMath(node) ? [`$$${sourceOf(node)}$$`] : sourceOf(node).split('\n')
    case 'hr':
      return ['---']
    case 'bullet_list':
    case 'ordered_list':
      return childrenOf(node).flatMap((item, index) => {
        const marker = node.type === 'bullet_list' ? '- ' : `${index + 1}. `
        return childrenOf(item).flatMap(nodeText).map((text, row) => `${row === 0 ? marker : '   '}${text}`)
      })
    case 'table':
      return childrenOf(node).map((row) =>
        childrenOf(row).map((cell) => childrenOf(cell).flatMap(nodeText).join(' ')).join('\t'))
    default:
      return childrenOf(node).flatMap(nodeText)
  }
}

function lineText(copied: CopyLine, indent = copied.indent ?? 0): string[] {
  const pad = '    '.repeat(indent)
  const texts = copied.content.flatMap(nodeText)
  if (texts.length === 0) texts.push('')
  return texts.map((text, index) => `${pad}${index === 0 ? copied.lead ?? '' : ''}${text}`)
}

function blockText(block: CopyBlock): string[] {
  switch (block.kind) {
    case 'line':
      return lineText(block)
    case 'grid':
      // Plain text has no columns; the answers read in letter order.
      return block.cells[0]!
        .flatMap((_unused, column) => block.cells.map((row) => row[column]))
        .filter((cell): cell is CopyLine => cell !== null)
        .flatMap((cell) => lineText(cell, block.indent ?? 0))
    case 'beside':
      return [...block.right, ...block.left].flatMap((copied) => lineText(copied))
    case 'rules':
      return Array.from({ length: block.count }, () => `${'    '.repeat(block.indent ?? 0)}${ANSWER_RULE}`)
  }
}

/** Several Questions' blocks as plain text, an empty line between each. */
export function copyTextOf(questions: readonly (readonly CopyBlock[])[]): string {
  return questions.map((blocks) => blocks.flatMap(blockText).join('\n')).join('\n\n')
}

// ---- Pictures and formulas ------------------------------------------------

/** How many CSS pixels a MathJax `ex` is at a document's default 11pt. */
const EX_PX = 7.5
/** Formulas are drawn at this many device pixels per CSS pixel, so they stay
 *  sharp when the destination is zoomed or printed. */
const MATH_SCALE = 3

/** A formula's SVG, sized in CSS pixels and drawn in black: MathJax sizes in
 *  `ex` and paints with `currentColor`, neither of which an image has. */
export function sizedMathSvg(svg: string): { svg: string; width: number; height: number } | null {
  const width = /width="([\d.]+)ex"/.exec(svg)
  const height = /height="([\d.]+)ex"/.exec(svg)
  if (!width || !height) return null
  const px = { width: Number(width[1]) * EX_PX, height: Number(height[1]) * EX_PX }
  return {
    svg: svg
      .replace(/width="[\d.]+ex"/, `width="${px.width * MATH_SCALE}"`)
      .replace(/height="[\d.]+ex"/, `height="${px.height * MATH_SCALE}"`)
      .replace(/currentColor/g, '#000'),
    width: Math.round(px.width),
    height: Math.round(px.height),
  }
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = src
  await image.decode()
  return image
}

async function mathPicture(source: string, display: boolean): Promise<CopyPicture | null> {
  const tools = await mathJaxTools()
  const sized = sizedMathSvg(tools.adaptor.outerHTML(tools.svg(source, display)))
  if (!sized) return null
  const url = URL.createObjectURL(new Blob([sized.svg], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(sized.width * MATH_SCALE)
    canvas.height = Math.ceil(sized.height * MATH_SCALE)
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    return { src: canvas.toDataURL('image/png'), width: sized.width, height: sized.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

const dataUrlOf = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

async function imagePicture(src: string, crop: CropBox | undefined, sizing: PictureSizing): Promise<CopyPicture | null> {
  // A Media Asset's address resolves only in this browser, so the picture
  // travels as its own bytes — only the part a Picture Crop keeps.
  const response = await fetch(src)
  if (!response.ok) return null
  const blob = await response.blob()
  const bitmap = await createImageBitmap(blob)
  try {
    const kept = crop ? keptPixels(crop, bitmap.width, bitmap.height) : { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
    const bytes = crop ? await encoded(bitmap, blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', kept) : null
    if (crop && !bytes) return null
    const picture = bytes ? new Blob([bytes.slice().buffer as ArrayBuffer], { type: blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png' }) : blob
    const width = copyImageWidth(kept.width, sizing)
    const height = Math.round(width * kept.height / kept.width)
    return { src: await dataUrlOf(picture), width, height }
  } finally {
    bitmap.close()
  }
}

// What has been made, kept for the page's life: a Media Asset never changes,
// and neither does what a formula renders to.
const madePictures = new Map<string, CopyPicture>()
const madeMathml = new Map<string, string>()
const making = new Map<string, Promise<void>>()

function make(key: string, work: () => Promise<void>): Promise<void> {
  let pending = making.get(key)
  if (!pending) {
    // One that cannot be made is left out, and pastes as a bracketed
    // placeholder or its own source; it is tried again next time.
    pending = work().catch(() => undefined).finally(() => making.delete(key))
    making.set(key, pending)
  }
  return pending
}

/** Make every picture and formula these blocks need, once, and keep them. */
export async function prepareCopyMedia(blocks: readonly CopyBlock[], math: CopyMathMode): Promise<void> {
  await Promise.all(copyMediaOf(blocks).map((request) => {
    if (request.kind === 'image') {
      if (madePictures.has(request.key)) return undefined
      return make(`image:${request.key}`, async () => {
        const picture = await imagePicture(request.src, request.crop, request.sizing)
        if (picture) madePictures.set(request.key, picture)
      })
    }
    const key = mathKey(request.source, request.display)
    if (math === 'word') {
      if (madeMathml.has(key)) return undefined
      return make(`mathml:${key}`, async () => {
        madeMathml.set(key, (await mathJaxTools()).mathml(request.source, request.display))
      })
    }
    if (madePictures.has(key)) return undefined
    return make(`math:${key}`, async () => {
      const picture = await mathPicture(request.source, request.display)
      if (picture) madePictures.set(key, picture)
    })
  }))
}

/** What has been made so far, for writing a copy at once. */
export function preparedCopyMedia(): CopyMedia {
  return { pictures: madePictures, mathml: madeMathml }
}

/** The rich and plain text for these Questions, as far as it is made. */
export function copyContentOf(
  questions: readonly { question: Question; format?: CopyFormat }[],
  math: CopyMathMode,
): { html: string; text: string } {
  const blocks = questions.map(({ question, format }) => copyBlocksOf(question, format))
  return { html: copyHtmlOf(blocks, preparedCopyMedia(), math), text: copyTextOf(blocks) }
}

/**
 * Put Questions on the clipboard of `view` — the window the teacher acted in,
 * which in the Question Bank Pop-over is not the one this script runs in.
 *
 * The clipboard item is written at once with a promise for its rich text, so
 * the gesture that asked for it still counts while pictures are fetched and
 * formulas made.
 */
export async function copyQuestions(
  questions: readonly { question: Question; format?: CopyFormat }[],
  math: CopyMathMode,
  view: Window = window,
): Promise<void> {
  const blocks = questions.map(({ question, format }) => copyBlocksOf(question, format))
  const text = copyTextOf(blocks)
  const html = Promise.all(blocks.map((each) => prepareCopyMedia(each, math))).then(() =>
    new Blob([copyHtmlOf(blocks, preparedCopyMedia(), math)], { type: 'text/html' }))
  const Item = (view as Window & typeof globalThis).ClipboardItem ?? ClipboardItem
  await view.navigator.clipboard.write([new Item({
    'text/html': html,
    'text/plain': new Blob([text], { type: 'text/plain' }),
  })])
}
