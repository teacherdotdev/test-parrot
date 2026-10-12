import type { SemanticMark, SemanticNode } from '../question-bank-export'
import { BLANK_MARK, type Blocks } from './types'
import { isElement, parseXml, type XmlElement, type XmlNode } from './xml'

/**
 * Question text from another format, as the semantic blocks a Question Bank
 * Record holds. Plain text keeps its line breaks. HTML — which QTI, Blackboard
 * pools, Moodle XML and D2L all carry — keeps what the record can say
 * (paragraphs, bold, italics, lists, tables, sub- and superscripts, links,
 * math, pictures) and drops the rest, such as colors, fonts and scripts,
 * keeping their text.
 */

export function textRun(text: string, marks?: SemanticMark[]): SemanticNode {
  return marks && marks.length ? { type: 'text', text, marks } : { type: 'text', text }
}

/** Plain text as blocks: one paragraph, its line breaks kept. */
export function plainBlocks(text: string): Blocks {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const content: SemanticNode[] = []
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: 'hard-break' })
    if (line) content.push(textRun(line))
  })
  while (content.at(-1)?.type === 'hard-break') content.pop()
  return [content.length ? { type: 'paragraph', content } : { type: 'paragraph' }]
}

/** The plain text of blocks, for messages and comparisons. */
export function blocksText(blocks: Blocks): string {
  const walk = (node: SemanticNode): string => {
    if (node.type === 'text') return (node.text ?? '').replaceAll(BLANK_MARK, '_____')
    if (node.type === 'blank') return '_____'
    if (node.type === 'hard-break') return '\n'
    if (node.type === 'inline-math' || node.type === 'display-math') return node.source ?? ''
    if (node.type === 'code-block') return node.text ?? ''
    const inner = (node.content ?? []).map(walk).join(node.type === 'table-row' ? ' ' : '')
    return ['paragraph', 'heading', 'list-item', 'table-row'].includes(node.type) ? `${inner}\n` : inner
  }
  return blocks.map(walk).join('').trim()
}

export function isBlank(blocks: Blocks): boolean {
  const hasContent = (node: SemanticNode): boolean =>
    (node.type === 'text' && (node.text ?? '').trim() !== '') ||
    node.type === 'inline-image' ||
    node.type === 'block-image' ||
    node.type === 'inline-math' ||
    node.type === 'display-math' ||
    node.type === 'rule' ||
    (node.type === 'code-block' && (node.text ?? '').trim() !== '') ||
    (node.content ?? []).some(hasContent)
  return !blocks.some(hasContent)
}

/**
 * What a picture in HTML stands for: an image key a parser registered with
 * its bytes, or `null` for a picture that cannot be brought in. `onMissing`
 * hears of each picture left out.
 */
export type ImageResolver = (source: string, element: XmlElement) => string | null

export type HtmlOptions = {
  image?: ImageResolver
  /** Called with a picture's `src` when it is left out. */
  onMissing?: (source: string) => void
}

const BLOCK_ELEMENTS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'figure', 'figcaption', 'center',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'td', 'th', 'pre', 'hr', 'dl', 'dt', 'dd', 'address', 'form', 'fieldset', 'body', 'html',
])

const MARKS: Record<string, Exclude<SemanticMark['type'], 'link'>> = {
  b: 'strong', strong: 'strong', i: 'emphasis', em: 'emphasis', cite: 'emphasis', var: 'emphasis',
  code: 'inline-code', kbd: 'inline-code', samp: 'inline-code', tt: 'inline-code',
  s: 'strike', strike: 'strike', del: 'strike', sub: 'subscript', sup: 'superscript',
}

const SAFE_HREF = /^https?:\/\//i

/** HTML as blocks. Never throws: HTML that cannot be read is kept as text. */
export function htmlBlocks(html: string, options: HtmlOptions = {}): Blocks {
  let root: XmlElement
  try {
    root = parseXml(html, { html: true })
  } catch {
    return plainBlocks(html.replace(/<[^>]*>/g, ''))
  }
  const blocks = new HtmlReader(options).blocks(root.children)
  return blocks.length ? blocks : [{ type: 'paragraph' }]
}

/** Whether a string holds HTML markup rather than plain text. */
export function looksLikeHtml(text: string): boolean {
  return /<\/?(p|br|div|span|b|i|u|em|strong|img|sub|sup|ul|ol|li|table|a|font|h[1-6])\b[^>]*>/i.test(text) ||
    /&(nbsp|amp|lt|gt|quot|#\d+);/i.test(text)
}

/** Text that may be HTML or plain, as blocks. */
export function richBlocks(text: string, options: HtmlOptions = {}): Blocks {
  return looksLikeHtml(text) ? htmlBlocks(text, options) : plainBlocks(text)
}

class HtmlReader {
  constructor(private readonly options: HtmlOptions) {}

  /** Block-level content: runs of inline nodes become paragraphs. */
  blocks(nodes: XmlNode[]): Blocks {
    const blocks: Blocks = []
    let inline: SemanticNode[] = []
    const flush = () => {
      const trimmed = trimInline(inline)
      if (trimmed.length) blocks.push({ type: 'paragraph', content: trimmed })
      inline = []
    }
    for (const node of nodes) {
      if (!isElement(node) || !BLOCK_ELEMENTS.has(node.local)) {
        for (const piece of this.inline(node, [])) {
          if (piece.type === 'block-image') {
            flush()
            blocks.push(piece)
          } else {
            inline.push(piece)
          }
        }
        continue
      }
      flush()
      blocks.push(...this.block(node))
    }
    flush()
    return blocks
  }

  block(element: XmlElement): Blocks {
    switch (element.local) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const content = trimInline(this.inlineChildren(element, []))
        return content.length ? [{ type: 'heading', level: Number(element.local[1]), content }] : []
      }
      case 'blockquote': {
        const content = this.blocks(element.children)
        return content.length ? [{ type: 'blockquote', content }] : []
      }
      case 'ul': case 'ol': {
        const items = element.children
          .filter((node): node is XmlElement => isElement(node) && node.local === 'li')
          .map((item) => {
            const content = this.blocks(item.children)
            return { type: 'list-item', content: content.length ? content : [{ type: 'paragraph' }] }
          })
        if (!items.length) return []
        const start = Number(element.attributes.start)
        return [{
          type: element.local === 'ul' ? 'bullet-list' : 'ordered-list',
          ...(element.local === 'ol' && Number.isInteger(start) && start > 1 ? { start } : {}),
          content: items,
        }]
      }
      case 'table': return this.table(element)
      case 'pre': return [{ type: 'code-block', text: textContent(element).replace(/\n$/, '') }]
      case 'hr': return [{ type: 'rule' }]
      default: return this.blocks(element.children)
    }
  }

  table(element: XmlElement): Blocks {
    const rows: SemanticNode[] = []
    const collect = (node: XmlElement) => {
      for (const child of node.children) {
        if (!isElement(child)) continue
        if (child.local === 'tr') {
          const cells = child.children
            .filter((cell): cell is XmlElement => isElement(cell) && (cell.local === 'td' || cell.local === 'th'))
            .map((cell) => {
              const content = this.blocks(cell.children)
              return {
                type: 'table-cell',
                ...(cell.local === 'th' ? { header: true } : {}),
                content: content.length ? content : [{ type: 'paragraph' }],
              }
            })
          if (cells.length) {
            const header = cells.every((cell) => cell.header)
            rows.push({ type: 'table-row', ...(header ? { header: true } : {}), content: cells })
          }
        } else if (['thead', 'tbody', 'tfoot'].includes(child.local)) {
          collect(child)
        }
      }
    }
    collect(element)
    return rows.length ? [{ type: 'table', content: rows }] : []
  }

  inlineChildren(element: XmlElement, marks: SemanticMark[]): SemanticNode[] {
    return element.children.flatMap((child) => this.inline(child, marks))
  }

  inline(node: XmlNode, marks: SemanticMark[]): SemanticNode[] {
    if (!isElement(node)) {
      const text = node.replace(/[\t\n\r ]+/g, ' ')
      return text ? mathRuns(text, marks) : []
    }
    const mark = MARKS[node.local]
    if (mark) return this.inlineChildren(node, withMark(marks, { type: mark }))
    switch (node.local) {
      case 'br': return [{ type: 'hard-break' }]
      case 'img': return this.image(node)
      case 'a': {
        const href = node.attributes.href ?? ''
        return this.inlineChildren(node, SAFE_HREF.test(href) ? withMark(marks, { type: 'link', href }) : marks)
      }
      case 'span': case 'font': {
        const style = (node.attributes.style ?? '').toLowerCase()
        let next = marks
        if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) next = withMark(next, { type: 'strong' })
        if (/font-style\s*:\s*italic/.test(style)) next = withMark(next, { type: 'emphasis' })
        if (/vertical-align\s*:\s*sub/.test(style)) next = withMark(next, { type: 'subscript' })
        if (/vertical-align\s*:\s*super/.test(style)) next = withMark(next, { type: 'superscript' })
        const latex = node.attributes['data-latex'] ?? node.attributes['data-equation-content']
        if (latex) return [{ type: 'inline-math', source: latex }]
        return this.inlineChildren(node, next)
      }
      case 'math': {
        const annotation = findAnnotation(node)
        return annotation ? [{ type: 'inline-math', source: annotation }] : this.inlineChildren(node, marks)
      }
      default:
        if (BLOCK_ELEMENTS.has(node.local)) {
          // A block inside inline content, such as a <p> in a <span>: its
          // text still belongs to the line.
          return this.inlineChildren(node, marks)
        }
        return this.inlineChildren(node, marks)
    }
  }

  image(element: XmlElement): SemanticNode[] {
    const latex = element.attributes['data-equation-content'] ?? element.attributes['data-latex']
    if (latex) return [{ type: 'inline-math', source: latex }]
    const source = element.attributes.src ?? ''
    const key = this.options.image?.(source, element) ?? null
    if (!key) {
      this.options.onMissing?.(source)
      return []
    }
    const alt = element.attributes.alt?.trim()
    return [{ type: 'block-image', asset: key, ...(alt ? { alt } : {}) }]
  }
}

function findAnnotation(element: XmlElement): string | null {
  for (const child of element.children) {
    if (!isElement(child)) continue
    if (child.local === 'annotation' && /tex/i.test(child.attributes.encoding ?? '')) return textContent(child)
    const found = findAnnotation(child)
    if (found) return found
  }
  return null
}

function textContent(element: XmlElement): string {
  return element.children.map((node) => (isElement(node) ? textContent(node) : node)).join('')
}

function withMark(marks: SemanticMark[], mark: SemanticMark): SemanticMark[] {
  return marks.some((existing) => existing.type === mark.type) ? marks : [...marks, mark]
}

/** `\( … \)` and `\[ … \]`, the TeX delimiters Moodle and Canvas write,
 *  as math; everything else as text. */
function mathRuns(text: string, marks: SemanticMark[]): SemanticNode[] {
  if (!text.includes('\\(') && !text.includes('\\[')) return [textRun(text, marks)]
  const nodes: SemanticNode[] = []
  let last = 0
  for (const match of text.matchAll(/\\\((.+?)\\\)|\\\[(.+?)\\\]/g)) {
    if (match.index > last) nodes.push(textRun(text.slice(last, match.index), marks))
    nodes.push({ type: 'inline-math', source: (match[1] ?? match[2]!).trim() })
    last = match.index + match[0].length
  }
  if (last < text.length) nodes.push(textRun(text.slice(last), marks))
  return nodes
}

/** Inline content with runs merged and the whitespace at its edges removed. */
function trimInline(nodes: SemanticNode[]): SemanticNode[] {
  const merged: SemanticNode[] = []
  for (const node of nodes) {
    const previous = merged.at(-1)
    if (
      node.type === 'text' && previous?.type === 'text' &&
      JSON.stringify(previous.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      merged[merged.length - 1] = { ...previous, text: previous.text! + node.text! }
    } else {
      merged.push(node)
    }
  }
  // Collapse spaces that meet across runs, and around line breaks.
  for (let index = 0; index < merged.length; index += 1) {
    const node = merged[index]!
    if (node.type !== 'text') continue
    const before = merged[index - 1]
    let text = node.text!
    if (!before || before.type === 'hard-break' || (before.type === 'text' && before.text!.endsWith(' '))) {
      text = text.replace(/^ +/, '')
    }
    const after = merged[index + 1]
    if (!after || after.type === 'hard-break') text = text.replace(/ +$/, '')
    merged[index] = { ...node, text }
  }
  const kept = merged.filter((node) => node.type !== 'text' || node.text !== '')
  while (kept[0]?.type === 'hard-break') kept.shift()
  while (kept.at(-1)?.type === 'hard-break') kept.pop()
  // A paragraph of nothing but no-break spaces is an empty line in HTML.
  if (kept.every((node) => node.type === 'text' && /^[\s\u00A0]*$/.test(node.text!))) return []
  return kept
}

/**
 * A stem whose `[name]` placeholders — the way Canvas, Blackboard and
 * Respondus write a named blank in the question text — are blank marks, and
 * the names' places in the order they stand. Each name is marked once, where
 * it first stands; a name the text never mentions is left for `record.ts` to
 * place after it.
 */
export function markNamedBlanks(blocks: Blocks, names: readonly string[]): { stem: Blocks; order: number[] } {
  const order: number[] = []
  const wanted = names.map((name) => name.trim()).filter(Boolean)
  if (!wanted.length) return { stem: blocks, order }
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`\\[(${wanted.map(escape).join('|')})\\]`, 'g')
  const rewrite = (nodes: SemanticNode[]): SemanticNode[] =>
    nodes.map((node) => {
      if (node.type === 'text') {
        const text = (node.text ?? '').replace(pattern, (whole, name: string) => {
          const index = names.findIndex((each) => each.trim() === name)
          if (index === -1 || order.includes(index)) return whole
          order.push(index)
          return BLANK_MARK
        })
        return { ...node, text }
      }
      return node.content ? { ...node, content: rewrite(node.content) } : node
    })
  return { stem: rewrite(blocks), order }
}

/** `items` in the order `order` gives, then the rest in their own order. */
export function inMarkedOrder<T>(items: readonly T[], order: readonly number[]): T[] {
  return [...order.map((index) => items[index]!), ...items.filter((_, index) => !order.includes(index))]
}

/** Each Blank's answer in blocks, as plain text, in the order they stand. */
export function blankAnswers(blocks: Blocks): string[] {
  const answers: string[] = []
  const visit = (node: SemanticNode) => {
    if (node.type === 'blank') answers.push(blocksText([{ type: 'paragraph', content: node.content ?? [] }]))
    else node.content?.forEach(visit)
  }
  blocks.forEach(visit)
  return answers
}
