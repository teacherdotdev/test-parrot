// Where the exam sheet draws each Question Section: one band per sheet the
// Section appears on, across the paper's whole width, from just above its
// first piece on that sheet to where the next Section's begins there, or just
// below its last piece. The highlight covers each band; the dashed rules mark
// only the Section's real top and foot (`bandEdges`), so a Section that runs
// over a page break shows no rule at the break, and the missing rule reads as
// "continued". Pure arithmetic over boxes the sheet reads off its rendered
// pieces, which is what lets it be tested without a browser.

/** The band of an open new-Section target: a Section in the making, which the
 *  Section above it ends at. */
export const NEW_SECTION_BAND = '\u0000new-section'

/** How far above its first piece a Section's band — its dashed rule, and its
 *  highlight — begins. A band runs from there to where the next Section's
 *  begins, so the rules of neighbouring Sections fall on the same line. */
export const SECTION_RULE_OFFSET = 9

/** How far a Section's highlight reaches below the last piece on a sheet when
 *  no Section follows it there. */
export const SECTION_BAND_BLEED = 12

/** One sheet's stretch of a Section, as drawn: from its sheet's top edge, for
 *  the highlight, and from the workspace's, for the controls in the gutter. */
export type SectionBand = {
  sectionId: string
  pageIndex: number
  /** Whether a new-Section target open beneath it is where it ends — whose
   *  own rule then marks its foot, so it draws none of its own there. */
  endsAtNewSection: boolean
  topInPage: number
  height: number
  top: number
  bottom: number
  pageLeft: number
}

/** A rendered piece of a Section — its heading, or a question or the part of
 *  one a sheet carries — in viewport coordinates. */
export type SectionPiece = { sectionId: string; top: number; bottom: number }

/** The bands one sheet draws, from the pieces on it, its own box and the
 *  workspace's, all in viewport coordinates. */
export function sheetBands(
  pieces: readonly SectionPiece[],
  pageIndex: number,
  sheet: { top: number; left: number },
  origin: { top: number; left: number },
): SectionBand[] {
  const spans = new Map<string, { top: number; bottom: number }>()
  for (const piece of pieces) {
    const span = spans.get(piece.sectionId)
    if (span) {
      span.top = Math.min(span.top, piece.top)
      span.bottom = Math.max(span.bottom, piece.bottom)
    } else {
      spans.set(piece.sectionId, { top: piece.top, bottom: piece.bottom })
    }
  }
  const onSheet = [...spans].sort(([, a], [, b]) => a.top - b.top)
  return onSheet.map(([sectionId, span], index) => {
    const top = span.top - SECTION_RULE_OFFSET
    const next = onSheet[index + 1]
    const bottom = next ? next[1].top - SECTION_RULE_OFFSET : span.bottom + SECTION_BAND_BLEED
    return {
      sectionId,
      pageIndex,
      endsAtNewSection: next?.[0] === NEW_SECTION_BAND,
      topInPage: top - sheet.top,
      height: bottom - top,
      top: top - origin.top,
      bottom: bottom - origin.top,
      pageLeft: sheet.left - origin.left,
    }
  })
}

/** Which of a band's edges are its Section's real top and foot, and so draw a
 *  dashed rule: the top of the first sheet the Section appears on, and the
 *  foot of the last — never an edge at a page break, nor the foot a new-Section
 *  target below it rules off itself. */
export function bandEdges(
  bands: readonly SectionBand[],
  band: SectionBand,
): { top: boolean; bottom: boolean } {
  const same = bands.filter(({ sectionId }) => sectionId === band.sectionId)
  return {
    top: !same.some(({ pageIndex }) => pageIndex < band.pageIndex),
    bottom: !band.endsAtNewSection && !same.some(({ pageIndex }) => pageIndex > band.pageIndex),
  }
}

export function sameBand(left: SectionBand, right: SectionBand): boolean {
  return (
    left.sectionId === right.sectionId
    && left.pageIndex === right.pageIndex
    && left.endsAtNewSection === right.endsAtNewSection
    && left.top === right.top
    && left.bottom === right.bottom
    && left.pageLeft === right.pageLeft
  )
}
