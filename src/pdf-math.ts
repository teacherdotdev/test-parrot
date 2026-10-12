// Mathematics for the PDF Export Adapter.
//
// Print typesets an equation with KaTeX. The PDF draws the same equation from
// MathJax's typesetting of it (`typesetMath`): every glyph, fraction bar,
// radical and rule an outline, so a fraction stacks and a repeating decimal
// carries its bar as print shows them — a PDF printed `3⁄5+4⁄15` and
// `−0.overline3` when it wrote equations on a single line.
//
// The equation is also written on the line, invisibly, over what is drawn, so
// the PDF can be searched and copied from: a fraction as `a⁄b`, parenthesised
// where a term needs it, roots, raised and lowered scripts, relations,
// operators and Greek letters as their symbols, a minus sign as a minus sign,
// and the commands that only size what follows — `\left`, `\big` — dropped. It
// is school notation, not all of LaTeX: a command it does not know is written
// as its name, never with the backslash or the braces of its arguments. The
// same writing is drawn, visibly, for an equation MathJax cannot typeset.

import type { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js'
import type { MathJaxTools } from './mathjax'

/** A run of an equation: its text, its size relative to the text around it,
 *  and how far it is raised, in the same relative units. */
export type MathPiece = { text: string; scale: number; rise: number }

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗', circ: '∘',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', lt: '<', gt: '>',
  approx: '≈', sim: '∼', equiv: '≡', propto: '∝',
  infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒',
  Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', mapsto: '↦',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩',
  emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', neg: '¬',
  angle: '∠', triangle: '△', perp: '⊥', parallel: '∥', degree: '°',
  prime: '′', ldots: '…', cdots: '⋯', dots: '…', sum: '∑', prod: '∏',
  int: '∫', partial: '∂', nabla: '∇', lbrace: '{', rbrace: '}',
  langle: '⟨', rangle: '⟩', vert: '|', mid: '|', lvert: '|', rvert: '|',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  cong: '≅', ell: 'ℓ',
}

// Commands that print as their own name, upright, as KaTeX sets them.
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'sup',
  'inf', 'det', 'gcd', 'deg', 'mod',
])

// Commands that only size or style what follows them.
const IGNORED = new Set([
  'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr',
  'displaystyle', 'textstyle', 'limits', 'nolimits',
])

// Commands whose one argument is written as it is: words for the `text` ones,
// mathematics in a different face for the rest.
const WORDS = new Set(['text', 'textrm', 'textit', 'textbf', 'mbox'])
const FACES = new Set([
  'mathrm', 'mathit', 'mathbf', 'mathsf', 'mathtt', 'operatorname',
  'boldsymbol', 'mathbb', 'mathcal',
  // Accents, bars and boxes, which a line cannot draw over what they mark.
  'overline', 'underline', 'bar', 'vec', 'hat', 'widehat', 'tilde',
  'widetilde', 'dot', 'ddot', 'overrightarrow', 'overleftarrow',
  'overleftrightarrow', 'boxed', 'cancel', 'bcancel', 'xcancel',
])

// Commands whose first argument is a colour, not mathematics.
const COLOURS = new Set(['color', 'textcolor'])

const SPACES: Record<string, string> = {
  ',': ' ', ':': ' ', ';': ' ', ' ': ' ', '!': '', quad: '  ', qquad: '    ',
}

const FRACTIONS = new Set(['frac', 'dfrac', 'tfrac', 'cfrac'])

const SCRIPT_SCALE = 0.75
const RAISE = 0.35
const LOWER = -0.2

/** The balanced `{…}` group opening `source` at `start`, or undefined. */
function group(source: string, start: number): { inner: string; end: number } | undefined {
  if (source[start] !== '{') return undefined
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return { inner: source.slice(start + 1, index), end: index + 1 }
    }
  }
  return { inner: source.slice(start + 1), end: source.length }
}

/** One argument of a command: a braced group, or the single character or
 *  command at `start`. */
function argument(source: string, start: number): { inner: string; end: number } {
  let index = start
  while (source[index] === ' ') index += 1
  const braced = group(source, index)
  if (braced) return braced
  const command = /^\\(?:[A-Za-z]+|.)/.exec(source.slice(index))
  if (command) return { inner: command[0], end: index + command[0].length }
  return { inner: source[index] ?? '', end: Math.min(source.length, index + 1) }
}

/** Whether a term needs parentheses to stay one term once a fraction is
 *  written on a line: `(3x − 4)⁄(2x − 5)`, but `x⁄2`, `(a + b)⁄c`, `f(x)⁄2`
 *  and `√(x + 1)⁄2`. */
function needsParentheses(pieces: readonly MathPiece[]): boolean {
  const written = pieces.map((piece) => piece.text).join('').trim()
  // A name, number or radical, applied to at most one group.
  const applied = written.replace(/^[\p{L}\p{N}.′√]+/u, '')
  if (applied === '') return false
  return !(applied.startsWith('(') && applied.endsWith(')') && balancedWithin(applied))
}

// `(a)(b)` starts and ends with a parenthesis but is not one group.
function balancedWithin(written: string): boolean {
  let depth = 0
  for (let index = 0; index < written.length; index += 1) {
    if (written[index] === '(') depth += 1
    if (written[index] === ')') depth -= 1
    if (depth === 0 && index < written.length - 1) return false
  }
  return true
}

/** The equation `source`, as runs of text to write on a line. */
export function mathPieces(source: string, scale = 1, rise = 0): MathPiece[] {
  const pieces: MathPiece[] = []
  const push = (text: string) => {
    if (text) pieces.push({ text, scale, rise })
  }
  const nested = (inner: string, innerScale = scale, innerRise = rise) => {
    pieces.push(...mathPieces(inner, innerScale, innerRise))
  }
  const term = (inner: string) => {
    const written = mathPieces(inner, scale, rise)
    if (needsParentheses(written)) {
      push('(')
      pieces.push(...written)
      push(')')
    } else pieces.push(...written)
  }

  let index = 0
  while (index < source.length) {
    const character = source[index]!

    if (character === '\\') {
      const command = /^\\([A-Za-z]+|.)/.exec(source.slice(index))
      const name = command?.[1] ?? ''
      index += command ? command[0].length : 1
      if (FRACTIONS.has(name)) {
        const numerator = argument(source, index)
        const denominator = argument(source, numerator.end)
        term(numerator.inner)
        push('⁄')
        term(denominator.inner)
        index = denominator.end
      } else if (name === 'sqrt') {
        // An index — `\sqrt[3]{x}` — is raised before the radical.
        const degree = source[index] === '[' ? /^\[([^\]]*)\]/.exec(source.slice(index)) : null
        if (degree) {
          nested(degree[1]!, scale * SCRIPT_SCALE, rise + scale * RAISE)
          index += degree[0].length
        }
        const radicand = argument(source, index)
        push('√')
        term(radicand.inner)
        index = radicand.end
      } else if (WORDS.has(name)) {
        const words = argument(source, index)
        push(words.inner)
        index = words.end
      } else if (FACES.has(name)) {
        const face = argument(source, index)
        nested(face.inner)
        index = face.end
      } else if (COLOURS.has(name)) {
        index = argument(source, index).end
      } else if (IGNORED.has(name)) {
        // `\left.` and `\right.` stand for no delimiter at all.
        if (source[index] === '.') index += 1
      } else if (name in SPACES) {
        push(SPACES[name]!)
      } else if (FUNCTIONS.has(name)) {
        push(name)
      } else if (SYMBOLS[name]) {
        push(SYMBOLS[name]!)
      } else {
        // An escaped character — `\{`, `\%`, `\$` — is that character, and an
        // unknown command prints as its name.
        push(name)
      }
      continue
    }

    if (character === '^' || character === '_') {
      const script = argument(source, index + 1)
      nested(
        script.inner,
        scale * SCRIPT_SCALE,
        rise + scale * (character === '^' ? RAISE : LOWER),
      )
      index = script.end
      continue
    }

    if (character === '{') {
      const braced = group(source, index)!
      nested(braced.inner)
      index = braced.end
      continue
    }

    if (character === '}') {
      index += 1
      continue
    }

    if (character === '~') {
      push(' ')
      index += 1
      continue
    }

    push(character === '-' ? '−' : character === "'" ? '′' : character)
    index += 1
  }
  return pieces
}

/** The equation `source` as the plain text it is written as. */
export function mathText(source: string): string {
  return mathPieces(source).map((piece) => piece.text).join('')
}

// ---- Typeset ---------------------------------------------------------------

/** An affine map `[a, b, c, d, e, f]`, as PDF and SVG write one. */
export type Matrix = readonly [number, number, number, number, number, number]

/** A step of a path, every point absolute: a move, a line, a quadratic or
 *  cubic curve through its control points, or the close of the subpath. */
export type PathStep =
  | { op: 'move' | 'line'; to: [number, number] }
  | { op: 'quadratic'; control: [number, number]; to: [number, number] }
  | { op: 'cubic'; controls: [number, number, number, number]; to: [number, number] }
  | { op: 'close' }

/** One mark of a typeset equation, in the coordinates `matrix` maps to the
 *  equation's own: a path filled or stroked, or text MathJax has no outline
 *  for. `color` is `currentColor` or what `\color` gave. */
export type MathMark = (
  | { kind: 'fill'; path: PathStep[]; matrix: Matrix; color: string }
  | { kind: 'stroke'; path: PathStep[]; matrix: Matrix; color: string; width: number }
  | { kind: 'text'; text: string; matrix: Matrix; color: string; size: number }
) & {
  /** The boxes it is cut to, as corners in the equation's coordinates:
   *  MathJax draws part of a stretched glyph in a box that hides the rest. */
  clips: Clip[]
}

export type Clip = readonly (readonly [number, number])[]

/** An equation typeset, in ems of its own size: measured from the left of its
 *  baseline, `y` up, `ascent` above the baseline and `descent` below it. */
export type TypesetMath = {
  width: number
  ascent: number
  descent: number
  marks: MathMark[]
}

/** MathJax's units: a thousand to the em. */
const UNITS = 1000
/** The width MathJax's stylesheet gives a table's rules, which the SVG leaves
 *  unstated. */
const RULE_WIDTH = 70

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

/** An SVG `transform`, as the one matrix it applies. */
function transformOf(value: string | null): Matrix {
  let matrix: Matrix = [1, 0, 0, 1, 0, 0]
  for (const [, name, list] of (value ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const n = list!.split(/[\s,]+/).filter(Boolean).map(Number)
    const step: Matrix | null =
      name === 'translate' ? [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]
      : name === 'scale' ? [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]
      : name === 'matrix' && n.length === 6 ? [n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!]
      : name === 'rotate' ? rotation(n[0] ?? 0)
      : null
    if (step) matrix = multiply(matrix, step)
  }
  return matrix
}

/** An SVG path's data as absolute steps: `H` and `V` as lines, `T` and `S`
 *  with the control point they reflect. Arcs, which MathJax's glyphs never
 *  use, are drawn as lines to their ends. */
export function pathSteps(data: string): PathStep[] {
  const steps: PathStep[] = []
  const tokens = data.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|[A-Za-z]/gi) ?? []
  let index = 0
  let command = ''
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  // The control point a smooth curve reflects, when the step before was a
  // curve of its kind.
  let quadratic: [number, number] | null = null
  let cubic: [number, number] | null = null
  const next = () => Number(tokens[index++])
  const point = (relative: boolean): [number, number] => {
    const px = next()
    const py = next()
    return relative ? [x + px, y + py] : [px, py]
  }
  while (index < tokens.length) {
    if (/[A-Za-z]/.test(tokens[index]!)) command = tokens[index++]!
    else if (!command) break
    const relative = command === command.toLowerCase()
    const upper = command.toUpperCase()
    let nextQuadratic: [number, number] | null = null
    let nextCubic: [number, number] | null = null
    if (upper === 'Z') {
      steps.push({ op: 'close' })
      x = startX
      y = startY
      command = ''
    } else if (upper === 'M') {
      ;[x, y] = point(relative)
      ;[startX, startY] = [x, y]
      steps.push({ op: 'move', to: [x, y] })
      // Pairs after a move's first are lines.
      command = relative ? 'l' : 'L'
    } else if (upper === 'L' || upper === 'H' || upper === 'V') {
      if (upper === 'L') [x, y] = point(relative)
      else if (upper === 'H') x = relative ? x + next() : next()
      else y = relative ? y + next() : next()
      steps.push({ op: 'line', to: [x, y] })
    } else if (upper === 'Q' || upper === 'T') {
      const control: [number, number] = upper === 'Q'
        ? point(relative)
        : quadratic ? [2 * x - quadratic[0], 2 * y - quadratic[1]] : [x, y]
      ;[x, y] = point(relative)
      steps.push({ op: 'quadratic', control, to: [x, y] })
      nextQuadratic = control
    } else if (upper === 'C' || upper === 'S') {
      const first: [number, number] = upper === 'C'
        ? point(relative)
        : cubic ? [2 * x - cubic[0], 2 * y - cubic[1]] : [x, y]
      const second = point(relative)
      ;[x, y] = point(relative)
      steps.push({ op: 'cubic', controls: [...first, ...second], to: [x, y] })
      nextCubic = second
    } else if (upper === 'A') {
      index += 5
      ;[x, y] = point(relative)
      steps.push({ op: 'line', to: [x, y] })
    } else break
    quadratic = nextQuadratic
    cubic = nextCubic
  }
  return steps
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

function rotation(degrees: number): Matrix {
  const radians = degrees * Math.PI / 180
  return [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0]
}

/** The equation `source` typeset, or null when MathJax cannot typeset it. */
export function typesetMath(
  tools: MathJaxTools,
  source: string,
  display: boolean,
): TypesetMath | null {
  let svg: LiteElement
  try {
    svg = tools.svg(source, display)
  } catch {
    return null
  }
  const { adaptor } = tools
  const box: number[] = String(adaptor.getAttribute(svg, 'viewBox') ?? '').split(/\s+/).map(Number)
  if (box.length !== 4 || box.some((value) => !Number.isFinite(value))) return null
  const [left, top, width, height] = box as [number, number, number, number]
  const marks: MathMark[] = []
  const number = (node: LiteElement, name: string, fallback = 0) => {
    const value = Number.parseFloat(adaptor.getAttribute(node, name) ?? '')
    return Number.isFinite(value) ? value : fallback
  }

  const visit = (
    node: LiteElement,
    outer: Matrix,
    fill: string,
    stroke: string,
    clips: Clip[],
  ) => {
    const matrix = multiply(outer, transformOf(adaptor.getAttribute(node, 'transform')))
    fill = adaptor.getAttribute(node, 'fill') ?? fill
    stroke = adaptor.getAttribute(node, 'stroke') ?? stroke
    switch (adaptor.kind(node)) {
      case 'path': {
        const path = pathSteps(String(adaptor.getAttribute(node, 'd') ?? ''))
        if (path.length > 0 && fill !== 'none') marks.push({ kind: 'fill', path, matrix, color: fill, clips })
        return
      }
      case 'svg': {
        // A box of its own at `x`, `y`, its view box scaled into it, and what
        // falls outside the box hidden.
        const x = number(node, 'x')
        const y = number(node, 'y')
        const boxWidth = number(node, 'width')
        const boxHeight = number(node, 'height')
        const corners: Clip = [
          apply(matrix, x, y),
          apply(matrix, x + boxWidth, y),
          apply(matrix, x + boxWidth, y + boxHeight),
          apply(matrix, x, y + boxHeight),
        ]
        const view = String(adaptor.getAttribute(node, 'viewBox') ?? '').split(/\s+/).map(Number)
        let inner = multiply(matrix, [1, 0, 0, 1, x, y])
        if (view.length === 4 && view.every(Number.isFinite) && view[2]! > 0 && view[3]! > 0) {
          inner = multiply(inner, [boxWidth / view[2]!, 0, 0, boxHeight / view[3]!, 0, 0])
          inner = multiply(inner, [1, 0, 0, 1, -view[0]!, -view[1]!])
        }
        for (const child of adaptor.childNodes(node)) {
          if (adaptor.kind(child as LiteElement) !== '#text') {
            visit(child as LiteElement, inner, fill, stroke, [...clips, corners])
          }
        }
        return
      }
      case 'rect': {
        // A link's hit box, and the yellow behind an error, are not ink.
        if (adaptor.getAttribute(node, 'data-hitbox') || adaptor.getAttribute(node, 'data-background')) return
        const x = number(node, 'x')
        const y = number(node, 'y')
        const right = x + number(node, 'width')
        const bottom = y + number(node, 'height')
        const path: PathStep[] = [
          { op: 'move', to: [x, y] },
          { op: 'line', to: [right, y] },
          { op: 'line', to: [right, bottom] },
          { op: 'line', to: [x, bottom] },
          { op: 'close' },
        ]
        if (fill !== 'none') marks.push({ kind: 'fill', path, matrix, color: fill, clips })
        else if (stroke !== 'none') {
          marks.push({
            kind: 'stroke', path, matrix, color: stroke, width: number(node, 'stroke-width', RULE_WIDTH), clips,
          })
        }
        return
      }
      case 'line': {
        if (stroke === 'none') return
        const path: PathStep[] = [
          { op: 'move', to: [number(node, 'x1'), number(node, 'y1')] },
          { op: 'line', to: [number(node, 'x2'), number(node, 'y2')] },
        ]
        marks.push({
          kind: 'stroke', path, matrix, color: stroke, width: number(node, 'stroke-width', RULE_WIDTH), clips,
        })
        return
      }
      case 'text': {
        const text = adaptor.textContent(node)
        if (text) marks.push({ kind: 'text', text, matrix, color: fill, size: number(node, 'font-size', UNITS), clips })
        return
      }
      default:
        for (const child of adaptor.childNodes(node)) {
          if (adaptor.kind(child as LiteElement) !== '#text') visit(child as LiteElement, matrix, fill, stroke, clips)
        }
    }
  }

  // The `<svg>` is laid out downward from its view box's corner, its baseline
  // at y = 0; the equation's own coordinates are ems from the left of that
  // baseline, upward.
  const root: Matrix = [1 / UNITS, 0, 0, -1 / UNITS, -left / UNITS, 0]
  for (const child of adaptor.childNodes(svg)) {
    visit(child as LiteElement, root, 'currentColor', 'currentColor', [])
  }
  return {
    width: width / UNITS,
    ascent: -top / UNITS,
    descent: (top + height) / UNITS,
    marks,
  }
}
