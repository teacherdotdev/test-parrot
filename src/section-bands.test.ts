// Where the sheet draws a Section's band and its dashed rules, from the boxes
// of its rendered pieces.

import { describe, expect, test } from 'bun:test'
import {
  NEW_SECTION_BAND,
  SECTION_BAND_BLEED,
  SECTION_RULE_OFFSET,
  bandEdges,
  sheetBands,
  type SectionPiece,
} from './section-bands'

const origin = { top: 0, left: 0 }
const sheetAt = (top: number) => ({ top, left: 40 })

describe('a sheet’s Section bands', () => {
  test('run from just above each Section’s first piece to where the next one’s begins', () => {
    const pieces: SectionPiece[] = [
      { sectionId: 'a', top: 200, bottom: 240 },
      { sectionId: 'a', top: 260, bottom: 300 },
      { sectionId: 'b', top: 330, bottom: 360 },
    ]
    const [a, b] = sheetBands(pieces, 0, sheetAt(100), origin)
    expect(a).toMatchObject({ sectionId: 'a', topInPage: 100 - SECTION_RULE_OFFSET, top: 200 - SECTION_RULE_OFFSET })
    // The foot of one is the top of the next: their rules share a line.
    expect(a!.topInPage + a!.height).toBe(b!.topInPage)
    expect(b!.bottom).toBe(360 + SECTION_BAND_BLEED)
    expect(b!.pageLeft).toBe(40)
  })

  test('start above the Section’s heading, whatever order its pieces were read in', () => {
    // A question box read before the heading above it must not pull the band —
    // and its rule — down onto the heading's directions.
    const pieces: SectionPiece[] = [
      { sectionId: 'a', top: 300, bottom: 340 },
      { sectionId: 'a', top: 250, bottom: 290 },
    ]
    const [a] = sheetBands(pieces, 0, sheetAt(0), origin)
    expect(a!.top).toBe(250 - SECTION_RULE_OFFSET)
  })

  test('end where a new-Section target opens, which rules itself off', () => {
    const pieces: SectionPiece[] = [
      { sectionId: 'a', top: 200, bottom: 240 },
      { sectionId: NEW_SECTION_BAND, top: 250, bottom: 300 },
    ]
    const [a] = sheetBands(pieces, 0, sheetAt(0), origin)
    expect(a!.endsAtNewSection).toBe(true)
    expect(bandEdges(sheetBands(pieces, 0, sheetAt(0), origin), a!)).toEqual({ top: true, bottom: false })
  })
})

describe('a Section’s dashed rules', () => {
  test('mark its real top and foot, and nothing at a page break it runs over', () => {
    // Section a ends page 0 and runs on to page 1, where b follows it.
    const bands = [
      ...sheetBands([{ sectionId: 'a', top: 500, bottom: 900 }], 0, sheetAt(0), origin),
      ...sheetBands(
        [{ sectionId: 'a', top: 1200, bottom: 1300 }, { sectionId: 'b', top: 1320, bottom: 1400 }],
        1,
        sheetAt(1100),
        origin,
      ),
    ]
    const [first, continued, next] = bands
    expect(bandEdges(bands, first!)).toEqual({ top: true, bottom: false })
    expect(bandEdges(bands, continued!)).toEqual({ top: false, bottom: true })
    expect(bandEdges(bands, next!)).toEqual({ top: true, bottom: true })
  })

  test('mark a Section across three sheets only at its first top and its last foot', () => {
    const bands = [0, 1, 2].flatMap((page) =>
      sheetBands([{ sectionId: 'a', top: page * 1100 + 100, bottom: page * 1100 + 900 }], page, sheetAt(page * 1100), origin))
    expect(bands.map((band) => bandEdges(bands, band))).toEqual([
      { top: true, bottom: false },
      { top: false, bottom: false },
      { top: false, bottom: true },
    ])
  })
})
