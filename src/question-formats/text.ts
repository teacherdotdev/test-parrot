/**
 * Reading a text file the way a teacher's computer wrote it: UTF-8 with or
 * without a byte-order mark, the UTF-16 Excel calls “Unicode Text”, or the
 * Windows-1252 older Office and Notepad save as. Line endings of every kind
 * become `\n`, so a line number counts what the teacher sees in an editor.
 */

export type DecodedText = { text: string; encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252' }

export function decodeText(bytes: Uint8Array): DecodedText {
  let encoding: DecodedText['encoding']
  let start = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = 'utf-8'
    start = 3
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le'
    start = 2
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be'
    start = 2
  } else if (looksLikeUtf16(bytes)) {
    encoding = bytes[1] === 0 ? 'utf-16le' : 'utf-16be'
  } else {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return { text: normalizeText(text), encoding: 'utf-8' }
    } catch {
      encoding = 'windows-1252'
    }
  }
  const text = new TextDecoder(encoding).decode(bytes.subarray(start))
  return { text: normalizeText(text), encoding }
}

/** Text with no byte-order mark whose every other byte is zero is UTF-16. */
function looksLikeUtf16(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512))
  if (sample.length < 4) return false
  let evenZeros = 0
  let oddZeros = 0
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] !== 0) continue
    if (index % 2 === 0) evenZeros += 1
    else oddZeros += 1
  }
  const half = sample.length / 2
  return oddZeros > half * 0.6 || evenZeros > half * 0.6
}

/** One line ending, a leading mark removed, and Unicode in its composed form. */
export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').normalize('NFC')
}

/**
 * What a word processor puts where a structural character belongs: the
 * no-break space after a `*`, a zero-width joiner, a fullwidth asterisk.
 * Applied to the markers a format reads, never to what a teacher wrote.
 */
export function plainStructure(line: string): string {
  return line
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/＊/g, '*')
}

/** A line of text, and the 1-based line it is on. */
export type Line = { text: string; line: number }

export function linesOf(text: string): Line[] {
  return text.split('\n').map((value, index) => ({ text: value, line: index + 1 }))
}

/** Lines grouped into the blocks blank lines separate. */
export function blocksOf(text: string): Line[][] {
  const blocks: Line[][] = []
  let current: Line[] = []
  for (const line of linesOf(text)) {
    if (plainStructure(line.text).trim() === '') {
      if (current.length) blocks.push(current)
      current = []
    } else {
      current.push(line)
    }
  }
  if (current.length) blocks.push(current)
  return blocks
}

/** A short quotation of a line, to find a question by. */
export function excerpt(text: string, length = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat
}

/**
 * Delimited rows — CSV, or a tab-delimited file Excel saved — split the way
 * RFC 4180 reads them: a quoted field may hold the delimiter, a line break,
 * or a doubled quote. Each row keeps the line it started on.
 */
export function delimitedRows(text: string, delimiter: string): { fields: string[]; line: number }[] {
  const rows: { fields: string[]; line: number }[] = []
  let fields: string[] = []
  let field = ''
  let quoted = false
  let fieldStarted = false
  let line = 1
  let rowLine = 1
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        if (character === '\n') line += 1
        field += character
      }
      continue
    }
    if (character === '"' && !fieldStarted) {
      quoted = true
      fieldStarted = true
      continue
    }
    if (character === delimiter) {
      fields.push(field)
      field = ''
      fieldStarted = false
      continue
    }
    if (character === '\n') {
      fields.push(field)
      rows.push({ fields, line: rowLine })
      fields = []
      field = ''
      fieldStarted = false
      line += 1
      rowLine = line
      continue
    }
    field += character
    fieldStarted = true
  }
  if (field !== '' || fields.length) {
    fields.push(field)
    rows.push({ fields, line: rowLine })
  }
  return rows
}

/** A row with the empty fields at its end removed; empty fields inside it
 *  can mean something, as in Blackboard's Fill in Multiple Blanks. */
export function trimTrailingEmpty(fields: string[]): string[] {
  let end = fields.length
  while (end > 0 && fields[end - 1]!.trim() === '') end -= 1
  return fields.slice(0, end)
}

/** A point value as a file writes it, such as `2`, `10.0` or `2,5`, as a
 *  number; undefined when there is none or it is not a number. Whether it
 *  becomes Points is `record.ts`'s to say. */
export function pointsIn(text: string | undefined): number | undefined {
  const trimmed = text?.trim()
  if (!trimmed) return undefined
  const value = Number(trimmed.replace(',', '.'))
  return Number.isFinite(value) ? value : undefined
}
