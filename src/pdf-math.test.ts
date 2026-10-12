import { describe, expect, test } from 'bun:test'
import { mathJaxTools } from './mathjax'
import { mathText, pathSteps, typesetMath, type MathMark, type TypesetMath } from './pdf-math'

const tools = await mathJaxTools()

function typeset(source: string, display = false): TypesetMath {
  const result = typesetMath(tools, source, display)
  if (!result) throw new Error(`MathJax could not typeset ${source}`)
  return result
}

/** A mark's points in the equation's own coordinates: ems, `y` up. */
function pointsOf(mark: MathMark): [number, number][] {
  if (mark.kind === 'text') return [[mark.matrix[4], mark.matrix[5]]]
  return mark.path.flatMap((step) => {
    if (step.op === 'close') return []
    const [x, y] = step.to
    return [[
      mark.matrix[0] * x + mark.matrix[2] * y + mark.matrix[4],
      mark.matrix[1] * x + mark.matrix[3] * y + mark.matrix[5],
    ] as [number, number]]
  })
}

function verticalExtent(mark: MathMark): { bottom: number; top: number } {
  const ys = pointsOf(mark).map(([, y]) => y)
  return { bottom: Math.min(...ys), top: Math.max(...ys) }
}

describe('SVG path data', () => {
  test('reads every step as absolute, lines for H and V', () => {
    expect(pathSteps('M10 20H30V40l5 5Z')).toEqual([
      { op: 'move', to: [10, 20] },
      { op: 'line', to: [30, 20] },
      { op: 'line', to: [30, 40] },
      { op: 'line', to: [35, 45] },
      { op: 'close' },
    ])
  })

  // MathJax's glyphs are quadratic outlines written with `T`. A `T` reflects
  // the control point of the curve before it; drawn without that, a C or an m
  // came out with stray strokes across it.
  test('reflects the control point a smooth quadratic curve continues', () => {
    expect(pathSteps('M0 0Q10 10 20 0T40 0')).toEqual([
      { op: 'move', to: [0, 0] },
      { op: 'quadratic', control: [10, 10], to: [20, 0] },
      { op: 'quadratic', control: [30, -10], to: [40, 0] },
    ])
    // After anything but a quadratic, the control point is the current one.
    expect(pathSteps('M0 0L20 0T40 0')[2]).toEqual({ op: 'quadratic', control: [20, 0], to: [40, 0] })
  })

  test('reads pairs after a move as lines, and negative numbers without spaces', () => {
    expect(pathSteps('M0 0 10-5 20-10')).toEqual([
      { op: 'move', to: [0, 0] },
      { op: 'line', to: [10, -5] },
      { op: 'line', to: [20, -10] },
    ])
  })
})

describe('Typeset mathematics', () => {
  // A PDF printed `3⁄5+4⁄15` for a stacked sum of fractions.
  test('stacks a fraction: its numerator above the bar, its denominator below', () => {
    const fraction = typeset('\\frac{3}{5}')
    const glyphs = fraction.marks.filter((mark) => mark.kind === 'fill' && mark.path.length > 5)
    const bar = fraction.marks.find((mark) => mark.kind === 'fill' && mark.path.length === 5)!
    expect(glyphs).toHaveLength(2)
    expect(bar).toBeDefined()
    const [numerator, denominator] = glyphs.map(verticalExtent)
    const rule = verticalExtent(bar)
    expect(numerator!.bottom).toBeGreaterThan(rule.top)
    expect(denominator!.top).toBeLessThan(rule.bottom)
    expect(fraction.ascent).toBeGreaterThan(numerator!.top - 0.01)
    expect(fraction.descent).toBeGreaterThan(-denominator!.bottom - 0.01)
  })

  // The same PDF wrote `−0.overline3` for a repeating decimal.
  test('draws a repeating decimal’s bar above its repeating digit', () => {
    const decimal = typeset('0.\\overline{3}')
    const [three, bar] = decimal.marks.slice(-2)
    const digit = pointsOf(three!)
    const over = pointsOf(bar!)
    expect(Math.min(...over.map(([, y]) => y))).toBeGreaterThan(Math.max(...digit.map(([, y]) => y)))
    expect(Math.min(...over.map(([x]) => x))).toBeGreaterThanOrEqual(Math.min(...digit.map(([x]) => x)) - 0.1)
    expect(Math.max(...over.map(([x]) => x))).toBeLessThanOrEqual(Math.max(...digit.map(([x]) => x)) + 0.1)
  })

  // A bar over more than one letter is a glyph stretched in a box that hides
  // the rest of it; drawn unclipped, it ran on over what followed.
  test('cuts a stretched bar to the letters it spans', () => {
    const segment = typeset('\\overline{AB}')
    const bar = segment.marks.find((mark) => mark.clips.length > 0)!
    expect(bar).toBeDefined()
    const letters = segment.marks.filter((mark) => mark.clips.length === 0).flatMap(pointsOf)
    const clipped = bar.clips[0]!.map(([x]) => x)
    expect(Math.min(...clipped)).toBeGreaterThanOrEqual(Math.min(...letters.map(([x]) => x)) - 0.1)
    expect(Math.max(...clipped)).toBeLessThanOrEqual(segment.width + 0.01)
  })

  // `\color` is a switch, as in TeX and KaTeX: it colours what follows it in its group.
  test('keeps a colour, and inks everything else', () => {
    const coloured = typeset('{\\color{red} 7} + 1')
    expect(coloured.marks.map((mark) => mark.color)).toContain('red')
    expect(coloured.marks.filter((mark) => mark.color === 'currentColor').length).toBeGreaterThan(0)
  })

  test('measures a display fraction taller than an inline one', () => {
    const inline = typeset('\\frac{1}{2}')
    const display = typeset('\\frac{1}{2}', true)
    expect(display.ascent + display.descent).toBeGreaterThan(inline.ascent + inline.descent)
  })

  // MathJax 3.2 throws on some characters it has no operator entry for; the
  // adapter writes such an equation on the line instead.
  test('gives nothing for an equation MathJax cannot typeset', () => {
    expect(typesetMath(tools, '€', false)).toBeNull()
  })
})

describe('Written mathematics', () => {
  test('writes accents, boxes and colours as what they mark', () => {
    expect(mathText('-0.\\overline{3}')).toBe('−0.3')
    expect(mathText('\\boxed{42}')).toBe('42')
    expect(mathText('\\color{red}{7}')).toBe('7')
    expect(mathText('\\triangle ABC \\cong \\triangle DEF')).toBe('△ ABC ≅ △ DEF')
  })
})
