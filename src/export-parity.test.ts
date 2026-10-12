// Export parity, at the seam that matters.
//
// One Layout Plan per fixture, fed to both Export Adapters, with each adapter's
// observable result reduced to the same content lines and compared against the
// plan. A difference here means one output says something the other does not —
// which is the entire class of bug this suite exists to catch.
//
// These tests need no LibreOffice, no Chromium and no PDF tooling. The
// heavyweight comparison in `bun run test:exports` is a separate, out-of-band
// diagnostic; see `docs/export-testing.md`.

import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { createExamDocx } from './docx-export'
import type { MediaLoader } from './export-media'
import { docxFingerprint } from './docx-fingerprint'
import { FIXTURES, PIXEL_PNG, type Fixture } from './export-fixtures'
import {
  compareFingerprints,
  describeDifferences,
  exportDocumentFingerprint,
  layoutFingerprint,
  type ExportFingerprint,
} from './export-fingerprint'
import { SECTION_ORDER } from './exam'
import {
  buildExportDocument,
  planExport,
  unmeasured,
  STUDENT_TEST,
  type LayoutPlan,
} from './export-plan'
import {
  EMPTY_EXPORT_HISTORY,
  plansOf,
  prepareExport,
} from './export-preparation'
import { printFingerprint } from './print-fingerprint'
import { PAPER_STYLES } from './paper-style'
import {
  SUPPORTED_MARKS,
  SUPPORTED_NODES,
  type ProseMirrorJSON,
} from './question-doc'

const noImages: MediaLoader = async () => null
const pixel: MediaLoader = async () => PIXEL_PNG

/**
 * The whole export a fixture describes, prepared the way the application
 * prepares one: the canonical student test followed by its answer key.
 *
 * Both adapters are fed exactly this, so a difference between them is a real
 * difference and never a difference in what each was asked to carry.
 */
function planOf(fixture: Fixture): LayoutPlan[] {
  return plansOf(
    prepareExport({
      examId: 'fixture-exam',
      exam: fixture.exam,
      arrangement: fixture.arrangement,
      configuration: {
        selection: { test: true, answerKey: true },
      },
      history: EMPTY_EXPORT_HISTORY,
      measure: fixture.measure,
      createdAt: '2026-09-04T12:00:00.000Z',
    }),
  )
}

async function docxOf(fixture: Fixture): Promise<ExportFingerprint> {
  const blob = await createExamDocx(
    planOf(fixture),
    fixture.images ? pixel : noImages,
  )
  return docxFingerprint(await blob.arrayBuffer())
}

function expectSameDocument(
  expected: ExportFingerprint,
  actual: ExportFingerprint,
): void {
  expect(describeDifferences(compareFingerprints(expected, actual))).toBe(
    'no differences',
  )
}

describe('the DOCX Export Adapter carries the planned document', () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, async () => {
      expectSameDocument(
        layoutFingerprint(planOf(fixture)),
        await docxOf(fixture),
      )
    })
  }

  test('carries a work space as ruled or blank room, and a filled page as a page', async () => {
    const fixture = FIXTURES.find((item) => item.name.startsWith('Short Answer work space'))!
    const planned = layoutFingerprint(planOf(fixture))
    const test = planned.pages.filter((page) => page.content.some((line) => line.startsWith('para ')))
    const spaces = planned.pages.flatMap((page) =>
      page.content.filter((line) => line.startsWith('space:')),
    )
    // Five rules; a blank space; and the filled space ruled all the way down.
    expect(spaces[0]).toBe('space:lines:5')
    expect(spaces[1]).toBe('space:blank')
    expect(spaces[2]).toMatch(/^space:lines:\d+$/)
    expect(Number(spaces[2]!.split(':')[2])).toBeGreaterThan(5)
    // The question after the filled space starts the next page.
    expect(test[1]!.content.some((line) => line.includes('Starts a new page'))).toBe(true)
    expectSameDocument(planned, await docxOf(fixture))
  })

  test('carries Subparts beneath their Part’s lead-in, and a key line for each', async () => {
    const fixture = FIXTURES.find((item) => item.name === 'a multipart whose part holds subparts')!
    const planned = layoutFingerprint(planOf(fixture))
    const lines = planned.pages.flatMap((page) => page.content)
    const at = (start: string) => lines.findIndex((line) => line.startsWith(`para ${start}`))
    // The lead-in, then each Subpart labelled beneath it, in order.
    expect(at('b. The count was highest')).toBeGreaterThan(at('a. Name one thing'))
    expect(at('i. In which season')).toBeGreaterThan(at('b. The count was highest'))
    expect(at('ii. Suggest why')).toBeGreaterThan(at('i. In which season'))
    expect(lines).toContain('space:lines:2')
    // Spring is the second answer under this arrangement.
    expect(lines).toContain('para b (i). «strong»B«/»')
    expect(lines.some((line) => line.startsWith('para b (ii).'))).toBe(true)
    expectSameDocument(planned, await docxOf(fixture))
    expectSameDocument(planned, printFingerprint(planOf(fixture)))
  })

  test('puts a stemless Multipart question’s Part (a) on its number’s line, and a lead-in-less Part’s Subpart (i) on its letter’s, under every Paper Style', async () => {
    const stemless = FIXTURES.find((item) => item.name === 'a multipart with no stem, and a part with no lead-in')!
    for (const paperStyle of PAPER_STYLES) {
      const fixture = { ...stemless, exam: { ...stemless.exam, paperStyle } }
      const plans = planOf(fixture)
      // A stem of only empty paragraphs is no stem, and so is such a lead-in.
      const item = plans[0]!.pages.flatMap((page) => page.items).find((candidate) => candidate.kind === 'question')
      expect(item?.kind === 'question' && item.stem).toEqual([])
      expect(item?.kind === 'question' && item.parts![1]!.stem).toEqual([])
      const planned = layoutFingerprint(plans)
      const lines = layoutFingerprint([plans[0]!]).pages.flatMap((page) => page.content)
      // `1 (a) Fig. 1.1…` under Exam Board, `1. a. Fig. 1.1…` under the rest.
      const [number, a, b, i, ii] = paperStyle === 'exam-board'
        ? ['1', '(a)', '(b)', '(i)', '(ii)']
        : ['1.', 'a.', 'b.', 'i.', 'ii.']
      expect(lines).toContain(`para ${number} ${a} Fig. 1.1 shows a ball rolling down a ramp. State the energy it gains.`)
      expect(lines).toContain(`para ${b} ${i} Name the force that slows the ball.`)
      expect(lines).toContain(`para ${ii} Which unit is energy measured in?`)
      // Neither the number nor a letter is left on a line of its own.
      expect(lines).not.toContain(`para ${number}`)
      expect(lines).not.toContain(`para ${b}`)
      expectSameDocument(planned, await docxOf(fixture))
      expectSameDocument(planned, printFingerprint(plans))
    }
  })

  test('carries Points on the Answer Key under every Paper Style, and on the test only where its style prints them', async () => {
    const pointed = FIXTURES.find((item) => item.name === 'a paper with points')!
    for (const paperStyle of PAPER_STYLES.filter((style) => style !== 'exam-board')) {
      const fixture = { ...pointed, exam: { ...pointed.exam, paperStyle } }
      const plans = planOf(fixture)
      const planned = layoutFingerprint(plans)
      const [test, key] = [0, 1].map((stream) =>
        layoutFingerprint([plans[stream]!]).pages.flatMap((page) => page.content))
      // The test says nothing of Points under a style that prints none.
      expect(test!.some((line) => /\[\d+\]|points?\b/.test(line))).toBe(false)
      // The key gives the paper's total, each line with Points its `[n]`, a
      // Matching set's once on its first Item, and an unpointed line none.
      expect(key).toContain('heading:1 Answer Section Total: 9 points')
      expect(key).toContain('para 1. «strong»A«/» [1] Easy Rivers')
      expect(key).toContain('para 2. «strong»F«/»')
      expect(key).toContain('para 3. «strong»A«/» [2]')
      expect(key).toContain('para 4. «strong»B«/»')
      expect(key).toContain('para a. [1]')
      expect(key).toContain('para b (i). [2]')
      expect(key).toContain('para b (ii). [3]')
      expectSameDocument(planned, await docxOf(fixture))
      expectSameDocument(planned, printFingerprint(plans))
    }
  })

  test('carries an Exam Board paper: its paper total, labels, dotted lines and Points, on A4', async () => {
    const fixture = FIXTURES.find((item) => item.name === 'a paper with points in the exam board paper style')!
    const plans = planOf(fixture)
    const [test, key] = plans
    const planned = layoutFingerprint(plans)
    const testPages = layoutFingerprint([test!]).pages
    const lines = testPages.flatMap((page) => page.content)

    // A4, every page of the test and the key.
    for (const page of planned.pages) expect([page.width, page.height]).toEqual([794, 1123])

    // Page 1 is a test page as every style prints one: the page number above
    // the header line, the title, then the paper's total opening the content,
    // ahead of its first Section's heading. No page is the style's own.
    expect(testPages[0]!.header).toEqual([
      'para 1',
      'para Name: __________________ Class: ___________ Date: ___________',
      'heading:title Plant Biology',
    ])
    expect(testPages[0]!.content[0]).toBe('para The total mark for this paper is 16.')
    expect(testPages[0]!.content[1]).toBe('heading:1 Multiple Choice')
    expect(lines.filter((line) => line.startsWith('para The total mark'))).toHaveLength(1)
    // …and never part of the Answer Key.
    expect(layoutFingerprint([key!]).pages.flatMap((page) => page.content))
      .not.toContain('para The total mark for this paper is 16.')

    // `1` before the stem, `A` before an answer, `(a)` and `(i)` before Parts
    // and Subparts, the Points after each answer and the Multipart total.
    expect(lines).toContain('para 1 Which gas do leaves give out in sunlight?')
    expect(lines).toContain('para B Oxygen')
    expect(lines).toContain('para 5 Explain why a plant kept in the dark loses mass.')
    expect(lines).toContain('para (a) State one condition seeds need to germinate.')
    expect(lines).toContain('para (i) Which colour are the cupboard seedlings?')
    expect(lines).toContain('para (ii) Explain the difference in their height.')
    // The style's three dotted lines, the answer's Points on the last of
    // them, at its right end.
    const shortAnswer = lines.indexOf('para 5 Explain why a plant kept in the dark loses mass.')
    expect(lines[shortAnswer + 1]).toBe('space:lines:3:dotted [3]')
    expect(lines).not.toContain('para [3]')
    // The teacher's own two lines on Part (a) win over the style's three.
    const partA = lines.indexOf('para (a) State one condition seeds need to germinate.')
    expect(lines[partA + 1]).toBe('space:lines:2:dotted [2]')
    expect(lines.at(-2)).toBe('space:lines:3:dotted [6]')
    expect(lines.at(-1)).toBe('para [Total: 9]')
    // A Multiple Choice and a Matching set print their Points after their answers.
    expect(lines).toContain('para [1]')
    expect(lines.indexOf('para [2]')).toBeGreaterThan(lines.findIndex((line) => line.includes('Receives pollen')))

    // The page number at the top, centred, above the later pages' Name line;
    // and "Turn over" on every test page another test page follows.
    expect(testPages[1]!.header).toEqual(['para 2', 'para Name: __________________'])
    expect(testPages.map((page) => page.footer[0])).toEqual([
      ...Array.from({ length: testPages.length - 1 }, () => 'para Turn over'),
      'para',
    ])
    // The Answer Key keeps the sheet's own furniture.
    expect(layoutFingerprint([key!]).pages[0]!.footer).toEqual(['para 1'])

    expectSameDocument(planned, await docxOf(fixture))
    expectSameDocument(planned, printFingerprint(plans))
  })

  test('keeps an answer’s Points on a line of their own where no ruled Work Space ends it', async () => {
    const pointed = FIXTURES.find((item) => item.name === 'a paper with points in the exam board paper style')!
    // The teacher gives the Short Answer question blank room, and Part (a) none.
    const fixture = {
      ...pointed,
      exam: {
        ...pointed.exam,
        workSpace: {
          'eb-sa': { height: 64, style: 'blank' as const, fill: false },
          'eb-mp-a': { height: 0, style: 'lines' as const, fill: false },
        },
      },
    }
    const plans = planOf(fixture)
    const lines = layoutFingerprint([plans[0]!]).pages.flatMap((page) => page.content)
    const shortAnswer = lines.indexOf('para 5 Explain why a plant kept in the dark loses mass.')
    expect(lines.slice(shortAnswer + 1, shortAnswer + 3)).toEqual(['space:blank', 'para [3]'])
    const partA = lines.indexOf('para (a) State one condition seeds need to germinate.')
    expect(lines[partA + 1]).toBe('para [2]')
    expectSameDocument(layoutFingerprint(plans), await docxOf(fixture))
    expectSameDocument(layoutFingerprint(plans), printFingerprint(plans))
  })

  test('carries a Centred figure, its caption and a Centred table centred, and keeps the number at the left', async () => {
    const fixture = FIXTURES.find((item) => item.name === 'a centred figure, caption and table')!
    const plans = planOf(fixture)
    const lines = layoutFingerprint([plans[0]!]).pages.flatMap((page) => page.content)
    const figure = lines.indexOf('para:center ⟨image:1⟩')
    expect(lines[figure - 1]).toBe('para 1. Fig. 1.1 shows a leaf seen through a hand lens.')
    expect(lines.slice(figure + 1, figure + 3)).toEqual(['para:center «strong»Fig. 1.1«/»', 'table:2x2:center'])
    expect(lines).toContain('para:center Length / mm')
    expect(lines).toContain('para Leaf')
    expect(lines).toContain('para:center Table 1.1')
    expect(lines).toContain('para Describe the leaf.')
    // A Centred paragraph that opens its question carries the number.
    expect(lines).toContain('para:center 2. Table 2.1')
    expect(lines).toContain('para:center «emphasis»A captioned figure«/»')
    expectSameDocument(layoutFingerprint(plans), await docxOf(fixture))
    expectSameDocument(layoutFingerprint(plans), printFingerprint(plans))
    // In Word the number stays at the left, and a centre tab sets the line.
    const blob = await createExamDocx(plans, pixel)
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string')
    const opening = xml.split('<w:p>').find((paragraph) => paragraph.includes('Table 2.1'))!
    expect(opening).toContain('w:val="center" w:pos=')
    expect(opening).toContain('<w:jc w:val="left"/>')
  })

  test('cuts an A4 plan to A4 exactly in Word', async () => {
    const fixture = FIXTURES.find((item) => item.name === 'a paper with points in the exam board paper style')!
    const blob = await createExamDocx(planOf(fixture), noImages)
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string')
    const sizes = [...xml.matchAll(/<w:pgSz [^>]*w:w="(\d+)"[^>]*w:h="(\d+)"/g)].map((match) => `${match[1]}x${match[2]}`)
    expect(sizes.length).toBeGreaterThan(0)
    expect(new Set(sizes)).toEqual(new Set(['11906x16838']))
    // Dotted lines are dotted borders.
    expect(xml).toContain('w:val="dotted"')
  })

  test('continues a Part’s later Subparts on the next page without its letter or lead-in', async () => {
    const fixture = FIXTURES.find((item) => item.name === 'a part whose later subparts continue on the next page')!
    const planned = layoutFingerprint(planOf(fixture))
    const test = planned.pages.filter((page) => page.content.some((line) => line.includes('Question (')))
    expect(test).toHaveLength(2)
    const second = test[1]!.content.join('\n')
    expect(second).not.toContain('The notice is about a lost cat.')
    expect(second).not.toContain('a. ')
    expect(second).toContain('iii. Question (iii)')
    expectSameDocument(planned, await docxOf(fixture))
    expectSameDocument(planned, printFingerprint(planOf(fixture)))
  })

  test('packages the canonical student test before its answer key', async () => {
    const fixture = FIXTURES.find(
      (item) => item.name === 'a realistic composite exam',
    )!
    const plans = planOf(fixture)
    const streams = plans.map((plan) =>
      plan.pages[0]!.stream === 'answer-key' ? 'answer-key' : 'test',
    )

    expect(streams).toEqual(['test', 'answer-key'])
    expect(plans.map((plan) => plan.arrangement.letter)).toEqual([
      fixture.arrangement.letter,
      fixture.arrangement.letter,
    ])
    // Every document starts its own page numbering at one.
    expect(plans.map((plan) => plan.pages[0]!.furniture.pageNumber)).toEqual([
      1, 1,
    ])

    const fingerprint = await docxOf(fixture)
    expect(fingerprint.pages.length).toBe(
      plans.reduce((count, plan) => count + plan.pages.length, 0),
    )
    expect(fingerprint.arrangement).toBe(fixture.arrangement.letter)
  })

  test('names a shuffled Version on every page, keys included, in both adapters', async () => {
    const fixture = FIXTURES.find(
      (item) => item.name === 'a realistic composite exam',
    )!
    const plans = [STUDENT_TEST, { test: false, answerKey: true }].map((selection) =>
      planExport({
        exam: fixture.exam,
        arrangement: fixture.arrangement,
        selection,
        measure: fixture.measure,
        version: 'Curly Fox',
      }),
    )
    const docx = await docxFingerprint(
      await (await createExamDocx(plans, fixture.images ? pixel : noImages)).arrayBuffer(),
    )
    expect(docx.pages.length).toBeGreaterThan(1)
    expect(docx.pages.every((page) => page.header.join(' ').includes('Curly Fox'))).toBe(true)
    expectSameDocument(layoutFingerprint(plans), docx)
    expectSameDocument(layoutFingerprint(plans), printFingerprint(plans))
  })

  test('prints no label on the Working Copy’s own arrangement', async () => {
    const fixture = FIXTURES.find(
      (item) => item.name === 'a realistic composite exam',
    )!
    const fingerprint = await docxOf(fixture)
    expect(fingerprint.pages.some((page) => page.header.join(' ').includes('ID:'))).toBe(false)
  })
})

describe('the print Export Adapter carries the planned document', () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, () => {
      const plans = planOf(fixture)
      expectSameDocument(layoutFingerprint(plans), printFingerprint(plans))
    })
  }
})

describe('the two Export Adapters agree', () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, async () => {
      // The same prepared collection, both ways: same documents, same order,
      // same pages, whichever format the teacher chose.
      expectSameDocument(
        printFingerprint(planOf(fixture)),
        await docxOf(fixture),
      )
    })
  }
})

// ---------------------------------------------------------------------------
// Exhaustive coverage
//
// A supported node with no fixture is a node whose export nobody is checking.

describe('the supported document vocabulary', () => {
  function nodeTypesIn(node: ProseMirrorJSON, found: Set<string>): Set<string> {
    found.add(String(node.type ?? ''))
    for (const mark of Array.isArray(node.marks)
      ? (node.marks as ProseMirrorJSON[])
      : []) {
      found.add(String(mark.type ?? ''))
    }
    for (const child of Array.isArray(node.content)
      ? (node.content as ProseMirrorJSON[])
      : []) {
      nodeTypesIn(child, found)
    }
    return found
  }

  const covered = FIXTURES.reduce((found, fixture) => {
    for (const question of fixture.exam.questions)
      nodeTypesIn(question.doc, found)
    return found
  }, new Set<string>())

  test('every supported node appears in a fixture', () => {
    expect(SUPPORTED_NODES.filter((node) => !covered.has(node))).toEqual([])
  })

  test('every supported mark appears in a fixture', () => {
    expect(SUPPORTED_MARKS.filter((mark) => !covered.has(mark))).toEqual([])
  })

  test('every question type and column setting appears in a fixture', () => {
    const columns = new Set(
      FIXTURES.flatMap((fixture) =>
        fixture.exam.questions.map((question) => question.columns),
      ),
    )
    expect([...columns].map(String).sort()).toEqual(['1', '2', '4'])
    const types = new Set(
      FIXTURES.flatMap((fixture) =>
        fixture.exam.questions.map((question) => question.type),
      ),
    )
    // Taken from the vocabulary rather than written out, so a new Question
    // Section owes the corpus a fixture the day it is added.
    expect([...types].sort()).toEqual([...SECTION_ORDER].sort())
  })

  test('every Paper Style appears in a fixture', () => {
    const styles = new Set(FIXTURES.map((fixture) => fixture.exam.paperStyle ?? 'standard'))
    expect([...styles].sort()).toEqual([...PAPER_STYLES].sort())
  })

  test('every page-header variant appears in a fixture', () => {
    const headers = new Set(
      FIXTURES.flatMap((fixture) =>
        planOf(fixture).flatMap((plan) =>
          plan.pages.map((page) => page.header),
        ),
      ),
    )
    expect([...headers].sort()).toEqual(['answer-key', 'answer-key-later', 'first', 'later'])
  })
})

// ---------------------------------------------------------------------------
// The semantic stage on its own

describe('the Export Document', () => {
  const [composite] = FIXTURES.filter((item) => item.name.includes('composite'))

  test('derives both documents from one Exam arrangement', () => {
    const document = buildExportDocument(
      composite!.exam,
      composite!.arrangement,
      STUDENT_TEST,
      unmeasured,
    )
    const fingerprint = exportDocumentFingerprint(document)
    expect(fingerprint.title).toBe('Chemistry: Unit 3 Review')
    expect(fingerprint.arrangement).toBe('A')
    // The key is derived from the same numbered, lettered questions the test
    // shows, so it can never name a letter the paper does not.
    expect(fingerprint.answerKey).toEqual([
      'heading:1 Answer Section',
      'heading:2 Multiple Choice',
      'para 1. «strong»A«/»',
      'para 2. «strong»A«/»',
      'heading:2 Short Answer',
      'para 3.',
    ])
  })

  test('is derived whole whichever documents the selection asks for', () => {
    const both = buildExportDocument(
      composite!.exam,
      composite!.arrangement,
      { test: true, answerKey: true },
      unmeasured,
    )
    const testOnly = buildExportDocument(
      composite!.exam,
      composite!.arrangement,
      STUDENT_TEST,
      unmeasured,
    )
    expect(exportDocumentFingerprint(testOnly).answerKey).toEqual(
      exportDocumentFingerprint(both).answerKey,
    )
  })

  test('omits a section that holds no questions', () => {
    const document = buildExportDocument(
      {
        title: 'One section',
        questions: composite!.exam.questions.slice(0, 1),
      },
      composite!.arrangement,
      STUDENT_TEST,
      unmeasured,
    )
    const lines = exportDocumentFingerprint(document).test
    expect(lines.filter((line) => line.startsWith('heading:1'))).toEqual([
      'heading:1 Multiple Choice',
    ])
  })
})

// ---------------------------------------------------------------------------
// Proving the comparison
//
// A harness that cannot fail proves nothing. Each of these degrades a real
// fingerprint the way the DOCX path used to differ from print, and asserts that
// the comparison names the discrepancy rather than passing it.

function degrade(
  fingerprint: ExportFingerprint,
  change: (lines: string[]) => string[],
): ExportFingerprint {
  return {
    ...fingerprint,
    pages: fingerprint.pages.map((page) => ({
      ...page,
      content: change(page.content),
    })),
  }
}

describe('the comparison detects the discrepancies it exists for', () => {
  const gridFixture = FIXTURES.find((item) =>
    item.name.includes('four-column'),
  )!
  const imageFixture = FIXTURES.find((item) => item.name.includes('images'))!
  const mathFixture = FIXTURES.find((item) =>
    item.name.includes('mathematics'),
  )!
  const tableFixture = FIXTURES.find((item) =>
    item.name.includes('table with a header'),
  )!

  test('a choice grid collapsed into paragraphs', () => {
    const expected = layoutFingerprint(planOf(gridFixture))
    const collapsed = degrade(expected, (lines) =>
      lines.filter(
        (line) =>
          !line.startsWith('table:') &&
          !line.startsWith('cell:') &&
          line !== '/table',
      ),
    )
    const differences = compareFingerprints(expected, collapsed)
    expect(differences).not.toEqual([])
    expect(differences[0]!.what).toBe('content')
    expect(differences[0]!.expected).toBe('table:1x4')
  })

  test('an image replaced by placeholder text', () => {
    const expected = layoutFingerprint(planOf(imageFixture))
    const placeholders = {
      ...degrade(expected, (lines) =>
        lines.map((line) => line.replace(/⟨image:\d+⟩/g, '[Image: burner]')),
      ),
      media: [],
    }
    const differences = compareFingerprints(expected, placeholders)
    expect(differences.map((difference) => difference.what)).toContain(
      'content',
    )
    expect(differences.map((difference) => difference.what)).toContain('media')
  })

  test('mathematics exported as raw source text', () => {
    const expected = layoutFingerprint(planOf(mathFixture))
    const raw = degrade(expected, (lines) =>
      lines.map((line) => line.replace(/⟨math:([^⟩]*)⟩/g, '$1')),
    )
    const [difference] = compareFingerprints(expected, raw)
    expect(difference?.what).toBe('content')
    expect(difference?.expected).toContain('⟨math:E = mc^2⟩')
  })

  test('a Centred block drawn at the left', () => {
    const fixture = FIXTURES.find((item) => item.name === 'a centred figure, caption and table')!
    const expected = layoutFingerprint(planOf(fixture))
    const left = degrade(expected, (lines) => lines.map((line) => line.replace(':center', '')))
    const [difference] = compareFingerprints(expected, left)
    expect(difference?.what).toBe('content')
    expect(difference?.expected).toBe('para:center ⟨image:1⟩')
  })

  test('a table flattened into tab-separated paragraphs', () => {
    const expected = layoutFingerprint(planOf(tableFixture))
    const flattened = degrade(expected, (lines) =>
      lines.flatMap((line) =>
        line.startsWith('table:') ||
        line.startsWith('cell:') ||
        line === '/table'
          ? []
          : [line],
      ),
    )
    const [difference] = compareFingerprints(expected, flattened)
    expect(difference?.what).toBe('content')
    expect(difference?.expected).toBe('table:3x2')
  })

  test('page furniture dropped', () => {
    const expected = layoutFingerprint(planOf(FIXTURES[0]!))
    const bare: ExportFingerprint = {
      ...expected,
      pages: expected.pages.map((page) => ({
        ...page,
        header: [],
        footer: [],
      })),
    }
    const kinds = compareFingerprints(expected, bare).map((item) => item.what)
    expect(kinds).toContain('header')
    expect(kinds).toContain('footer')
  })

  test('content moved to another page', () => {
    const fixture = FIXTURES.find((item) => item.name.includes('moves whole'))!
    const expected = layoutFingerprint(planOf(fixture))
    expect(expected.pages.length).toBe(3)
    const moved: ExportFingerprint = {
      ...expected,
      pages: [
        {
          ...expected.pages[0]!,
          content: [...expected.pages[0]!.content, 'para 2. Second question.'],
        },
        { ...expected.pages[1]!, content: [] },
        expected.pages[2]!,
      ],
    }
    const differences = compareFingerprints(expected, moved)
    expect(differences[0]!.page).toBe(1)
    expect(differences[0]!.what).toBe('content')
  })

  // The tests above degrade a fingerprint by hand, which proves the comparison.
  // This one degrades the *plan* and then runs the real adapter over it, which
  // proves the harness: a DOCX built from a collapsed grid is a DOCX the
  // comparison rejects.
  test('a real DOCX built from a collapsed choice grid', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('four-column'))!
    const [plan] = planOf(fixture)
    const collapsed: LayoutPlan = {
      ...plan!,
      pages: plan!.pages.map((page) => ({
        ...page,
        items: page.items.map((item) =>
          item.kind === 'question' && item.grid
            ? // What the old DOCX path did: the answers become paragraphs and
              // the grid's topology is gone.
              {
                ...item,
                grid: null,
                stem: [
                  ...item.stem,
                  ...item.question.choices.map((choice) => ({
                    type: 'paragraph',
                    content: [{ type: 'text', text: `${choice.letter}. ` }],
                  })),
                ],
              }
            : item,
        ),
      })),
    }
    const blob = await createExamDocx([collapsed], noImages)
    const differences = compareFingerprints(
      layoutFingerprint([plan!]),
      await docxFingerprint(await blob.arrayBuffer()),
    )
    expect(differences).not.toEqual([])
    expect(differences[0]!.what).toBe('content')
    expect(differences[0]!.expected).toBe('table:1x4')
  })

  test('a page lost altogether', () => {
    const fixture = FIXTURES.find((item) =>
      item.name.includes('split across pages'),
    )!
    const expected = layoutFingerprint(planOf(fixture))
    expect(expected.pages.length).toBeGreaterThan(1)
    const short: ExportFingerprint = {
      ...expected,
      pages: expected.pages.slice(0, 1),
    }
    const [difference] = compareFingerprints(expected, short)
    expect(difference?.what).toBe('page-count')
  })
})
