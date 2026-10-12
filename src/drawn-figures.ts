import { isPicture, type PageBox } from './picture-rules'

/**
 * A picture drawn with lines rather than stored as an image: a graph or a
 * structure that a browser or a chemistry program saved as a PDF keeps as the
 * paths it drew. Nothing in the PDF says where such a picture is, so it is
 * found from the ink. Paths that touch are one drawing, and the short words on
 * it — axis labels, atom symbols — are part of it, so a label set between two
 * bonds joins them; letters of a font saved as outlines are words too. A
 * drawing is a figure when it has the curves of a graph or the slanted lines
 * of a structure, which the level and plumb lines of a rule, a table or an
 * answer box do not have; a table is told by its cells.
 * Molecules in one reaction, joined by an arrow or a plus sign, are one
 * figure. When in doubt drawings stay apart: an assistant can set two tags
 * side by side, but cannot split one.
 */

/** One painted path: where it lands, how many curves it has, how many of its
 *  straight lines slant or run level or plumb, and whether it is stroked as a
 *  line rather than only filled as a shape. */
export type DrawnPath = { box: PageBox; curves: number; diagonals: number; straights: number; stroked: boolean }

/** Where a run of the page's text, or a mark painted like one, lands, and
 *  what it says when that is known. */
export type Words = PageBox & { text?: string }

/** A path this wide is a rule across the page, such as a header's. */
const PAGE_RULE = 800
/** Paths, and the words on them, this close are one drawing. */
const TOUCHING = 8
/** A graph's plotted line has dozens of curves; a circle has four. */
const MIN_CURVES = 10
/** The smallest structure, two bonds and an atom label, has two slanted
 *  lines; a rule, a table or a box has none. */
const MIN_DIAGONALS = 2
/** Level and plumb lines this close meet, as a table's rules do. */
const MEETING = 3
/** A path this thin is one line. */
const THIN = 2
/** A filled shape no larger than this is the size of a letter. */
const GLYPH = 15
/** A radio button, check box or oval to fill in is no larger than this; a
 *  structure's ring is larger, and has slanted bonds besides. */
const CONTROL = 40
/** A drawing whose lines reach no further than this is an icon or a drawn
 *  character, such as a menu's arrow or an asterisk; the smallest structure's
 *  bonds span about 35. */
const ICON = 30
/** A letter's neighbours in a word are this close; a dot has none. */
const LETTER_GAP = 3
/** A dot is about as wide as it is tall: within this of a log ratio of 0. */
const ROUND = 0.25
/** A box with this many lines or shaded cells reaching its sides is divided
 *  into a diagram; one line could be a form's header rule. */
const DIVISIONS = 2
/** Words this close along a line are one phrase. */
const WORD_GAP = 10
/** A phrase wider than this is a line of the question, not a label: the
 *  widest label measured, a pKa beside a structure, is about 100. */
const LABEL_WIDTH = 120
/** A figure smaller than this is a stray mark; the smallest structure
 *  measured, two bonds and “OH”, is about 55 by 14. An embedded image has a
 *  larger minimum, since a small one is an equation. */
const MIN_WIDTH = 25
const MIN_HEIGHT = 10
/** A figure covering this share of the page or more is the page's frame. */
const FULL_PAGE = 0.7
/** A reaction's molecules sit no further than this from its arrow or plus. */
const REACTION_GAP = 80
/** An arrow is a level shaft this share of its width, with a head. */
const ARROW_SHAFT = 0.6
/** A reaction arrow, even an equilibrium's pair, is no taller than this. */
const ARROW_HEIGHT = 20
const ARROW_TEXT = /^[→⟶⇌⇄⇋↔⟷]$/

const overlaps = (a: PageBox, b: PageBox, gap = 0) =>
  a.left - gap < b.right && b.left - gap < a.right && a.top - gap < b.bottom && b.top - gap < a.bottom

const union = (a: PageBox, b: PageBox): PageBox => ({
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
})

const widthOf = (box: PageBox) => box.right - box.left
const heightOf = (box: PageBox) => box.bottom - box.top
const spanOf = (box: PageBox) => Math.max(widthOf(box), heightOf(box))

const isRule = (path: DrawnPath) =>
  !path.diagonals && !path.curves && Math.min(widthOf(path.box), heightOf(path.box)) <= THIN
/** A box has level and plumb sides, whatever curves round its corners — a
 *  form's answer box can have sixteen — and almost nothing slanted: a dashed
 *  one's dashes at its corners, a few in a thousand. */
const isBox = (path: DrawnPath) => path.straights >= 3 && path.diagonals * 20 <= path.straights && !isRule(path)
/** A path that only clips, which paints nothing. */
const isClip = (path: DrawnPath) => !path.curves && !path.diagonals && !path.straights
/** A form's control, or a piece of one: a small shape with nothing slanted. */
const isControl = (path: DrawnPath) => !path.diagonals && spanOf(path.box) <= CONTROL
/** A filled shape no bigger than a letter. */
const isGlyph = (path: DrawnPath) => !path.stroked && spanOf(path.box) <= GLYPH

/** Merges sets of indexes, each named by its smallest member. */
function disjointSets(size: number) {
  const parent = Array.from({ length: size }, (_, index) => index)
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index]!)))
  const join = (a: number, b: number) => {
    const [low, high] = [find(a), find(b)].sort((x, y) => x - y) as [number, number]
    parent[high] = low
  }
  const groups = <T>(items: readonly T[]) => {
    const byRoot = new Map<number, T[]>()
    items.forEach((item, index) => byRoot.set(find(index), [...(byRoot.get(find(index)) ?? []), item]))
    return [...byRoot.values()]
  }
  return { join, groups }
}

/** Words, or letters painted as filled shapes, counted in `shapes`. */
type Phrase = Words & { shapes?: number }

/** Words that run on along one line, as phrases: a label's pieces, such as
 *  “pK”, “a” and “= 4.2”, or a line of the question. */
function phrasesOf(words: readonly Phrase[]): Phrase[] {
  const phrases: Phrase[] = []
  const sorted = [...words].sort((a, b) => a.left - b.left || a.top - b.top)
  for (const word of sorted) {
    const phrase = phrases.find((phrase) => {
      const shared = Math.min(phrase.bottom, word.bottom) - Math.max(phrase.top, word.top)
      return (
        word.left - phrase.right <= WORD_GAP &&
        word.left >= phrase.left &&
        shared >= 0.4 * Math.min(heightOf(phrase), heightOf(word))
      )
    })
    if (!phrase) phrases.push({ ...word })
    else {
      Object.assign(phrase, union(phrase, word))
      phrase.text = phrase.text === undefined || word.text === undefined ? undefined : `${phrase.text} ${word.text}`
      phrase.shapes = (phrase.shapes ?? 0) + (word.shapes ?? 0)
    }
  }
  return phrases
}

/** A drawing and the labels on it, or labels on nothing. */
type Part = { paths: DrawnPath[]; labels: Phrase[]; box: PageBox }

/** Whether a part is only rules and boxes, and whether its rules and boxes
 *  make a table — at least three edges across and three down — or divide a
 *  box into a diagram. */
function frameOf({ paths }: Part): { frame: boolean; table: boolean } {
  const painted = paths.filter((path) => !isClip(path))
  const straight = painted.filter((path) => isRule(path) || isBox(path))
  const across: number[] = []
  const down: number[] = []
  for (const { box } of straight) {
    if (widthOf(box) > THIN) down.push(box.top, ...(heightOf(box) > THIN ? [box.bottom] : []))
    if (heightOf(box) > THIN) across.push(box.left, ...(widthOf(box) > THIN ? [box.right] : []))
  }
  const distinct = (edges: number[]) =>
    edges.sort((a, b) => a - b).filter((edge, index) => index === 0 || edge - edges[index - 1]! > THIN).length
  // A box divided from side to side, or with a cell shaded in a corner, is a
  // diagram, such as an area model; a box's own fill is not a division.
  const divided = straight.some(
    (outer) =>
      isBox(outer) && straight.filter((inner) => inner !== outer && divides(inner.box, outer.box)).length >= DIVISIONS,
  )
  return {
    frame: painted.length > 0 && straight.length === painted.length,
    table: (distinct(across) >= 3 && distinct(down) >= 3) || divided,
  }
}

/** Whether `inner` lies within `outer` and reaches one or two of its
 *  sides: a dividing line or a shaded cell, not a box drawn over it. */
function divides(inner: PageBox, outer: PageBox): boolean {
  const within =
    inner.left >= outer.left - THIN &&
    inner.right <= outer.right + THIN &&
    inner.top >= outer.top - THIN &&
    inner.bottom <= outer.bottom + THIN
  const sides = [
    Math.abs(inner.left - outer.left),
    Math.abs(inner.right - outer.right),
    Math.abs(inner.top - outer.top),
    Math.abs(inner.bottom - outer.bottom),
  ].filter((gap) => gap <= THIN).length
  // A line along one of the box's sides is its border, drawn separately.
  const border =
    (heightOf(inner) <= THIN && (inner.top <= outer.top + THIN || inner.bottom >= outer.bottom - THIN)) ||
    (widthOf(inner) <= THIN && (inner.left <= outer.left + THIN || inner.right >= outer.right - THIN))
  return within && !border && sides >= 1 && sides <= 2
}

/** Whether a part is a reaction arrow: a level shaft most of its width, with
 *  a head, drawn or filled. */
function isArrow({ paths, labels }: Part): boolean {
  if (!paths.length) return labels.length === 1 && ARROW_TEXT.test(labels[0]!.text ?? '')
  const ink = paths.map((path) => path.box).reduce(union)
  return (
    widthOf(ink) >= 3 * heightOf(ink) &&
    heightOf(ink) <= ARROW_HEIGHT &&
    (paths.some((path) => !isBox(path) && path.diagonals + path.curves > 0) ||
      labels.some((label) => label.shapes === 1)) &&
    paths.some((path) => isRule(path) && heightOf(path.box) <= THIN && widthOf(path.box) >= ARROW_SHAFT * widthOf(ink))
  )
}

const isPlus = ({ paths, labels }: Part) => !paths.length && labels.length === 1 && labels[0]!.text === '+'

/**
 * The figures drawn on a page, as boxes in no particular order. `words` is
 * where each run of the page's text, or mark painted like text, lands, and
 * `images` where its images are painted: a drawing over an image is part of
 * that image, not a figure.
 */
export function drawnFigures(
  paths: readonly DrawnPath[],
  words: readonly Words[],
  images: readonly PageBox[],
): PageBox[] {
  const drawn = paths.filter(({ box }) => widthOf(box) <= PAGE_RULE)
  // A font saved as outlines paints each letter as a small filled shape:
  // those are words, not drawing. A dot standing alone, such as a point on
  // a graph, is drawing.
  const glyphs = drawn.filter(isGlyph)
  const isDot = (path: DrawnPath) =>
    path.curves >= 4 &&
    !path.diagonals &&
    !path.straights &&
    Math.abs(Math.log(widthOf(path.box) / heightOf(path.box))) < ROUND &&
    !glyphs.some((other) => other !== path && overlaps(path.box, other.box, LETTER_GAP))
  const inked = drawn.filter((path) => !isGlyph(path) || isDot(path))
  const letters = glyphs.filter((path) => !isDot(path)).map((path) => ({ ...path.box, shapes: 1 }))
  // A line of the question beside a figure is not one of its labels.
  const labels = phrasesOf([...words, ...letters]).filter((phrase) => widthOf(phrase) <= LABEL_WIDTH)
  const boxes = [...inked.map((path) => path.box), ...labels]
  // What stands inside a box, clear of its sides, does not touch it: a
  // question's frame holds its words and its answers, not one drawing.
  const inside = (i: number, j: number) => {
    const frame = inked[i]
    if (!frame || !isBox(frame)) return false
    const within = boxes[j]!
    return (
      within.left > frame.box.left + THIN &&
      within.right < frame.box.right - THIN &&
      within.top > frame.box.top + THIN &&
      within.bottom < frame.box.bottom - THIN
    )
  }
  // A table's rules meet; two tables set one under the other, as answer
  // choices, only come close. A dashed line's dashes, being short, join as
  // any strokes do.
  const straight = (index: number) =>
    !!inked[index] && (isRule(inked[index]!) || isBox(inked[index]!)) && spanOf(boxes[index]!) > GLYPH
  const reach = (i: number, j: number) => (straight(i) && straight(j) ? MEETING : TOUCHING)
  const touching = disjointSets(boxes.length)
  for (let i = 0; i < boxes.length; i += 1)
    for (let j = i + 1; j < boxes.length; j += 1)
      if (overlaps(boxes[i]!, boxes[j]!, reach(i, j)) && !inside(i, j) && !inside(j, i)) touching.join(i, j)
  let parts: Part[] = touching.groups(boxes.map((box, index) => ({ box, path: inked[index] }))).map((members) => ({
    paths: members.flatMap(({ path }) => (path ? [path] : [])),
    labels: members.flatMap(({ box, path }) => (path ? [] : [box])),
    box: members.map(({ box }) => box).reduce(union),
  }))
  // Ink within another drawing's reach is part of it, as a graph's points
  // are of its axes, though they do not touch; a box reaches only its sides.
  for (let merged = true; merged; ) {
    const inks = parts.map(({ paths }) => {
      const ink = paths.filter((path) => !isBox(path))
      return ink.length ? ink.map((path) => path.box).reduce(union) : undefined
    })
    const within = disjointSets(parts.length)
    merged = false
    for (let i = 0; i < parts.length; i += 1)
      for (let j = i + 1; j < parts.length; j += 1)
        if (inks[i] && inks[j] && overlaps(inks[i]!, inks[j]!)) {
          within.join(i, j)
          merged = true
        }
    parts = within.groups(parts).map((group) => ({
      paths: group.flatMap((part) => part.paths),
      labels: group.flatMap((part) => part.labels),
      box: group.map((part) => part.box).reduce(union),
    }))
  }
  parts = parts.filter(({ paths }) => !paths.some(({ box }) => images.some((image) => overlaps(box, image))))

  const frames = parts.map(frameOf)
  const arrows = parts.map(isArrow)
  // What a reaction row can be made of: anything but an empty box or a bare
  // rule. Letters joined by drawn dashes, as in a typed Lewis structure, are
  // one.
  const items = parts.map(({ labels }, index) => !frames[index]!.frame || labels.length > 0)
  const rows = disjointSets(parts.length)
  const neighbour = (of: number, side: 'left' | 'right') => {
    const connector = parts[of]!.box
    let nearest: number | undefined
    parts.forEach(({ box }, index) => {
      if (index === of || !items[index] || box.top >= connector.bottom || connector.top >= box.bottom) return
      const gap = side === 'left' ? connector.left - box.right : box.left - connector.right
      if (gap < -TOUCHING || gap > REACTION_GAP) return
      const best = nearest === undefined ? undefined : parts[nearest]!.box
      if (!best || (side === 'left' ? box.right > best.right : box.left < best.left)) nearest = index
    })
    return nearest
  }
  parts.forEach((part, index) => {
    if (!arrows[index] && !isPlus(part)) return
    const sides = [neighbour(index, 'left'), neighbour(index, 'right')]
    // A plus sign joins only what stands on both sides of it.
    if (!arrows[index] && sides.includes(undefined)) return
    for (const side of sides) if (side !== undefined) rows.join(index, side)
  })

  const figures: Part[][] = []
  for (const row of rows.groups(parts.map((part, index) => ({ part, index })))) {
    const drawings = row.filter(({ part }) => part.paths.length > 0)
    // A reaction is an arrow and what it joins, or a plus sign between two
    // drawings; otherwise each part stands on its own.
    const reaction =
      drawings.length > 0 && row.length > 1 && (row.some(({ index }) => arrows[index]) || drawings.length >= 2)
    if (reaction) {
      figures.push(row.map(({ part }) => part))
      continue
    }
    for (const { part, index } of row) {
      const { frame, table } = frames[index]!
      const curves = part.paths.filter((path) => !isBox(path)).reduce((sum, path) => sum + path.curves, 0)
      const diagonals = part.paths.filter((path) => !isBox(path)).reduce((sum, path) => sum + path.diagonals, 0)
      const painted = part.paths.filter((path) => !isClip(path))
      if (!painted.length || arrows[index] || (frame && !table)) continue
      // A drawn icon, asterisk or tick, even on a box, is a character, not a
      // figure; a small filled shape, such as a page's arrow, reaches no
      // further than itself.
      const lines = painted.filter((path) => !isBox(path))
      const reaching = lines.filter((path) => path.stroked || spanOf(path.box) > CONTROL)
      const ink = reaching.length ? reaching.map((path) => path.box).reduce(union) : undefined
      if (!table && (!ink || spanOf(ink) <= ICON)) continue
      // Strokes no longer than a letter's, such as a triangle sign drawn in
      // a line of text, are characters however far apart they stand.
      if (!table && lines.every((path) => spanOf(path.box) <= GLYPH)) continue
      // Radio buttons, check boxes and ovals to fill in are small closed
      // shapes with nothing slanted, alone or in a row: a choice list.
      if (!table && painted.every(isControl)) continue
      if (curves >= MIN_CURVES || diagonals >= MIN_DIAGONALS || table) figures.push([part])
    }
  }
  return figures.flatMap((figure) => {
    const box = figure.map((part) => part.box).reduce(union)
    // Only filled shapes, such as a heading's letters saved as outlines, are
    // held to an image's minimum size.
    const stroked = figure.some((part) => part.paths.some((path) => path.stroked))
    const small = widthOf(box) < MIN_WIDTH || heightOf(box) < MIN_HEIGHT
    const big = stroked ? !small && (widthOf(box) * heightOf(box)) / 1_000_000 < FULL_PAGE : isPicture(box)
    return big ? [box] : []
  })
}
