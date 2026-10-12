// A small XML reader.
//
// Both sides of an export comparison are markup: OOXML parts on the DOCX side,
// the print adapter's own HTML on the other. Neither is hostile and neither is
// hand-written — machine-written XML with no doctypes and no CDATA, and markup
// a browser serialized — so a tag scanner is enough, and it keeps the standard
// test suite free of an XML parser dependency it would carry only for this.
//
// Text that follows a child element is collected onto the parent, so this is a
// reader for structure, not for mixed inline prose. Every caller here walks
// elements whose text nodes are already wrapped.
//
// Test and diagnostic code only. Nothing in the application imports it.

export type XmlNode = {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decode(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    }
    return ENTITIES[entity] ?? whole
  })
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1]!] = decode(match[2]!)
  }
  return attrs
}

// HTML void elements. OOXML has none, but the print adapter's own markup is
// read back with this parser too, and a browser writes `<br>` rather than
// `<br/>`.
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  const pattern = /<([?!/]?)([\w:.-]*)([^>]*?)(\/?)>|([^<]+)/g

  for (const match of source.matchAll(pattern)) {
    const [, lead, name, rest, selfClosing, text] = match
    const parent = stack.at(-1)!
    if (text !== undefined) {
      parent.text += decode(text)
      continue
    }
    // Declarations, doctypes and comments carry nothing a fingerprint reads.
    if (lead === '?' || lead === '!') continue
    if (lead === '/') {
      if (stack.length > 1) stack.pop()
      continue
    }
    const node: XmlNode = {
      name: name!,
      attrs: parseAttrs(rest ?? ''),
      children: [],
      text: '',
    }
    parent.children.push(node)
    if (selfClosing !== '/' && !VOID_ELEMENTS.has(node.name)) stack.push(node)
  }
  return root
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((candidate) => candidate.name === name)
}

export function path(node: XmlNode, ...names: string[]): XmlNode | undefined {
  let current: XmlNode | undefined = node
  for (const name of names) {
    if (!current) return undefined
    current = child(current, name)
  }
  return current
}

export function descendants(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = []
  const visit = (current: XmlNode) => {
    for (const item of current.children) {
      if (item.name === name) found.push(item)
      visit(item)
    }
  }
  visit(node)
  return found
}

