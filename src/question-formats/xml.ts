/**
 * A small, safe XML reader for the question formats that are XML — QTI,
 * Blackboard pools, Moodle XML, and the XML inside Word and Excel files.
 *
 * It reads elements, attributes, text and CDATA, and nothing that reaches
 * outside the file: a DOCTYPE and its entity declarations are skipped, never
 * expanded, so an external entity or a “billion laughs” file cannot fetch or
 * multiply anything. Only XML's five named entities and numeric references
 * are decoded. It works the same in a browser and under `bun test`, which
 * has no DOMParser.
 *
 * In `html` mode it is forgiving the way question stems need: tag names are
 * lower-cased, void elements such as `<br>` need no closing slash, a
 * mismatched close tag closes up to its match, and HTML's common named
 * entities decode.
 */

export type XmlElement = {
  name: string
  /** The name without its namespace prefix, lower-cased in `html` mode. */
  local: string
  attributes: Record<string, string>
  children: XmlNode[]
}

export type XmlNode = XmlElement | string

const MAX_DEPTH = 256
const MAX_NODES = 2_000_000

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const HTML_ENTITIES: Record<string, string> = {
  ...XML_ENTITIES,
  nbsp: '\u00A0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', shy: '\u00AD',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  bull: '•', middot: '·', deg: '°', plusmn: '±', times: '×', divide: '÷', minus: '−', le: '≤', ge: '≥', ne: '≠',
  asymp: '≈', infin: '∞', sup2: '²', sup3: '³', frac12: '½', frac14: '¼', frac34: '¾', micro: 'µ', para: '¶',
  sect: '§', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢', prime: '′', Prime: '″',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', rArr: '⇒', lArr: '⇐', hArr: '⇔',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π',
  sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', Pi: 'Π', Theta: 'Θ',
  sum: '∑', prod: '∏', radic: '√', int: '∫', part: '∂', nabla: '∇', isin: '∈', notin: '∉', cap: '∩', cup: '∪',
  sub: '⊂', sup: '⊃', and: '∧', or: '∨', not: '¬', forall: '∀', exist: '∃', empty: '∅', there4: '∴',
  iexcl: '¡', iquest: '¿', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', ouml: 'ö', auml: 'ä',
  Uuml: 'Ü', Ouml: 'Ö', Auml: 'Ä', szlig: 'ß', ccedil: 'ç', Ccedil: 'Ç', agrave: 'à', egrave: 'è', ecirc: 'ê',
}

export class XmlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XmlError'
  }
}

export function decodeEntities(text: string, html = false): string {
  if (!text.includes('&')) return text
  const named = html ? HTML_ENTITIES : XML_ENTITIES
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    // An XML entity must end in `;`; HTML forgives a missing one.
    if (!whole.endsWith(';') && !html) return whole
    return named[body] ?? whole
  })
}

const localName = (name: string) => {
  const colon = name.indexOf(':')
  return colon === -1 ? name : name.slice(colon + 1)
}

function parseAttributes(source: string, html: boolean): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of source.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
    const name = html ? match[1]!.toLowerCase() : match[1]!
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (!(name in attributes)) attributes[name] = decodeEntities(value, html)
  }
  return attributes
}

/** Parse a document into a synthetic root whose children are its top-level
 *  nodes. Throws `XmlError` on XML that is not well formed. */
export function parseXml(source: string, options: { html?: boolean } = {}): XmlElement {
  const html = options.html ?? false
  const root: XmlElement = { name: '#root', local: '#root', attributes: {}, children: [] }
  const stack: XmlElement[] = [root]
  let nodes = 0
  let index = 0
  const text = (value: string) => {
    if (!value) return
    const decoded = decodeEntities(value, html)
    const parent = stack.at(-1)!
    const last = parent.children.at(-1)
    if (typeof last === 'string') parent.children[parent.children.length - 1] = last + decoded
    else parent.children.push(decoded)
  }
  while (index < source.length) {
    const open = source.indexOf('<', index)
    if (open === -1) {
      text(source.slice(index))
      break
    }
    text(source.slice(index, open))
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4)
      index = end === -1 ? source.length : end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9)
      if (end === -1 && !html) throw new XmlError('A CDATA section is never closed.')
      const content = source.slice(open + 9, end === -1 ? source.length : end)
      const parent = stack.at(-1)!
      const last = parent.children.at(-1)
      if (typeof last === 'string') parent.children[parent.children.length - 1] = last + content
      else parent.children.push(content)
      index = end === -1 ? source.length : end + 3
      continue
    }
    if (source.startsWith('<?', open)) {
      const end = source.indexOf('?>', open + 2)
      index = end === -1 ? source.length : end + 2
      continue
    }
    if (source.startsWith('<!', open)) {
      // A DOCTYPE, with any internal subset in brackets: skipped whole.
      let depth = 0
      let at = open + 2
      for (; at < source.length; at += 1) {
        const character = source[at]
        if (character === '[') depth += 1
        else if (character === ']') depth -= 1
        else if (character === '>' && depth <= 0) break
      }
      index = at + 1
      continue
    }
    // A tag: find its end outside quoted attribute values.
    let end = open + 1
    let quote: string | null = null
    for (; end < source.length; end += 1) {
      const character = source[end]
      if (quote) {
        if (character === quote) quote = null
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '>') {
        break
      }
    }
    if (end >= source.length) {
      if (html) {
        text(source.slice(open))
        break
      }
      throw new XmlError('A tag is never closed.')
    }
    const body = source.slice(open + 1, end)
    index = end + 1
    if (body.startsWith('/')) {
      const rawName = body.slice(1).trim()
      const name = html ? rawName.toLowerCase() : rawName
      let at = stack.length - 1
      while (at > 0 && stack[at]!.name !== name) at -= 1
      if (at <= 0) {
        if (html) continue
        throw new XmlError(`</${rawName}> closes nothing.`)
      }
      if (!html && at !== stack.length - 1) throw new XmlError(`<${stack.at(-1)!.name}> is closed by </${rawName}>.`)
      stack.length = at
      continue
    }
    if (html && !/^[a-z]/i.test(body)) {
      // A bare `<`, such as `x < 3`, in forgiving HTML.
      text(`<${body}>`)
      continue
    }
    const selfClosing = body.endsWith('/')
    const inner = selfClosing ? body.slice(0, -1) : body
    const nameMatch = /^[^\s/>]+/.exec(inner)
    if (!nameMatch) throw new XmlError('A tag has no name.')
    const name = html ? nameMatch[0].toLowerCase() : nameMatch[0]
    const element: XmlElement = {
      name,
      local: localName(name),
      attributes: parseAttributes(inner.slice(nameMatch[0].length), html),
      children: [],
    }
    nodes += 1
    if (nodes > MAX_NODES) throw new XmlError('This file has too many elements to read safely.')
    stack.at(-1)!.children.push(element)
    if (selfClosing || (html && VOID_ELEMENTS.has(element.local))) continue
    if (html && (element.local === 'script' || element.local === 'style')) {
      // Their content is never question text; skip to the close tag.
      const close = source.toLowerCase().indexOf(`</${element.local}`, index)
      index = close === -1 ? source.length : source.indexOf('>', close) + 1 || source.length
      continue
    }
    stack.push(element)
    if (stack.length > MAX_DEPTH) throw new XmlError('This file nests too deeply to read safely.')
  }
  if (!html && stack.length > 1) throw new XmlError(`<${stack.at(-1)!.name}> is never closed.`)
  return root
}

export const isElement = (node: XmlNode | undefined): node is XmlElement => typeof node === 'object'

/** The element children of an element, optionally only those with a local name. */
export function childrenOf(element: XmlElement | undefined, local?: string): XmlElement[] {
  if (!element) return []
  return element.children.filter(
    (node): node is XmlElement => isElement(node) && (local === undefined || node.local === local),
  )
}

export function childOf(element: XmlElement | undefined, local: string): XmlElement | undefined {
  return element?.children.find((node): node is XmlElement => isElement(node) && node.local === local)
}

/** Every descendant with a local name, in document order. */
export function descendantsOf(element: XmlElement | undefined, local: string): XmlElement[] {
  const found: XmlElement[] = []
  const walk = (node: XmlElement) => {
    for (const child of node.children) {
      if (!isElement(child)) continue
      if (child.local === local) found.push(child)
      walk(child)
    }
  }
  if (element) walk(element)
  return found
}

export function descendantOf(element: XmlElement | undefined, local: string): XmlElement | undefined {
  if (!element) return undefined
  for (const child of element.children) {
    if (!isElement(child)) continue
    if (child.local === local) return child
    const found = descendantOf(child, local)
    if (found) return found
  }
  return undefined
}

/** All the text inside an element. */
export function textOf(element: XmlElement | undefined): string {
  if (!element) return ''
  return element.children.map((node) => (isElement(node) ? textOf(node) : node)).join('')
}

/** An attribute by its local name, whatever namespace prefix it carries. */
export function attributeOf(element: XmlElement | undefined, local: string): string | undefined {
  if (!element) return undefined
  if (local in element.attributes) return element.attributes[local]
  for (const [name, value] of Object.entries(element.attributes)) {
    if (localName(name) === local) return value
  }
  return undefined
}

/** The first element of a document, skipping the synthetic root. */
export function documentElement(root: XmlElement): XmlElement | undefined {
  return childrenOf(root)[0]
}
