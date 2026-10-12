// Readable source fixtures for export coverage.
//
// One minimal exam per supported document feature, plus boundary cases for page
// transitions and a couple of realistic composites. Everything here is
// synthetic: no student, teacher or school ever appears in the corpus.
//
// A fixture is source, not expectation. What each one should produce is
// asserted through the shared fingerprint, so adding a fixture is cheap and a
// new parity bug costs one more entry in this file.

import { DEFAULT_COLUMNS, type Exam, type Question, type Arrangement } from './exam'
import {
  pageContentHeight,
  unmeasured,
  type Measure,
  type PageItem,
} from './export-plan'
import type { ExportImage } from './export-media'
import type { ProseMirrorJSON } from './question-doc'

export function text(
  value: string,
  ...marks: ProseMirrorJSON[]
): ProseMirrorJSON {
  return marks.length > 0
    ? { type: 'text', text: value, marks }
    : { type: 'text', text: value }
}

export function paragraph(...content: ProseMirrorJSON[]): ProseMirrorJSON {
  return content.length > 0
    ? { type: 'paragraph', content }
    : { type: 'paragraph' }
}

export function mark(
  type: string,
  attrs?: Record<string, unknown>,
): ProseMirrorJSON {
  return attrs ? { type, attrs } : { type }
}

function open(id: string, ...blocks: ProseMirrorJSON[]): Question {
  return {
    id,
    type: 'open',
    columns: DEFAULT_COLUMNS,
    doc: { type: 'doc', content: blocks },
  }
}

function fillInTheBlank(id: string, ...blocks: ProseMirrorJSON[]): Question {
  return {
    id,
    type: 'fill-in-the-blank',
    columns: DEFAULT_COLUMNS,
    doc: { type: 'doc', content: blocks },
  }
}

/** A Blank holding its answer. */
function blank(...answer: ProseMirrorJSON[]): ProseMirrorJSON {
  return answer.length > 0 ? { type: 'blank', content: answer } : { type: 'blank' }
}

function choice(id: string, correct: boolean, ...blocks: ProseMirrorJSON[]) {
  return {
    type: 'multipleChoiceChoice',
    attrs: { correct, id },
    content: blocks,
  }
}

function multipleChoice(
  id: string,
  columns: Question['columns'],
  stem: ProseMirrorJSON[],
  choices: ProseMirrorJSON[],
): Question {
  return {
    id,
    type: 'multiple-choice',
    columns,
    doc: {
      type: 'doc',
      content: [...stem, { type: 'multipleChoice', content: choices }],
    },
  }
}

function trueFalse(
  id: string,
  stem: ProseMirrorJSON[],
  correct: 'true' | 'false',
): Question {
  return {
    id,
    type: 'true-false',
    columns: DEFAULT_COLUMNS,
    doc: {
      type: 'doc',
      content: [
        ...stem,
        {
          type: 'multipleChoice',
          content: [
            choice(`${id}-t`, correct === 'true', paragraph(text('True'))),
            choice(`${id}-f`, correct === 'false', paragraph(text('False'))),
          ],
        },
      ],
    },
  }
}

function prompt(id: string, answer: string, ...blocks: ProseMirrorJSON[]) {
  return { type: 'matchingPrompt', attrs: { id, answer }, content: blocks }
}

function bankAnswer(id: string, ...blocks: ProseMirrorJSON[]) {
  return { type: 'matchingAnswer', attrs: { id }, content: blocks }
}

function matching(
  id: string,
  stem: ProseMirrorJSON[],
  prompts: ProseMirrorJSON[],
  bank: ProseMirrorJSON[],
): Question {
  return {
    id,
    type: 'matching',
    columns: DEFAULT_COLUMNS,
    doc: {
      type: 'doc',
      content: [...stem, { type: 'matching', content: [...prompts, ...bank] }],
    },
  }
}

function part(
  id: string,
  stem: ProseMirrorJSON[],
  answer: ProseMirrorJSON,
  columns: Question['columns'] = DEFAULT_COLUMNS,
): ProseMirrorJSON {
  return {
    type: 'multipartPart',
    attrs: { id, columns },
    content: [{ type: 'multipartPartStem', content: stem }, answer],
  }
}

function subpart(
  id: string,
  stem: ProseMirrorJSON[],
  answer: ProseMirrorJSON,
  columns: Question['columns'] = DEFAULT_COLUMNS,
): ProseMirrorJSON {
  return {
    type: 'multipartSubpart',
    attrs: { id, columns },
    content: [{ type: 'multipartPartStem', content: stem }, answer],
  }
}

/** A Part that holds Subparts: its stem is their lead-in. */
function partWithSubparts(id: string, leadIn: ProseMirrorJSON[], subparts: ProseMirrorJSON[]): ProseMirrorJSON {
  return {
    type: 'multipartPart',
    attrs: { id, columns: DEFAULT_COLUMNS },
    content: [
      { type: 'multipartPartStem', content: leadIn },
      { type: 'multipartSubparts', content: subparts },
    ],
  }
}

function choicesOf(...choices: ProseMirrorJSON[]): ProseMirrorJSON {
  return { type: 'multipleChoice', content: choices }
}

function suggestedAnswer(...blocks: ProseMirrorJSON[]): ProseMirrorJSON {
  return { type: 'suggestedAnswer', content: blocks.length > 0 ? blocks : [paragraph()] }
}

function multipart(
  id: string,
  material: ProseMirrorJSON[],
  parts: ProseMirrorJSON[],
): Question {
  return {
    id,
    type: 'multipart',
    columns: DEFAULT_COLUMNS,
    doc: {
      type: 'doc',
      content: [...material, { type: 'multipartParts', content: parts }],
    },
  }
}

function arrangement(
  questionOrder: string[],
  choiceOrder: Record<string, string[]> = {},
  letter = 'A',
): Arrangement {
  return { id: 'v-fixture', letter, questionOrder, choiceOrder }
}

/** How much a first page has room for — what a fixture aims at when it wants an
 *  item to land exactly on a page boundary. */
export const FIRST_PAGE_BOX = pageContentHeight('first')

/** A `Measure` that gives named items a fixed height and everything else zero,
 *  so a fixture can put a page boundary exactly where it means to. */
export function stubHeights(heights: Record<string, number>): Measure {
  return {
    itemHeight: (item: PageItem) =>
      item.kind === 'question' ? (heights[item.question.id] ?? 0) : 0,
  }
}

/** A one-pixel PNG. Fixtures need real bytes to package, not a real picture. */
export const PIXEL_PNG: ExportImage = {
  data: Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    ),
    (character) => character.charCodeAt(0),
  ),
  type: 'png',
  width: 400,
  height: 200,
}

export type Fixture = {
  name: string
  exam: Exam
  arrangement: Arrangement
  measure: Measure
  /** Every image source in the fixture resolves to the same pixel. */
  images?: boolean
  answerKey?: boolean
}

const fixture = (
  name: string,
  exam: Exam,
  questionArrangement: Arrangement,
  extra: Partial<Fixture> = {},
): Fixture => ({
  name,
  exam,
  arrangement: questionArrangement,
  measure: unmeasured,
  ...extra,
})

// ---------------------------------------------------------------------------
// One fixture per supported feature

// The composite exam, named so the multi-Arrangement fixtures below can publish
// the very same Question Content in several arrangements.
const COMPOSITE_EXAM: Exam = {
  title: 'Chemistry: Unit 3 Review',
  questions: [
    multipleChoice(
      'm1',
      2,
      [
        paragraph(
          text('Which of the following is '),
          text('not', mark('emphasis')),
          text(' a state of matter?'),
        ),
      ],
      [
        choice('c1', false, paragraph(text('Solid'))),
        choice('c2', false, paragraph(text('Liquid'))),
        choice('c3', true, paragraph(text('Energy'))),
        choice('c4', false, paragraph(text('Gas'))),
      ],
    ),
    multipleChoice(
      'm2',
      1,
      [
        paragraph(text('Read the table, then answer.')),
        {
          type: 'table',
          content: [
            {
              type: 'table_row',
              content: [
                { type: 'table_cell', content: [paragraph(text('Sample'))] },
                { type: 'table_cell', content: [paragraph(text('Mass'))] },
              ],
            },
            {
              type: 'table_row',
              content: [
                { type: 'table_cell', content: [paragraph(text('A'))] },
                { type: 'table_cell', content: [paragraph(text('12 g'))] },
              ],
            },
          ],
        },
      ],
      [
        choice('c5', true, paragraph(text('Sample A is heavier.'))),
        choice('c6', false, paragraph(text('Sample B is heavier.'))),
      ],
    ),
    open(
      'o1',
      paragraph(
        text('Using '),
        { type: 'math_inline', attrs: { value: 'PV = nRT' } },
        text(', explain the result.'),
      ),
      paragraph(),
      {
        type: 'image-block',
        attrs: {
          src: `/local-images/${'a'.repeat(64)}`,
          caption: 'Pressure against volume',
        },
      },
    ),
  ],
}

// One question of every type, for the Paper Style fixtures. The Short
// Answer Part has a Work Space of its own, which wins over a style's lines;
// the Short Answer question has none, so a style's lines show there.
const PAPER_STYLE_EXAM: Exam = {
  title: 'Paper Styles',
  questions: [
    multipleChoice(
      'ys-mc',
      1,
      [paragraph(text('Which gas do plants take in?'))],
      [
        choice('ys-mc-a', false, paragraph(text('Oxygen'))),
        choice('ys-mc-b', true, paragraph(text('Carbon dioxide'))),
        choice('ys-mc-c', false, paragraph(text('Helium'))),
        choice('ys-mc-d', false, paragraph(text('Neon'))),
      ],
    ),
    trueFalse('ys-tf', [paragraph(text('Roots absorb water.'))], 'true'),
    matching(
      'ys-mx',
      [paragraph(text('Match each part to its job.'))],
      [
        prompt('ys-mx-p1', 'ys-mx-a2', paragraph(text('Leaf'))),
        prompt('ys-mx-p2', 'ys-mx-a1', paragraph(text('Root'))),
      ],
      [
        bankAnswer('ys-mx-a1', paragraph(text('Takes up water'))),
        bankAnswer('ys-mx-a2', paragraph(text('Makes food'))),
        bankAnswer('ys-mx-a3', paragraph(text('Holds seeds'))),
      ],
    ),
    fillInTheBlank('ys-fb', paragraph(text('A plant makes food in its '), blank(text('leaves')), text('.'))),
    open('ys-sa', paragraph(text('Name one thing a plant needs to grow.'))),
    multipart(
      'ys-mp',
      [paragraph(text('A seed is planted in dry soil.'))],
      [
        part(
          'ys-mp-a',
          [paragraph(text('What does it need first?'))],
          choicesOf(
            choice('ys-mp-a1', true, paragraph(text('Water'))),
            choice('ys-mp-a2', false, paragraph(text('Shade'))),
          ),
          1,
        ),
        part(
          'ys-mp-b',
          [paragraph(text('Explain why.'))],
          suggestedAnswer(paragraph(text('It cannot sprout without it.'))),
        ),
      ],
    ),
  ],
  workSpace: { 'ys-mp-b': { height: 64, style: 'blank', fill: false } },
}

export const FIXTURES: readonly Fixture[] = [
  // A Multipart question is the one shape that takes one number for several questions:
  // the material prints under the number, and each Part prints lettered
  // beneath it the way a question of its kind prints — a Multiple Choice Part
  // with its blank and grid, a Short Answer Part with its work space. Its
  // Multiple Choice Part's answers are shuffled under the Part's own id, so
  // the letter the key reports is the arrangement's.
  fixture(
    'a multipart with a multiple-choice part and a short-answer part',
    {
      title: 'Kingdom of Aldmere',
      questions: [
        multipart(
          's1',
          [
            paragraph(
              text(
                'The power of the Kingdom was fading by 1450, when its last deep harbor silted up.',
              ),
            ),
            paragraph(text('Several other factors contributed to the Kingdom’s decline:')),
            {
              type: 'bullet_list',
              content: [
                {
                  type: 'list_item',
                  content: [paragraph(text('Competition from newer ports to the south'))],
                },
                {
                  type: 'list_item',
                  content: [paragraph(text('Development of other trade routes'))],
                },
              ],
            },
            paragraph(text('Source: “A Short History of Aldmere” (adapted)', mark('emphasis'))),
          ],
          [
            part(
              's1-a',
              [paragraph(text('Which region was controlled by the Kingdom of Aldmere in 1450?'))],
              choicesOf(
                choice('s1-a1', false, paragraph(text('Western Hills'))),
                choice('s1-a2', false, paragraph(text('Southern Plains'))),
                choice('s1-a3', false, paragraph(text('Eastern Forests'))),
                choice('s1-a4', true, paragraph(text('Northern Coast'))),
              ),
              4,
            ),
            part(
              's1-b',
              [paragraph(text('Identify an issue faced by the Kingdom of Aldmere in the 1400s.'))],
              suggestedAnswer(paragraph(text('Its harbors silted up.'))),
            ),
          ],
        ),
      ],
      workSpace: { 's1-b': { height: 96, style: 'lines', fill: false } },
    },
    arrangement(['s1'], { 's1-a': ['s1-a4', 's1-a1', 's1-a2', 's1-a3'] }),
    { answerKey: true },
  ),

  // A Multipart question too tall for one page with all its Parts breaks between them:
  // the material stays with Part a, and later Parts go on to the next page,
  // each whole.
  fixture(
    'a multipart whose later parts continue on the next page',
    {
      title: 'Reading',
      questions: [
        multipart(
          's2',
          [paragraph(text('Read the passage below.')), paragraph(text('A long passage.'))],
          ['a', 'b', 'c'].map((letter) =>
            part(
              `s2-${letter}`,
              [paragraph(text(`Question ${letter} about the passage.`))],
              choicesOf(
                choice(`s2-${letter}1`, true, paragraph(text('Yes'))),
                choice(`s2-${letter}2`, false, paragraph(text('No'))),
              ),
            ),
          ),
        ),
      ],
    },
    arrangement(['s2']),
    {
      measure: {
        itemHeight: (item) =>
          item.kind === 'question'
            ? item.stem.length * 200 + (item.parts?.length ?? 0) * 260
            : 40,
      },
    },
  ),

  // A Part may hold Subparts: its stem prints as their lead-in, and each
  // Subpart prints numbered beneath it, one level further in, as a Part of
  // its kind prints — a shuffled Multiple Choice Subpart, a Short Answer one
  // with ruled room. The key gives one line per Subpart, labelled with its
  // place under its Part.
  fixture(
    'a multipart whose part holds subparts',
    {
      title: 'Pond Survey',
      questions: [
        multipart(
          'sp1',
          [paragraph(text('A class counted the frogs at a pond each month for a year.'))],
          [
            part(
              'sp1-a',
              [paragraph(text('Name one thing a frog eats.'))],
              suggestedAnswer(paragraph(text('Insects.'))),
            ),
            partWithSubparts(
              'sp1-b',
              [paragraph(text('The count was highest in April.'))],
              [
                subpart(
                  'sp1-b-i',
                  [paragraph(text('In which season is April?'))],
                  choicesOf(
                    choice('sp1-b-i1', true, paragraph(text('Spring'))),
                    choice('sp1-b-i2', false, paragraph(text('Autumn'))),
                    choice('sp1-b-i3', false, paragraph(text('Winter'))),
                  ),
                  1,
                ),
                subpart(
                  'sp1-b-ii',
                  [paragraph(text('Suggest why more frogs were seen then.'))],
                  suggestedAnswer(paragraph(text('Frogs gather at ponds to breed in spring.'))),
                ),
              ],
            ),
          ],
        ),
      ],
      workSpace: { 'sp1-b-ii': { height: 64, style: 'lines', fill: false } },
    },
    arrangement(['sp1'], { 'sp1-b-i': ['sp1-b-i2', 'sp1-b-i1', 'sp1-b-i3'] }),
    { answerKey: true },
  ),

  // Points on everything a student answers (ADR-0042): a Multiple Choice
  // question with Question Metadata beside its `[n]`, an unpointed True/False
  // one, a Matching set worth Points as a whole, and a Multipart question whose
  // Part and Subparts carry their own. No current Paper Style prints Points on
  // the test; the key prints each `[n]` and the paper's total.
  fixture(
    'a paper with points',
    {
      title: 'Rivers',
      questions: [
        {
          ...multipleChoice(
            'mk1',
            2,
            [paragraph(text('Where does a river begin?'))],
            [
              choice('mk1-a', true, paragraph(text('Its source'))),
              choice('mk1-b', false, paragraph(text('Its mouth'))),
            ],
          ),
          points: 1,
          difficulty: 'easy',
          topics: ['Rivers'],
        },
        trueFalse('mk2', [paragraph(text('A delta forms at a river’s source.'))], 'false'),
        {
          ...matching(
            'mk3',
            [paragraph(text('Match each word to its meaning.'))],
            [
              prompt('mk3-p1', 'mk3-a1', paragraph(text('Tributary'))),
              prompt('mk3-p2', 'mk3-a2', paragraph(text('Meander'))),
            ],
            [
              bankAnswer('mk3-a1', paragraph(text('A stream that joins a river'))),
              bankAnswer('mk3-a2', paragraph(text('A bend in a river'))),
            ],
          ),
          points: 2,
        },
        multipart(
          'mk4',
          [paragraph(text('A river floods its valley every spring.'))],
          [
            { ...part('mk4-a', [paragraph(text('Name the flat land that floods.'))], suggestedAnswer(paragraph(text('The floodplain.')))), attrs: { id: 'mk4-a', columns: DEFAULT_COLUMNS, points: 1 } },
            partWithSubparts(
              'mk4-b',
              [paragraph(text('Farmers grow crops on the flooded land.'))],
              [
                { ...subpart('mk4-b-i', [paragraph(text('What does a flood leave behind?'))], suggestedAnswer(paragraph(text('Silt.')))), attrs: { id: 'mk4-b-i', columns: DEFAULT_COLUMNS, points: 2 } },
                { ...subpart('mk4-b-ii', [paragraph(text('Give one danger of farming there.'))], suggestedAnswer()), attrs: { id: 'mk4-b-ii', columns: DEFAULT_COLUMNS, points: 3 } },
              ],
            ),
          ],
        ),
      ],
    },
    arrangement(['mk1', 'mk2', 'mk3', 'mk4']),
    { answerKey: true },
  ),

  // A Part's Subparts may break across pages: the lead-in stays with
  // Subpart (i), and the Subparts after the break continue on the next page
  // without the Part's letter or lead-in printed again.
  fixture(
    'a part whose later subparts continue on the next page',
    {
      title: 'Reading',
      questions: [
        multipart(
          'sp2',
          [paragraph(text('Read the notice below.'))],
          [
            partWithSubparts(
              'sp2-a',
              [paragraph(text('The notice is about a lost cat.'))],
              ['i', 'ii', 'iii'].map((label) =>
                subpart(
                  `sp2-a-${label}`,
                  [paragraph(text(`Question (${label}) about the notice.`))],
                  choicesOf(
                    choice(`sp2-a-${label}1`, true, paragraph(text('Yes'))),
                    choice(`sp2-a-${label}2`, false, paragraph(text('No'))),
                  ),
                ),
              ),
            ),
          ],
        ),
      ],
    },
    arrangement(['sp2']),
    {
      measure: {
        itemHeight: (item) =>
          item.kind === 'question'
            ? item.stem.length * 200
              + (item.parts ?? []).reduce(
                (sum, part) => sum + (part.continued ? 0 : 100) + part.subparts.length * 260,
                0,
              )
            : 40,
      },
    },
  ),

  // A True/False question is the one shape where an answer blank prints with no
  // choice grid behind it, and where the key letter is not a choice letter.
  // Both adapters have to agree about that on their own.
  fixture(
    'a true/false question and its T or F key entry',
    {
      title: 'True/False',
      questions: [
        trueFalse('t1', [paragraph(text('Mitochondria produce ATP.'))], 'true'),
        trueFalse(
          't2',
          [paragraph(text('Enzymes are consumed by the reactions they catalyze.'))],
          'false',
        ),
      ],
    },
    arrangement(['t1', 't2']),
  ),

  // A matching set is the one shape that takes several numbers, prints them
  // on its items rather than beside its stem, and lays out as two columns
  // stacked independently. Its Word Bank is shuffled here, so the letters the
  // key reports are the arrangement's and not the authored order's.
  fixture(
    'a matching set with a shuffled word bank and an unmatched item',
    {
      title: 'Matching',
      questions: [
        matching(
          'x1',
          [paragraph(text('Match each event to the correct time period.'))],
          [
            prompt('x1-p1', 'x1-a3', paragraph(text('Iron tools replaced bronze ones.'))),
            prompt('x1-p2', 'x1-a1', paragraph(text('The first stone tools were made.'))),
            prompt('x1-p3', '', paragraph(text('Bronze tools were first made.'))),
          ],
          [
            bankAnswer('x1-a1', paragraph(text('Stone Age'))),
            bankAnswer('x1-a2', paragraph(text('Bronze Age'))),
            bankAnswer('x1-a3', paragraph(text('Iron Age'))),
            bankAnswer('x1-a4', paragraph(text('Middle Ages'))),
          ],
        ),
      ],
    },
    arrangement(['x1'], { x1: ['x1-a4', 'x1-a3', 'x1-a1', 'x1-a2'] }),
  ),

  // A Fill in the Blank question prints its Blanks as lines of one length,
  // whatever their answers, under one number however many it holds; the key
  // gives the answers in order on one line, with their own marks and maths.
  fixture(
    'fill in the blank questions with one and with two blanks',
    {
      title: 'Fill in the Blank',
      questions: [
        { ...fillInTheBlank('f1', paragraph(text('Water freezes at '), blank(text('zero')), text(' degrees Celsius.'))), points: 2 },
        fillInTheBlank(
          'f2',
          paragraph(
            text('The area of a circle is '),
            blank({ type: 'math_inline', attrs: { value: '\\pi r^2' } }),
            text(', and its edge is called the '),
            blank(text('circumference', mark('emphasis'))),
            text('.'),
          ),
        ),
        fillInTheBlank('f3', paragraph(text('A sentence whose Blank has no answer yet: '), blank(), text('.'))),
      ],
    },
    arrangement(['f1', 'f2', 'f3']),
  ),

  // Past five answers the bank moves above the prompts into two columns,
  // column-major — the other shape a source test prints a matching set in.
  fixture(
    'a matching set whose long word bank prints above its items',
    {
      title: 'Beatitudes',
      questions: [
        matching(
          'x2',
          [paragraph(text('Match each description with the correct character trait.'))],
          [
            prompt('x2-p1', 'x2-a4', paragraph(text('passionately wanting righteousness'))),
            prompt('x2-p2', 'x2-a2', paragraph(text('sorrowful because of sin'))),
            prompt('x2-p3', 'x2-a7', paragraph(text('proclaiming the message'))),
            prompt('x2-p4', 'x2-a1', paragraph(text('aware of having no merit'))),
            prompt('x2-p5', 'x2-a8', paragraph(text('mistreated for following'))),
            prompt('x2-p6', 'x2-a5', paragraph(text('not insisting on what is deserved'))),
            prompt('x2-p7', 'x2-a3', paragraph(text('considerate even when slandered'))),
          ],
          [
            bankAnswer('x2-a1', paragraph(text('poor in spirit'))),
            bankAnswer('x2-a2', paragraph(text('mourners'))),
            bankAnswer('x2-a3', paragraph(text('meek'))),
            bankAnswer('x2-a4', paragraph(text('hungry for righteousness'))),
            bankAnswer('x2-a5', paragraph(text('merciful'))),
            bankAnswer('x2-a6', paragraph(text('pure in heart'))),
            bankAnswer('x2-a7', paragraph(text('peacemaking'))),
            bankAnswer('x2-a8', paragraph(text('persecuted for righteousness'))),
          ],
        ),
      ],
    },
    arrangement(['x2']),
  ),

  // Too many items for one page at any real size: the set breaks between its
  // items and every piece prints the whole Word Bank again.
  fixture(
    'a matching set too long for one page, its word bank on every piece',
    {
      title: 'Vocabulary',
      questions: [
        matching(
          'x3',
          [paragraph(text('Match each word to its part of speech.'))],
          Array.from({ length: 40 }, (_unused, index) =>
            prompt(`x3-p${index + 1}`, `x3-a${(index % 4) + 1}`, paragraph(text(`vocabulary word ${index + 1}`))),
          ),
          [
            bankAnswer('x3-a1', paragraph(text('noun'))),
            bankAnswer('x3-a2', paragraph(text('verb'))),
            bankAnswer('x3-a3', paragraph(text('adjective'))),
            bankAnswer('x3-a4', paragraph(text('adverb'))),
          ],
        ),
      ],
    },
    arrangement(['x3']),
    {
      measure: {
        itemHeight: (item) =>
          item.kind === 'question'
            ? item.stem.length * 30 + (item.matching ? item.matching.prompts.length * 32 + 120 : 0)
            : 40,
      },
    },
  ),

  fixture(
    'all four sections on one paper',
    {
      title: 'Mixed sections',
      questions: [
        open('o1', paragraph(text('Explain osmosis.'))),
        trueFalse('t1', [paragraph(text('Water is a compound.'))], 'true'),
        matching(
          'x1',
          [paragraph(text('Match each term with its definition.'))],
          [
            prompt('x1-p1', 'x1-a2', paragraph(text('Osmosis'))),
            prompt('x1-p2', 'x1-a1', paragraph(text('Diffusion'))),
          ],
          [
            bankAnswer('x1-a1', paragraph(text('Particles spread out.'))),
            bankAnswer('x1-a2', paragraph(text('Water crosses a membrane.'))),
          ],
        ),
        multipleChoice(
          'm1',
          2,
          [paragraph(text('Which particle is neutral?'))],
          [
            choice('m1-a', false, paragraph(text('Proton'))),
            choice('m1-b', true, paragraph(text('Neutron'))),
          ],
        ),
      ],
    },
    arrangement(['o1', 't1', 'x1', 'm1']),
  ),

  // An Exam that rewords its section headings: a new Multiple Choice heading
  // with its directions cleared, a Short Answer heading cleared of both — so it
  // prints nothing at all — and new Matching directions under the default
  // heading, every heading at the large size. The key's section titles follow
  // the test's, and name the cleared Short Answer group by its default.
  fixture(
    'reworded, cleared and large section headings',
    {
      title: 'Reworded sections',
      questions: [
        open('o1', paragraph(text('Explain osmosis.'))),
        matching(
          'x1',
          [paragraph(text('Match each term with its definition.'))],
          [
            prompt('x1-p1', 'x1-a2', paragraph(text('Osmosis'))),
            prompt('x1-p2', 'x1-a1', paragraph(text('Diffusion'))),
          ],
          [
            bankAnswer('x1-a1', paragraph(text('Particles spread out.'))),
            bankAnswer('x1-a2', paragraph(text('Water crosses a membrane.'))),
          ],
        ),
        multipleChoice(
          'm1',
          2,
          [paragraph(text('Which particle is neutral?'))],
          [
            choice('m1-a', false, paragraph(text('Proton'))),
            choice('m1-b', true, paragraph(text('Neutron'))),
          ],
        ),
      ],
      sectionHeadings: {
        'multiple-choice': { title: 'Choose One', instructions: '' },
        open: { title: '', instructions: '' },
        matching: { instructions: 'Write the letter of the matching definition.' },
      },
      headingSize: 'large',
    },
    arrangement(['o1', 'x1', 'm1']),
    { answerKey: true },
  ),

  // An Exam's own header line on its first page, beside the ID that is never
  // part of it.
  fixture(
    'a reworded header line',
    {
      title: 'Reworded header',
      questions: [open('o1', paragraph(text('Explain osmosis.')))],
      header: { first: 'Student: __________  Period: ____' },
    },
    arrangement(['o1']),
    { answerKey: true },
  ),

  // Large text and small headings: the text size reaches the questions and the
  // key, the heading size the title, and the header line keeps its own type.
  fixture(
    'large text under small headings',
    {
      title: 'Sized type',
      questions: [
        multipleChoice(
          'm1',
          2,
          [paragraph(text('Which particle is neutral?'))],
          [
            choice('m1-a', false, paragraph(text('Proton'))),
            choice('m1-b', true, paragraph(text('Neutron'))),
          ],
        ),
      ],
      headingSize: 'small',
      textSize: 'large',
    },
    arrangement(['m1']),
    { answerKey: true },
  ),

  // An Exam's own Page Margins, a different one on each side: every adapter
  // cuts the sheet the plan packed against.
  fixture(
    'an exam with its own page margins',
    {
      title: 'Own margins',
      questions: [
        multipleChoice(
          'm1',
          2,
          [paragraph(text('Which particle is neutral?'))],
          [
            choice('m1-a', false, paragraph(text('Proton'))),
            choice('m1-b', true, paragraph(text('Neutron'))),
          ],
        ),
        open('o1', paragraph(text('Explain osmosis.'))),
      ],
      margins: { top: 1, right: 0.6, bottom: 1.25, left: 0.85 },
    },
    arrangement(['m1', 'o1']),
    { answerKey: true },
  ),

  fixture(
    'a plain short-answer question',
    {
      title: 'Plain',
      questions: [open('o1', paragraph(text('Explain photosynthesis.')))],
    },
    arrangement(['o1']),
  ),

  fixture(
    'every inline mark',
    {
      title: 'Marks',
      questions: [
        open(
          'o1',
          paragraph(
            text('normal '),
            text('strong', mark('strong')),
            text(' '),
            text('emphasis', mark('emphasis')),
            text(' '),
            text('code', mark('inlineCode')),
            text(' '),
            text('struck', mark('strike_through')),
            text(' H'),
            text('2', mark('subscript')),
            text('O and x'),
            text('2', mark('superscript')),
          ),
        ),
      ],
    },
    arrangement(['o1']),
  ),

  fixture(
    'a link and its destination',
    {
      title: 'Links',
      questions: [
        open(
          'o1',
          paragraph(
            text('Read '),
            text(
              'the notes',
              mark('link', { href: 'https://example.test/notes' }),
            ),
            text(' first.'),
          ),
        ),
      ],
    },
    arrangement(['o1']),
  ),

  fixture(
    'authored blank paragraphs and hard breaks',
    {
      title: 'Whitespace',
      questions: [
        open(
          'o1',
          paragraph(text('Show  your  work')),
          paragraph(),
          paragraph(),
          paragraph(text('first'), { type: 'hardbreak' }, text('second')),
        ),
      ],
    },
    arrangement(['o1']),
  ),

  fixture(
    'headings and a block quote',
    {
      title: 'Structure',
      questions: [
        open(
          'o1',
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [text('Background')],
          },
          { type: 'heading', attrs: { level: 3 }, content: [text('Detail')] },
          {
            type: 'blockquote',
            content: [
              paragraph(text('Energy cannot be created or destroyed.')),
            ],
          },
        ),
      ],
    },
    arrangement(['o1']),
  ),

  // A Blockquote prints boxed, and a boxed source passage often holds a list;
  // opening a question, it takes the number on a line of its own, as a table
  // does. Its source line is the ordinary paragraph after it.
  fixture(
    'a boxed passage that opens its question',
    {
      title: 'Boxes',
      questions: [
        open(
          'o1',
          {
            type: 'blockquote',
            content: [
              paragraph(text('Several factors contributed to the decline:')),
              {
                type: 'bullet_list',
                content: [
                  { type: 'list_item', content: [paragraph(text('Competition from newer ports'))] },
                  { type: 'list_item', content: [paragraph(text('Rising unemployment'))] },
                ],
              },
            ],
          },
          paragraph(text('Source: A Short History of Aldmere, 1998 (adapted)')),
          paragraph(text('Identify one cause of the decline.')),
        ),
      ],
    },
    arrangement(['o1']),
  ),

  // A Side-by-Side lays its Panels across one line: two graphs, a table beside
  // a graph, a picture beside text — each Panel holding any stem block.
  fixture(
    'side-by-side panels of pictures, tables and text',
    {
      title: 'Side by side',
      questions: [
        multipleChoice(
          'm1',
          2,
          [
            {
              type: 'sideBySide',
              content: [
                {
                  type: 'sideBySidePanel',
                  content: [
                    {
                      type: 'image-block',
                      attrs: { src: `/local-images/${'b'.repeat(64)}`, caption: 'Graph of f' },
                    },
                  ],
                },
                {
                  type: 'sideBySidePanel',
                  content: [
                    {
                      type: 'image-block',
                      attrs: { src: `/local-images/${'c'.repeat(64)}`, caption: 'Graph of g', ratio: 0.6 },
                    },
                  ],
                },
              ],
            },
            paragraph(text('Which transformation takes f to g?')),
          ],
          [
            choice('c1', true, paragraph(text('g(x) = f(x − 2) − 3'))),
            choice('c2', false, paragraph(text('g(x) = f(x + 2) + 3'))),
          ],
        ),
        open(
          'o1',
          paragraph(text('Use the table and the notes below.')),
          {
            type: 'sideBySide',
            content: [
              {
                type: 'sideBySidePanel',
                content: [
                  {
                    type: 'table',
                    content: [
                      {
                        type: 'table_row',
                        content: [
                          { type: 'table_cell', content: [paragraph(text('x'))] },
                          { type: 'table_cell', content: [paragraph(text('−3'))] },
                        ],
                      },
                      {
                        type: 'table_row',
                        content: [
                          { type: 'table_cell', content: [paragraph(text('g(x)'))] },
                          { type: 'table_cell', content: [paragraph(text('−5'))] },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'sideBySidePanel',
                content: [
                  paragraph(text('Group A: '), text('12.5%', mark('emphasis'))),
                  {
                    type: 'blockquote',
                    content: [paragraph(text('Group B: 82%'))],
                  },
                ],
              },
              {
                type: 'sideBySidePanel',
                content: [
                  paragraph(
                    text('Where '),
                    { type: 'math_inline', attrs: { value: '-1 \\le x \\le 5' } },
                  ),
                ],
              },
            ],
          },
        ),
        // A Side-by-Side opening its question takes the number on a line of
        // its own.
        open(
          'o2',
          {
            type: 'sideBySide',
            content: [
              { type: 'sideBySidePanel', content: [paragraph(text('Left'))] },
              { type: 'sideBySidePanel', content: [paragraph(text('Right'))] },
            ],
          },
        ),
      ],
    },
    arrangement(['m1', 'o1', 'o2']),
    { images: true },
  ),

  // A Centred figure with its caption, and a Centred table with a centred
  // cell; a Centred block that opens its question keeps the number at the left.
  fixture(
    'a centred figure, caption and table',
    {
      title: 'Centred',
      questions: [
        open(
          'o1',
          paragraph(text('Fig. 1.1 shows a leaf seen through a hand lens.')),
          {
            type: 'image-block',
            attrs: { src: `/local-images/${'d'.repeat(64)}`, size: 0.5, align: 'center' },
          },
          { ...paragraph(text('Fig. 1.1', mark('strong'))), attrs: { align: 'center' } },
          {
            type: 'table',
            attrs: { align: 'center' },
            content: [
              {
                type: 'table_header_row',
                content: [
                  { type: 'table_header', content: [paragraph(text('Leaf'))] },
                  { type: 'table_header', content: [{ ...paragraph(text('Length / mm')), attrs: { align: 'center' } }] },
                ],
              },
              {
                type: 'table_row',
                content: [
                  { type: 'table_cell', content: [paragraph(text('A'))] },
                  { type: 'table_cell', content: [{ ...paragraph(text('42')), attrs: { align: 'center' } }] },
                ],
              },
            ],
          },
          { ...paragraph(text('Table 1.1')), attrs: { align: 'center' } },
          paragraph(text('Describe the leaf.')),
        ),
        open(
          'o2',
          { ...paragraph(text('Table 2.1')), attrs: { align: 'center' } },
          {
            type: 'image-block',
            attrs: { src: `/local-images/${'e'.repeat(64)}`, caption: 'A captioned figure', align: 'center' },
          },
        ),
      ],
    },
    arrangement(['o1', 'o2']),
    { images: true },
  ),

  fixture(
    'bullet, ordered and nested lists',
    {
      title: 'Lists',
      questions: [
        open(
          'o1',
          {
            type: 'bullet_list',
            content: [
              { type: 'list_item', content: [paragraph(text('alpha'))] },
              {
                type: 'list_item',
                content: [
                  paragraph(text('beta')),
                  {
                    type: 'bullet_list',
                    content: [
                      {
                        type: 'list_item',
                        content: [paragraph(text('beta one'))],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'ordered_list',
            attrs: { order: 3 },
            content: [
              { type: 'list_item', content: [paragraph(text('third'))] },
              { type: 'list_item', content: [paragraph(text('fourth'))] },
            ],
          },
        ),
      ],
    },
    arrangement(['o1']),
  ),

  fixture(
    'a code block and a horizontal rule',
    {
      title: 'Code',
      questions: [
        open(
          'o1',
          {
            type: 'code_block',
            attrs: { language: 'python' },
            content: [text('total = 0\nfor item in items:\n    total += item')],
          },
          { type: 'hr' },
          paragraph(text('What does this print?')),
        ),
      ],
    },
    arrangement(['o1']),
  ),

  fixture(
    'a table with a header row',
    {
      title: 'Tables',
      questions: [
        open('o1', {
          type: 'table',
          content: [
            {
              type: 'table_header_row',
              content: [
                { type: 'table_header', content: [paragraph(text('Element'))] },
                { type: 'table_header', content: [paragraph(text('Symbol'))] },
              ],
            },
            {
              type: 'table_row',
              content: [
                { type: 'table_cell', content: [paragraph(text('Sodium'))] },
                { type: 'table_cell', content: [paragraph(text('Na'))] },
              ],
            },
            {
              type: 'table_row',
              content: [
                { type: 'table_cell', content: [paragraph(text('Chlorine'))] },
                { type: 'table_cell', content: [paragraph(text('Cl'))] },
              ],
            },
          ],
        }),
      ],
    },
    arrangement(['o1']),
  ),

  fixture(
    'inline and block images',
    {
      title: 'Images',
      questions: [
        open(
          'o1',
          paragraph(
            text('The apparatus '),
            {
              type: 'image',
              attrs: { src: `/local-images/${'b'.repeat(64)}`, alt: 'burner' },
            },
            text(' is shown.'),
          ),
          // Dragged to half the size it fit at, the way Crepe records a
          // resize: every adapter has to size it by this, not by its bytes.
          {
            type: 'image-block',
            attrs: {
              src: `/local-images/${'c'.repeat(64)}`,
              caption: 'Full setup',
              ratio: 0.5,
            },
          },
        ),
      ],
    },
    arrangement(['o1']),
    { images: true },
  ),

  // A picture belongs to the column its block sits in: past a Multiple Choice
  // question's blank and number, and past a choice's letter.
  fixture(
    'pictures in a multiple-choice stem and choice',
    {
      title: 'Apparatus',
      questions: [
        multipleChoice(
          'm1',
          2,
          [
            paragraph(text('Which piece of glassware is shown?')),
            { type: 'image-block', attrs: { src: `/local-images/${'d'.repeat(64)}`, caption: '', ratio: 1 } },
            { type: 'image', attrs: { src: `/local-images/${'e'.repeat(64)}`, alt: 'flask' } },
          ],
          [
            choice('m1-c1', true, { type: 'image', attrs: { src: `/local-images/${'f'.repeat(64)}`, alt: 'beaker' } }),
            choice('m1-c2', false, paragraph(text('A burette'))),
          ],
        ),
      ],
    },
    arrangement(['m1']),
    { images: true },
  ),

  fixture(
    'inline and display mathematics',
    {
      title: 'Maths',
      questions: [
        open(
          'o1',
          paragraph(
            text('Given '),
            { type: 'math_inline', attrs: { value: 'E = mc^2' } },
            text(', solve for m.'),
          ),
          {
            type: 'code_block',
            attrs: { language: 'latex' },
            content: [text('\\frac{a}{b} = \\sqrt{c}')],
          },
        ),
      ],
    },
    arrangement(['o1']),
  ),

  // The notation a math test is written in, as an AI conversion writes
  // it: display fractions, relations, sized delimiters, composition and
  // explicit spaces.
  fixture(
    'school mathematics notation',
    {
      title: 'Math Notation',
      questions: [
        open(
          'o1',
          paragraph(
            text('The function f is given by '),
            { type: 'math_inline', attrs: { value: 'f(x) = \\dfrac{2x + 1}{x - 3}' } },
            text(' for '),
            { type: 'math_inline', attrs: { value: '-1 \\le x \\le 5' } },
            text('.'),
          ),
          paragraph(
            { type: 'math_inline', attrs: { value: 'h(x) = 2f\\left(\\frac{x}{3}\\right) - 4' } },
            text(', '),
            { type: 'math_inline', attrs: { value: '(f \\circ g)(x)' } },
            text(', '),
            { type: 'math_inline', attrs: { value: '\\left[-\\tfrac{1}{2}, \\tfrac{1}{3}\\right]' } },
            text(', '),
            { type: 'math_inline', attrs: { value: '[-2,\\ 6]' } },
            text(', '),
            { type: 'math_inline', attrs: { value: 'f^{-1}(x) \\ne g(x)' } },
            text(', '),
            { type: 'math_inline', attrs: { value: '\\text{undefined}' } },
          ),
          {
            type: 'code_block',
            attrs: { language: 'latex' },
            content: [text('\\frac{\\sqrt{x + 1}}{2} \\geq 0')],
          },
        ),
      ],
    },
    arrangement(['o1']),
  ),

  fixture(
    'a four-column choice grid with an empty cell',
    {
      title: 'Grids',
      questions: [
        multipleChoice(
          'm1',
          4,
          [paragraph(text('Which is a noble gas?'))],
          [
            choice('c1', false, paragraph(text('Oxygen'))),
            choice('c2', true, paragraph(text('Argon'))),
            choice('c3', false, paragraph(text('Sodium'))),
          ],
        ),
      ],
    },
    arrangement(['m1'], { m1: ['c2', 'c1', 'c3'] }),
  ),

  fixture(
    'a one-column choice grid',
    {
      title: 'One column',
      questions: [
        multipleChoice(
          'm1',
          1,
          [paragraph(text('Which statement is correct?'))],
          [
            choice(
              'c1',
              true,
              paragraph(text('Mass is conserved in a closed system.')),
            ),
            choice(
              'c2',
              false,
              paragraph(text('Mass is created by combustion.')),
            ),
          ],
        ),
      ],
    },
    arrangement(['m1']),
  ),

  fixture(
    'a two-column choice grid with rich answers',
    {
      title: 'Rich answers',
      questions: [
        multipleChoice(
          'm1',
          2,
          [paragraph(text('Pick the correct formula.'))],
          [
            choice(
              'c1',
              true,
              paragraph(text('H'), text('2', mark('subscript')), text('O')),
            ),
            choice(
              'c2',
              false,
              paragraph({ type: 'math_inline', attrs: { value: 'x^2' } }),
            ),
            choice('c3', false, paragraph(text('none', mark('emphasis')))),
            choice('c4', false, paragraph()),
          ],
        ),
      ],
    },
    arrangement(['m1']),
  ),

  fixture(
    'both sections with the answer key',
    {
      title: 'Full paper',
      questions: [
        {
          ...multipleChoice(
            'm1',
            2,
            [paragraph(text('Which is an acid?'))],
            [
              choice('c1', false, paragraph(text('NaOH'))),
              choice('c2', true, paragraph(text('HCl'))),
            ],
          ),
          difficulty: 'easy',
          topics: ['Acids'],
        },
        {
          ...open('o1', paragraph(text('Describe a titration.'))),
          difficulty: 'hard',
          topics: ['Titration'],
        },
      ],
    },
    arrangement(['o1', 'm1']),
    { answerKey: true },
  ),

  fixture(
    'a question that moves whole to the next page',
    {
      title: 'Page break',
      questions: [
        open('o1', paragraph(text('First question.'))),
        open('o2', paragraph(text('Second question.'))),
      ],
    },
    arrangement(['o1', 'o2']),
    { measure: stubHeights({ o1: 600, o2: 400 }) },
  ),

  fixture(
    'a question split across pages',
    {
      title: 'Split question',
      questions: [
        open(
          'o1',
          paragraph(text('Part one of a very long question.')),
          paragraph(text('Part two of a very long question.')),
          paragraph(text('Part three of a very long question.')),
        ),
      ],
    },
    arrangement(['o1']),
    { measure: stubHeights({ o1: 5000 }) },
  ),

  fixture(
    'a question with two answer columns',
    {
      title: 'Two columns',
      questions: [
        multipleChoice(
          'm1',
          2,
          [paragraph(text('Which planet is closest to the sun?'))],
          [
            choice('c1', true, paragraph(text('Mercury'))),
            choice('c2', false, paragraph(text('Venus'))),
            choice('c3', false, paragraph(text('Earth'))),
            choice('c4', false, paragraph(text('Mars'))),
          ],
        ),
      ],
    },
    arrangement(['m1']),
  ),

  fixture(
    'a question that exactly fills the first page',
    {
      title: 'Exact fit',
      questions: [
        open('o1', paragraph(text('Fills the page exactly.'))),
        open('o2', paragraph(text('Starts the second.'))),
      ],
    },
    arrangement(['o1', 'o2']),
    { measure: stubHeights({ o1: FIRST_PAGE_BOX, o2: 100 }) },
  ),

  fixture(
    'a choice grid kept whole when its question moves',
    {
      title: 'Grid kept whole',
      questions: [
        open('o1', paragraph(text('Takes most of the first page.'))),
        multipleChoice(
          'm1',
          2,
          [paragraph(text('Which is a mammal?'))],
          [
            choice('c1', true, paragraph(text('Whale'))),
            choice('c2', false, paragraph(text('Shark'))),
            choice('c3', false, paragraph(text('Trout'))),
          ],
        ),
      ],
    },
    arrangement(['m1', 'o1']),
    { measure: stubHeights({ m1: 500, o1: 500 }) },
  ),

  fixture(
    'a section heading kept with its first question',
    {
      title: 'Heading kept',
      questions: [
        multipleChoice(
          'm1',
          1,
          [paragraph(text('Fills the page.'))],
          [
            choice('c1', true, paragraph(text('Yes'))),
            choice('c2', false, paragraph(text('No'))),
          ],
        ),
        open('o1', paragraph(text('The short-answer section starts here.'))),
      ],
    },
    arrangement(['m1', 'o1']),
    { measure: stubHeights({ m1: FIRST_PAGE_BOX - 20, o1: 200 }) },
  ),

  fixture(
    'content order preserved across several pages',
    {
      title: 'Many pages',
      questions: [
        open('o1', paragraph(text('One.'))),
        open('o2', paragraph(text('Two.'))),
        open('o3', paragraph(text('Three.'))),
        open('o4', paragraph(text('Four.'))),
      ],
    },
    arrangement(['o1', 'o2', 'o3', 'o4']),
    { measure: stubHeights({ o1: 500, o2: 500, o3: 500, o4: 500 }) },
  ),

  fixture(
    'Short Answer work space, lined, blank and filling its page',
    {
      title: 'Work space',
      questions: [
        open('o1', paragraph(text('Show how you balanced the equation.'))),
        open('o2', paragraph(text('Sketch the apparatus.'))),
        open('o3', paragraph(text('Explain your reasoning.'))),
        open('o4', paragraph(text('Starts a new page after a filled one.'))),
      ],
      workSpace: {
        o1: { height: 160, style: 'lines', fill: false },
        o2: { height: 96, style: 'blank', fill: false },
        o3: { height: 64, style: 'lines', fill: true },
      },
    },
    arrangement(['o1', 'o2', 'o3', 'o4']),
    { measure: stubHeights({ o1: 200, o2: 150, o3: 100, o4: 100 }) },
  ),

  fixture(
    'a Short Answer question with its Suggested Answer in the key',
    {
      title: 'Suggested answers',
      questions: [
        {
          ...open('o1', paragraph(text('Why do leaves change colour?'))),
          suggestedAnswer: {
            type: 'doc',
            content: [
              paragraph(text('Chlorophyll breaks down, ')),
              paragraph(text('revealing ', ), text('carotenoids', mark('strong')), text('.')),
            ],
          },
        },
        open('o2', paragraph(text('A question with no answer given.'))),
      ],
    },
    arrangement(['o1', 'o2']),
    { answerKey: true },
  ),

  fixture(
    'a realistic composite exam',
    COMPOSITE_EXAM,
    arrangement(['m2', 'm1'], { m1: ['c3', 'c1', 'c4', 'c2'] }),
    {
      images: true,
      answerKey: true,
      measure: stubHeights({ m1: 300, m2: 300, o1: 300 }),
    },
  ),

  // The Exam Board Paper Style (ADR-0045) over a paper with points: on A4,
  // the paper's total beneath the title, `1`, `(a)`, `(i)` and `A` labels,
  // dotted lines where the teacher set no Work Space, each answer's `[n]` at
  // the right margin, the Multipart question's `[Total: 9]`, the page number
  // above the header line and "Turn over" at the foot of every test page but
  // the last. One question to a page, so the test runs over several.
  fixture(
    'a paper with points in the exam board paper style',
    {
      title: 'Plant Biology',
      paperStyle: 'exam-board',
      questions: [
        {
          ...multipleChoice(
            'eb-mc',
            2,
            [paragraph(text('Which gas do leaves give out in sunlight?'))],
            [
              choice('eb-mc-a', false, paragraph(text('Nitrogen'))),
              choice('eb-mc-b', true, paragraph(text('Oxygen'))),
              choice('eb-mc-c', false, paragraph(text('Argon'))),
              choice('eb-mc-d', false, paragraph(text('Helium'))),
            ],
          ),
          points: 1,
        },
        { ...trueFalse('eb-tf', [paragraph(text('Xylem carries water up the stem.'))], 'true'), points: 1 },
        {
          ...matching(
            'eb-mx',
            [paragraph(text('Match each part of a flower to its job.'))],
            [
              prompt('eb-mx-p1', 'eb-mx-a1', paragraph(text('Anther'))),
              prompt('eb-mx-p2', 'eb-mx-a2', paragraph(text('Stigma'))),
            ],
            [
              bankAnswer('eb-mx-a1', paragraph(text('Makes pollen'))),
              bankAnswer('eb-mx-a2', paragraph(text('Receives pollen'))),
            ],
          ),
          points: 2,
        },
        { ...open('eb-sa', paragraph(text('Explain why a plant kept in the dark loses mass.'))), points: 3 },
        multipart(
          'eb-mp',
          [paragraph(text('A student grows cress seeds on damp cotton wool.'))],
          [
            { ...part('eb-mp-a', [paragraph(text('State one condition seeds need to germinate.'))], suggestedAnswer(paragraph(text('Warmth.')))), attrs: { id: 'eb-mp-a', columns: DEFAULT_COLUMNS, points: 2 } },
            partWithSubparts(
              'eb-mp-b',
              [paragraph(text('Half the seeds are kept in a cupboard.'))],
              [
                {
                  ...subpart(
                    'eb-mp-b-i',
                    [paragraph(text('Which colour are the cupboard seedlings?'))],
                    choicesOf(
                      choice('eb-mp-b-i-a', true, paragraph(text('Yellow'))),
                      choice('eb-mp-b-i-b', false, paragraph(text('Dark green'))),
                    ),
                  ),
                  attrs: { id: 'eb-mp-b-i', columns: DEFAULT_COLUMNS, points: 1 },
                },
                { ...subpart('eb-mp-b-ii', [paragraph(text('Explain the difference in their height.'))], suggestedAnswer()), attrs: { id: 'eb-mp-b-ii', columns: DEFAULT_COLUMNS, points: 6 } },
              ],
            ),
          ],
        ),
      ],
      // The teacher's own Work Space wins over the style's dotted three lines.
      workSpace: { 'eb-mp-a': { height: 64, style: 'lines', fill: false } },
    },
    arrangement(['eb-mc', 'eb-tf', 'eb-mx', 'eb-sa', 'eb-mp']),
    {
      answerKey: true,
      measure: { itemHeight: (item: PageItem) => (item.kind === 'question' ? 600 : 40) },
    },
  ),

  // A table under a picture in a Multipart question's Part (a), on an Exam
  // Board page of A4, its notes cell wrapping over many lines. Measured at
  // nothing, so the plan puts it all on the first page of questions, where
  // it fits with room to spare: the PDF must draw it there, a wrapped cell's
  // lines each taking one line of the page and no more.
  fixture(
    'a wrapping table under a picture in an exam board part',
    {
      title: 'Rolling Ball',
      paperStyle: 'exam-board',
      questions: [
        multipart(
          'eb-tb',
          [paragraph(text('This question is about motion.'))],
          [
            {
              ...part(
                'eb-tb-a',
                [
                  paragraph(text('A class rolls a ball down a ramp and times it.')),
                  {
                    type: 'image-block',
                    attrs: { src: `/local-images/${'f'.repeat(64)}`, caption: 'Fig. 1.1' },
                  },
                  paragraph(text('Complete the table.', mark('strong'))),
                  {
                    type: 'table',
                    content: [
                      {
                        type: 'table_header_row',
                        content: [
                          { type: 'table_header', content: [paragraph(text('Height of ramp / cm'))] },
                          { type: 'table_header', content: [paragraph(text('Time / s'))] },
                          { type: 'table_header', content: [paragraph(text('Notes'))] },
                        ],
                      },
                      {
                        type: 'table_row',
                        content: [
                          { type: 'table_cell', content: [paragraph()] },
                          { type: 'table_cell', content: [paragraph(text('2'))] },
                          {
                            type: 'table_cell',
                            content: [paragraph(text(
                              'Record each time to the nearest tenth of a second. '.repeat(8).trim(),
                            ))],
                          },
                        ],
                      },
                      {
                        type: 'table_row',
                        content: [
                          { type: 'table_cell', content: [paragraph(text('20'))] },
                          { type: 'table_cell', content: [paragraph()] },
                          { type: 'table_cell', content: [paragraph()] },
                        ],
                      },
                      {
                        type: 'table_row',
                        content: [
                          { type: 'table_cell', content: [paragraph()] },
                          { type: 'table_cell', content: [paragraph()] },
                          { type: 'table_cell', content: [paragraph(text('Repeat'))] },
                        ],
                      },
                    ],
                  },
                ],
                suggestedAnswer(),
              ),
              attrs: { id: 'eb-tb-a', columns: DEFAULT_COLUMNS, points: 3 },
            },
          ],
        ),
      ],
    },
    arrangement(['eb-tb']),
    { images: true },
  ),

  // A Multipart question with no stem of its own — only an empty paragraph —
  // opens with Part (a) on its number's line, and a Part with no lead-in
  // opens with Subpart (i) on its letter's line: `1 (a) Fig. 1.1 shows…`,
  // `(b) (i) Name…`, as structured papers print them.
  fixture(
    'a multipart with no stem, and a part with no lead-in',
    {
      title: 'Ramps',
      paperStyle: 'exam-board',
      questions: [
        multipart(
          'ns',
          [paragraph()],
          [
            part(
              'ns-a',
              [paragraph(text('Fig. 1.1 shows a ball rolling down a ramp. State the energy it gains.'))],
              suggestedAnswer(paragraph(text('Kinetic energy.'))),
            ),
            partWithSubparts(
              'ns-b',
              [paragraph()],
              [
                subpart(
                  'ns-b-i',
                  [paragraph(text('Name the force that slows the ball.'))],
                  suggestedAnswer(paragraph(text('Friction.'))),
                ),
                subpart(
                  'ns-b-ii',
                  [paragraph(text('Which unit is energy measured in?'))],
                  choicesOf(
                    choice('ns-b-ii-a', true, paragraph(text('Joule'))),
                    choice('ns-b-ii-b', false, paragraph(text('Newton'))),
                  ),
                ),
              ],
            ),
          ],
        ),
      ],
    },
    arrangement(['ns']),
    { answerKey: true },
  ),

  // A Part whose stem — text, three pictures with their captions, two tables
  // — and ruled room are taller than an A4 page (ADR-0048). It breaks between
  // its stem's blocks: its letter with the first, each caption with its
  // picture, the room and its Points with the last, and Part (b) after it.
  // Measured generously, block by block, so the PDF, which sets the same
  // content by its own metrics, keeps every page inside its margins.
  fixture(
    'a part taller than a page, broken between its stem’s blocks',
    {
      title: 'Pendulums',
      paperStyle: 'exam-board',
      questions: [
        multipart(
          'tp',
          [paragraph(text('This question is about a pendulum.'))],
          [
            {
              ...part(
                'tp-a',
                [
                  paragraph(text('A pendulum is set swinging from three heights.')),
                  ...[1, 2, 3].flatMap((figure) => [
                    { type: 'image-block', attrs: { src: `/local-images/${String(figure).repeat(64)}`, caption: '' } },
                    paragraph(text(`Fig. 1.${figure}`)),
                  ]),
                  ...['Swings', 'Seconds'].map((heading) => ({
                    type: 'table',
                    content: ['Height', '10 cm', '20 cm', '30 cm'].map((cell) => ({
                      type: 'table_row',
                      content: [
                        { type: 'table_cell', content: [paragraph(text(cell))] },
                        { type: 'table_cell', content: [paragraph(text(heading))] },
                      ],
                    })),
                  })),
                  paragraph(text('Describe how the height changes the time for one swing.')),
                ],
                suggestedAnswer(),
              ),
              attrs: { id: 'tp-a', columns: DEFAULT_COLUMNS, points: 4 },
            },
            part('tp-b', [paragraph(text('Name the force that slows the pendulum.'))], suggestedAnswer()),
          ],
        ),
      ],
    },
    arrangement(['tp']),
    {
      images: true,
      measure: {
        itemHeight: (item: PageItem) => {
          if (item.kind !== 'question') return 40
          const blocks = (stem: readonly ProseMirrorJSON[]) =>
            stem.reduce((sum, block) =>
              sum + (block.type === 'image-block' ? 260 : block.type === 'table' ? 160 : 40), 0)
          return blocks(item.stem) + (item.parts ?? []).reduce(
            (sum, piece) => sum + 30 + blocks(piece.stem) + (piece.workSpace?.height ?? 0) + (piece.pointsAfter ? 30 : 0),
            0,
          )
        },
      },
    },
  ),

  // Each Paper Style over every Question Type, so every adapter prints its
  // blanks, its letters, its Word Bank and its default Work Space the way the
  // plan resolved them. Two questions to a page, so the PDF has room to draw
  // them; Condensed's measure fits every answer four across. Unpointed, so
  // Exam Board prints no paper total beneath the title.
  ...(['classic', 'condensed', 'exam-board'] as const).map((paperStyle) =>
    fixture(
      `every question type in the ${paperStyle} paper style`,
      { ...PAPER_STYLE_EXAM, title: `${paperStyle} style`, paperStyle },
      arrangement(['ys-mc', 'ys-tf', 'ys-mx', 'ys-sa', 'ys-mp']),
      {
        answerKey: true,
        measure: {
          itemHeight: (item: PageItem) => (item.kind === 'question' ? 330 : 40),
          ...(paperStyle === 'condensed' ? { choiceWidth: () => 80 } : {}),
        },
      },
    ),
  ),
]
