// Drawing a typeset equation into a PDF page, for both PDFs Test Parrot
// writes: an Exam's and a Question Bank File. `pdf-math` typesets; this draws
// what it typeset, and writes the equation over it, invisibly, so the PDF can
// be searched and copied from.

import {
  appendBezierCurve,
  appendQuadraticCurve,
  clip,
  closePath,
  concatTransformationMatrix,
  endPath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
  setLineWidth,
  setStrokingColor,
  stroke,
  type Color,
  type PDFFont,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib'
import { mathJaxTools } from './mathjax'
import { mathText, typesetMath, type PathStep, type TypesetMath } from './pdf-math'

/** How much larger than the text around it an equation is set, as KaTeX
 *  sets it in print. */
export const MATH_SIZE = 1.21

/** A named `\color`, or a hex one; anything else prints in ink. */
const MATH_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.5, 0],
  blue: [0, 0, 1], cyan: [0, 1, 1], magenta: [1, 0, 1], yellow: [1, 1, 0],
  orange: [1, 0.65, 0], purple: [0.5, 0, 0.5], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5],
  brown: [0.65, 0.16, 0.16],
}

function mathColor(value: string, ink: Color): Color {
  const named = MATH_COLORS[value.toLowerCase()]
  if (named) return rgb(...named)
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value)?.[1]
  if (!hex) return ink
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
  return rgb(
    Number.parseInt(full.slice(0, 2), 16) / 255,
    Number.parseInt(full.slice(2, 4), 16) / 255,
    Number.parseInt(full.slice(4, 6), 16) / 255,
  )
}

function pathOperators(path: readonly PathStep[]): PDFOperator[] {
  return path.map((step) => {
    switch (step.op) {
      case 'move': return moveTo(...step.to)
      case 'line': return lineTo(...step.to)
      case 'quadratic': return appendQuadraticCurve(...step.control, ...step.to)
      case 'cubic': return appendBezierCurve(...step.controls, ...step.to)
      case 'close': return closePath()
    }
  })
}

/** Draw a typeset equation with the left of its baseline at `x`, `baseline`,
 *  set at KaTeX's size for text of `size`; and write it over itself,
 *  invisibly, stretched to its width, so it can be searched and copied.
 *  `check` may refuse a character `font` cannot draw before it is drawn. */
export function drawTypesetMath(
  page: PDFPage,
  font: PDFFont,
  typeset: TypesetMath,
  source: string,
  x: number,
  baseline: number,
  size: number,
  options: { ink: Color; check?: (text: string) => void },
): void {
  const scale = size * MATH_SIZE
  for (const mark of typeset.marks) {
    const color = mathColor(mark.color, options.ink)
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(scale, 0, 0, scale, x, baseline),
      ...mark.clips.flatMap((corners) => [
        ...corners.map((corner, index) => (index === 0 ? moveTo : lineTo)(...corner)),
        closePath(),
        clip(),
        endPath(),
      ]),
      concatTransformationMatrix(...mark.matrix),
    )
    if (mark.kind === 'fill') {
      page.pushOperators(setFillingColor(color), ...pathOperators(mark.path), fill())
    }
    if (mark.kind === 'stroke') {
      page.pushOperators(
        setStrokingColor(color),
        setLineWidth(mark.width),
        ...pathOperators(mark.path),
        stroke(),
      )
    }
    if (mark.kind === 'text') {
      options.check?.(mark.text)
      // pdf-lib sets a line of text `y` up; MathJax's is `y` down.
      page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, 0))
      page.drawText(mark.text, { x: 0, y: 0, size: mark.size, font, color })
    }
    page.pushOperators(popGraphicsState())
  }

  const supported = new Set(font.getCharacterSet())
  const written = [...mathText(source)]
    .filter((character) => supported.has(character.codePointAt(0)!))
    .join('')
    .trim()
  const writtenWidth = font.widthOfTextAtSize(written, size)
  if (!written || writtenWidth <= 0) return
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(typeset.width * scale / writtenWidth, 0, 0, 1, x, baseline),
  )
  page.drawText(written, { x: 0, y: 0, size, font, opacity: 0 })
  page.pushOperators(popGraphicsState())
}

export type MathTypesetter = (source: string, display: boolean) => TypesetMath | null

/** Each equation typeset once, MathJax loaded only when `holdsMath`. */
export async function mathTypesetter(holdsMath: boolean): Promise<MathTypesetter> {
  if (!holdsMath) return () => null
  const tools = await mathJaxTools()
  const typeset = new Map<string, TypesetMath | null>()
  return (source, display) => {
    const key = `${display ? 'display' : 'inline'}:${source}`
    if (!typeset.has(key)) typeset.set(key, typesetMath(tools, source, display))
    return typeset.get(key)!
  }
}
