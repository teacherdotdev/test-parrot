// The real `Measure` the app hands to `planExport`, as opposed to the stubs
// tests inject (see `export-plan.ts`'s `unmeasured` and the hand-built
// `Measure`s in `export-plan.test.ts`). Both halves work the same way: ask the
// browser what the real thing comes out as, off-screen, and hand back a number.
//
// `itemHeight` (#7) needs layout, not text metrics: a page item's height is the
// height of its rich text, its images and its choice grid once they are laid out
// at the page's content width. So it renders the item — through
// `PageItemMeasureView`, the very components `exam-page.tsx` draws on screen —
// into one reused off-screen host sized to the page's content width — today's
// `PAGE_CONTENT_WIDTH`, or what an Exam's own margins leave — and measures the
// host.
//
// Two things about that host matter and are easy to undo by accident:
//
//   - It is `display: flow-root` (see `.measure-host` in styles.css), so a top
//     item margin is contained rather than collapsing out of the host and going
//     unmeasured.
//   - Page items must keep a zero top margin, since each one is measured alone
//     and the heights are then summed. Bottom margins are what separates them.
//
// This is the one place in the app that reads a layout property, and it is why
// `planExport` never has to: everything downstream of `Measure` is arithmetic.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  PAGE_CONTENT_WIDTH,
  type ItemLayout,
  type Measure,
  type PageItem,
  type PlannedBankAnswer,
  type PlannedChoice,
} from './export-plan'
import { BODY_PX, TITLE_LINE_HEIGHT, TITLE_PX } from './export-typography'
import { BankAnswer, ChoiceGridView, PageItemMeasureView } from './page-item-view'
import type { HeadingSize, TextSize } from './section-headings'
import type { ProseMirrorJSON } from './question-doc'

let host: HTMLElement | null | undefined

// Lazy and cached, like the canvas above: one host for the process, appended
// once and reused for every measurement. It carries `.exam-page` so the item
// inherits exactly the typography it will print in; `.measure-host` overrides
// the page's own size and position and takes it out of sight.
function measureHost(): HTMLElement | null {
  if (host === undefined) {
    if (typeof document === 'undefined') {
      host = null
    } else {
      host = document.createElement('div')
      host.className = 'exam-page measure-host'
      host.setAttribute('aria-hidden', 'true')
      document.body.appendChild(host)
    }
  }
  return host
}

// Heights already found, keyed by the exact markup they were found for.
//
// The key is the rendered markup itself, which is the whole of what decides a
// height once the width and the typography are fixed — so a hit cannot be a
// wrong answer the way a hand-picked key (id, or content minus some field
// thought not to matter) could be.
//
// This is what makes reordering cheap. Shuffling or dragging changes which
// items sit where, not what any of them contains, so all but the handful whose
// printed number changed hit the cache and never touch layout at all.
const heights = new Map<string, number>()

// Big enough for a long exam's items several times over, small enough that an
// afternoon of editing cannot grow it without bound.
const HEIGHT_CACHE_LIMIT = 600

// Static markup rather than a React root: measurement is a synchronous question
// asked from inside another component's effect, and a second root rendering
// there would be fighting React's own scheduling for no gain — nothing in a
// measured item is interactive or stateful.
//
// The host carries the Exam's text size and Paper Style exactly as a page's
// content does, and is as wide as the page's margins leave — the width packing
// hands over, so the width an item is measured at is by construction the width
// it is packed against. All three are part of what a height is remembered by.
function itemHeight(item: PageItem, layout: ItemLayout = {}): number {
  const element = measureHost()
  if (!element) return 0
  const { textSize, paperStyle } = layout
  const width = layout.contentWidth ?? PAGE_CONTENT_WIDTH
  const markup = renderToStaticMarkup(createElement(PageItemMeasureView, { item }))
  const key = `${textSize ?? 'normal'}:${paperStyle ?? 'standard'}:${width}:${markup}`
  const remembered = heights.get(key)
  if (remembered !== undefined) return remembered
  element.style.width = `${width}px`
  element.style.fontSize = textSize && textSize !== 'normal' ? `${BODY_PX[textSize]}px` : ''
  if (paperStyle) element.dataset.paperStyle = paperStyle
  else delete element.dataset.paperStyle
  element.innerHTML = markup
  // Fractional, unlike `scrollHeight`: the heights of a dozen items are summed
  // against a fixed box, and a rounded pixel each would be a rounded page.
  const height = element.getBoundingClientRect().height
  // A picture whose bytes have not arrived measures as nothing. Its height is
  // an underestimate, so it is used — a page cannot wait — but never
  // remembered: remembered, it outlived the picture's arrival, and a page of
  // maps planned as a page of captions printed its questions off the sheet.
  const pending = [...element.querySelectorAll('img')].some((image) => !image.complete)
  if (pending) return height
  if (heights.size >= HEIGHT_CACHE_LIMIT) heights.clear()
  heights.set(key, height)
  return height
}

let naturalHost: HTMLElement | null | undefined

// A second host, as wide as what it holds rather than the page, for asking
// how wide an answer is when nothing makes it wrap.
function naturalMeasureHost(): HTMLElement | null {
  if (naturalHost === undefined) {
    if (typeof document === 'undefined') {
      naturalHost = null
    } else {
      naturalHost = document.createElement('div')
      naturalHost.className = 'exam-page measure-host measure-host--natural'
      naturalHost.setAttribute('aria-hidden', 'true')
      document.body.appendChild(naturalHost)
    }
  }
  return naturalHost
}

const widths = new Map<string, number>()

// An answer drawn alone in a one-cell choice grid, through the same component
// a page draws it with, on one line: the width that cell then takes, letter
// and padding included, is the least a column must give it. Remembered by its
// markup and size like a height, and never while a picture is still loading.
function choiceWidth(choice: PlannedChoice, textSize?: TextSize): number {
  const element = naturalMeasureHost()
  if (!element) return Infinity
  const markup = renderToStaticMarkup(
    createElement(ChoiceGridView, { grid: { columns: 1, rows: 1, cells: [[choice]] } }),
  )
  const key = `${textSize ?? 'normal'}:${markup}`
  const remembered = widths.get(key)
  if (remembered !== undefined) return remembered
  element.style.fontSize = textSize && textSize !== 'normal' ? `${BODY_PX[textSize]}px` : ''
  element.innerHTML = markup
  const grid = element.querySelector('.choice-grid')
  const width = grid ? grid.getBoundingClientRect().width : Infinity
  if ([...element.querySelectorAll('img')].some((image) => !image.complete)) return width
  if (widths.size >= HEIGHT_CACHE_LIMIT) widths.clear()
  widths.set(key, width)
  return width
}

// A Word Bank answer on one line, letter and all, through the component a page
// draws it with: the least a column beside the Items must give it. Remembered
// like an answer's width, and never while a picture is still loading.
function bankAnswerWidth(answer: PlannedBankAnswer, textSize?: TextSize): number {
  const element = naturalMeasureHost()
  if (!element) return Infinity
  const markup = renderToStaticMarkup(createElement(BankAnswer, { answer }))
  const key = `bank:${textSize ?? 'normal'}:${markup}`
  const remembered = widths.get(key)
  if (remembered !== undefined) return remembered
  element.style.fontSize = textSize && textSize !== 'normal' ? `${BODY_PX[textSize]}px` : ''
  element.innerHTML = markup
  const width = element.getBoundingClientRect().width
  if ([...element.querySelectorAll('img')].some((image) => !image.complete)) return width
  if (widths.size >= HEIGHT_CACHE_LIMIT) widths.clear()
  widths.set(key, width)
  return width
}

const titleLineCounts = new Map<string, number>()

// The Exam title set as a first page sets it, at the page's content width: how
// many of its lines it fills. The header the title sits in is laid out with
// its height released, so the title wraps as far as its words take it.
function titleLines(title: string, size: HeadingSize | undefined, width: number): number {
  const element = measureHost()
  if (!element || !title) return 1
  const px = TITLE_PX[size ?? 'normal']
  const key = `${px}:${width}:${title}`
  const remembered = titleLineCounts.get(key)
  if (remembered !== undefined) return remembered
  element.style.width = `${width}px`
  element.style.fontSize = ''
  delete element.dataset.paperStyle
  element.innerHTML =
    '<header class="page-header page-header--first" style="height: auto"><h1 class="exam-title"></h1></header>'
  const heading = element.querySelector('h1')!
  heading.style.fontSize = `${px}px`
  heading.textContent = title
  const lines = Math.max(1, Math.round(heading.getBoundingClientRect().height / (px * TITLE_LINE_HEIGHT)))
  if (titleLineCounts.size >= HEIGHT_CACHE_LIMIT) titleLineCounts.clear()
  titleLineCounts.set(key, lines)
  return lines
}

// Pictures already loaded or on their way, by source.
const loading = new Map<string, Promise<void>>()

/**
 * Load every picture in `sources`, so that a page measured afterwards measures
 * them at their real size. A picture this document has loaded is laid out at
 * its size the moment an `<img>` names it, which is what lets `itemHeight`
 * measure synchronously. A picture that fails to load is given up on rather
 * than waited for: it prints as nothing, and measures as nothing.
 */
function loadImages(sources: Iterable<string>): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve()
  const waits: Promise<void>[] = []
  for (const source of sources) {
    if (!source) continue
    let wait = loading.get(source)
    if (!wait) {
      const image = new Image()
      image.src = source
      // A failure is not remembered: a picture just imported may not be
      // servable yet, and is asked for again next time.
      wait = image.decode().catch(() => { loading.delete(source) })
      loading.set(source, wait)
    }
    waits.push(wait)
  }
  return Promise.all(waits).then(() => {})
}

// Throw the remembered heights away, for when the same markup would now measure
// differently: a web font has arrived, or an image has finished decoding and
// stopped measuring as nothing. Callers that re-measure on those events must
// call this first, or they will re-measure straight out of a stale cache.
function invalidate(): void {
  heights.clear()
  widths.clear()
  titleLineCounts.clear()
}

/** Every picture source in question documents, stems and answers alike. */
export function imageSourcesOfDocuments(documents: Iterable<ProseMirrorJSON | undefined>): string[] {
  const sources = new Set<string>()
  const visit = (node: ProseMirrorJSON) => {
    if (node.type === 'image' || node.type === 'image-block') {
      const src = (node.attrs as Record<string, unknown> | undefined)?.src
      if (typeof src === 'string' && src) sources.add(src)
    }
    if (Array.isArray(node.content)) for (const child of node.content as ProseMirrorJSON[]) visit(child)
  }
  for (const document of documents) if (document) visit(document)
  return [...sources]
}

export const domMeasure: Measure & {
  invalidate(): void
  loadImages(sources: Iterable<string>): Promise<void>
} = {
  itemHeight,
  choiceWidth,
  bankAnswerWidth,
  titleLines,
  invalidate,
  loadImages,
}
