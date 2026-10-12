// A normalized per-page manifest of a PDF.
//
// The manifest keeps what acceptance is about — how many pages there are, how
// big each one is, and the ordered content assigned to it — and discards what
// it is not: coordinates, baselines, bounding boxes, glyph geometry, and the
// line grouping a renderer chose for itself. Two renderers wrap text
// differently and neither is wrong, so a page's content is compared as its
// ordered words rather than as its lines.
//
// Authored breaks are not read back from the PDF. They are structural content,
// and they are asserted where they survive as structure: in the DOCX
// fingerprint, in the fast suite.

import { spawnSync } from 'node:child_process'

export type PdfPage = {
  number: number
  /** PostScript points, as the PDF records them. */
  width: number
  height: number
  /** The page's content as ordered words. */
  words: string[]
}

export type PdfManifest = {
  file: string
  pages: PdfPage[]
}

const PINNED_ENV = { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...PINNED_ENV },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}):\n${result.stderr}`,
    )
  }
  return result.stdout
}

/** Per-page dimensions. `pdfinfo -l` reports every page when asked for a range
 *  wider than the document, which is how the page count is read too. */
function pageSizes(file: string): { width: number; height: number }[] {
  const info = run('pdfinfo', ['-f', '1', '-l', '10000', file])
  const sizes: { width: number; height: number }[] = []
  for (const match of info.matchAll(
    /^Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/gm,
  )) {
    sizes[Number(match[1]) - 1] = {
      width: Math.round(Number(match[2])),
      height: Math.round(Number(match[3])),
    }
  }
  if (sizes.length === 0) throw new Error(`pdfinfo reported no pages for ${file}`)
  return sizes
}

// Ligatures and the dashes a renderer substitutes are typography, not content.
const SUBSTITUTIONS: [RegExp, string][] = [
  [/\u00a0/g, ' '],
  [/[‐‑‒–—−]/g, '-'],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/ﬁ/g, 'fi'],
  [/ﬂ/g, 'fl'],
  [/[•◦▪·]/g, '•'],
]

// A blank for the student to write on is drawn as a ruled box in print and as a
// run of underscores in Word. Both are empty space, neither is content, and
// only one of them leaves any text behind for an extractor to find. That the
// blank exists at all is asserted structurally in the fast suite, where the
// planned `_______ 1.` line of a matching Item is compared directly.
const BLANK = /^_+$/

export function normalizeWords(text: string): string[] {
  let normalized = text
  for (const [pattern, replacement] of SUBSTITUTIONS) {
    normalized = normalized.replace(pattern, replacement)
  }
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => /[^\u200B-\u200D\uFEFF]/.test(word))
    .filter((word) => !BLANK.test(word))
}

export function pdfManifest(file: string): PdfManifest {
  const sizes = pageSizes(file)
  // `-layout` keeps reading order without inventing column guesses; the page
  // separator is the form feed the format has always used.
  const text = run('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'])
  const pages = text.split('\f')
  return {
    file,
    pages: sizes.map((size, index) => ({
      number: index + 1,
      width: size.width,
      height: size.height,
      words: normalizeWords(pages[index] ?? ''),
    })),
  }
}

export type PdfDifference = {
  page: number | null
  what: 'page-count' | 'page-size' | 'content'
  detail: string
  expected?: string
  actual?: string
}

/** Three words either side of the first difference: enough to find it in the
 *  document, short enough to read in a failure message. */
function around(words: readonly string[], index: number): string {
  return words.slice(Math.max(0, index - 3), index + 4).join(' ') || '(nothing)'
}

/**
 * Words a typeset equation may leave behind, in either renderer.
 *
 * Mathematics is typeset, not written: KaTeX lays `PV = nRT` out as separate
 * glyph boxes that extract as `P V = nRT`, and an Office Math object may extract
 * as nothing at all. Neither is a parity failure, and neither is something a
 * word comparison can adjudicate. That the equation is there, and what its
 * source is, is asserted structurally in the fast suite as `⟨math:…⟩`.
 *
 * The set is built from the sources the document actually contains, so it can
 * only hide content the exam itself put inside an equation.
 */
export function equationWords(sources: readonly string[]): Set<string> {
  const words = new Set<string>()
  for (const source of sources) {
    const rendered = source
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1⁄$2')
      .replace(/\\sqrt\{([^{}]*)\}/g, '√$1')
      .replace(/[_^]\{?([^{}\s])\}?/g, '$1')
    for (const word of `${source} ${rendered}`.split(/\s+/).filter(Boolean)) {
      words.add(word)
      words.add(word.replace(/[^A-Za-z0-9]+/g, ''))
      words.add(word.replace(/[{}\\]/g, ''))
      for (const run of word.match(/[A-Za-z0-9]+/g) ?? []) {
        words.add(run)
        for (const character of run) words.add(character)
      }
    }
  }
  return words
}

function withoutIgnoredScripts(
  words: readonly string[],
  ignored: ReadonlySet<string>,
): string[] {
  const scripts = [...ignored].filter((word) => /^\d+$/.test(word))
  return words.flatMap((word) => {
    if (ignored.has(word)) return []
    for (const script of scripts) {
      if (word.endsWith(script) && word.length > script.length) {
        return [word.slice(0, -script.length)]
      }
    }
    return [word]
  })
}

export function comparePdfs(
  reference: PdfManifest,
  candidate: PdfManifest,
  ignored: ReadonlySet<string> = new Set(),
): PdfDifference[] {
  const differences: PdfDifference[] = []
  if (reference.pages.length !== candidate.pages.length) {
    differences.push({
      page: null,
      what: 'page-count',
      detail: `expected ${reference.pages.length} pages, found ${candidate.pages.length}`,
    })
  }
  const pages = Math.min(reference.pages.length, candidate.pages.length)
  for (let index = 0; index < pages; index += 1) {
    const expected = reference.pages[index]!
    const actual = candidate.pages[index]!
    if (expected.width !== actual.width || expected.height !== actual.height) {
      differences.push({
        page: index + 1,
        what: 'page-size',
        detail: 'page dimensions differ',
        expected: `${expected.width}x${expected.height} pts`,
        actual: `${actual.width}x${actual.height} pts`,
      })
    }
    const expectedWords = withoutIgnoredScripts(expected.words, ignored)
    const actualWords = withoutIgnoredScripts(actual.words, ignored)
    const length = Math.max(expectedWords.length, actualWords.length)
    for (let word = 0; word < length; word += 1) {
      if (expectedWords[word] === actualWords[word]) continue
      differences.push({
        page: index + 1,
        what: 'content',
        detail:
          actualWords[word] === undefined
            ? `content is missing from word ${word + 1}`
            : expectedWords[word] === undefined
              ? `content is additional from word ${word + 1}`
              : `content differs at word ${word + 1}`,
        expected: around(expectedWords, word),
        actual: around(actualWords, word),
      })
      break
    }
  }
  return differences
}

export function describePdfDifferences(
  differences: readonly PdfDifference[],
): string {
  if (differences.length === 0) return 'no differences'
  return differences
    .map((difference) => {
      const where = difference.page === null ? 'document' : `page ${difference.page}`
      const detail = `${where}: ${difference.what} — ${difference.detail}`
      return difference.expected === undefined
        ? detail
        : `${detail}\n    print: ${difference.expected}\n    docx:  ${difference.actual}`
    })
    .join('\n')
}
