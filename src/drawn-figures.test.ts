import { describe, expect, test } from 'bun:test'
import { drawnFigures, type DrawnPath, type Words } from './drawn-figures'
import type { PageBox } from './picture-rules'

const box = (left: number, top: number, right: number, bottom: number): PageBox => ({ left, top, right, bottom })
const path = (left: number, top: number, right: number, bottom: number, curves = 0): DrawnPath => ({
  box: box(left, top, right, bottom),
  curves,
  diagonals: 0,
  straights: curves ? 0 : 1,
  stroked: true,
})
/** A straight bond between two points, slanted unless level or plumb. */
const bond = (x0: number, y0: number, x1: number, y1: number): DrawnPath => {
  const level = Math.abs(y1 - y0) < 1 || Math.abs(x1 - x0) < 1
  return {
    box: box(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)),
    curves: 0,
    diagonals: level ? 0 : 1,
    straights: level ? 1 : 0,
    stroked: true,
  }
}
/** A closed box of level and plumb sides, its corners rounded or not. */
const frame = (left: number, top: number, right: number, bottom: number, corners = 0): DrawnPath => ({
  box: box(left, top, right, bottom),
  curves: corners,
  diagonals: 0,
  straights: 4,
  stroked: true,
})
/** A letter of a font saved as outlines: a small filled shape. */
const letter = (left: number, top: number): DrawnPath => ({
  box: box(left, top, left + 6, top + 9),
  curves: 12,
  diagonals: 2,
  straights: 3,
  stroked: false,
})
const words = (left: number, top: number, right: number, bottom: number, text?: string): Words => ({
  ...box(left, top, right, bottom),
  ...(text !== undefined && { text }),
})

/** A graph: two axes and a curve, three paths that touch. */
const graph = (left: number, top: number): DrawnPath[] => [
  path(left, top + 150, left + 300, top + 152),
  path(left, top, left + 2, top + 150),
  path(left + 20, top + 10, left + 280, top + 140, 40),
]

/** A zigzag of straight bonds, as a skeletal formula draws a chain. */
const chain = (left: number, top: number, bonds: number): DrawnPath[] =>
  Array.from({ length: bonds }, (_, index) =>
    bond(left + index * 19, top + (index % 2 ? 0 : 10), left + (index + 1) * 19, top + (index % 2 ? 10 : 0)),
  )

/** A level reaction arrow: a shaft and a head. */
const arrow = (left: number, top: number): DrawnPath[] => [
  path(left, top + 4, left + 50, top + 5),
  { box: box(left + 40, top, left + 52, top + 5), curves: 1, diagonals: 1, straights: 0, stroked: true },
]

describe('figures drawn with lines', () => {
  test('are the paths that touch, as one box', () => {
    expect(drawnFigures(graph(200, 100), [], [])).toEqual([box(200, 100, 500, 252)])
  })

  test('stay apart when their drawings do not touch', () => {
    expect(drawnFigures([...graph(200, 100), ...graph(200, 300)], [], [])).toHaveLength(2)
  })

  test('span a frame that only clips them', () => {
    // A browser clips an SVG to its frame: the frame paints nothing, and
    // counts as no curves, but the figure is as big as it.
    const clip = { ...path(180, 80, 520, 300), straights: 0, stroked: false }
    expect(drawnFigures([...graph(200, 100), clip], [], [])).toEqual([box(180, 80, 520, 300)])
  })

  test('are not stacked rows, boxes or rules, which are level and plumb lines', () => {
    const rows = [frame(100, 500, 400, 530), frame(100, 530, 400, 560), frame(100, 560, 400, 590)]
    const rule = path(50, 950, 950, 952)
    const blank = path(400, 640, 480, 641)
    const roundedBox = frame(100, 700, 400, 800, 4)
    const answerBox = frame(600, 700, 700, 760, 8)
    expect(drawnFigures([...rows, rule, blank, roundedBox, answerBox], [words(610, 745, 650, 755, 'pH')], [])).toEqual(
      [],
    )
  })

  test('include a table, told by its cells', () => {
    const cells = [0, 1, 2].flatMap((row) =>
      [0, 1, 2].map((column) => frame(100 + column * 80, 500 + row * 30, 180 + column * 80, 530 + row * 30)),
    )
    expect(drawnFigures(cells, [], [])).toEqual([box(100, 500, 340, 590)])
  })

  test('include a grid ruled with dashes drawn one by one', () => {
    const dashed = (from: number, to: number, place: (at: number) => DrawnPath) =>
      Array.from({ length: Math.floor((to - from) / 10) }, (_, at) => place(from + at * 10))
    const across = [500, 530, 560, 590].flatMap((y) => dashed(100, 340, (x) => path(x, y, x + 6, y)))
    const down = [100, 180, 260, 340].flatMap((x) => dashed(500, 590, (y) => path(x, y, x, y + 6)))
    expect(drawnFigures([...across, ...down], [], [])).toEqual([box(100, 500, 340, 590)])
  })

  test('keep apart tables set one under another, as answer choices', () => {
    const table = (top: number) =>
      [0, 1].flatMap((row) =>
        [0, 1, 2].map((column) => frame(100 + column * 80, top + row * 30, 180 + column * 80, top + 30 + row * 30)),
      )
    expect(drawnFigures([...table(500), ...table(567)], [], [])).toEqual([
      box(100, 500, 340, 560),
      box(100, 567, 340, 627),
    ])
  })

  test('include an area model: a square divided by lines, a cell shaded, braces and labels beside it', () => {
    const square = frame(300, 700, 480, 840)
    const shaded = { ...frame(420, 700, 455, 770), stroked: false }
    const lines = [349, 385, 420, 455].map((x) => path(x, 700, x, 840))
    const half = path(300, 770, 480, 770)
    const braces = [
      { ...path(290, 700, 298, 840, 4), straights: 2 },
      { ...path(300, 690, 480, 697, 4), straights: 2 },
    ]
    const ones = [words(282, 765, 287, 775, '1'), words(388, 678, 392, 688, '1')]
    expect(drawnFigures([square, shaded, ...lines, half, ...braces], ones, [])).toEqual([box(282, 678, 480, 840)])
  })

  test('are not an empty box with words in it, or a row of ovals to fill in', () => {
    const answer = frame(100, 100, 400, 200, 8)
    const ovals = [0, 1, 2, 3, 4].map((at) => ({ ...path(200 + at * 40, 500, 226 + at * 40, 516, 32), straights: 2 }))
    const scale = [words(150, 502, 180, 514, 'Not'), words(410, 502, 470, 514, 'Very')]
    expect(drawnFigures([answer, ...ovals], [words(120, 150, 200, 162, 'pH 3.87'), ...scale], [])).toEqual([])
  })

  test('are a structure of straight bonds, joined through the atom label between them', () => {
    // An ester: a chain, its O as text, and the chain beyond it, with no
    // curves at all.
    const left = chain(200, 300, 3)
    const oxygen = words(259, 300, 268, 310, 'O')
    const right = chain(270, 300, 2)
    expect(drawnFigures([...left, ...right], [oxygen], [])).toEqual([box(200, 300, 308, 310)])
  })

  test('include a small structure once its label is on it', () => {
    // Two bonds and an “OH”: about 55 by 15 with its label. One bond is not
    // a structure.
    const ethanol = chain(500, 400, 2)
    expect(drawnFigures(ethanol, [words(540, 404, 556, 415, 'OH')], [])).toEqual([box(500, 400, 556, 415)])
    expect(drawnFigures(chain(500, 400, 1), [words(520, 404, 536, 415, 'OH')], [])).toEqual([])
  })

  test('include a chair, whose bonds slant and whose box is short', () => {
    const chair = [
      bond(162, 592, 176, 578),
      bond(162, 592, 190, 598),
      bond(190, 598, 218, 592),
      bond(218, 592, 233, 578),
      bond(233, 578, 205, 584),
      bond(205, 584, 176, 578),
    ]
    expect(drawnFigures(chair, [], [])).toEqual([box(162, 578, 233, 598)])
  })

  test('are not a stray tick or a glyph-sized scribble', () => {
    expect(drawnFigures([bond(100, 100, 108, 106), bond(108, 106, 115, 100)], [], [])).toEqual([])
    expect(drawnFigures([path(100, 100, 115, 108, 20)], [], [])).toEqual([])
  })

  test('are not a lone arrow', () => {
    expect(drawnFigures(arrow(500, 300), [], [])).toEqual([])
  })

  test('include points plotted as filled dots, but not words saved as letter outlines', () => {
    const dots = [0, 1, 2, 3, 4].map((at) => ({
      ...path(230 + at * 50, 230 - at * 25, 234 + at * 50, 234 - at * 25, 4),
      stroked: false,
    }))
    const axes = [path(200, 250, 500, 252), path(200, 100, 202, 250)]
    const heading = Array.from({ length: 30 }, (_, at) => letter(200 + at * 7, 50))
    expect(drawnFigures([...axes, ...dots, ...heading], [], [])).toEqual([box(200, 100, 500, 252)])
  })

  test('find a structure inside a question’s frame, not the frame and everything in it', () => {
    const card = frame(100, 100, 900, 500, 16)
    const question = Array.from({ length: 60 }, (_, at) => letter(150 + at * 7, 150))
    const radio = path(150, 250, 170, 268, 4)
    const answer = frame(200, 240, 450, 280, 16)
    const choice = Array.from({ length: 6 }, (_, at) => letter(220 + at * 7, 255))
    const structure = chain(600, 300, 4)
    expect(drawnFigures([card, ...question, radio, answer, ...choice, ...structure], [], [])).toEqual([
      box(600, 300, 676, 310),
    ])
  })

  test('are not a dashed answer box, or a drawn asterisk beside a word', () => {
    const dashed = { box: box(165, 632, 862, 925), curves: 24, diagonals: 18, straights: 1356, stroked: false }
    const asterisk = [bond(732, 29, 744, 34), bond(732, 34, 744, 29), path(732, 31, 744, 32)]
    expect(drawnFigures([dashed, ...asterisk], [words(757, 26, 831, 37, 'Required')], [])).toEqual([])
  })

  test('make one figure of a reaction joined by a plus sign and an arrow', () => {
    const first = chain(200, 300, 3)
    const plus = words(285, 300, 295, 310, '+')
    const second = chain(330, 300, 3)
    const product = words(470, 299, 480, 311, '?')
    expect(drawnFigures([...first, ...second, ...arrow(410, 302)], [plus, product], [])).toEqual([
      box(200, 299, 480, 311),
    ])
  })

  test('make one figure of a reaction written with typed structures and a drawn arrow', () => {
    const ammonia = words(200, 300, 260, 312, 'H–N–H')
    const plus = words(280, 300, 290, 312, '+')
    const methanol = words(310, 300, 380, 312, 'H–O–CH3')
    expect(drawnFigures(arrow(400, 303), [ammonia, plus, methanol], [])).toEqual([box(200, 300, 452, 312)])
  })

  test('keep apart two structures set beside each other with “vs.”', () => {
    const left = chain(200, 600, 4)
    const versus = words(330, 598, 350, 610, 'vs.')
    const right = chain(415, 600, 4)
    expect(drawnFigures([...left, ...right], [versus], [])).toEqual([box(200, 600, 276, 610), box(415, 600, 491, 610)])
  })

  test('are not lines drawn over an embedded image', () => {
    expect(drawnFigures(graph(200, 100), [], [box(190, 90, 510, 260)])).toEqual([])
  })

  test('take in the labels that sit on them, but not the question beside them', () => {
    const ticks = [box(215, 254, 225, 262), box(365, 254, 375, 262)]
    const axisTitle = box(300, 263, 400, 275)
    const sidewaysTitle = box(188, 150, 198, 220)
    const question = box(100, 85, 900, 97)
    expect(drawnFigures(graph(200, 100), [axisTitle, question, ...ticks, sidewaysTitle], [])).toEqual([
      box(188, 100, 500, 275),
    ])
  })
})
