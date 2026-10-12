// Drawings the menus need that lucide has no icon for.

import type { ReactNode, SVGProps } from 'react'
import type { PaperStyle } from './paper-style'

/** A Section inserted above this one: a new row, marked with a plus, over the
 *  Section's own. Lucide has a glyph for putting something between rows, but
 *  none for adding a row above. Drawn as lucide draws, on its 24-unit grid. */
export function InsertSectionAboveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3v6" />
      <path d="M9 6h6" />
      <rect x="3" y="13" width="18" height="8" rx="2" />
    </svg>
  )
}

/**
 * Page Margins, drawn like a printer's crop marks: two vertical and two
 * horizontal lines crossing, running past one another, so the area between
 * them is the page they mark — a portrait rectangle 10 by 13, US Letter's
 * 8½ by 11, rather than a square. Drawn as lucide draws, on its 24-unit
 * grid in `currentColor` with round ends at stroke 2, so it sits among the
 * menu's other icons and takes their CSS size and stroke.
 */
export function MarginsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7 2v20" />
      <path d="M17 2v20" />
      <path d="M3 5.5h18" />
      <path d="M3 18.5h18" />
    </svg>
  )
}

// A Paper Style at a glance, beside its name in the Paper style submenu: the
// one thing it changes most, in a 32 by 24 sketch of a question or two, with
// a small "1." where that style prints the question's number. The menu draws
// it half as large again (`.context-menu-preview`), keeping its strokes a
// pixel wide; the numbers and letters are real text in the sheet's own serif.
// Decorative: the row's label and description carry what it means.
function Mark({ x, y, children, bold = false }: { x: number; y: number; children: string; bold?: boolean }) {
  return (
    <text
      x={x}
      y={y}
      fill="currentColor"
      stroke="none"
      fontFamily="Georgia, 'Times New Roman', serif"
      fontSize="7"
      fontWeight={bold ? 700 : 400}
    >
      {children}
    </text>
  )
}

const PREVIEWS: Record<PaperStyle, ReactNode> = {
  // T and F to circle, then the number and its stem; an answer letter circled.
  standard: (
    <>
      <Mark x={0.5} y={8}>T F</Mark>
      <Mark x={11} y={8} bold>1.</Mark>
      <path d="M18 5.5h13" />
      <circle cx="20" cy="13.5" r="2.5" />
      <path d="M25 13.5h6" />
      <path d="M19.5 20.5h1M25 20.5h6" />
    </>
  ),
  // A blank to write on before the number, and ruled lines under a written
  // answer.
  classic: (
    <>
      <path d="M0.5 7.5h8" />
      <Mark x={10} y={8} bold>1.</Mark>
      <path d="M17 5.5h14" />
      <path d="M17 12.5h14M17 17.5h14M17 22.5h14" strokeOpacity="0.55" />
    </>
  ),
  // Numbered rows close together, answers across the line, lines ruled tight.
  condensed: (
    <>
      <Mark x={0.5} y={6} bold>1.</Mark>
      <path d="M8 3.5h23" />
      <path d="M8 8.5h4M15 8.5h4M22 8.5h4M28.5 8.5h2.5" />
      <Mark x={0.5} y={15.5} bold>2.</Mark>
      <path d="M8 13h23" />
      <path d="M8 18.5h23M8 22.5h23" strokeOpacity="0.55" />
    </>
  ),
  // A bare bold number and a Part's (a), dotted lines to write on, and the
  // answer's points in brackets at the right margin.
  'exam-board': (
    <>
      <Mark x={0.5} y={7} bold>1</Mark>
      <Mark x={5} y={7} bold>(a)</Mark>
      <path d="M16 4.5h15" />
      <path d="M5 12.5h26M5 17.5h18" strokeDasharray="0.1 2" strokeOpacity="0.8" />
      <Mark x={24} y={23}>[2]</Mark>
    </>
  ),
}

export function PaperStylePreview({ style }: { style: PaperStyle }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="24"
      viewBox="0 0 32 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {PREVIEWS[style]}
    </svg>
  )
}
